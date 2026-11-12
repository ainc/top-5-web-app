// Roster linking, the path that used to claim the wrong person.
// A Google first name that matched one unsigned roster row used to attach
// that row with no message. Zero matches or several matches used to insert a
// second profile. The rules now are:
//   1. An email in the roster map claims that display name (Kyle's mailbox
//      is "Kyle Raney", Mack's mailboxes are "Mack" and not "Mackenzie").
//   2. Otherwise an exact display name claims the one unsigned profile.
//   3. Otherwise hold_roster_link reports a first-name clash and sign-in stops.
//      The database writes the staff inbox line. This test only checks that
//      the app refuses to attach or insert.
//   4. A name that matches nothing creates a new profile.
//
// The user passed in is a Supabase User with an email and a full_name. That
// is the shape Google leaves on the session after OAuth. Nothing here opens
// Google, and nothing here writes to the shared database. A live first-name
// clash would notify staff, so this stays on a fake client.
//
// Kyle: when you have Google Cloud admin access, add a separate test for the
// login itself. This file should stay the roster rules. The Google test would
// cover the handshake in src/auth.tsx, which we cannot run without the Cloud
// console:
//   - signInWithGoogle asks for openid, email, and profile, sends redirectTo
//     as the current origin, and sets the hd hint from
//     VITE_GOOGLE_WORKSPACE_DOMAIN when that env var is set. hd is only a
//     hint. The email check in enrollSignedInUser is what refuses a personal
//     Gmail that is not in the roster map.
//   - localhost and the Netlify origin both have to be Supabase redirect URLs,
//     and the Google provider has to be enabled on the Supabase project.
//   - googleDisplayName reads identity_data.full_name or name, then
//     user_metadata. A test user in Google Cloud is the way to prove a real
//     token carries that name. Do not invent one against production.
//   - A failed return puts error_description in the query or the hash.
//     takeRedirectError surfaces it and strips it, unless a code or access
//     token is also present (that case keeps the exchange and drops the error).
//   - After a first-name hold, auth.tsx signs out only once the banner text
//     includes "attach this Google account", so the message survives the
//     session clear. A Google test can stop at the redirect. It should not
//     create a roster clash on the live project. Use a throwaway Supabase
//     project, or keep mocking the provider the way this file does.

import type { User } from "@supabase/supabase-js";
import { beforeEach, expect, it, vi } from "vitest";
import { linkRosterAccount } from "./remoteBoard";

type Filter = { kind: "eq" | "is" | "ilike"; column: string; value: unknown };
type Query = {
  table: string;
  op: "select" | "insert" | "update" | "rpc";
  filters: Filter[];
  payload: unknown;
};

// The fake client is swapped per case. vi.mock is hoisted, so the holder has
// to be created before the mock factory runs.
const holder = vi.hoisted(() => ({ current: null as { queries: Query[] } | null }));

vi.mock("./supabaseClient", () => ({
  getSupabase: () => holder.current,
}));

function googleUser(id: string, email: string, fullName: string): User {
  return {
    id,
    email,
    user_metadata: { full_name: fullName },
    identities: [{ provider: "google", identity_data: { full_name: fullName } }],
  } as unknown as User;
}

