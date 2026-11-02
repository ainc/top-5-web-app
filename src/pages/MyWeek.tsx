// Editable scorecard for one person. A Google sign-in opens that person's rows.
// Anyone can look at another person. The fields stay locked unless this account
// is that person, or an admin or commissioner.
// Board is the default: a card per day, tasks stacked inside it.
// Grid turns that card sideways: weekdays across the top, tasks down the side.
// Grid (Legacy) is the original spreadsheet, one table per day.
// The choice is stored in this browser so a refresh does not flip the layout back.
// An older save used "grid" for that spreadsheet, so that value still opens Legacy.
//
// Dashboard names open this page with ?person=Team|Name. That query is the
// source of truth while it names someone on the roster, so a refresh stays on
// the person the link asked for. The picker writes the same parameter. Without
// it, the signed-in person is shown, same as before the links existed.
// The daily average is a whole number, matching the points on the dashboard.
// How scoring works used to be parchment scraps under the week menu on every
// page. The numbers belong next to the list you are editing, so the panel
// is only here. The amounts are the open season's rates.
//
// The streak countdown sits on the total, and only when this list is the
// signed-in person. "1 more day for +5" is a nudge for the person who can
// still earn it. Looking at someone else does not show their countdown.
// Their milestone history is the detail opened from a name on the leaderboard.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { canEditPerson, useAuth } from "../auth";
import { useBoard } from "../board";
import { PersonPicker } from "./PersonPicker";
import { maxDayPoints, maxWeekPoints, personKey, weekPoints } from "../points";
import { seasonBoard, streakCue } from "../streaks";
import { getSupabase } from "../supabaseClient";
import { WeekBoard } from "./WeekBoard";
import { WeekGrid } from "./WeekGrid";
import { WeekMatrix } from "./WeekMatrix";

type WeekLayout = "board" | "matrix" | "legacy";

const LAYOUT_KEY = "top5-week-layout";

function readWeekLayout(): WeekLayout {
  try {
    const saved = localStorage.getItem(LAYOUT_KEY);
    if (saved === "matrix") return "matrix";
    if (saved === "grid" || saved === "legacy") return "legacy";
    return "board";
  } catch {
    return "board";
  }
}

