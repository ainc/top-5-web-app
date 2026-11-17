// Layout preference for My week ("board" or "grid").
//
// Board stacks each weekday into a card. Grid turns that card sideways with
// weekdays across the top and slots 1–5 down the side.
//
// History: the sideways Grid view used to write "matrix" under
// top5-week-layout, while an older spreadsheet view wrote "grid" or "legacy".
// That spreadsheet is gone, so one helper now owns the mapping: the Grid
// button reads and writes "grid", a saved "matrix" still opens Grid, and
// anything else ("board", "legacy", empty) opens Board.

export type WeekLayout = "board" | "grid";

export const WEEK_LAYOUT_KEY = "top5-week-layout";

export function parseWeekLayout(stored: string | null | undefined): WeekLayout {
  if (stored === "grid" || stored === "matrix") return "grid";
  return "board";
}

export function readWeekLayout(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): WeekLayout {
  try {
    return parseWeekLayout(storage?.getItem(WEEK_LAYOUT_KEY));
  } catch {
    // Private browsing can block storage. Default to Board for this visit.
    return "board";
  }
}

export function writeWeekLayout(
  layout: WeekLayout,
  storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage,
): void {
  try {
    storage?.setItem(WEEK_LAYOUT_KEY, layout);
  } catch {
    // Private browsing can block storage. The choice still lasts for this visit.
  }
}
