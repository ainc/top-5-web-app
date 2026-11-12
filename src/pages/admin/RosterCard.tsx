// People on the season being edited. Adding and removing change this season's
// membership. A nickname is stored on the profile, so it shows on every page.

import { Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "../../supabaseClient";
import { fail, type AdminNotice, type Season } from "./adminShared";

type Person = { id: string; name: string; nickname: string; savedNickname: string };

export type RosterName = { id: string; name: string };

export function RosterCard({ season, onPeople, saved, failed }: AdminNotice & { season: Season; onPeople: (people: RosterName[]) => void }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [newPerson, setNewPerson] = useState("");
  const closed = season.status === "closed";

  const load = useCallback(async () => {
    const { data: memberRows, error } = await getSupabase()
      .from("season_members")
      .select("profile_id, profiles(display_name, nickname)")
      .eq("season_id", season.id);
    fail(error, "read roster");
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
    setPeople(next);
    onPeople(next.map((person) => ({ id: person.id, name: person.name })));
  }, [season.id, onPeople]);

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

  async function removePerson(person: Person) {
    if (season.status === "closed") return;
    const { error } = await getSupabase().from("season_members").delete().eq("season_id", season.id).eq("profile_id", person.id);
    fail(error, "remove roster");
    saved(
      season.status === "draft"
        ? `${person.name} was removed from this draft. The live roster is unchanged.`
        : `${person.name} left the roster. Days already saved stay on past weeks.`,
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
          : "People who show up on the board. A nickname is what other pages show instead of the roster name. Leave it blank to keep the roster name. Removing someone hides them from new weeks. Days already saved stay."}
      </p>
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
