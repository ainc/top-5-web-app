// Weekdays across the top, task slots down the side.
// Board stacks the five tasks inside a card for each day. This turns that
// card on its side: one column per weekday, one row per priority, so Monday
// through Friday can be read across a single line. Grid (Legacy) is the older
// spreadsheet, where each day is its own table and the priorities are columns.

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
    <div className="week-matrix-scroll">
      <table className="week-matrix">
        <thead>
          <tr>
            <th className="matrix-corner" />
            {days.map((day) => (
              <th className={day.isToday ? "is-today" : undefined} key={day.day} scope="col">
                <strong>{day.day}</strong>
                <span>{day.label}</span>
                <b>
                  {day.points}
                  <span> pts</span>
                </b>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {TASKS.map((task) => (
            <tr key={task.labelField}>
              <th className={`matrix-slot rank-${task.rank}`} scope="row">
                <span>{task.slot}</span>
                <small>{task.name}</small>
              </th>
              {days.map((day) => (
                <td className={day.isToday ? "is-today" : undefined} key={day.day}>
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
                </td>
              ))}
            </tr>
          ))}
          {/* The sketch stops at the five tasks. Notes and the score boxes stay
              in the same table so this view can still finish a day. */}
          <tr>
            <th className="matrix-slot" scope="row">
              <small>Notes</small>
            </th>
            {days.map((day) => (
              <td className={day.isToday ? "is-today" : undefined} key={day.day}>
                {day.row ? (
                  <DraftField
                    value={day.row.notes}
                    disabled={!canEdit}
                    label={`${day.row.person} ${day.row.day} notes`}
                    placeholder="Notes"
                    multiline
                    onCommit={(next) => onPatch(day.row!.id, { notes: next })}
                  />
                ) : null}
              </td>
            ))}
          </tr>
          <tr>
            <th className="matrix-slot" scope="row">
              <small>Scores</small>
            </th>
            {days.map((day) => (
              <td className={day.isToday ? "is-today" : undefined} key={day.day}>
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
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
