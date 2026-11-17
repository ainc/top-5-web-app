// People on the season being edited. Adding and removing change this season's
// membership (and optional future drafts). Roster display names and nicknames
// are stored on profiles, so renaming or setting a nickname updates every page.

import { Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "../../supabaseClient";
import { fail, type AdminNotice, type Season } from "./adminShared";

type Person = {
  id: string;
  name: string;
  savedName: string;
  nickname: string;
  savedNickname: string;
  linked: boolean;
};
type DraftSeason = { id: string; name: string };

export type RosterName = { id: string; name: string };

export function RosterCard({
  season,
  onPeople,
  onRosterChange,
  saved,
  failed,
}: AdminNotice & {
  season: Season;
  onPeople: (people: RosterName[]) => void;
  onRosterChange: () => void;
}) {
  const [people, setPeople] = useState<Person[]>([]);
  const [drafts, setDrafts] = useState<DraftSeason[]>([]);
  const [syncDrafts, setSyncDrafts] = useState(true);
  const [newPerson, setNewPerson] = useState("");
  const closed = season.status === "closed";

  const load = useCallback(async () => {
    const supabase = getSupabase();
    const [{ data: memberRows, error }, draftResult] = await Promise.all([
      supabase.from("season_members").select("profile_id, profiles(display_name, nickname, auth_user_id)").eq("season_id", season.id),
      season.status === "active"
        ? supabase.from("seasons").select("id, name").eq("status", "draft").order("starts_on")
        : Promise.resolve({ data: [] as DraftSeason[], error: null }),
    ]);
    fail(error, "read roster");
    fail(draftResult.error, "read draft seasons");
    const next = (memberRows ?? [])
      .map((row) => {
        const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        const name = String(profile?.display_name ?? "Unknown");
        return {
          id: String(row.profile_id),
          name,
          savedName: name.trim(),
          nickname: String(profile?.nickname ?? ""),
          savedNickname: String(profile?.nickname ?? "").trim(),
          linked: Boolean(profile?.auth_user_id),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    setDrafts(
      (draftResult.data ?? []).map((row) => ({
        id: String(row.id),
        name: String(row.name),
      })),
    );
    setPeople(next);
    onPeople(next.map((person) => ({ id: person.id, name: person.name })));
  }, [season.id, season.status, onPeople]);

  useEffect(() => {
    load().catch((reason: unknown) => failed(reason, "Could not load the roster."));
  }, [load, failed]);

  async function addPerson() {
    const name = newPerson.trim();
    if (!name) return;
    const supabase = getSupabase();
    const { data: existing, error: findError } = await supabase.from("profiles").select("id").ilike("display_name", name).limit(1);
    fail(findError, "find person");
    let profileId = existing?.[0]?.id as string | undefined;
    if (!profileId) {
      const { data: inserted, error: insertError } = await supabase.from("profiles").insert({ display_name: name }).select("id").single();
      fail(insertError, "add person");
      if (!inserted) throw new Error("add person: no profile returned");
      profileId = inserted.id;
    }
    const { error } = await supabase.from("season_members").upsert(
      { season_id: season.id, profile_id: profileId },
      { onConflict: "season_id,profile_id" },
    );
    fail(error, "add roster");

    const addedDraftNames: string[] = [];
    if (season.status === "active" && syncDrafts && drafts.length > 0) {
      const { error: draftAddError } = await supabase.from("season_members").upsert(
        drafts.map((draft) => ({ season_id: draft.id, profile_id: profileId! })),
        { onConflict: "season_id,profile_id" },
      );
      fail(draftAddError, "add to future draft rosters");
      for (const draft of drafts) addedDraftNames.push(draft.name);
    }

    setNewPerson("");
    saved(
      season.status === "draft"
        ? `${name} is on this draft. They join the live board when you activate it.`
        : addedDraftNames.length > 0
          ? `${name} joined ${season.name} and ${addedDraftNames.join(", ")}. They appear on the next blank week.`
          : `${name} is on the roster. They appear on the next blank week.`,
    );
    await load();
    onRosterChange();
  }

  // Removing only deletes membership and team assignment for the selected
  // season (and future drafts if checked). day_entries, tasks, bonus_checks,
  // edit_log, and the profile itself stay intact so task history is preserved.
  async function removePerson(person: Person) {
    if (season.status === "closed") return;
    const supabase = getSupabase();
    const { error } = await supabase.from("season_members").delete().eq("season_id", season.id).eq("profile_id", person.id);
    fail(error, "remove roster");
    const { error: teamError } = await supabase.from("team_members").delete().eq("season_id", season.id).eq("profile_id", person.id);
    fail(teamError, "clear team assignment");

    const updatedDraftNames: string[] = [];
    if (season.status === "active" && syncDrafts && drafts.length > 0) {
      const draftIds = drafts.map((draft) => draft.id);
      const { data: matchingDrafts, error: matchError } = await supabase
        .from("season_members")
        .select("season_id")
        .eq("profile_id", person.id)
        .in("season_id", draftIds);
      fail(matchError, "check future draft rosters");
      const matchedIds = (matchingDrafts ?? []).map((row) => String(row.season_id));
      if (matchedIds.length > 0) {
        const { error: draftMemberError } = await supabase
          .from("season_members")
          .delete()
          .eq("profile_id", person.id)
          .in("season_id", matchedIds);
        fail(draftMemberError, "remove from future draft rosters");
        const { error: draftTeamError } = await supabase
          .from("team_members")
          .delete()
          .eq("profile_id", person.id)
          .in("season_id", matchedIds);
        fail(draftTeamError, "clear future draft team assignments");
        for (const draft of drafts) {
          if (matchedIds.includes(draft.id)) updatedDraftNames.push(draft.name);
        }
      }
    }

    saved(
      season.status === "draft"
        ? `${person.savedName} was removed from this draft. The live roster and saved task history are unchanged.`
        : updatedDraftNames.length > 0
          ? `${person.savedName} left ${season.name} and ${updatedDraftNames.join(", ")}. Their task history is preserved.`
          : `${person.savedName} left the roster. Their task history is preserved.`,
    );
    await load();
    onRosterChange();
  }

  async function saveName(person: Person, rawName: string) {
    if (season.status === "closed") return;
    const next = rawName.trim();
    if (next === person.savedName) return;
    if (!next) {
      setPeople((current) => current.map((item) => (item.id === person.id ? { ...item, name: person.savedName } : item)));
      throw new Error("A roster name cannot be blank.");
    }
    const supabase = getSupabase();
    const { data: conflict, error: conflictError } = await supabase
      .from("profiles")
      .select("id")
      .neq("id", person.id)
      .ilike("display_name", next)
      .limit(1);
    fail(conflictError, "check roster name");
    if ((conflict ?? []).length > 0) {
      setPeople((current) => current.map((item) => (item.id === person.id ? { ...item, name: person.savedName } : item)));
      throw new Error(`Another profile is already named ${next}.`);
    }
    const { error } = await supabase.from("profiles").update({ display_name: next }).eq("id", person.id);
    fail(error, "rename person");
    const updated = people.map((item) => (item.id === person.id ? { ...item, name: next, savedName: next } : item));
    setPeople(updated);
    onPeople(updated.map((item) => ({ id: item.id, name: item.name })));
    saved(`${person.savedName} was renamed to ${next}.`);
    onRosterChange();
  }

  async function saveNickname(person: Person, nickname: string) {
    if (season.status === "closed") return;
    const next = nickname.trim();
    if (next === person.savedNickname) return;
    const { error } = await getSupabase().from("profiles").update({ nickname: next || null }).eq("id", person.id);
    fail(error, "save nickname");
    setPeople((current) => current.map((item) => (item.id === person.id ? { ...item, nickname: next, savedNickname: next } : item)));
    onPeople(people.map((item) => ({ id: item.id, name: item.name })));
    saved(next ? `${person.savedName} will show as ${next}.` : `${person.savedName} will show their roster name.`);
  }

  return (
    <div className="admin-card tone-roster">
      <h2>
        <Users aria-hidden="true" />
        Roster
      </h2>
      <p className="field-help">
        {season.status === "draft"
          ? "People copied onto this draft. Adding or removing someone changes the upcoming roster only. A roster name or nickname change still follows that profile across every page."
          : "People who show up on the dashboard, leaderboard, and new weeks. Renaming updates the profile everywhere; a nickname replaces only how the name displays. Removing someone takes them off the dashboard and leaderboard while keeping their saved task history."}
      </p>
      {season.status === "active" && drafts.length > 0 ? (
        <label className="admin-check field-help">
          <input type="checkbox" checked={syncDrafts} onChange={(event) => setSyncDrafts(event.target.checked)} />
          Also add/remove on future {drafts.length === 1 ? "draft" : "drafts"} ({drafts.map((draft) => draft.name).join(", ")})
        </label>
      ) : null}
      <form
        className="admin-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (closed) return;
          addPerson().catch((reason: unknown) => failed(reason, "Could not add that person."));
        }}
      >
        <input value={newPerson} placeholder="Name" disabled={closed} onChange={(event) => setNewPerson(event.target.value)} />
        <button type="submit" disabled={closed}>
          Add person
        </button>
      </form>
      <ul className="admin-list">
        {people.map((person) => (
          <li className="roster-row" key={person.id}>
            <input
              value={person.name}
              maxLength={60}
              aria-label={`Roster name for ${person.savedName}`}
              disabled={closed}
              onChange={(event) => setPeople(people.map((item) => (item.id === person.id ? { ...item, name: event.target.value } : item)))}
              onBlur={(event) => {
                saveName(person, event.target.value).catch((reason: unknown) => failed(reason, "Could not rename that person."));
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  (event.target as HTMLInputElement).blur();
                }
              }}
            />
            <span
              className={person.linked ? "roster-link-pill is-linked" : "roster-link-pill"}
              title={person.linked ? "Signed in with Google" : "No Google account linked yet"}
            >
              {person.linked ? "Google linked" : "Not linked"}
            </span>
            <input
              value={person.nickname}
              maxLength={40}
              placeholder="Nickname"
              aria-label={`Nickname for ${person.savedName}`}
              disabled={closed}
              onChange={(event) => setPeople(people.map((item) => (item.id === person.id ? { ...item, nickname: event.target.value } : item)))}
              onBlur={(event) => {
                saveNickname(person, event.target.value).catch((reason: unknown) => failed(reason, "Could not save that nickname."));
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  (event.target as HTMLInputElement).blur();
                }
              }}
            />
            <button type="button" disabled={closed} onClick={() => removePerson(person).catch((reason: unknown) => failed(reason, "Could not remove that person."))}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
