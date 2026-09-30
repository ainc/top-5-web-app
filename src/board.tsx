// Shared scorecard state. Both pages read the selected week from here.
// Saves go to Supabase. The grid still edits one person-day at a time.

import { AgGridReact } from "ag-grid-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buildColumns, gridTheme } from "./columns";
import type { GridContext } from "./cells";
import { importSummary, parseSheetCsv } from "./parseSheetCsv";
import { dailyPoints, peopleInOrder, personKey, weekPoints } from "./points";
import { loadBoardState, saveDays, subscribeToBoard, writesInFlight, type LoadedBoard } from "./remoteBoard";
import type { DayRow, GridRow } from "./types";
import {
  addDays,
  blankWeek,
  currentMonday,
  formatWeekLabel,
  rosterFrom,
  weekIsEmpty,
  withWeekIds,
  type WeekRecord,
} from "./weeks";

type Notice = { tone: "ok" | "error" | "info"; text: string };

type BoardValue = {
  rows: DayRow[];
  ready: boolean;
  source: string;
  notice: Notice | null;
  people: ReturnType<typeof peopleInOrder>;
  selectedWeek: string;
  weekLabel: string;
  isCurrentWeek: boolean;
  weekIds: string[];
  weeks: Record<string, WeekRecord>;
  weekIsBlank: boolean;
  onPatch: GridContext["onPatch"];
  importCsv: (file: File) => Promise<void>;
  loadSample: () => Promise<void>;
  selectWeek: (weekId: string) => void;
  goToPreviousWeek: () => void;
  goToNextWeek: () => void;
  goToCurrentWeek: () => void;
  createNewWeek: () => void;
};

const BoardContext = createContext<BoardValue | null>(null);

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function ensureWeek(weeks: Record<string, WeekRecord>, weekId: string, fromWeek: string): Record<string, WeekRecord> {
  if (weeks[weekId]) return weeks;
  const roster = rosterFrom(weeks, fromWeek);
  return {
    ...weeks,
    [weekId]: {
      rows: blankWeek(roster, weekId),
      source: roster.length > 0 ? "Blank week" : "Empty week",
    },
  };
}

async function fetchSample(): Promise<DayRow[]> {
  const response = await fetch("/sample-top5.csv");
  if (!response.ok) throw new Error("Could not load the sample sheet.");
  return parseSheetCsv(await response.text());
}

function textIsEditing(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLInputElement && active.type === "text";
}

