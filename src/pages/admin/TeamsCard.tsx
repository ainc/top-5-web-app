// Team names and who is on them for this season. Shown only while scoring is
// Teams. Each person can be on one team. Clearing the select removes that row.

import { Handshake } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "../../supabaseClient";
import { fail, type AdminNotice, type Season } from "./adminShared";

type Person = { id: string; name: string; teamId: string };
type Team = { id: string; name: string };

export function TeamsCard({ season, saved, failed }: AdminNotice & { season: Season }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [newTeam, setNewTeam] = useState("");
  const closed = season.status === "closed";

  const load = useCallback(async () => {
    const supabase = getSupabase();
    const [{ data: memberRows, error: memberError }, { data: teamRows, error: teamError }, { data: assignmentRows, error: assignmentError }] = await Promise.all([
      supabase.from("season_members").select("profile_id, profiles(display_name)").eq("season_id", season.id),
      supabase.from("teams").select("id, name").eq("season_id", season.id).order("name"),
      supabase.from("team_members").select("profile_id, team_id").eq("season_id", season.id),
    ]);
    fail(memberError, "read roster");
    fail(teamError, "read teams");
    fail(assignmentError, "read team assignments");
    const assigned = new Map((assignmentRows ?? []).map((row) => [String(row.profile_id), String(row.team_id)]));
    setTeams((teamRows ?? []).map((row) => ({ id: row.id, name: row.name })));
    setPeople(
      (memberRows ?? [])
        .map((row) => {
          const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
          return {
            id: String(row.profile_id),
            name: profile?.display_name ?? "Unknown",
            teamId: assigned.get(String(row.profile_id)) ?? "",
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }, [season.id]);

  useEffect(() => {
    load().catch((reason: unknown) => failed(reason, "Could not load teams."));
  }, [load, failed]);

  async function addTeam() {
    if (season.status === "closed") return;
    const name = newTeam.trim();
    if (!name) return;
    const { error } = await getSupabase().from("teams").insert({ season_id: season.id, name });
    fail(error, "add team");
    setNewTeam("");
    saved(`Team ${name} added.`);
    await load();
  }

  async function assignTeam(person: Person, teamId: string) {
    if (season.status === "closed") return;
    const supabase = getSupabase();
    if (!teamId) {
      const { error } = await supabase.from("team_members").delete().eq("season_id", season.id).eq("profile_id", person.id);
      fail(error, "clear team");
    } else {
      const { error } = await supabase.from("team_members").upsert(
        { season_id: season.id, team_id: teamId, profile_id: person.id },
        { onConflict: "season_id,profile_id" },
      );
      fail(error, "assign team");
    }
    saved("Team assignment saved.");
    await load();
  }

  return (
    <div className="admin-card tone-teams">
      <h2>
        <Handshake aria-hidden="true" />
        Teams
      </h2>
      <p className="field-help">Shown because scoring is set to Teams. Each person can be on one team. No team leaves them out of the team standing.</p>
      <form
        className="admin-row"
        onSubmit={(event) => {
          event.preventDefault();
          addTeam().catch((reason: unknown) => failed(reason, "Could not add that team."));
        }}
      >
        <input value={newTeam} placeholder="Team name" disabled={closed} onChange={(event) => setNewTeam(event.target.value)} />
        <button type="submit" disabled={closed}>
          Add team
        </button>
      </form>
      <ul className="admin-list">
        {people.map((person) => (
          <li key={person.id}>
            <span>{person.name}</span>
            <select
              value={person.teamId}
              disabled={closed}
              onChange={(event) => assignTeam(person, event.target.value).catch((reason: unknown) => failed(reason, "Could not assign that team."))}
            >
              <option value="">No team</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </div>
  );
}
