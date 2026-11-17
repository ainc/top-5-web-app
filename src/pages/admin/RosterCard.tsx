// People on the season being edited. Adding and removing change this season's
// membership. A nickname is stored on the profile, so it shows on every page.

import { Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "../../supabaseClient";
import { fail, type AdminNotice, type Season } from "./adminShared";

type Person = { id: string; name: string; nickname: string; savedNickname: string };
type DraftSeason = { id: string; name: string };

export type RosterName = { id: string; name: string };

export function RosterCard({ season, onPeople, saved, failed }: AdminNotice & { season: Season; onPeople: (people: RosterName[]) => void }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [drafts, setDrafts] = useState<DraftSeason[]>([]);
  const [removeFromDrafts, setRemoveFromDrafts] = useState(true);
  const [newPerson, setNewPerson] = useState("");
  const closed = season.status === "closed";

  const load = useCallback(async () => {
    const supabase = getSupabase();
    const [{ data: memberRows, error }, draftResult] = await Promise.all([
      supabase.from("season_members").select("profile_id, profiles(display_name, nickname)").eq("season_id", season.id),
      season.status === "active"
        ? supabase.from("seasons").select("id, name").eq("status", "draft").order("starts_on")
        : Promise.resolve({ data: [] as DraftSeason[], error: null }),
    ]);
    fail(error, "read roster");
    fail(draftResult.error, "read draft seasons");
    const next = (memberRows ?? [])
      .map((row) => {
        const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        return {
          id: String(row.profile_id),
          name: profile?.display_name ?? "Unknown",
          nickname: String(profile?.nickname ?? ""),
          savedNickname: String(profile?.nickname ?? "").trim(),
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
    setNewPerson("");
    saved(
      season.status === "draft"
        ? `${name} is on this draft. They join the live board when you activate it.`
        : `${name} is on the roster. They appear on the next blank week.`,
    );
    await load();
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
    if (season.status === "active" && removeFromDrafts && drafts.length > 0) {
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
        ? `${person.name} was removed from this draft. The live roster and saved task history are unchanged.`
        : updatedDraftNames.length > 0
          ? `${person.name} left ${season.name} and ${updatedDraftNames.join(", ")}. Their task history is preserved.`
          : `${person.name} left the roster. Their task history is preserved.`,
    );
    await load();
  }

  async function saveNickname(person: Person, nickname: string) {
    if (season.status === "closed") return;
    const next = nickname.trim();
    if (next === person.savedNickname) return;
    const { error } = await getSupabase().from("profiles").update({ nickname: next || null }).eq("id", person.id);
    fail(error, "save nickname");
    setPeople((current) => current.map((item) => (item.id === person.id ? { ...item, nickname: next, savedNickname: next } : item)));
    onPeople(people.map((item) => ({ id: item.id, name: item.name })));
    saved(next ? `${person.name} will show as ${next}.` : `${person.name} will show their roster name.`);
  }

  return (
    <div className="admin-card tone-roster">
      <h2>
        <Users aria-hidden="true" />
        Roster
      </h2>
      <p className="field-help">
        {season.status === "draft"
          ? "People copied onto this draft. Adding or removing someone changes the upcoming roster only. A nickname still changes that person's name on every page."
          : "People who show up on the dashboard, leaderboard, and new weeks. A nickname is what other pages show instead of the roster name. Leave it blank to keep the roster name. Removing someone takes them off the dashboard and leaderboard while keeping their saved task history."}
      </p>
      {season.status === "active" && drafts.length > 0 ? (
        <label className="admin-check field-help">
          <input type="checkbox" checked={removeFromDrafts} onChange={(event) => setRemoveFromDrafts(event.target.checked)} />
          Also remove from future {drafts.length === 1 ? "draft" : "drafts"} ({drafts.map((draft) => draft.name).join(", ")})
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
          <li key={person.id}>
            <span>{person.name}</span>
            <input
              value={person.nickname}
              maxLength={40}
              placeholder="Nickname"
              aria-label={`Nickname for ${person.name}`}
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