export function BoardProvider({ children }: { children: ReactNode }) {
  const [selectedWeek, setSelectedWeek] = useState(currentMonday());
  const [weeks, setWeeks] = useState<Record<string, WeekRecord>>({});
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const weeksRef = useRef(weeks);
  const selectedRef = useRef(selectedWeek);
  selectedRef.current = selectedWeek;

  const commitWeeks = useCallback((next: Record<string, WeekRecord>) => {
    weeksRef.current = next;
    setWeeks(next);
  }, []);

  const applyLoaded = useCallback(
    (state: LoadedBoard, keepSelection: boolean) => {
      const next = { ...state.weeks };
      const selected = selectedRef.current;
      if (keepSelection && !next[selected] && weeksRef.current[selected]) {
        next[selected] = weeksRef.current[selected];
      }
      commitWeeks(next);
      if (!keepSelection) setSelectedWeek(currentMonday());
    },
    [commitWeeks],
  );

  // First paint reads Supabase. The screen stays on "Loading" until that
  // returns, so a checkbox cannot save against an empty local copy.
  useEffect(() => {
    let cancel = false;
    loadBoardState()
      .then((state) => {
        if (cancel) return;
        applyLoaded(state, false);
        setReady(true);
        if (state.empty) {
          setNotice({
            tone: "info",
            text: "No scorecard in Supabase yet. Load the sample sheet or import a CSV.",
          });
        } else if (state.migratedFromBrowser) {
          setNotice({ tone: "ok", text: "Saved weeks from this browser are now in Supabase." });
        }
      })
      .catch((error: unknown) => {
        if (cancel) return;
        setReady(true);
        setNotice({ tone: "error", text: errorText(error, "Could not load the scorecard from Supabase.") });
      });
    return () => {
      cancel = true;
    };
  }, [applyLoaded]);

  // A remote change reloads the week, but not while our own save is still
  // in flight and not while a task title is focused. Otherwise the reload
  // would wipe the letters still being typed.
  useEffect(() => {
    if (!ready) return;
    let timer = 0;
    const unsubscribe = subscribeToBoard(() => {
      window.clearTimeout(timer);
      const reload = () => {
        if (writesInFlight() || textIsEditing()) {
          timer = window.setTimeout(reload, 400);
          return;
        }
        loadBoardState()
          .then((state) => applyLoaded(state, true))
          .catch((error: unknown) => {
            setNotice({ tone: "error", text: errorText(error, "Could not refresh the scorecard.") });
          });
      };
      timer = window.setTimeout(reload, 400);
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [applyLoaded, ready]);

  const reportSaveError = useCallback((error: unknown) => {
    setNotice({
      tone: "error",
      text: errorText(error, "Could not save that change to Supabase."),
    });
  }, []);

  // The grid updates immediately. The Supabase write follows that day only,
  // so editing Mack's Monday does not resend the rest of the week.
  const onPatch = useCallback(
    (id: string, patch: Partial<GridRow>) => {
      const week = weeksRef.current[selectedWeek];
      if (!week) return;
      const rows = week.rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
      const changed = rows.find((row) => row.id === id);
      commitWeeks({
        ...weeksRef.current,
        [selectedWeek]: { ...week, rows },
      });
      if (!changed) return;
      void saveDays(selectedWeek, [changed], week.source).catch(reportSaveError);
    },
    [commitWeeks, reportSaveError, selectedWeek],
  );

  const importCsv = useCallback(
    async (file: File) => {
      try {
        const next = withWeekIds(parseSheetCsv(await file.text()), selectedWeek);
        const record: WeekRecord = { rows: next, source: file.name };
        commitWeeks({ ...weeksRef.current, [selectedWeek]: record });
        await saveDays(selectedWeek, next, file.name, true);
        setNotice({ tone: "ok", text: `Imported ${importSummary(next, file.name)}` });
      } catch (error: unknown) {
        setNotice({ tone: "error", text: errorText(error, "Could not read that CSV.") });
      }
    },
    [commitWeeks, selectedWeek],
  );

  const loadSample = useCallback(async () => {
    try {
      const weekId = currentMonday();
      const next = withWeekIds(await fetchSample(), weekId);
      setSelectedWeek(weekId);
      selectedRef.current = weekId;
      commitWeeks({ ...weeksRef.current, [weekId]: { rows: next, source: "Sample sheet" } });
      await saveDays(weekId, next, "Sample sheet", true);
      setNotice({ tone: "ok", text: `Sample sheet loaded. ${importSummary(next)}` });
    } catch (error: unknown) {
      setNotice({ tone: "error", text: errorText(error, "Could not load the sample sheet.") });
    }
  }, [commitWeeks]);

  const selectWeek = useCallback((weekId: string) => {
    setSelectedWeek(weekId);
    setNotice(null);
  }, []);

  const openWeek = useCallback(
    (weekId: string, fromWeek: string) => {
      const existed = Boolean(weeksRef.current[weekId]);
      const next = ensureWeek(weeksRef.current, weekId, fromWeek);
      commitWeeks(next);
      setSelectedWeek(weekId);
      if (existed || next[weekId].rows.length === 0) return;
      void saveDays(weekId, next[weekId].rows, next[weekId].source).catch(reportSaveError);
    },
    [commitWeeks, reportSaveError],
  );

  const goToPreviousWeek = useCallback(() => {
    const previous = addDays(selectedWeek, -7);
    if (!weeksRef.current[previous]) {
      setNotice({
        tone: "ok",
        text: `No saved scorecard for ${formatWeekLabel(previous)}. The roster is blank until you import or fill it in.`,
      });
    }
    openWeek(previous, selectedWeek);
  }, [openWeek, selectedWeek]);

  const goToCurrentWeek = useCallback(() => {
    const today = currentMonday();
    setNotice(null);
    if (weeksRef.current[today]) {
      setSelectedWeek(today);
      return;
    }
    openWeek(today, selectedWeek);
  }, [openWeek, selectedWeek]);

  const goToNextWeek = useCallback(() => {
    const next = addDays(selectedWeek, 7);
    // A future week is only opened once New week has saved it. Next week does not create one.
    if (next > currentMonday() && !weeksRef.current[next]) return;
    setNotice(null);
    openWeek(next, selectedWeek);
  }, [openWeek, selectedWeek]);

  // The season is filled in ahead of time. This copies the roster onto the
  // following Monday, including a Monday that has not started yet.
  const createNewWeek = useCallback(() => {
    const following = addDays(selectedWeek, 7);
    const latest = Object.keys(weeksRef.current).sort().at(-1) ?? selectedWeek;
    const target = weeksRef.current[following] ? addDays(latest, 7) : following;
    setNotice({
      tone: "ok",
      text: `New week started for ${formatWeekLabel(target)}. The roster is blank until you fill it in.`,
    });
    openWeek(target, selectedWeek);
  }, [openWeek, selectedWeek]);

  const rows = weeks[selectedWeek]?.rows ?? [];
  const source = weeks[selectedWeek]?.source ?? "Supabase";
  const people = useMemo(() => peopleInOrder(rows), [rows]);
  const weekIds = useMemo(() => Object.keys(weeks).sort().reverse(), [weeks]);
  const today = currentMonday();
  const isCurrentWeek = selectedWeek === today;
  const weekLabel = formatWeekLabel(selectedWeek);
  const weekIsBlank = weekIsEmpty(rows);

  const value = useMemo(
    () => ({
      rows,
      ready,
      source,
      notice,
      people,
      selectedWeek,
      weekLabel,
      isCurrentWeek,
      weekIds,
      weeks,
      weekIsBlank,
      onPatch,
      importCsv,
      loadSample,
      selectWeek,
      goToPreviousWeek,
      goToNextWeek,
      goToCurrentWeek,
      createNewWeek,
    }),
    [
      rows,
      ready,
      source,
      notice,
      people,
      selectedWeek,
      weekLabel,
      isCurrentWeek,
      weekIds,
      weeks,
      weekIsBlank,
      onPatch,
      importCsv,
      loadSample,
      selectWeek,
      goToPreviousWeek,
      goToNextWeek,
      goToCurrentWeek,
      createNewWeek,
    ],
  );

  return <BoardContext.Provider value={value}>{children}</BoardContext.Provider>;
}

export function useBoard(): BoardValue {
  const value = useContext(BoardContext);
  if (!value) throw new Error("useBoard must be used inside BoardProvider");
  return value;
}

// Attach daily and weekly totals so the grid can show them as ordinary columns.
export function toGridRows(rows: DayRow[]): GridRow[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = personKey(row);
    totals.set(key, (totals.get(key) ?? 0) + dailyPoints(row));
  }
  return rows.map((row) => ({
    ...row,
    daily: dailyPoints(row),
    week: totals.get(personKey(row)) ?? weekPoints(rows, personKey(row)),
  }));
}

type ScoreGridProps = {
  rows: DayRow[];
  canEdit: boolean;
  showWeek?: boolean;
  height?: number | string;
  quickFilter?: string;
};

// key={selectedWeek} remounts the grid so a week change cannot leave stale checkboxes.
export function ScoreGrid({ rows, canEdit, showWeek = false, height, quickFilter }: ScoreGridProps) {
  const { onPatch, selectedWeek } = useBoard();
  const gridRows = useMemo(() => toGridRows(rows), [rows]);
  const showGroup = rows.some((row) => row.team);
  const columnDefs = useMemo(() => buildColumns(showWeek, showGroup), [showGroup, showWeek]);
  const context = useMemo<GridContext>(() => ({ canEdit, onPatch }), [canEdit, onPatch]);

  return (
    <div className="grid-wrap" key={selectedWeek} style={height == null ? undefined : { height }}>
      <AgGridReact<GridRow>
        theme={gridTheme}
        rowData={gridRows}
        columnDefs={columnDefs}
        context={context}
        getRowId={(params) => params.data.id}
        defaultColDef={{ sortable: true, resizable: true, suppressMovable: true }}
        enableBrowserTooltips
        tooltipShowDelay={400}
        quickFilterText={quickFilter}
        headerHeight={52}
        rowHeight={44}
        suppressCellFocus={!canEdit}
        onCellValueChanged={(event) => {
          if (!event.data || event.colDef.field !== "notes") return;
          onPatch(event.data.id, { notes: String(event.newValue ?? "") });
        }}
        stopEditingWhenCellsLoseFocus
      />
    </div>
  );
}
