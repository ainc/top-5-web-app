// Reads a Google Sheets CSV export of the scorecard tab.
// Group banners (ACES, ALPHIAS, AWESOMES) must be the only text in their row.
// Each priority is a checkbox column followed by a text column.
// Daily and weekly totals in the file are ignored and recalculated.

import { DAY_NAMES, personKey } from "./points";
import type { DayRow, Team } from "./types";

type Pair = { check: number; label: number };

// Small CSV parser. Handles quoted commas and "" escapes. Strips a leading Excel BOM.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < src.length; i += 1) {
    const char = src[i];
    if (inQuotes) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

// Sheet banners are not spelled the same way every time. ALPHIAS is Team Alpha.
function normalizeTeam(value: string): Team | null {
  const name = value.trim().toLowerCase();
  if (name === "ace" || name === "aces") return "ACES";
  if (name === "alpha" || name === "alphas" || name === "alphias") return "Alpha";
  if (name === "awesome" || name === "awesomes") return "Awesomes";
  return null;
}

// Google Sheets exports a checked box as TRUE.
function isChecked(value: string | undefined): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "y" || normalized === "1";
}

function isPriorityHeader(value: string): boolean {
  return /priority|high|medium|low/i.test(value) && !/top\s*5/i.test(value);
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// A group banner is one cell, such as "ACES", with the rest of the row empty.
function isSectionRow(cells: string[]): Team | null {
  const filled = cells.map((cell) => cell.trim()).filter(Boolean);
  if (filled.length !== 1) return null;
  return normalizeTeam(filled[0]);
}

// Merged headers put the title on the checkbox column and leave the text column blank.
// Collect up to five checkbox/label pairs before Notes or Top 5.
function findPriorityPairs(headers: string[], start: number, end: number): Pair[] {
  const pairs: Pair[] = [];
  let index = start;
  while (index < end && pairs.length < 5) {
    const header = headers[index] ?? "";
    const next = headers[index + 1] ?? "";
    if (header && !next && index + 1 < end) {
      pairs.push({ check: index, label: index + 1 });
      index += 2;
      continue;
    }
    if (!header && next && isPriorityHeader(next)) {
      pairs.push({ check: index, label: index + 1 });
      index += 2;
      continue;
    }
    if (header && isPriorityHeader(header)) {
      pairs.push({ check: -1, label: index });
      index += 1;
      continue;
    }
    index += 1;
  }
  return pairs;
}

// The sheet sometimes puts Top 5 / Exercise / Reading on the row under the main header.
// Fold that second header row in when it is not already a data row.
function combineHeader(table: string[][], headerIndex: number): { headers: string[]; dataStart: number } {
  const headers = table[headerIndex].map((cell) => cell.trim());
  const next = table[headerIndex + 1];
  if (!next) return { headers, dataStart: headerIndex + 1 };

  const nextHasScore = next.some((cell) => /exercise|reading|top\s*5/i.test(cell));
  const nextIsData = next.some((cell) => /^(true|false)$/i.test(cell.trim()));
  if (!nextHasScore || nextIsData) return { headers, dataStart: headerIndex + 1 };

  next.forEach((cell, index) => {
    if (!headers[index] && cell.trim()) headers[index] = cell.trim();
  });
  return { headers, dataStart: headerIndex + 2 };
}

function cell(row: string[], index: number): string {
  if (index < 0) return "";
  return (row[index] ?? "").trim();
}

// Walk data rows. A banner changes the current group. A blank name repeats the person
// above it, which is how merged name cells export. The first five rows become Mon–Fri.
export function parseSheetCsv(text: string): DayRow[] {
  const table = parseCsv(text).filter((row) => row.some((value) => value.trim() !== ""));
  const headerIndex = table.findIndex((row) => row.some((cell) => /top priority/i.test(cell)));
  if (headerIndex === -1) {
    throw new Error("Could not find a Top Priority header. Download the scorecard tab as a CSV.");
  }

  const { headers, dataStart } = combineHeader(table, headerIndex);
  const notesCol = headers.findIndex((header) => /notes/i.test(header));
  const top5Col = headers.findIndex((header) => /top\s*5/i.test(header));
  const exerciseCol = headers.findIndex((header) => /exercise/i.test(header));
  const readingCol = headers.findIndex((header) => /reading/i.test(header));
  const priorityEnd = [notesCol, top5Col, headers.length].find((index) => index > 0) ?? headers.length;
  const pairs = findPriorityPairs(headers, 1, priorityEnd);

  if (pairs.length === 0 || top5Col === -1) {
    throw new Error("The CSV is missing the priority columns or the Top 5 checkbox column.");
  }

  const rows: DayRow[] = [];
  const dayCount = new Map<string, number>();
  let team: Team = "Awesomes";
  let person = "";

  for (const source of table.slice(dataStart)) {
    const section = isSectionRow(source);
    if (section) {
      team = section;
      person = "";
      continue;
    }

    const name = cell(source, 0);
    const namedTeam = normalizeTeam(name);
    if (namedTeam && source.slice(1).every((value) => value.trim() === "")) {
      team = namedTeam;
      person = "";
      continue;
    }

    if (name && name.length > 1 && !namedTeam) person = name;
    if (!person || person.length < 2) continue;

    const labels = pairs.map((pair) => cell(source, pair.label));
    const dones = pairs.map((pair) => isChecked(cell(source, pair.check)));
    const top5 = isChecked(cell(source, top5Col));
    const exercise = isChecked(cell(source, exerciseCol));
    const reading = isChecked(cell(source, readingCol));
    const notes = cell(source, notesCol);
    const hasTask = labels.some(Boolean) || dones.some(Boolean) || top5 || exercise || reading || notes.length > 0;
    if (!hasTask) continue;

    const key = `${team}|${person}`;
    const dayNumber = (dayCount.get(key) ?? 0) + 1;
    dayCount.set(key, dayNumber);

    const row: DayRow = {
      id: `${slug(team)}-${slug(person)}-${dayNumber}`,
      person,
      team,
      day: DAY_NAMES[dayNumber - 1] ?? `Day ${dayNumber}`,
      topLabel: "",
      topDone: false,
      highLabel: "",
      highDone: false,
      med1Label: "",
      med1Done: false,
      med2Label: "",
      med2Done: false,
      lowLabel: "",
      lowDone: false,
      notes,
      top5,
      exercise,
      reading,
    };

    const [top, high, med1, med2, low] = [0, 1, 2, 3, 4].map((index) => ({
      label: labels[index] ?? "",
      done: dones[index] ?? false,
    }));
    row.topLabel = top.label;
    row.topDone = top.done;
    row.highLabel = high.label;
    row.highDone = high.done;
    row.med1Label = med1.label;
    row.med1Done = med1.done;
    row.med2Label = med2.label;
    row.med2Done = med2.done;
    row.lowLabel = low.label;
    row.lowDone = low.done;

    rows.push(row);
  }

  if (rows.length === 0) {
    throw new Error("The CSV did not include any scorecard rows.");
  }

  return rows;
}

// Short status line after a successful import, such as "sheet.csv: 50 days for 10 people."
export function importSummary(rows: DayRow[], fileName?: string): string {
  const people = new Set(rows.map((row) => personKey(row))).size;
  const file = fileName ? `${fileName}: ` : "";
  return `${file}${rows.length} days for ${people} ${people === 1 ? "person" : "people"}.`;
}
