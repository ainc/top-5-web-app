// Waiting Google accounts. Sign-in writes the row. This card only reads the
// unresolved ones and lets an admin attach or add the person. It does not
// wait on the season card, because a hold is about the roster, not the season
// being edited.

import { Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { canAssignRoles, useAuth } from "../../auth";
import { getSupabase } from "../../supabaseClient";
import { fail, type AdminNotice } from "./adminShared";

type LinkRequest = { authUserId: string; email: string; googleName: string; matchNames: string; choice: string };
type UnsignedPerson = { id: string; name: string };

export function RosterLinksCard({ saved, failed }: AdminNotice) {
  const { role } = useAuth();
  const assignRoles = canAssignRoles(role);
  const [linkRequests, setLinkRequests] = useState<LinkRequest[]>([]);
  const [unsignedPeople, setUnsignedPeople] = useState<UnsignedPerson[]>([]);

  const load = useCallback(async () => {
    const supabase = getSupabase();
    const [{ data: waiting, error: waitingError }, { data: unsigned, error: unsignedError }] = await Promise.all([
      supabase.from("roster_link_requests").select("auth_user_id, email, google_name, match_names").is("resolved_at", null).order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, display_name").is("auth_user_id", null).order("display_name"),
    ]);
    fail(waitingError, "read roster links");
    fail(unsignedError, "read unsigned roster");
    const openProfiles = unsigned ?? [];
    setUnsignedPeople(openProfiles.map((row) => ({ id: String(row.id), name: String(row.display_name) })));
    setLinkRequests((current) =>
      (waiting ?? []).map((row) => {
        const authUserId = String(row.auth_user_id);
        const matchNames = String(row.match_names);
        const names = new Set(matchNames.split(", ").map((name) => name.trim().toLowerCase()));
        const matches = openProfiles.filter((person) => names.has(String(person.display_name).trim().toLowerCase()));
        const previous = current.find((item) => item.authUserId === authUserId)?.choice ?? "";
        const choice = matches.some((person) => String(person.id) === previous) ? previous : matches.length === 1 ? String(matches[0].id) : "";
        return {
          authUserId,
          email: String(row.email ?? ""),
          googleName: String(row.google_name),
          matchNames,
          choice,
        };
      }),
    );
  }, []);

  useEffect(() => {
    load().catch((reason: unknown) => failed(reason, "Could not load waiting accounts."));
  }, [load, failed]);

  useEffect(() => {
    if (linkRequests.length === 0 || window.location.hash !== "#roster-links") return;
    document.getElementById("roster-links")?.scrollIntoView({ block: "start" });
  }, [linkRequests]);

  async function attachLink(request: LinkRequest) {
    if (!assignRoles) throw new Error("Only an admin can attach a Google account.");
    if (!request.choice) throw new Error("Choose the roster name for this Google account.");
    const { error: attachError } = await getSupabase().rpc("attach_roster_link", {
      target_auth: request.authUserId,
      target_profile: request.choice,
    });
    fail(attachError, "attach account");
    saved(`${request.googleName} is attached. They can sign in on that roster name.`);
    await load();
  }

  async function openLink(request: LinkRequest) {
    if (!assignRoles) throw new Error("Only an admin can add this Google account.");
    const { error: openError } = await getSupabase().rpc("open_roster_link", { target_auth: request.authUserId });
    fail(openError, "add account");
    saved(`${request.googleName} was added as a new person. They join the live roster the next time they sign in.`);
    await load();
  }

  if (linkRequests.length === 0) return null;

  return (
    <div className="admin-card tone-roster" id="roster-links">
      <h2>
        <Users aria-hidden="true" />
        Waiting Google accounts
      </h2>
      <p className="field-help">
        These accounts share a first name with someone already on the roster, so sign-in stopped instead of guessing. Attach uses the roster name you choose. New person keeps the Google name. Only an admin can do either.
      </p>
      <ul className="admin-list">
        {linkRequests.map((request) => {
          const names = new Set(request.matchNames.split(", ").map((name) => name.trim().toLowerCase()));
          const matches = unsignedPeople.filter((person) => names.has(person.name.trim().toLowerCase()));
          return (
            <li className="roster-link" key={request.authUserId}>
              <span>
                {request.googleName}
                {request.email ? ` · ${request.email}` : ""}
              </span>
              <select
                aria-label={`Roster name for ${request.googleName}`}
                value={request.choice}
                disabled={!assignRoles}
                onChange={(event) =>
                  setLinkRequests((current) => current.map((item) => (item.authUserId === request.authUserId ? { ...item, choice: event.target.value } : item)))
                }
              >
                <option value="">Choose a roster name</option>
                {matches.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!assignRoles || !request.choice}
                onClick={() => attachLink(request).catch((reason: unknown) => failed(reason, "Could not attach that account."))}
              >
                Attach
              </button>
              <button
                type="button"
                disabled={!assignRoles}
                onClick={() => openLink(request).catch((reason: unknown) => failed(reason, "Could not add that person."))}
              >
                New person
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
