// Weekdays across the top, task slots down the side.
// Board stacks the five tasks inside a card for each day. This turns that
// card on its side: one column per weekday, one row per slot, so Monday
// through Friday can be read across a single line. The row is numbered 1–5.
// The priority words used to sit beside those numbers.
import { useBoard } from "../board";
import { DAY_NAMES, dailyPoints, withAutomaticTop5 } from "../points";
import { TASK_SLOTS } from "../taskSlots";
import type { DayRow } from "../types";
import { addDays, formatISODate, parseISODate } from "../weeks";
import { DayNote, DayScores, TaskLine } from "./WeekBoard";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
        {TASK_SLOTS.map((task) => (
          <div className="matrix-slot is-task" key={task.label}>
            <span>{task.slot}</span>
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
          {TASK_SLOTS.map((task) => (
            <div className="matrix-cell is-task" key={task.label}>
              <div className="matrix-slot matrix-slot-inline">
                <span>{task.slot}</span>
              </div>
              {day.row ? (
                <TaskLine
                  row={day.row}
                  name={String(task.slot)}
                  done={day.row[task.done]}
                  label={day.row[task.label]}
                  canEdit={canEdit}
                  onDone={(checked) => onPatch(day.row!.id, { [task.done]: checked })}
                  onLabel={(next) => onPatch(day.row!.id, { [task.label]: next })}
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
            {day.row ? <DayNote row={day.row} canEdit={canEdit} /> : null}
          </div>
          <div className="matrix-cell">
            <div className="matrix-slot matrix-slot-inline">
              <small>Scores</small>
            </div>
            {day.row ? <DayScores row={day.row} canEdit={canEdit} /> : null}
          </div>
        </article>
      ))}
    </div>
  );
}
