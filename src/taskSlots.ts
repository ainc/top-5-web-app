// The only translation between one DayRow and the tasks table.
// A day on screen has named fields. Postgres stores one tasks row per slot.
// SLOT_COUNT and TASK_COLUMNS are the two facts a new slot has to change,
// together with one new entry in TASK_SLOTS. Postgres keeps the same number
// in app_private.task_slot_count() and the same columns in
// app_private.task_write_columns(). restore_edit reads that SQL list, so it
// does not keep a second copy.

export const SLOT_COUNT = 5;

const TASK_SLOT_LIST = [
  { slot: 1, label: "topLabel", done: "topDone", name: "Top", header: "Top priority" },
  { slot: 2, label: "highLabel", done: "highDone", name: "High", header: "High priority" },
  { slot: 3, label: "med1Label", done: "med1Done", name: "Medium", header: "Medium" },
  { slot: 4, label: "med2Label", done: "med2Done", name: "Medium 2", header: "Medium 2" },
  { slot: 5, label: "lowLabel", done: "lowDone", name: "Low", header: "Low priority" },
] as const;

function assertSlotCount<const T extends readonly unknown[]>(
  slots: T & (T["length"] extends typeof SLOT_COUNT ? unknown : never),
): T {
  return slots;
}

export const TASK_SLOTS = assertSlotCount(TASK_SLOT_LIST);

export type TaskSlot = (typeof TASK_SLOTS)[number];
export type TaskLabelField = TaskSlot["label"];
export type TaskDoneField = TaskSlot["done"];

export type TaskFields = {
  [Slot in TaskSlot as Slot["label"]]: string;
} & {
  [Slot in TaskSlot as Slot["done"]]: boolean;
};

// Columns restore_edit writes back onto public.tasks, besides id.
// app_private.task_write_columns() is this same list.
export const TASK_COLUMNS = ["season_id", "profile_id", "entry_date", "slot", "title", "done"] as const;

export type StoredTask = {
  slot: number;
  title: string;
  done: boolean;
};

export function blankTaskFields(): TaskFields {
  const fields = {} as TaskFields;
  for (const slot of TASK_SLOTS) {
    fields[slot.label] = "";
    fields[slot.done] = false;
  }
  return fields;
}

export function applyStoredTask(row: TaskFields, slotNumber: number, title: string, done: boolean): void {
  if (slotNumber < 1 || slotNumber > SLOT_COUNT) return;
  const slot = TASK_SLOTS.find((item) => item.slot === slotNumber);
  if (!slot) return;
  row[slot.label] = title;
  row[slot.done] = done;
}

export function storedTasksFromRow(row: TaskFields): StoredTask[] {
  return TASK_SLOTS.map((slot) => ({
    slot: slot.slot,
    title: row[slot.label],
    done: row[slot.done],
  }));
}

export function slotName(slotNumber: number): string {
  return TASK_SLOTS.find((slot) => slot.slot === slotNumber)?.name ?? "";
}

export function sameTasks(left: TaskFields, right: TaskFields): boolean {
  return TASK_SLOTS.every((slot) => left[slot.label] === right[slot.label] && left[slot.done] === right[slot.done]);
}
