// The season being edited, plus the draft actions. This card loads the season
// list and the points-per-task rule. Saving writes those two rows only.
// Bonuses, the roster, teams, and roles load themselves for the season this
// card reports upward.

import { Calendar } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "../../supabaseClient";
import { addDays, mondayOf, parseISODate } from "../../weeks";
import { fail, SaveButtonView, seasonLabel, seasonStatus, sortSeasons, useSaveFlash, type AdminNotice, type Season } from "./adminShared";

const DEFAULT_SEASON_WEEKS = 8;

type SeasonCardProps = AdminNotice & {
  onSeason: (season: Season) => void;
};

export function SeasonCard({ onSeason, saved, failed }: SeasonCardProps) {
  const [season, setSeason] = useState<Season | null>(null);
  const [seasonChoices, setSeasonChoices] = useState<Season[]>([]);
  const [pointsPerTask, setPointsPerTask] = useState(0);
  const [working, setWorking] = useState(false);
  const selectedId = useRef<string | null>(null);
  const { flash, run } = useSaveFlash();

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
    const { data: rules, error: rulesError } = await supabase
      .from("scoring_rules")
      .select("points_per_task")
      .eq("season_id", current.id)
      .maybeSingle();
    fail(rulesError, "read points per task");
    setSeasonChoices(choices);
    setSeason(current);
    setPointsPerTask(Number(rules?.points_per_task ?? 0));
  }, []);

  useEffect(() => {
    load().catch((reason: unknown) => failed(reason, "Could not load admin."));
  }, [load, failed]);

  useEffect(() => {
    if (season) onSeason(season);
  }, [season, onSeason]);

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
    const { error: rulesError } = await supabase.from("scoring_rules").update({ points_per_task: pointsPerTask }).eq("season_id", season.id);
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

  if (!season) return null;

  const closed = season.status === "closed";
  const activeSeason = seasonChoices.find((item) => item.status === "active");

  return (
    <div className="admin-card tone-season">
      <h2>
        <Calendar aria-hidden="true" />
        Season
      </h2>
      <label className="admin-field">
        Editing
        <select
          value={season.id}
          onChange={(event) => {
            selectedId.current = event.target.value;
            load().catch((reason: unknown) => failed(reason, "Could not load that season."));
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
          run(saveSeason, failed, "Could not save the season.");
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
        {closed ? null : <SaveButtonView label={season.status === "draft" ? "Save draft" : "Save season"} flash={flash} />}
      </form>
      <div className="admin-row">
        <button
          type="button"
          disabled={working || !activeSeason}
          onClick={() => {
            planNextSeason().catch((reason: unknown) => failed(reason, "Could not plan the next season."));
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
                activateSeason().catch((reason: unknown) => failed(reason, "Could not activate that season."));
              }}
            >
              Activate this season
            </button>
            <button
              type="button"
              disabled={working}
              onClick={() => {
                deleteDraft().catch((reason: unknown) => failed(reason, "Could not delete that draft."));
              }}
            >
              Delete draft
            </button>
          </>
        ) : null}
      </div>
      <p className="field-help">Plan next season copies the live roster, teams, and scoring into a draft. Days and scores stay where they are. The draft starts at {DEFAULT_SEASON_WEEKS} weeks.</p>
    </div>
  );
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
