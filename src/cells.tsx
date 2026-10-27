// Cells drawn inside AG Grid. The grid does not own the checkbox state.
// Each change calls onPatch, and the board writes it onto the selected week.

import type { CustomCellRendererProps } from "ag-grid-react";
import { useEffect, useRef, useState } from "react";
import type { GridRow } from "./types";
import { taskPlainText } from "./taskMarkup";
import { TaskEditor, TaskHtml } from "./taskRich";

type TaskFields = {
  doneField: "topDone" | "highDone" | "med1Done" | "med2Done" | "lowDone";
  labelField: "topLabel" | "highLabel" | "med1Label" | "med2Label" | "lowLabel";
};

export type GridContext = {
  canEdit: boolean;
  onPatch: (id: string, patch: Partial<GridRow>) => void;
};

type TaskCellProps = CustomCellRendererProps<GridRow, string, GridContext> & TaskFields;

// The letters being typed stay here until blur. The week in React state is
// replaced when Supabase pushes a reload. If that reload is a snapshot from
// before the blur, copying it back into the box wipes the title, and blur
// then thinks nothing changed, so the title is never saved.
export function useDraftText(value: string): {
  draft: string;
  edit: (next: string) => void;
  commit: (onCommit: (next: string) => void) => void;
} {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const valueRef = useRef(value);
  const dirty = useRef(false);
  valueRef.current = value;

  useEffect(() => {
    if (dirty.current) return;
    draftRef.current = value;
    setDraft(value);
  }, [value]);

  return {
    draft,
    edit(next: string) {
      draftRef.current = next;
      dirty.current = next !== valueRef.current;
      setDraft(next);
    },
    commit(onCommit: (next: string) => void) {
      const next = draftRef.current;
      const changed = dirty.current && next !== valueRef.current;
      dirty.current = false;
      if (changed) onCommit(next);
    },
  };
}

// One priority column: a done checkbox plus the task label.
// The label is saved on blur so typing does not rebuild the grid on every keystroke.
export function TaskCell({ data, context, doneField, labelField }: TaskCellProps) {
  const label = data?.[labelField] ?? "";
  const done = Boolean(data?.[doneField]);
  const typed = useDraftText(label);
  const hasText = taskPlainText(label).length > 0;

  if (!data) return null;

  return (
    <div className="task-cell">
      <input
        type="checkbox"
        checked={done && hasText}
        disabled={!context.canEdit}
        title={hasText ? undefined : "Type the task before checking it"}
        aria-label={`${data.person} ${data.day} done`}
        onChange={(event) => context.onPatch(data.id, { [doneField]: event.target.checked })}
      />
      {context.canEdit ? (
        <TaskEditor
          value={typed.draft}
          label={`${data.person} ${data.day} task`}
          placeholder="Add a task"
          onCommit={(next) => {
            typed.edit(next);
            typed.commit((saved) => context.onPatch(data.id, { [labelField]: saved }));
          }}
        />
      ) : (
        <span className={done && hasText ? "task-done" : undefined}>{label ? <TaskHtml value={label} /> : null}</span>
      )}
    </div>
  );
}

type BoolCellProps = CustomCellRendererProps<GridRow, boolean, GridContext>;

// Top 5, Exercise, and Reading. Top 5 is filled in from the five task boxes,
// so that checkbox cannot be toggled on its own. The others are disabled on
// the dashboard, where canEdit is false.
export function BoolCell({ data, value, context, colDef }: BoolCellProps) {
  if (!data || !colDef?.field) return null;
  const field = colDef.field as "top5" | "exercise" | "reading";
  const automatic = field === "top5";

  return (
    <div className="bool-cell">
      <input
        type="checkbox"
        checked={Boolean(value)}
        disabled={automatic || !context.canEdit}
        title={automatic ? "Checked when all five tasks are done" : undefined}
        aria-label={`${data.person} ${data.day} ${colDef.headerName ?? field}`}
        onChange={(event) => context.onPatch(data.id, { [field]: event.target.checked })}
      />
    </div>
  );
}

// A bonus added in Admin. The column id is "extra:<key>".
export function ExtraBonusCell({ data, value, context, colDef }: BoolCellProps) {
  if (!data) return null;
  const key = String(colDef?.colId ?? "").replace(/^extra:/, "");
  if (!key) return null;
  return (
    <div className="bool-cell">
      <input
        type="checkbox"
        checked={Boolean(value)}
        disabled={!context.canEdit}
        aria-label={`${data.person} ${data.day} ${colDef?.headerName ?? key}`}
        onChange={(event) =>
          context.onPatch(data.id, {
            extraChecks: { ...(data.extraChecks ?? {}), [key]: { checked: event.target.checked } },
          })
        }
      />
    </div>
  );
}
