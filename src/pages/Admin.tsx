// Season, bonus, roster, team, and role edits.
// These forms do not build a DayRow and do not call saveDays. Each save
// function below calls getSupabase().from("<table>").update/upsert/delete
// on the setup tables (seasons, scoring_rules, bonus_definitions, and so on).
// That is a separate PostgREST request from a task checkbox. Postgres allows
// a commissioner or an admin to change scoring, teams, and the roster.
// Only an admin can write user_roles. A member's key is rejected.
//
// One season is active. "Plan next season" copies that season's roster, teams,
// and scoring into a draft. The draft length starts at 8 weeks and can be
// edited. The board keeps reading the active season until Activate closes it
// and opens the draft. Days and scores are not copied.

import { useCallback, useEffect, useRef, useState } from "react";
import { canAssignRoles, useAuth } from "../auth";
import { addDays, mondayOf, parseISODate } from "../weeks";
import { EditLog } from "./EditLog";
import { PastSeasons } from "./PastSeasons";
import { getSupabase } from "../supabaseClient";

const DEFAULT_SEASON_WEEKS = 8;

type SeasonStatus = "draft" | "active" | "closed";

type Season = {
  id: string;
  name: string;
  starts_on: string;
  length_weeks: number;
  scoring_mode: "individual" | "teams";
  status: SeasonStatus;
};

type Bonus = { id: string; key: string; name: string; points: number; builtIn: boolean };

const BUILTIN_ORDER = ["top5", "exercise", "reading"];
type Person = { id: string; name: string; nickname: string; savedNickname: string; role: string; teamId: string };
type Team = { id: string; name: string };

function fail(error: { message: string } | null, action: string): void {
  if (error) throw new Error(`${action}: ${error.message}`);
}

type SaveButton = "season" | "bonuses" | "roles";
type Flash = "idle" | "saving" | "saved";