export function MyWeek() {
  const { rows, people, ready, rates, season, selectedWeek, nicknames, weeks } = useBoard();
  const { nickname, profileId, profileName, role, roleReady, user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  // searchParams.get already decodes, so the key matches the roster key.
  const requestedKey = searchParams.get("person") ?? "";
  const [selectedKey, setSelectedKey] = useState(requestedKey);
  const [nicknameDraft, setNicknameDraft] = useState(nickname);
  const [nicknameError, setNicknameError] = useState("");
  useEffect(() => {
    setNicknameDraft(nickname);
  }, [nickname]);
  const [layout, setLayout] = useState<WeekLayout>(readWeekLayout);
  const signedInKey = people.find((person) => person.person === profileName)?.key ?? "";
  const selected = people.some((person) => person.key === requestedKey)
    ? requestedKey
    : people.some((person) => person.key === selectedKey)
      ? selectedKey
      : signedInKey || (people[0]?.key ?? "");

  function choosePerson(key: string) {
    setSelectedKey(key);
    const next = new URLSearchParams(searchParams);
    next.set("person", key);
    setSearchParams(next, { replace: true });
  }
  const person = people.find((item) => item.key === selected);
  const mine = useMemo(() => rows.filter((row) => personKey(row) === selected), [rows, selected]);
  const total = person ? weekPoints(rows, person.key, rates) : 0;
  const dayCount = mine.length || 5;
  const average = total / dayCount;
  const averageLabel = String(Math.round(average));
  const canEdit = Boolean(person) && roleReady && canEditPerson(role, profileName, person?.person ?? "");
  // The countdown is computed for the open season, then shown only when the
  // list on screen is the signed-in person. Another person's week stays quiet.
  const streakNote = useMemo(() => {
    if (!person || person.person !== profileName) return "";
    const row = seasonBoard(weeks, undefined, rates, season).find((item) => item.key === person.key);
    return row ? streakCue(row.currentStreak) : "";
  }, [person, profileName, rates, season, weeks]);

  async function saveNickname() {
    const next = nicknameDraft.trim();
    if (!profileId || next === nickname) return;
    setNicknameError("");
    const { error } = await getSupabase().from("profiles").update({ nickname: next || null }).eq("id", profileId);
    if (error) {
      setNicknameError(error.message);
      return;
    }
    window.dispatchEvent(new Event("top5-reload"));
  }

  function chooseLayout(next: WeekLayout) {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // Private browsing can block storage. The choice still lasts for this visit.
    }
  }

  if (!ready) return <p className="status">Loading the scorecard…</p>;

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h1>📝 My week</h1>
          <p>Top 5 checks itself when all five tasks are done. Exercise and Reading are still checked by hand.</p>
        </div>
      </div>
      <div className="whose-week">
        <div className="whose-week-field">
            <span>Look at someone's tasks</span>
            <PersonPicker
              people={people}
              value={selected}
              nicknames={nicknames}
              signedInName={profileName}
              onChange={choosePerson}
              onReturn={signedInKey ? () => choosePerson(signedInKey) : undefined}
              returnDisabled={selected === signedInKey}
            />
          </div>
        <p>{canEdit ? "You can edit this list." : "This list is read only. Pick your own name to edit."}</p>
      </div>
      <div className="week-tools">
        <div className="week-tile">
          <span>Team</span>
          <div className="team-readout">{person?.team || "No team"}</div>
        </div>
        {user && profileId ? (
          <label className="week-tile">
            Your nickname
            <input
              value={nicknameDraft}
              maxLength={40}
              placeholder="Shown instead of your name"
              aria-label="Your nickname"
              onChange={(event) => setNicknameDraft(event.target.value)}
              onBlur={() => void saveNickname()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void saveNickname();
                }
              }}
            />
          </label>
        ) : null}
        <aside className="week-tile week-score">
          <span className="week-score-label">Total</span>
          <strong>
            {total}
            <span> / {maxWeekPoints(rates)}</span>
          </strong>
          <span className="week-score-avg">Average {averageLabel} per day</span>
          {streakNote ? <span className="streak-cue">{streakNote}</span> : null}
        </aside>
        <div className="week-tile">
          <span>Layout</span>
          <div className="layout-toggle" role="group" aria-label="Week layout">
            <button type="button" aria-pressed={layout === "board"} onClick={() => chooseLayout("board")}>
              Board
            </button>
            <button type="button" aria-pressed={layout === "matrix"} onClick={() => chooseLayout("matrix")}>
              Grid
            </button>
            <button type="button" aria-pressed={layout === "legacy"} onClick={() => chooseLayout("legacy")}>
              Grid (Legacy)
            </button>
          </div>
        </div>
      </div>
      <aside className="scoring-panel" aria-label="How scoring works">
        <h2>How scoring works</h2>
        <dl>
          <div>
            <dt>{rates.top5Name}</dt>
            <dd>{rates.top5}</dd>
          </div>
          <div>
            <dt>{rates.exerciseName}</dt>
            <dd>{rates.exercise}</dd>
          </div>
          <div>
            <dt>{rates.readingName}</dt>
            <dd>{rates.reading}</dd>
          </div>
          {rates.extras.map((bonus) => (
            <div key={bonus.key}>
              <dt>{bonus.name}</dt>
              <dd>{bonus.points}</dd>
            </div>
          ))}
          {rates.pointsPerTask > 0 ? (
            <div>
              <dt>Each finished task</dt>
              <dd>{rates.pointsPerTask}</dd>
            </div>
          ) : null}
          <div>
            <dt>Full day</dt>
            <dd>{maxDayPoints(rates)}</dd>
          </div>
          <div>
            <dt>Full week</dt>
            <dd>{maxWeekPoints(rates)}</dd>
          </div>
        </dl>
      </aside>
      {layout === "board" ? (
        <WeekBoard rows={mine} weekId={selectedWeek} canEdit={canEdit} />
      ) : layout === "matrix" ? (
        <WeekMatrix rows={mine} weekId={selectedWeek} canEdit={canEdit} />
      ) : (
        <WeekGrid rows={mine} weekId={selectedWeek} canEdit={canEdit} />
      )}
      {nicknameError ? <p className="banner error">{nicknameError}</p> : null}
      {roleReady && !canEdit ? (
        <p className="field-help">
          {user
            ? "You can edit your own tasks, including past days. A commissioner or an admin can edit anyone."
            : "Sign in to edit your own tasks."}
        </p>
      ) : null}
    </section>
  );
}