// Answers the four claim lookups. An exact or email match returns one unsigned
// profile. Anything else returns no row, which is what sends the caller on to
// the hold, and then to an insert when the hold comes back empty.
function install(matchName: string | null, holdNames: string | null) {
  const queries: Query[] = [];
  holder.current = { queries };

  function answer(query: Query) {
    queries.push(query);
    if (query.op === "rpc") return { data: holdNames, error: null };
    if (query.op === "update") return { data: null, error: null };
    if (query.op === "insert") return { data: { id: "profile-new" }, error: null };
    const byAuth = query.filters.find((filter) => filter.kind === "eq" && filter.column === "auth_user_id");
    if (byAuth) return { data: null, error: null };
    const byName = query.filters.find((filter) => filter.kind === "ilike" && filter.column === "display_name");
    if (matchName && byName?.value === matchName) {
      return { data: [{ id: "profile-match", display_name: matchName }], error: null };
    }
    return { data: [], error: null };
  }

  // Supabase builders are thenable. update().eq() is awaited directly, and
  // select().limit() is too. maybeSingle() and single() are also awaited.
  // Every method returns the same builder, and awaiting it runs the query.
  function builder(table: string) {
    const state: Query = { table, op: "select", filters: [], payload: null };
    const chain = {
      select() {
        return chain;
      },
      insert(payload: unknown) {
        state.op = "insert";
        state.payload = payload;
        return chain;
      },
      update(payload: unknown) {
        state.op = "update";
        state.payload = payload;
        return chain;
      },
      eq(column: string, value: unknown) {
        state.filters.push({ kind: "eq", column, value });
        return chain;
      },
      is(column: string, value: unknown) {
        state.filters.push({ kind: "is", column, value });
        return chain;
      },
      ilike(column: string, value: unknown) {
        state.filters.push({ kind: "ilike", column, value });
        return chain;
      },
      limit() {
        return chain;
      },
      maybeSingle() {
        return chain;
      },
      single() {
        return chain;
      },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
        return Promise.resolve(answer({ ...state, filters: state.filters.map((filter) => ({ ...filter })) })).then(resolve, reject);
      },
    };
    return chain;
  }

  const client = {
    queries,
    from(table: string) {
      return builder(table);
    },
    rpc(fn: string, payload: unknown) {
      return Promise.resolve(answer({ table: fn, op: "rpc", filters: [], payload }));
    },
  };
  holder.current = client;
  return client;
}

beforeEach(() => {
  holder.current = null;
});

it("claims a mapped email, an exact name, holds a first name, and creates a new person", async () => {
  // The Google label is "Kyle", not "Kyle Raney". The email map is what picks
  // the roster row, and the account id is written onto that profile only.
  const emailClient = install("Kyle Raney", null);
  const byEmail = await linkRosterAccount(googleUser("auth-kyle", "kyle@awesomeinc.org", "Kyle"));
  expect(byEmail).toEqual({ profileId: "profile-match", rosterName: "Kyle Raney" });
  const emailUpdate = emailClient.queries.find((query) => query.op === "update");
  expect(emailUpdate?.payload).toEqual({ auth_user_id: "auth-kyle" });
  expect(emailUpdate?.filters).toContainEqual({ kind: "eq", column: "id", value: "profile-match" });
  expect(emailClient.queries.some((query) => query.op === "rpc" || query.op === "insert")).toBe(false);

  // No email map entry. The whole Google name equals one unsigned display name,
  // so that profile is attached. A first name alone would not take this branch.
  const exactClient = install("Cam", null);
  const byName = await linkRosterAccount(googleUser("auth-cam", "cam.visitor@example.com", "Cam"));
  expect(byName).toEqual({ profileId: "profile-match", rosterName: "Cam" });
  expect(exactClient.queries.some((query) => query.op === "rpc" || query.op === "insert")).toBe(false);

  // "Ben Starling" is not an exact roster name. The hold returns the unsigned
  // "Ben", sign-in throws, and no profile is inserted or attached.
  const holdClient = install(null, "Ben");
  await expect(linkRosterAccount(googleUser("auth-ben", "ben.visitor@example.com", "Ben Starling"))).rejects.toThrow(
    "Ben Starling matches the roster name Ben. An admin needs to attach this Google account before the board will open.",
  );
  expect(holdClient.queries.some((query) => query.op === "rpc" && query.table === "hold_roster_link")).toBe(true);
  expect(holdClient.queries.some((query) => query.op === "insert" || query.op === "update")).toBe(false);

  // Nothing on the roster shares this name, so a new profile is created with
  // the Google display name and this account id.
  const createClient = install(null, null);
  const created = await linkRosterAccount(googleUser("auth-ada", "ada@awesomeinc.org", "Ada Lovelace"));
  expect(created).toEqual({ profileId: "profile-new", rosterName: "Ada Lovelace" });
  expect(createClient.queries.find((query) => query.op === "insert")?.payload).toEqual({
    display_name: "Ada Lovelace",
    auth_user_id: "auth-ada",
  });
});
