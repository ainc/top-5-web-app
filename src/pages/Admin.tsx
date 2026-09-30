// Season, bonus, roster, team, and role edits.
// Google sign-in is not required. The policies are still open, so this page
// writes with the publishable key. A role is stored on the roster profile.
// It does not create a Google user.

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "../supabaseClient";

type Season = {
  id: string;
  name: string;
  starts_on: string;
  length_weeks: number;
  scoring_mode: "individual" | "teams";
};

type Bonus = { id: string; key: string; name: string; points: number; retired: boolean };
type Person = { id: string; name: string; role: string; teamId: string };
type Team = { id: string; name: string };

function fail(error: { message: string } | null, action: string): void {
  if (error) throw new Error(`${action}: ${error.message}`);
}

export function Admin() {
  const [season, setSeason] = useState<Season | null>(null);
  const [pointsPerTask, setPointsPerTask] = useState(0);
  const [bonuses, setBonuses] = useState<Bonus[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [newPerson, setNewPerson] = useState("");
  const [newTeam, setNewTeam] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const supabase = getSupabase();
    const { data: openSeason, error: seasonError } = await supabase
      .from("seasons")
      .select("id, name, starts_on, length_weeks, scoring_mode")
      .eq("is_open", true)
      .maybeSingle();
    fail(seasonError, "read season");
    if (!openSeason) throw new Error("No open season.");
    const current: Season = {
      id: openSeason.id,
      name: openSeason.name,
      starts_on: openSeason.starts_on,
      length_weeks: openSeason.length_weeks,
      scoring_mode: openSeason.scoring_mode === "teams" ? "teams" : "individual",
    };
    const [{ data: rules, error: rulesError }, { data: bonusRows, error: bonusError }, { data: memberRows, error: memberError }, { data: teamRows, error: teamError }, { data: roleRows, error: roleError }, { data: assignmentRows, error: assignmentError }] =
      await Promise.all([
        supabase.from("scoring_rules").select("points_per_task").eq("season_id", current.id).maybeSingle(),
        supabase.from("bonus_definitions").select("id, key, name, points, retired_at").eq("season_id", current.id).order("key"),
        supabase.from("season_members").select("profile_id, profiles(display_name)").eq("season_id", current.id),
        supabase.from("teams").select("id, name").eq("season_id", current.id).order("name"),
        supabase.from("user_roles").select("profile_id, role"),
        supabase.from("team_members").select("profile_id, team_id").eq("season_id", current.id),
      ]);
    fail(rulesError, "read points per task");
    fail(bonusError, "read bonuses");
    fail(memberError, "read roster");
    fail(teamError, "read teams");
    fail(roleError, "read roles");
    fail(assignmentError, "read team assignments");
    const roles = new Map((roleRows ?? []).map((row) => [String(row.profile_id), String(row.role)]));
    const assigned = new Map((assignmentRows ?? []).map((row) => [String(row.profile_id), String(row.team_id)]));
    setSeason(current);
    setPointsPerTask(Number(rules?.points_per_task ?? 0));
    setBonuses(
      (bonusRows ?? []).map((row) => ({
        id: row.id,
        key: row.key,
        name: row.name,
        points: row.points,
        retired: row.retired_at != null,
      })),
    );
    setTeams((teamRows ?? []).map((row) => ({ id: row.id, name: row.name })));
    setPeople(
      (memberRows ?? [])
        .map((row) => {
          const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
          return {
            id: String(row.profile_id),
            name: profile?.display_name ?? "Unknown",
            role: roles.get(String(row.profile_id)) ?? "",
            teamId: assigned.get(String(row.profile_id)) ?? "",
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }, []);

  useEffect(() => {
    load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load admin."));
  }, [load]);

  function saved(text: string) {
    setError("");
    setMessage(text);
    window.dispatchEvent(new Event("top5-reload"));
  }

  async function saveSeason() {
    if (!season) return;
    const supabase = getSupabase();
    const { error: seasonError } = await supabase
      .from("seasons")
      .update({
        name: season.name.trim(),
        starts_on: season.starts_on,
        length_weeks: season.length_weeks,
        scoring_mode: season.scoring_mode,
      })
      .eq("id", season.id);
    fail(seasonError, "save season");
    const { error: rulesError } = await supabase
      .from("scoring_rules")
      .update({ points_per_task: pointsPerTask })
      .eq("season_id", season.id);
    fail(rulesError, "save points per task");
    saved("Season saved.");
    await load();
  }

  async function saveBonuses() {
    const supabase = getSupabase();
    for (const bonus of bonuses) {
      const { error } = await supabase
        .from("bonus_definitions")
        .update({
          name: bonus.name.trim(),
          points: bonus.points,
          retired_at: bonus.retired ? new Date().toISOString() : null,
        })
        .eq("id", bonus.id);
      fail(error, `save ${bonus.key}`);
    }
    saved("Bonuses saved. A retired bonus scores 0.");
  }

  async function addPerson() {
    if (!season) return;
    const name = newPerson.trim();
    if (!name) return;
    const supabase = getSupabase();
    const { data: existing, error: findError } = await supabase
      .from("profiles")
      .select("id")
      .ilike("display_name", name)
      .limit(1);
    fail(findError, "find person");
    let profileId = existing?.[0]?.id as string | undefined;
    if (!profileId) {
      const { data: inserted, error: insertError } = await supabase
        .from("profiles")
        .insert({ display_name: name })
        .select("id")
        .single();
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
    saved(`${name} is on the roster. They appear on the next blank week.`);
    await load();
  }

  async function removePerson(person: Person) {
    if (!season) return;
    const { error } = await getSupabase()
      .from("season_members")
      .delete()
      .eq("season_id", season.id)
      .eq("profile_id", person.id);
    fail(error, "remove roster");
    saved(`${person.name} left the roster. Days already saved stay on past weeks.`);
    await load();
  }

  async function addTeam() {
    if (!season) return;
    const name = newTeam.trim();
    if (!name) return;
    const { error } = await getSupabase().from("teams").insert({ season_id: season.id, name });
    fail(error, "add team");
    setNewTeam("");
    saved(`Team ${name} added.`);
    await load();
  }

  async function assignTeam(person: Person, teamId: string) {
    if (!season) return;
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

  async function saveRoles() {
    const supabase = getSupabase();
    for (const person of people) {
      if (!person.role) {
        const { error } = await supabase.from("user_roles").delete().eq("profile_id", person.id);
        fail(error, "clear role");
      } else {
        const { error } = await supabase.from("user_roles").upsert(
          { profile_id: person.id, role: person.role },
          { onConflict: "profile_id" },
        );
        fail(error, "save role");
      }
    }
    saved("Roles saved.");
  }

  if (!season) {
    return <p className="status">{error || "Loading admin…"}</p>;
  }

  return (
    <section className="page admin">
      <h1>Admin</h1>
      <p>Bonuses, the open season, the roster, and roles. Sign-in is not required for these edits yet.</p>
      {message ? <p className="banner ok">{message}</p> : null}
      {error ? <p className="banner error">{error}</p> : null}

      <form
        className="admin-card"
        onSubmit={(event) => {
          event.preventDefault();
          saveSeason().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not save the season."));
        }}
      >
        <h2>Season</h2>
        <label>
          Name
          <input value={season.name} onChange={(event) => setSeason({ ...season, name: event.target.value })} />
        </label>
        <label>
          Starts
          <input type="date" value={season.starts_on} onChange={(event) => setSeason({ ...season, starts_on: event.target.value })} />
        </label>
        <label>
          Length in weeks
          <input
            type="number"
            min={1}
            value={season.length_weeks}
            onChange={(event) => setSeason({ ...season, length_weeks: Number(event.target.value) })}
          />
        </label>
        <label>
          Scoring
          <select
            value={season.scoring_mode}
            onChange={(event) => setSeason({ ...season, scoring_mode: event.target.value === "teams" ? "teams" : "individual" })}
          >
            <option value="individual">Individual</option>
            <option value="teams">Teams</option>
          </select>
        </label>
        <label>
          Points per finished task
          <input type="number" min={0} value={pointsPerTask} onChange={(event) => setPointsPerTask(Number(event.target.value))} />
        </label>
        <button type="submit">Save season</button>
      </form>

      <form
        className="admin-card"
        onSubmit={(event) => {
          event.preventDefault();
          saveBonuses().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not save bonuses."));
        }}
      >
        <h2>Bonuses</h2>
        {bonuses.map((bonus, index) => (
          <div className="admin-row" key={bonus.id}>
            <span>{bonus.key}</span>
            <input
              value={bonus.name}
              onChange={(event) => setBonuses(bonuses.map((item, itemIndex) => (itemIndex === index ? { ...item, name: event.target.value } : item)))}
            />
            <input
              type="number"
              min={0}
              value={bonus.points}
              onChange={(event) =>
                setBonuses(bonuses.map((item, itemIndex) => (itemIndex === index ? { ...item, points: Number(event.target.value) } : item)))
              }
            />
            <label>
              <input
                type="checkbox"
                checked={bonus.retired}
                onChange={(event) =>
                  setBonuses(bonuses.map((item, itemIndex) => (itemIndex === index ? { ...item, retired: event.target.checked } : item)))
                }
              />
              Retired
            </label>
          </div>
        ))}
        <button type="submit">Save bonuses</button>
      </form>

      <div className="admin-card">
        <h2>Roster</h2>
        <form
          className="admin-row"
          onSubmit={(event) => {
            event.preventDefault();
            addPerson().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not add that person."));
          }}
        >
          <input value={newPerson} placeholder="Name" onChange={(event) => setNewPerson(event.target.value)} />
          <button type="submit">Add person</button>
        </form>
        <ul className="admin-list">
          {people.map((person) => (
            <li key={person.id}>
              <span>{person.name}</span>
              <button type="button" onClick={() => removePerson(person).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not remove that person."))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>

      {season.scoring_mode === "teams" ? (
        <div className="admin-card">
          <h2>Teams</h2>
          <form
            className="admin-row"
            onSubmit={(event) => {
              event.preventDefault();
              addTeam().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not add that team."));
            }}
          >
            <input value={newTeam} placeholder="Team name" onChange={(event) => setNewTeam(event.target.value)} />
            <button type="submit">Add team</button>
          </form>
          <ul className="admin-list">
            {people.map((person) => (
              <li key={person.id}>
                <span>{person.name}</span>
                <select value={person.teamId} onChange={(event) => assignTeam(person, event.target.value).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not assign that team."))}>
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
      ) : null}

      <form
        className="admin-card"
        onSubmit={(event) => {
          event.preventDefault();
          saveRoles().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not save roles."));
        }}
      >
        <h2>Roles</h2>
        <ul className="admin-list">
          {people.map((person) => (
            <li key={person.id}>
              <span>{person.name}</span>
              <select
                value={person.role}
                onChange={(event) => setPeople(people.map((item) => (item.id === person.id ? { ...item, role: event.target.value } : item)))}
              >
                <option value="">Member access only</option>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="commissioner">Commissioner</option>
              </select>
            </li>
          ))}
        </ul>
        <button type="submit">Save roles</button>
      </form>
    </section>
  );
}
