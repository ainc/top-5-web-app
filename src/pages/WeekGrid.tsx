// Grid layout with one card per weekday. The columns stay the spreadsheet
// row (priorities, notes, bonuses). The days are not stacked inside one table,
// so Monday does not sit on the next line under Friday.

import { ScoreGrid, useBoard } from "../board";
import { DAY_NAMES, dailyPoints } from "../points";
import type { DayRow } from "../types";
import { addDays, formatISODate, parseISODate } from "../weeks";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type WeekGridProps = {
  rows: DayRow[];
  weekId: string;
  canEdit: boolean;
};

export function WeekGrid({ rows, weekId, canEdit }: WeekGridProps) {
  const { rates } = useBoard();
  const today = formatISODate(new Date());
  const byDay = new Map(rows.map((row) => [row.day, row]));

  return (
    <div className="week-grid">
      {DAY_NAMES.map((day, index) => {
        const date = addDays(weekId, index);
        const parsed = parseISODate(date);
        const row = byDay.get(day) ?? null;
        const points = row ? dailyPoints(row, rates) : 0;
        return (
          <article className={date === today ? "day-strip is-today" : "day-strip"} key={day}>
            <header className="day-column-head">
              <div>
                <strong>{day}</strong>
                <span>{`${MONTHS[parsed.getMonth()]} ${parsed.getDate()}`}</span>
              </div>
              <b>
                {points}
                <span> pts</span>
              </b>
            </header>
            {row ? (
              <ScoreGrid rows={[row]} canEdit={canEdit} showPerson={false} showGroup={false} showDay={false} />
            ) : (
              <p className="day-empty">No day saved.</p>
            )}
          </article>
        );
      })}
    </div>
  );
}
