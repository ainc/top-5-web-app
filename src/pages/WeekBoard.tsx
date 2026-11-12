// Horizontal week. Each weekday is a column.
// The five slots stay in order, numbered 1–5. The old Top / High / Medium
// words and their colors are gone: the number is the only rank on the card.
// A note starts as "+ Note" and opens into the box, so an empty day is not
// a blank textarea. Top 5 complete is a status badge. It checks itself when
// all five tasks are done, so it is not a checkbox. Exercise and Reading are
// toggle chips. The icon sits to the left of each label. The points for those
// chips live in the sidebar, not on the chip.

import { BadgeCheck, BookOpenCheck, Dumbbell, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useBoard } from "../board";
import { useDraftText } from "../cells";
import { DAY_NAMES, completedTaskCount, dailyPoints, taskHasText, withAutomaticTop5 } from "../points";
import { TASK_SLOTS } from "../taskSlots";
import { TaskEditor, TaskHtml } from "../taskRich";
import type { DayRow } from "../types";
import { addDays, formatISODate, parseISODate } from "../weeks";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type WeekBoardProps = {
  rows: DayRow[];
  weekId: string;
  canEdit: boolean;
};

function tasksFinished(row: DayRow): number {
  return completedTaskCount(row);
}

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
        const scored = row ? withAutomaticTop5(row) : null;
        const points = scored ? dailyPoints(scored, rates) : 0;
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
            {scored ? (
              <>
                <ul className="day-tasks">
                  {TASK_SLOTS.map((task) => (
                    <li key={task.label}>
                      <TaskLine
                        row={scored}
                        name={String(task.slot)}
                        slot={task.slot}
                        done={scored[task.done]}
                        label={scored[task.label]}
                        canEdit={canEdit}
                        onDone={(checked) => onPatch(scored.id, { [task.done]: checked })}
                        onLabel={(next) => onPatch(scored.id, { [task.label]: next })}
                      />
                    </li>
                  ))}
                </ul>
                <DayNote row={scored} canEdit={canEdit} />
                <DayScores row={scored} canEdit={canEdit} />
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

export function TaskLine({
  row,
  name,
  slot,
  done,
  label,
  canEdit,
  onDone,
  onLabel,
}: {
  row: DayRow;
  name: string;
  slot?: number;
  done: boolean;
  label: string;
  canEdit: boolean;
  onDone: (checked: boolean) => void;
  onLabel: (next: string) => void;
}) {
  const hasText = taskHasText(label);
  return (
    <div className={slot ? (done && hasText ? "day-task is-done has-slot" : "day-task has-slot") : done && hasText ? "day-task is-done" : "day-task"}>
      {slot ? <span className="day-task-slot">{slot}</span> : null}
      <input
        type="checkbox"
        checked={done && hasText}
        disabled={!canEdit}
        title={hasText ? undefined : "Type the task before checking it"}
        aria-label={`${row.person} ${row.day} task ${name} done`}
        onChange={(event) => onDone(event.target.checked)}
      />
      <DraftField
        value={label}
        disabled={!canEdit}
        done={done && hasText}
        label={`${row.person} ${row.day} task ${name}`}
        placeholder="Add a task"
        onCommit={onLabel}
      />
    </div>
  );
}

// The badge is the finished state of Top 5. Until then the card says how
// many of the five tasks are done. Exercise and Reading stay clickable.
export function DayScores({ row, canEdit }: { row: DayRow; canEdit: boolean }) {
  const { onPatch, rates } = useBoard();
  const finished = tasksFinished(row);
  return (
    <div className="day-scores">
      {row.top5 ? (
        <p className="score-badge">
          <BadgeCheck aria-hidden="true" />
          <span>
            {rates.top5Name} · {rates.top5}
          </span>
        </p>
      ) : (
        <p className="score-progress">
          {finished} of 5 done
        </p>
      )}
      <div className="score-chips">
        <ScoreChip
          icon={Dumbbell}
          label={rates.exerciseName}
          checked={row.exercise}
          disabled={!canEdit}
          onChange={(checked) => onPatch(row.id, { exercise: checked })}
        />
        <ScoreChip
          icon={BookOpenCheck}
          label={rates.readingName}
          checked={row.reading}
          disabled={!canEdit}
          onChange={(checked) => onPatch(row.id, { reading: checked })}
        />
        {rates.extras.map((bonus) => (
          <ScoreChip
            key={bonus.key}
            label={bonus.name}
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
    </div>
  );
}

function ScoreChip({
  icon: Icon,
  label,
  checked,
  disabled,
  onChange,
}: {
  icon?: LucideIcon;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={checked ? "score-chip is-on" : "score-chip"}
      aria-pressed={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      {Icon ? <Icon aria-hidden="true" /> : null}
      <span>{label}</span>
    </button>
  );
}

// An empty note is a link. Opening it shows the box. Blurring an empty box
// puts the link back. A saved note stays open so it can be read.
export function DayNote({ row, canEdit }: { row: DayRow; canEdit: boolean }) {
  const { onPatch } = useBoard();
  const [open, setOpen] = useState(() => row.notes.trim().length > 0);
  useEffect(() => {
    if (row.notes.trim()) setOpen(true);
  }, [row.notes]);
  if (!canEdit && !row.notes.trim()) return null;
  if (!open) {
    return (
      <button type="button" className="day-note-add" onClick={() => setOpen(true)}>
        + Note
      </button>
    );
  }
  return (
    <label className="day-notes">
      <DraftField
        value={row.notes}
        disabled={!canEdit}
        label={`${row.person} ${row.day} notes`}
        placeholder="Note"
        multiline
        autoFocus={!row.notes.trim()}
        onEmptyBlur={() => {
          if (!row.notes.trim()) setOpen(false);
        }}
        onCommit={(next) => {
          onPatch(row.id, { notes: next });
          if (!next.trim()) setOpen(false);
        }}
      />
    </label>
  );
}

export function DraftField({
  value,
  disabled,
  done,
  label,
  placeholder,
  multiline,
  autoFocus,
  onCommit,
  onEmptyBlur,
}: {
  value: string;
  disabled: boolean;
  done?: boolean;
  label: string;
  placeholder: string;
  multiline?: boolean;
  autoFocus?: boolean;
  onCommit: (next: string) => void;
  onEmptyBlur?: () => void;
}) {
  const typed = useDraftText(value);

  if (disabled) {
    return value ? <TaskHtml value={value} /> : <span className={done ? "task-done" : undefined}>{placeholder}</span>;
  }

  if (multiline) {
    return (
      <textarea
        value={typed.draft}
        rows={2}
        aria-label={label}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(event) => typed.edit(event.target.value)}
        onBlur={() => {
          typed.commit(onCommit);
          if (!typed.draft.trim()) onEmptyBlur?.();
        }}
      />
    );
  }

  // Checked tasks stay grey with one strikethrough until the editor is open.
  // Quill replaces the text box so a web address can be a link.
  return (
    <span className="task-field">
      <TaskEditor
        value={typed.draft}
        label={label}
        placeholder={placeholder}
        onCommit={(next) => {
          typed.edit(next);
          typed.commit(onCommit);
        }}
      />
    </span>
  );
}
