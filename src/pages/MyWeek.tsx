// Editable scorecard for one person. A Google sign-in opens that person's rows.
// Anyone can look at another person. The fields stay locked unless this account
// is that person, or an admin or commissioner.
//
// The person switcher sits beside the title. It reads "Viewing: You" for the
// signed-in person and "Viewing: Ben" for anyone else. The wide "Look at
// someone's tasks" row, the disabled My week button, and "You can edit this
// list" used to come before the days. Those are gone from this page. The
// dashboard still uses the wide picker.
//
// Team and nickname used to sit in the tools row next to the total. They are
// profile settings now: team is read from the roster, nickname is the signed-in
// person's own label. This page only shows the week.
//
// Board is the default: a card per day, tasks stacked inside it.
// Grid turns that card sideways: weekdays across the top, tasks down the side.
// Grid (Legacy) was the original spreadsheet. That option is gone. An older
// browser save of "grid" or "legacy" opens Board, so a refresh does not bring
// the spreadsheet back.
//
// The right sidebar holds the week's total, the change from last week, the
// current streak, the season place, and How scoring works. The streak
// countdown ("1 more day for +5") is only there when this list is the
// signed-in person. Looking at someone else shows their total and place, not
// a countdown they cannot act on.
//
// Dashboard names open this page with ?person=Team|Name. That query is the
// source of truth while it names someone on the roster, so a refresh stays on
// the person the link asked for. The picker writes the same parameter. Without
// it, the signed-in person is shown.
import { NotebookPen } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { canEditPerson, useAuth } from "../auth";
import { useBoard } from "../board";
import { PersonPicker } from "./PersonPicker";
import { maxDayPoints, maxWeekPoints, personKey, weekPoints } from "../points";
import { seasonBoard, streakCue } from "../streaks";
import { addDays } from "../weeks";
import { WeekBoard } from "./WeekBoard";
import { ScorecardLoading } from "../ScorecardLoading";
import { WeekMatrix } from "./WeekMatrix";

type WeekLayout = "board" | "matrix";

const LAYOUT_KEY = "top5-week-layout";

function readWeekLayout(): WeekLayout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "matrix" ? "matrix" : "board";
  } catch {
    return "board";
  }
}

function placeLabel(place: number): string {
  const mod100 = place % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${place}th`;
  switch (place % 10) {
    case 1:
      return `${place}st`;
    case 2:
      return `${place}nd`;
    case 3:
      return `${place}rd`;
    default:
      return `${place}th`;
  }
}

export function MyWeek() {
  const { rows, people, ready, rates, season, selectedWeek, nicknames, weeks } = useBoard();
  const { profileName, role, roleReady, user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  // searchParams.get already decodes, so the key matches the roster key.
  const requestedKey = searchParams.get("person") ?? "";
  const [selectedKey, setSelectedKey] = useState(requestedKey);
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
  const canEdit = Boolean(person) && roleReady && canEditPerson(role, profileName, person?.person ?? "");
  const seasonPeople = useMemo(() => seasonBoard(weeks, undefined, rates, season), [weeks, rates, season]);
  const seasonRow = person ? seasonPeople.find((item) => item.key === person.key) : undefined;
  // Ties share a place, same as the leaderboard. A person with no season row
  // has no place to show.
  const rankLabel = useMemo(() => {
    if (!person) return "—";
    let place = 1;
    for (let index = 0; index < seasonPeople.length; index += 1) {
      if (index > 0 && seasonPeople[index].seasonTotal < seasonPeople[index - 1].seasonTotal) place = index + 1;
      if (seasonPeople[index].key === person.key) return placeLabel(place);
    }
    return "—";
  }, [person, seasonPeople]);
  const priorWeek = weeks[addDays(selectedWeek, -7)];
  const priorExists = Boolean(person && priorWeek?.rows.some((row) => personKey(row) === person.key));
  const priorPoints = person && priorExists ? weekPoints(priorWeek?.rows ?? [], person.key, rates) : 0;
  const delta = total - priorPoints;
  const deltaLabel = !priorExists
    ? ""
    : delta > 0
      ? `Up ${delta} from last week`
      : delta < 0
        ? `Down ${Math.abs(delta)} from last week`
        : "Same as last week";
  const streakDays = seasonRow?.currentStreak ?? 0;
  // The countdown is computed for the open season, then shown only when the
  // list on screen is the signed-in person.
  const streakNote = person && person.person === profileName && seasonRow ? streakCue(seasonRow.currentStreak) : "";

  function chooseLayout(next: WeekLayout) {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // Private browsing can block storage. The choice still lasts for this visit.
    }
  }

  if (!ready) return <ScorecardLoading />;

  return (
    <section className="page">
      <div className="page-head my-week-head">
        <h1>
          <NotebookPen aria-hidden="true" />
          My week
        </h1>
        <PersonPicker
          compact
          people={people}
          value={selected}
          nicknames={nicknames}
          signedInName={profileName}
          onChange={choosePerson}
        />
      </div>
      <div className="my-week-layout">
        <div className="my-week-main">
          {layout === "board" ? (
            <WeekBoard rows={mine} weekId={selectedWeek} canEdit={canEdit} />
          ) : (
            <WeekMatrix rows={mine} weekId={selectedWeek} canEdit={canEdit} />
          )}
          {roleReady && !canEdit ? (
            <p className="field-help">
              {user
                ? "You can edit your own tasks, including past days. A commissioner or an admin can edit anyone."
                : "Sign in to edit your own tasks."}
            </p>
          ) : null}
        </div>
        <aside className="my-week-side">
          <div className="week-side-card">
            <p className="week-side-kicker">This week</p>
            <p className="week-side-total">
              {total}
              <span> / {maxWeekPoints(rates)}</span>
            </p>
            {deltaLabel ? (
              <p className={delta > 0 ? "week-delta is-up" : delta < 0 ? "week-delta is-down" : "week-delta"}>{deltaLabel}</p>
            ) : null}
            <div className="week-side-pair">
              <div>
                <p className="week-side-kicker">Streak</p>
                <p className="week-side-stat">
                  {streakDays} {streakDays === 1 ? "day" : "days"}
                </p>
              </div>
              <div>
                <p className="week-side-kicker">Season</p>
                <p className="week-side-stat">{rankLabel}</p>
              </div>
            </div>
            {streakNote ? <p className="streak-cue">{streakNote}</p> : null}
          </div>
          <div className="scoring-panel" aria-label="How scoring works">
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
          </div>
          <div className="week-side-card">
            <p className="week-side-kicker">Layout</p>
            <div className="layout-toggle" role="group" aria-label="Week layout">
              <button type="button" aria-pressed={layout === "board"} onClick={() => chooseLayout("board")}>
                Board
              </button>
              <button type="button" aria-pressed={layout === "matrix"} onClick={() => chooseLayout("matrix")}>
                Grid
              </button>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
