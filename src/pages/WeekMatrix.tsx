// Weekdays across the top, task slots down the side.
// Board stacks the five tasks inside a card for each day. This turns that
// card on its side: one column per weekday, one row per priority, so Monday
// through Friday can be read across a single line. On a phone those columns
// stack into full-width tiles and the page scrolls down. Grid (Legacy) keeps
// its sideways spreadsheet.

import { useBoard } from "../board";
import { DAY_NAMES, dailyPoints, withAutomaticTop5 } from "../points";
import type { DayRow } from "../types";
import { addDays, formatISODate, parseISODate } from "../weeks";
import { DraftField, ScoreBox, TaskLine } from "./WeekBoard";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const TASKS = [
  { doneField: "topDone", labelField: "topLabel", name: "Top", rank: "top", slot: "1" },
  { doneField: "highDone", labelField: "highLabel", name: "High", rank: "high", slot: "2" },
  { doneField: "med1Done", labelField: "med1Label", name: "Medium", rank: "med", slot: "3" },
  { doneField: "med2Done", labelField: "med2Label", name: "Medium 2", rank: "med2", slot: "4" },
  { doneField: "lowDone", labelField: "lowLabel", name: "Low", rank: "low", slot: "5" },
] as const;

type WeekMatrixProps = {
  rows: DayRow[];
  weekId: string;
  canEdit: boolean;
};

export function WeekMatrix({ rows, weekId, canEdit }: WeekMatrixProps) {
  const { onPatch, rates } = useBoard();
  const today = formatISODate(new Date());
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const days = DAY_NAMES.map((day, index) => {
    const date = addDays(weekId, index);
    const parsed = parseISODate(date);
    const row = byDay.get(day) ?? null;
    const scored = row ? withAutomaticTop5(row) : null;
    return {
      day,
      date,
      isToday: date === today,
      label: `${MONTHS[parsed.getMonth()]} ${parsed.getDate()}`,
      points: scored ? dailyPoints(scored, rates) : 0,
      row: scored,
    };
  });

  return (
    <div className="week-matrix">
      {/* Rank names stay in their own column on a wide screen so the five days line up.
          A phone hides this column and repeats the name inside each day tile. */}
      <div className="matrix-labels" aria-hidden="true">
        <div className="matrix-corner" />
        {TASKS.map((task) => (
          <div className={`matrix-slot rank-${task.rank}`} key={task.labelField}>
            <span>{task.slot}</span>
            <small>{task.name}</small>
          </div>
        ))}
        <div className="matrix-slot">
          <small>Notes</small>
        </div>
        <div className="matrix-slot">
          <small>Scores</small>
        </div>
      </div>
      {days.map((day) => (
        <article className={day.isToday ? "matrix-day is-today" : "matrix-day"} key={day.day}>
          <header className="day-column-head">
            <div>
              <strong>{day.day}</strong>
              <span>{day.label}</span>
            </div>
            <b>
              {day.points}
              <span> pts</span>
            </b>
          </header>
          {TASKS.map((task) => (
            <div className="matrix-cell" key={task.labelField}>
              <div className={`matrix-slot rank-${task.rank} matrix-slot-inline`}>
                <span>{task.slot}</span>
                <small>{task.name}</small>
              </div>
              {day.row ? (
                <TaskLine
                  row={day.row}
                  name={task.name}
                  rank={task.rank}
                  done={day.row[task.doneField]}
                  label={day.row[task.labelField]}
                  canEdit={canEdit}
                  showRank={false}
                  onDone={(checked) => onPatch(day.row!.id, { [task.doneField]: checked })}
                  onLabel={(next) => onPatch(day.row!.id, { [task.labelField]: next })}
                />
              ) : (
                <p className="day-empty">No day saved.</p>
              )}
            </div>
          ))}
          {/* Same notes box as the board. A bare textarea in this grid row uses
              the browser's intrinsic size and stretches over the day tile. */}
          <div className="matrix-cell">
            <div className="matrix-slot matrix-slot-inline">
              <small>Notes</small>
            </div>
            {day.row ? (
              <label className="day-notes">
                <DraftField
                  value={day.row.notes}
                  disabled={!canEdit}
                  label={`${day.row.person} ${day.row.day} notes`}
                  placeholder="Notes"
                  multiline
                  onCommit={(next) => onPatch(day.row!.id, { notes: next })}
                />
              </label>
            ) : null}
          </div>
          <div className="matrix-cell">
            <div className="matrix-slot matrix-slot-inline">
              <small>Scores</small>
            </div>
            {day.row ? (
              <div className="matrix-scores">
                <ScoreBox
                  label={rates.top5Name}
                  points={rates.top5}
                  checked={day.row.top5}
                  disabled
                  title="Checked when all five tasks are done"
                  onChange={() => undefined}
                />
                <ScoreBox
                  label={rates.exerciseName}
                  points={rates.exercise}
                  checked={day.row.exercise}
                  disabled={!canEdit}
                  onChange={(checked) => onPatch(day.row!.id, { exercise: checked })}
                />
                <ScoreBox
                  label={rates.readingName}
                  points={rates.reading}
                  checked={day.row.reading}
                  disabled={!canEdit}
                  onChange={(checked) => onPatch(day.row!.id, { reading: checked })}
                />
                {rates.extras.map((bonus) => (
                  <ScoreBox
                    key={bonus.key}
                    label={bonus.name}
                    points={bonus.points}
                    checked={Boolean(day.row?.extraChecks?.[bonus.key]?.checked)}
                    disabled={!canEdit}
                    onChange={(checked) =>
                      onPatch(day.row!.id, {
                        extraChecks: { ...(day.row?.extraChecks ?? {}), [bonus.key]: { checked } },
                      })
                    }
                  />
                ))}
              </div>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}