export function Admin() {
  const { role } = useAuth();
  const assignRoles = canAssignRoles(role);
  const [season, setSeason] = useState<Season | null>(null);
  const [seasonChoices, setSeasonChoices] = useState<Season[]>([]);
  const [working, setWorking] = useState(false);
  const selectedId = useRef<string | null>(null);
  const [pointsPerTask, setPointsPerTask] = useState(0);
  const [bonuses, setBonuses] = useState<Bonus[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [newBonusName, setNewBonusName] = useState("");
  const [newBonusPoints, setNewBonusPoints] = useState(5);
  const [newPerson, setNewPerson] = useState("");
  const [newTeam, setNewTeam] = useState("");
  const [signInAsName, setSignInAsName] = useState("");
  const [signingInAs, setSigningInAs] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // The banner is easy to miss under the week controls. Each save button changes so the click is obvious.
  // One timer per button so a second save does not clear the first button's "Saved" state early.
  const [saveFlash, setSaveFlash] = useState<Record<SaveButton, Flash>>({
    season: "idle",
    bonuses: "idle",
    roles: "idle",
  });
  const saveTimers = useRef<Partial<Record<SaveButton, number>>>({});

  const load = useCallback(async () => {
    const supabase = getSupabase();
    const { data: seasonRows, error: seasonError } = await supabase
      .from("seasons")
      .select("id, name, starts_on, length_weeks, scoring_mode, status");
    fail(seasonError, "read seasons");
    const choices = sortSeasons(
      (seasonRows ?? []).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        starts_on: String(row.starts_on),
        length_weeks: Number(row.length_weeks),
        scoring_mode: row.scoring_mode === "teams" ? "teams" : "individual",
        status: seasonStatus(row.status),
      })),
    );
    if (choices.length === 0) throw new Error("No seasons yet.");
    const current = choices.find((item) => item.id === selectedId.current) ?? choices.find((item) => item.status === "active") ?? choices[0];
    selectedId.current = current.id;
    setSeasonChoices(choices);
    const [{ data: rules, error: rulesError }, { data: bonusRows, error: bonusError }, { data: memberRows, error: memberError }, { data: teamRows, error: teamError }, { data: roleRows, error: roleError }, { data: assignmentRows, error: assignmentError }] =
      await Promise.all([
        supabase.from("scoring_rules").select("points_per_task").eq("season_id", current.id).maybeSingle(),
        supabase.from("bonus_definitions").select("id, key, name, points, retired_at").eq("season_id", current.id).order("key"),
        supabase.from("season_members").select("profile_id, profiles(display_name, nickname)").eq("season_id", current.id),
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
      (bonusRows ?? [])
        .filter((row) => row.retired_at == null)
        .map((row) => ({
          id: row.id,
          key: row.key,
          name: row.name,
          points: row.points,
          builtIn: BUILTIN_ORDER.includes(row.key),
        }))
        .sort((a, b) => {
          const left = BUILTIN_ORDER.indexOf(a.key);
          const right = BUILTIN_ORDER.indexOf(b.key);
          return (left === -1 ? 9 : left) - (right === -1 ? 9 : right) || a.name.localeCompare(b.name);
        }),
    );
    setTeams((teamRows ?? []).map((row) => ({ id: row.id, name: row.name })));
    setPeople(
      (memberRows ?? [])
        .map((row) => {
          const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
          return {
            id: String(row.profile_id),
            name: profile?.display_name ?? "Unknown",
            nickname: String(profile?.nickname ?? ""),
            savedNickname: String(profile?.nickname ?? "").trim(),
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

  useEffect(() => {
    const timers = saveTimers.current;
    return () => {
      for (const id of Object.values(timers)) {
        if (id != null) window.clearTimeout(id);
      }
    };
  }, []);

  function runSave(button: SaveButton, action: () => Promise<void>, fallback: string) {
    const pending = saveTimers.current[button];
    if (pending != null) window.clearTimeout(pending);
    setSaveFlash((current) => ({ ...current, [button]: "saving" }));
    action()
      .then(() => {
        setSaveFlash((current) => ({ ...current, [button]: "saved" }));
        saveTimers.current[button] = window.setTimeout(() => {
          setSaveFlash((current) => ({ ...current, [button]: "idle" }));
        }, 1800);
      })
      .catch((reason: unknown) => {
        setSaveFlash((current) => ({ ...current, [button]: "idle" }));
        setError(reason instanceof Error ? reason.message : fallback);
      });
  }

  function saved(text: string) {
    setError("");
    setMessage(text);
    window.dispatchEvent(new Event("top5-reload"));
  }

  async function persistSeason() {
    if (!season) return;
    if (season.status === "closed") throw new Error("A closed season stays as it was.");
    const name = season.name.trim();
    if (!name) throw new Error("Name the season before saving.");
    if (!season.starts_on) throw new Error("A season needs a start date.");
    if (!Number.isFinite(season.length_weeks) || season.length_weeks < 1) throw new Error("A season needs at least one week.");
    const supabase = getSupabase();
    const { error: seasonError } = await supabase
      .from("seasons")
      .update({
        name,
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
  }

  async function saveSeason() {
    await persistSeason();
    saved(season?.status === "draft" ? "Draft saved. It stays off the board until you activate it." : "Season saved.");
    await load();
  }

  // Copies the live season's roster, teams, and scoring. Length is 8 weeks
  // until someone edits the draft. Nothing here changes which season is live.
  async function planNextSeason() {
    const source = seasonChoices.find((item) => item.status === "active");
    if (!source) throw new Error("There is no active season to copy.");
    const name = nextSeasonName(source.name);
    const starts = nextSeasonStart(source.starts_on, source.length_weeks);
    const drafts = seasonChoices.filter((item) => item.status === "draft");
    const already = drafts.length === 0 ? "" : `\n\nYou already have ${drafts.length === 1 ? `a draft (${drafts[0].name})` : `${drafts.length} drafts`}. This adds another.`;
    const lengthNote =
      source.length_weeks === DEFAULT_SEASON_WEEKS
        ? `Length starts at ${DEFAULT_SEASON_WEEKS} weeks.`
        : `Length starts at ${DEFAULT_SEASON_WEEKS} weeks. ${source.name} is ${source.length_weeks} weeks, and you can change the draft before it goes live.`;
    const ok = window.confirm(
      `Plan the next season from ${source.name}?\n\nThe draft copies the roster, teams, and scoring. Days and scores stay on ${source.name}.\n${lengthNote}\nSuggested name: ${name}. Start: ${starts}.${already}\n\nIt stays off the board until you activate it.`,
    );
    if (!ok) return;
    setWorking(true);
    try {
      const { data, error } = await getSupabase().rpc("create_season_draft", {
        source_id: source.id,
        season_name: name,
        starts_on: starts,
        length_weeks: DEFAULT_SEASON_WEEKS,
        copy_settings: true,
      });
      fail(error, "plan season");
      selectedId.current = String(data);
      saved("Draft created. Edit it below, then activate it when this season should go live.");
      await load();
    } finally {
      setWorking(false);
    }
  }

  async function activateSeason() {
    if (!season || season.status !== "draft") return;
    const current = seasonChoices.find((item) => item.status === "active");
    const closing = current
      ? `${current.name} closes and keeps the days already saved, but those days leave the scorecard.`
      : "The current season closes.";
    const ok = window.confirm(
      `Activate ${season.name || "this draft"}?\n\nThe name, dates, length, and points per task on this form are saved first. Save bonuses separately if you changed them.\n\nThe live board switches to this season immediately. ${closing}\n\nTasks are not copied into the new season.`,
    );
    if (!ok) return;
    setWorking(true);
    try {
      await persistSeason();
      const { error } = await getSupabase().rpc("activate_season", { target_id: season.id });
      fail(error, "activate season");
      saved(`${season.name.trim()} is the live season.`);
      await load();
    } finally {
      setWorking(false);
    }
  }

  async function deleteDraft() {
    if (!season || season.status !== "draft") return;
    const ok = window.confirm(`Delete the draft "${season.name}"? The live season stays as it is.`);
    if (!ok) return;
    setWorking(true);
    try {
      const { error } = await getSupabase().from("seasons").delete().eq("id", season.id);
      fail(error, "delete draft");
      selectedId.current = null;
      saved("Draft deleted.");
      await load();
    } finally {
      setWorking(false);
    }
  }

  async function saveBonuses() {
    if (season?.status === "closed") throw new Error("A closed season stays as it was.");
    const supabase = getSupabase();
    for (const bonus of bonuses) {
      const { error } = await supabase
        .from("bonus_definitions")
        .update({
          name: bonus.name.trim(),
          points: bonus.points,
          retired_at: null,
        })
        .eq("id", bonus.id);
      fail(error, `save ${bonus.key}`);
    }
    const added = newBonusName.trim();
    if (added) await addBonus();
    saved(added ? `${added} is on each day.` : "Bonuses saved.");
    await load();
  }

  async function addBonus() {
    if (!season || season.status === "closed") return;
    const name = newBonusName.trim();
    if (!name) return;
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24);
    if (!base) throw new Error("Use a bonus name with letters or numbers.");
    if (BUILTIN_ORDER.includes(base)) throw new Error("Top 5, Exercise, and Reading are already on the board.");
    const taken = new Set(bonuses.map((bonus) => bonus.key));
    let key = base;
    let suffix = 2;
    while (taken.has(key)) {
      key = `${base}${suffix}`;
      suffix += 1;
    }
    const supabase = getSupabase();
    const { data: existing, error: findError } = await supabase
      .from("bonus_definitions")
      .select("id")
      .eq("season_id", season.id)
      .eq("key", key)
      .maybeSingle();
    fail(findError, "find bonus");
    if (existing) {
      const { error } = await supabase
        .from("bonus_definitions")
        .update({ name, points: newBonusPoints, retired_at: null })
        .eq("id", existing.id);
      fail(error, "restore bonus");
    } else {
      const { error } = await supabase.from("bonus_definitions").insert({
        season_id: season.id,
        key,
        name,
        points: newBonusPoints,
      });
      fail(error, "add bonus");
    }
    setNewBonusName("");
  }

  async function removeBonus(bonus: Bonus) {
    if (bonus.builtIn) return;
    const { error } = await getSupabase()
      .from("bonus_definitions")
      .update({ retired_at: new Date().toISOString() })
      .eq("id", bonus.id);
    fail(error, "remove bonus");
    saved(`${bonus.name} was removed. Days that already earned it keep those points.`);
    await load();
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
    saved(
      season.status === "draft"
        ? `${name} is on this draft. They join the live board when you activate it.`
        : `${name} is on the roster. They appear on the next blank week.`,
    );
    await load();
  }

  async function removePerson(person: Person) {
    if (!season || season.status === "closed") return;
    const { error } = await getSupabase()
      .from("season_members")
      .delete()
      .eq("season_id", season.id)
      .eq("profile_id", person.id);
    fail(error, "remove roster");
    saved(
      season.status === "draft"
        ? `${person.name} was removed from this draft. The live roster is unchanged.`
        : `${person.name} left the roster. Days already saved stay on past weeks.`,
    );
    await load();
  }

  async function saveNickname(person: Person, nickname: string) {
    if (season?.status === "closed") return;
    const next = nickname.trim();
    if (next === person.savedNickname) return;
    const { error } = await getSupabase().from("profiles").update({ nickname: next || null }).eq("id", person.id);
    fail(error, "save nickname");
    setPeople((current) => current.map((item) => (item.id === person.id ? { ...item, nickname: next, savedNickname: next } : item)));
    saved(next ? `${person.name} will show as ${next}.` : `${person.name} will show their roster name.`);
    window.dispatchEvent(new Event("top5-reload"));
  }

  async function addTeam() {
    if (!season || season.status === "closed") return;
    const name = newTeam.trim();
    if (!name) return;
    const { error } = await getSupabase().from("teams").insert({ season_id: season.id, name });
    fail(error, "add team");
    setNewTeam("");
    saved(`Team ${name} added.`);
    await load();
  }

  async function assignTeam(person: Person, teamId: string) {
    if (!season || season.status === "closed") return;
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
    if (!assignRoles) throw new Error("Only an admin can assign roles.");
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

  // The dev server mints a one-time token for that person's existing Google account.
  // The session is applied in this browser. Production has no /dev/sign-in-as route,
  // and this block is omitted from the build.
  async function signInLocally(name: string) {
    setError("");
    setSigningInAs(true);
    try {
      const response = await fetch("/dev/sign-in-as", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = (await response.json()) as { tokenHash?: string; type?: "magiclink"; error?: string };
      if (!response.ok || !payload.tokenHash || !payload.type) {
        setError(payload.error || "Could not sign in as that person.");
        setSigningInAs(false);
        return;
      }
      const { error: verifyError } = await getSupabase().auth.verifyOtp({
        token_hash: payload.tokenHash,
        type: payload.type,
      });
      if (verifyError) {
        setError(verifyError.message);
        setSigningInAs(false);
        return;
      }
      window.location.assign("/");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not sign in as that person.");
      setSigningInAs(false);
    }
  }

  if (!season) {
    return <p className="status">{error || "Loading admin…"}</p>;
  }

  const closed = season.status === "closed";
  const activeSeason = seasonChoices.find((item) => item.status === "active");

  return (
    <section className="page admin">
      <h1>⚙️ Admin</h1>
      <p>Scoring, teams, the roster, and the next season. A commissioner or an admin can change these. Only an admin can assign roles. One season is live. The next one can be drafted and edited before it is activated.</p>
      {message ? <p className="banner ok">{message}</p> : null}
      {error ? <p className="banner error">{error}</p> : null}

      <div className="admin-card tone-season">
        <h2>📅 Season</h2>
        <label className="admin-field">
          Editing
          <select
            value={season.id}
            onChange={(event) => {
              selectedId.current = event.target.value;
              load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load that season."));
            }}
          >
            {seasonChoices.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} — {seasonLabel(item.status)}
              </option>
            ))}
          </select>
          <p className="field-help">Save before you switch. This list is the seasons already stored.</p>
        </label>
        <p>
          <span className={`season-flag is-${season.status}`}>{seasonLabel(season.status)}</span>
        </p>
        {season.status === "draft" ? (
          <p className="field-help">
            This draft is not on the scorecard yet.
            {activeSeason ? ` Activating it closes ${activeSeason.name} and moves the live board here. Tasks already written stay on ${activeSeason.name}.` : " Activating it makes it the live season."}
          </p>
        ) : null}
        {closed && activeSeason ? <p className="field-help">{season.name} is closed. The live board is {activeSeason.name}.</p> : null}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (closed) return;
            runSave("season", saveSeason, "Could not save the season.");
          }}
        >
          <label className="admin-field">
            Name
            <input value={season.name} disabled={closed} onChange={(event) => setSeason({ ...season, name: event.target.value })} />
          </label>
          <label className="admin-field">
            Starts
            <input type="date" value={season.starts_on} disabled={closed} onChange={(event) => setSeason({ ...season, starts_on: event.target.value })} />
            <p className="field-help">The Monday the season begins. Each week is that Monday through Friday.</p>
          </label>
          <label className="admin-field">
            Length in weeks
            <input
              type="number"
              min={1}
              value={season.length_weeks}
              disabled={closed}
              onChange={(event) => setSeason({ ...season, length_weeks: Number(event.target.value) })}
            />
            <p className="field-help">
              {season.status === "draft"
                ? `A new season defaults to ${DEFAULT_SEASON_WEEKS} weeks. Change this before you activate. The board ignores a draft until then.`
                : "How many weeks this season runs. A new Monday is created on its own only inside this span."}
            </p>
          </label>
          <label className="admin-field">
            Scoring
            <select
              value={season.scoring_mode}
              disabled={closed}
              onChange={(event) => setSeason({ ...season, scoring_mode: event.target.value === "teams" ? "teams" : "individual" })}
            >
              <option value="individual">Individual</option>
              <option value="teams">Teams</option>
            </select>
            <p className="field-help">
              Individual ranks each person on their own points. Teams adds a team standing and the assignment list below. Old sheet banners such as ACES, Alpha, and Awesomes are not teams.
            </p>
          </label>
          <label className="admin-field">
            Points per finished task
            <input type="number" min={0} disabled={closed} value={pointsPerTask} onChange={(event) => setPointsPerTask(Number(event.target.value))} />
            <p className="field-help">
              Extra points for each priority box that is checked, on top of the bonuses below. Leave this at 0 to score only bonuses.
            </p>
          </label>
          {closed ? null : <SaveButtonView label={season.status === "draft" ? "Save draft" : "Save season"} flash={saveFlash.season} />}
        </form>
        <div className="admin-row">
          <button
            type="button"
            disabled={working || !activeSeason}
            onClick={() => {
              planNextSeason().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not plan the next season."));
            }}
          >
            {working ? "Working…" : "Plan next season"}
          </button>
          {season.status === "draft" ? (
            <>
              <button
                type="button"
                disabled={working}
                onClick={() => {
                  activateSeason().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not activate that season."));
                }}
              >
                Activate this season
              </button>
              <button
                type="button"
                disabled={working}
                onClick={() => {
                  deleteDraft().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not delete that draft."));
                }}
              >
                Delete draft
              </button>
            </>
          ) : null}
        </div>
        <p className="field-help">Plan next season copies the live roster, teams, and scoring into a draft. Days and scores stay where they are. The draft starts at {DEFAULT_SEASON_WEEKS} weeks.</p>
      </div>

      <form
        className="admin-card tone-bonus"
        onSubmit={(event) => {
          event.preventDefault();
          runSave("bonuses", saveBonuses, "Could not save bonuses.");
        }}
      >
        <h2>🎁 Bonuses</h2>
        <p className="field-help">
          Top 5, Exercise, and Reading stay on every day. Top 5 checks itself when all five tasks are done. Type another bonus below and save to put a new checkbox on each day. Removing one hides that checkbox. A day that already earned it keeps those points.
        </p>
        {season.status === "draft" ? <p className="field-help">These point values are saved on this draft. The live board keeps the active season until you activate.</p> : null}
        {bonuses.map((bonus, index) => (
          <div className="admin-row" key={bonus.id}>
            <input
              aria-label={`${bonus.builtIn ? "Built-in bonus" : "Bonus"} name`}
              value={bonus.name}
              disabled={closed}
              onChange={(event) => setBonuses(bonuses.map((item, itemIndex) => (itemIndex === index ? { ...item, name: event.target.value } : item)))}
            />
            <input
              type="number"
              min={0}
              aria-label={`${bonus.name} points`}
              value={bonus.points}
              disabled={closed}
              onChange={(event) =>
                setBonuses(bonuses.map((item, itemIndex) => (itemIndex === index ? { ...item, points: Number(event.target.value) } : item)))
              }
            />
            {bonus.builtIn ? <span className="field-help">Always on</span> : (
              <button
                type="button"
                disabled={closed}
                onClick={() => removeBonus(bonus).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not remove that bonus."))}
              >
                Remove
              </button>
            )}
          </div>
        ))}
        <div className="admin-row">
          <input value={newBonusName} placeholder="Add a bonus" aria-label="New bonus name" disabled={closed} onChange={(event) => setNewBonusName(event.target.value)} />
          <input
            type="number"
            min={0}
            aria-label="New bonus points"
            value={newBonusPoints}
            disabled={closed}
            onChange={(event) => setNewBonusPoints(Number(event.target.value))}
          />
        </div>
        {closed ? null : <SaveButtonView label="Save bonuses" flash={saveFlash.bonuses} />}
      </form>

      <div className="admin-card tone-roster">
        <h2>👥 Roster</h2>
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
            addPerson().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not add that person."));
          }}
        >
          <input value={newPerson} placeholder="Name" disabled={closed} onChange={(event) => setNewPerson(event.target.value)} />
          <button type="submit" disabled={closed}>Add person</button>
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
                onChange={(event) =>
                  setPeople(people.map((item) => (item.id === person.id ? { ...item, nickname: event.target.value } : item)))
                }
                onBlur={(event) => {
                  saveNickname(person, event.target.value).catch((reason: unknown) =>
                    setError(reason instanceof Error ? reason.message : "Could not save that nickname."),
                  );
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    (event.target as HTMLInputElement).blur();
                  }
                }}
              />
              <button type="button" disabled={closed} onClick={() => removePerson(person).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not remove that person."))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>

      {season.scoring_mode === "teams" ? (
        <div className="admin-card tone-teams">
          <h2>🤝 Teams</h2>
          <p className="field-help">Shown because scoring is set to Teams. Each person can be on one team. No team leaves them out of the team standing.</p>
          <form
            className="admin-row"
            onSubmit={(event) => {
              event.preventDefault();
              addTeam().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not add that team."));
            }}
          >
            <input value={newTeam} placeholder="Team name" disabled={closed} onChange={(event) => setNewTeam(event.target.value)} />
            <button type="submit" disabled={closed}>Add team</button>
          </form>
          <ul className="admin-list">
            {people.map((person) => (
              <li key={person.id}>
                <span>{person.name}</span>
                <select value={person.teamId} disabled={closed} onChange={(event) => assignTeam(person, event.target.value).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not assign that team."))}>
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

      {import.meta.env.DEV ? (
        <form
          className="admin-card"
          onSubmit={(event) => {
            event.preventDefault();
            void signInLocally(signInAsName);
          }}
        >
          <h2>Local sign-in</h2>
          <p className="field-help">
            Shown only on this computer. Opens that person's real account in this browser so you can try their task cells. A task you save is written on the live board. This does not create a second Garrett or Hannah.
          </p>
          <div className="admin-row">
            <select value={signInAsName} onChange={(event) => setSignInAsName(event.target.value)} disabled={people.length === 0 || signingInAs}>
              <option value="">Choose a person</option>
              {people.map((person) => (
                <option key={person.id} value={person.name}>
                  {person.name}
                </option>
              ))}
            </select>
            <button type="submit" disabled={!signInAsName || signingInAs}>
              {signingInAs ? "Signing in…" : "Sign in as this person"}
            </button>
          </div>
        </form>
      ) : null}

      <form
        className="admin-card tone-roles"
        onSubmit={(event) => {
          event.preventDefault();
          runSave("roles", saveRoles, "Could not save roles.");
        }}
      >
        <h2>🪪 Roles</h2>
        <p className="field-help">
          A member can fill in and check off their own tasks, including past days. A commissioner can also edit anyone's tasks, create teams, move players between teams, and set point values. Only an admin can change these roles.
        </p>
        <ul className="admin-list">
          {people.map((person) => (
            <li key={person.id}>
              <span>{person.name}</span>
              <select
                value={person.role}
                disabled={!assignRoles}
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
        {assignRoles ? <SaveButtonView label="Save roles" flash={saveFlash.roles} /> : <p className="field-help">Only an admin can assign roles.</p>}
      </form>
      <PastSeasons />
      <EditLog people={people.map((person) => ({ id: person.id, name: person.name }))} />
    </section>
  );
}

function seasonStatus(value: unknown): SeasonStatus {
  if (value === "draft" || value === "active" || value === "closed") return value;
  return "closed";
}

function seasonLabel(status: SeasonStatus): string {
  if (status === "active") return "Active";
  if (status === "draft") return "Draft";
  return "Closed";
}

function sortSeasons(rows: Season[]): Season[] {
  const rank: Record<SeasonStatus, number> = { active: 0, draft: 1, closed: 2 };
  return [...rows].sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    if (a.status === "closed") return b.starts_on.localeCompare(a.starts_on);
    return a.starts_on.localeCompare(b.starts_on) || a.name.localeCompare(b.name);
  });
}

function nextSeasonName(name: string): string {
  const match = name.trim().match(/^Q([1-4])\s+(\d{4})$/i);
  if (!match) return `${name.trim()} next`;
  const quarter = Number(match[1]);
  const year = Number(match[2]);
  if (quarter === 4) return `Q1 ${year + 1}`;
  return `Q${quarter + 1} ${year}`;
}

function nextSeasonStart(startsOn: string, lengthWeeks: number): string {
  const start = mondayOf(parseISODate(startsOn));
  const lastFriday = addDays(start, (Math.max(lengthWeeks, 1) - 1) * 7 + 4);
  return addDays(lastFriday, 3);
}

function SaveButtonView({ label, flash }: { label: string; flash: Flash }) {
  return (
    <button type="submit" className={flash === "saved" ? "save-flash" : undefined} disabled={flash === "saving"}>
      {flash === "saving" ? "Saving…" : flash === "saved" ? "Saved" : label}
    </button>
  );
}
