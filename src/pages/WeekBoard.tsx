// Horizontal week. Each weekday is a column, the way a Todoist board lays out sections.
// The five priority slots stay in the same order as the grid. Labels save on blur
// so a keystroke does not rewrite the day and move the cursor.

import { useEffect, useState } from "react";
import { useBoard } from "../board";
import { DAY_NAMES, dailyPoints } from "../points";
import type { DayRow } from "../types";
import { addDays, formatISODate, parseISODate } from "../weeks";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const TASKS = [
  { doneField: "topDone", labelField: "topLabel", name: "Top", rank: "top" },
  { doneField: "highDone", labelField: "highLabel", name: "High", rank: "high" },
  { doneField: "med1Done", labelField: "med1Label", name: "Medium", rank: "med" },
  { doneField: "med2Done", labelField: "med2Label", name: "Medium 2", rank: "med2" },
  { doneField: "lowDone", labelField: "lowLabel", name: "Low", rank: "low" },
] as const;

type WeekBoardProps = {
  rows: DayRow[];
  weekId: string;
  canEdit: boolean;
};

export function WeekBoard({ rows, weekId, canEdit }: WeekBoardProps) {
  const { onPatch, rates } = useBoard();
  const today = formatISODate(new Date());
  const byDay = new Map(rows.map((row) => [row.day, row]));

  return (
    <div className="week-board">
      {DAY_NAMES.map((day, index) => {
        const date = addDays(weekId, index);
        const parsed = parseISODate(date);
        const row = byDay.get(day) ?? null;
        const points = row ? dailyPoints(row, rates) : 0;
        return (
          <article className={date === today ? "day-column is-today" : "day-column"} key={day}>
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
              <>
                <ul className="day-tasks">
                  {TASKS.map((task) => (
                    <li key={task.labelField}>
                      <TaskLine
                        row={row}
                        name={task.name}
                        rank={task.rank}
                        done={row[task.doneField]}
                        label={row[task.labelField]}
                        canEdit={canEdit}
                        onDone={(checked) => onPatch(row.id, { [task.doneField]: checked })}
                        onLabel={(next) => onPatch(row.id, { [task.labelField]: next })}
                      />
                    </li>
                  ))}
                </ul>
                <label className="day-notes">
                  Notes
                  <DraftField
                    value={row.notes}
                    disabled={!canEdit}
                    label={`${row.person} ${row.day} notes`}
                    placeholder="Notes"
                    multiline
                    onCommit={(next) => onPatch(row.id, { notes: next })}
                  />
                </label>
                <div className="day-scores">
                  <ScoreBox
                    label={rates.top5Name}
                    points={rates.top5}
                    checked={row.top5}
                    disabled
                    title="Checked when all five tasks are done"
                    onChange={() => undefined}
                  />
                  <ScoreBox
                    label={rates.exerciseName}
                    points={rates.exercise}
                    checked={row.exercise}
                    disabled={!canEdit}
                    onChange={(checked) => onPatch(row.id, { exercise: checked })}
                  />
                  <ScoreBox
                    label={rates.readingName}
                    points={rates.reading}
                    checked={row.reading}
                    disabled={!canEdit}
                    onChange={(checked) => onPatch(row.id, { reading: checked })}
                  />
                  {rates.extras.map((bonus) => (
                    <ScoreBox
                      key={bonus.key}
                      label={bonus.name}
                      points={bonus.points}
                      checked={Boolean(row.extraChecks?.[bonus.key]?.checked)}
                      disabled={!canEdit}
                      onChange={(checked) =>
                        onPatch(row.id, {
                          extraChecks: { ...(row.extraChecks ?? {}), [bonus.key]: { checked } },
                        })
                      }
                    />
                  ))}
                </div>
              </>
            ) : (
              <p className="day-empty">This day is not on the week yet.</p>
            )}
          </article>
        );
      })}
    </div>
  );
}

function TaskLine({
  row,
  name,
  rank,
  done,
  label,
  canEdit,
  onDone,
  onLabel,
}: {
  row: DayRow;
  name: string;
  rank: string;
  done: boolean;
  label: string;
  canEdit: boolean;
  onDone: (checked: boolean) => void;
  onLabel: (next: string) => void;
}) {
  return (
    <div className={done ? `day-task is-done rank-${rank}` : `day-task rank-${rank}`}>
      <input
        type="checkbox"
        checked={done}
        disabled={!canEdit}
        aria-label={`${row.person} ${row.day} ${name} done`}
        onChange={(event) => onDone(event.target.checked)}
      />
      <span className="day-task-name">{name}</span>
      <DraftField
        value={label}
        disabled={!canEdit}
        done={done}
        label={`${row.person} ${row.day} ${name}`}
        placeholder="Add a task"
        onCommit={onLabel}
      />
    </div>
  );
}

function ScoreBox({
  label,
  points,
  checked,
  disabled,
  title,
  onChange,
}: {
  label: string;
  points: number;
  checked: boolean;
  disabled: boolean;
  title?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={checked ? "day-score is-on" : "day-score"} title={title}>
      <input type="checkbox" checked={checked} disabled={disabled} title={title} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
      <b>{points}</b>
    </label>
  );
}

function DraftField({
  value,
  disabled,
  done,
  label,
  placeholder,
  multiline,
  onCommit,
}: {
  value: string;
  disabled: boolean;
  done?: boolean;
  label: string;
  placeholder: string;
  multiline?: boolean;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  if (disabled) {
    return <span className={done ? "task-done" : undefined}>{value || placeholder}</span>;
  }

  if (multiline) {
    return (
      <textarea
        value={draft}
        rows={2}
        aria-label={label}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== value) onCommit(draft);
        }}
      />
    );
  }

  // A line through an <input> does not paint in Chromium. The overlay uses the
  // same text so a finished task still reads as done.
  return (
    <span className="task-field" data-value={done ? draft : undefined}>
      <input
        type="text"
        value={draft}
        aria-label={label}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== value) onCommit(draft);
        }}
      />
    </span>
  );
}
