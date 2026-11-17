// My week layout mapping. The Grid button reads and writes "grid", while an
// older browser save of "matrix" still opens Grid instead of flipping back to
// Board. Legacy spreadsheet values fall back to Board.

import { expect, it } from "vitest";
import { parseWeekLayout, readWeekLayout, WEEK_LAYOUT_KEY, writeWeekLayout } from "./weekLayout";

it("maps grid and legacy matrix to grid, and defaults everything else to board", () => {
  expect(parseWeekLayout("grid")).toBe("grid");
  expect(parseWeekLayout("matrix")).toBe("grid");
  expect(parseWeekLayout("board")).toBe("board");
  expect(parseWeekLayout("legacy")).toBe("board");
  expect(parseWeekLayout(null)).toBe("board");
  expect(parseWeekLayout(undefined)).toBe("board");
});

it("reads and writes grid under top5-week-layout", () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };

  store.set(WEEK_LAYOUT_KEY, "matrix");
  expect(readWeekLayout(storage)).toBe("grid");

  writeWeekLayout("grid", storage);
  expect(store.get(WEEK_LAYOUT_KEY)).toBe("grid");
  expect(readWeekLayout(storage)).toBe("grid");

  writeWeekLayout("board", storage);
  expect(store.get(WEEK_LAYOUT_KEY)).toBe("board");
  expect(readWeekLayout(storage)).toBe("board");
});
