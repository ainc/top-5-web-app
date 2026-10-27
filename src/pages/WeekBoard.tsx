// Horizontal week. Each weekday is a column, the way a Todoist board lays out sections.
// The five priority slots stay in the same order as the grid. The rank word
// sits to the right of the text, small, so the task itself is what you read.
// Labels save on blur so a keystroke does not rewrite the day and move the cursor.

import { useBoard } from "../board";
import { useDraftText } from "../cells";
import { DAY_NAMES, dailyPoints, taskHasText, withAutomaticTop5 } from "../points";
import { TaskEditor, TaskHtml } from "../taskRich";
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
                  {TASKS.map((task) => (
                    <li key={task.labelField}>
                      <TaskLine
                        row={scored}
                        name={task.name}
                        rank={task.rank}
                        done={scored[task.doneField]}
                        label={scored[task.labelField]}
                        canEdit={canEdit}
                        onDone={(checked) => onPatch(scored.id, { [task.doneField]: checked })}
                        onLabel={(next) => onPatch(scored.id, { [task.labelField]: next })}
                      />
                    </li>
                  ))}
                </ul>
                <label className="day-notes">
                  Notes
                  <DraftField
                    value={scored.notes}
                    disabled={!canEdit}
                    label={`${scored.person} ${scored.day} notes`}
                    placeholder="Notes"
                    multiline
                    onCommit={(next) => onPatch(scored.id, { notes: next })}
                  />
                </label>
                <div className="day-scores">
                  <ScoreBox
                    label={rates.top5Name}
                    points={rates.top5}
                    checked={scored.top5}
                    disabled
                    title="Checked when all five tasks are done"
                    onChange={() => undefined}
                  />
                  <ScoreBox
                    label={rates.exerciseName}
                    points={rates.exercise}
                    checked={scored.exercise}
                    disabled={!canEdit}
                    onChange={(checked) => onPatch(scored.id, { exercise: checked })}
                  />
                  <ScoreBox
                    label={rates.readingName}
                    points={rates.reading}
                    checked={scored.reading}
                    disabled={!canEdit}
                    onChange={(checked) => onPatch(scored.id, { reading: checked })}
                  />
                  {rates.extras.map((bonus) => (
                    <ScoreBox
                      key={bonus.key}
                      label={bonus.name}
                      points={bonus.points}
                      checked={Boolean(scored.extraChecks?.[bonus.key]?.checked)}
                      disabled={!canEdit}
                      onChange={(checked) =>
                        onPatch(scored.id, {
                          extraChecks: { ...(scored.extraChecks ?? {}), [bonus.key]: { checked } },
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

// showRank is for the board cards, where each line needs its own Top/High note.
// The weekday matrix already names the slot in the row header, so it hides that note.
export function TaskLine({
  row,
  name,
  rank,
  done,
  label,
  canEdit,
  showRank = true,
  onDone,
  onLabel,
}: {
  row: DayRow;
  name: string;
  rank: string;
  done: boolean;
  label: string;
  canEdit: boolean;
  showRank?: boolean;
  onDone: (checked: boolean) => void;
  onLabel: (next: string) => void;
}) {
  const hasText = taskHasText(label);
  const rankClass = showRank ? "" : " no-rank";
  return (
    <div className={done && hasText ? `day-task is-done rank-${rank}${rankClass}` : `day-task rank-${rank}${rankClass}`}>
      <input
        type="checkbox"
        checked={done && hasText}
        disabled={!canEdit}
        title={hasText ? undefined : "Type the task before checking it"}
        aria-label={`${row.person} ${row.day} ${name} done`}
        onChange={(event) => onDone(event.target.checked)}
      />
      <DraftField
        value={label}
        disabled={!canEdit}
        done={done && hasText}
        label={`${row.person} ${row.day} ${name}`}
        placeholder="Add a task"
        onCommit={onLabel}
      />
      {showRank ? <span className="day-task-name">{name}</span> : null}
    </div>
  );
}

export function ScoreBox({
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

export function DraftField({
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
        onChange={(event) => typed.edit(event.target.value)}
        onBlur={() => typed.commit(onCommit)}
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
