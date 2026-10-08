// Shared scorecard state. Both pages read the selected week from here.
// Saves go to Supabase. The grid still edits one person-day at a time.

import { AgGridReact } from "ag-grid-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buildColumns, darkGridTheme, gridTheme } from "./columns";
import type { GridContext } from "./cells";
import { importSummary, parseSheetCsv } from "./parseSheetCsv";
import { dailyPoints, DEFAULT_RATES, peopleInOrder, personKey, weekPoints, withAutomaticTop5, type ScoreRates } from "./points";
import { useAuth, canEditPerson, canOpenAdmin } from "./auth";
import { useTheme } from "./theme";
import { enrollSignedInUser, loadBoardState, saveDays, subscribeToBoard, writesInFlight, type LoadedBoard } from "./remoteBoard";
import type { SeasonSpan } from "./streaks";
import { fillBlankSampleTasks } from "./sampleTasks";
import type { DayRow, GridRow } from "./types";
import {
  addDays,
  blankWeek,
  currentMonday,
  formatWeekLabel,
  furthestPlannableMonday,
  isPastPlan,
  nextNewWeekId,
  planAheadMessage,
  rosterFrom,
  weekIsEmpty,
  withWeekIds,
  type WeekRecord,
} from "./weeks";

type Notice = { tone: "ok" | "error" | "info"; text: string; planLimit?: boolean };

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
  scoringMode: "individual" | "teams";
  season: SeasonSpan;
  nicknames: Record<string, string>;
  rates: ScoreRates;
  onPatch: GridContext["onPatch"];
  importCsv: (file: File) => Promise<void>;
  selectWeek: (weekId: string) => void;
  goToPreviousWeek: () => void;
  goToNextWeek: () => void;
  goToCurrentWeek: () => void;
  createNewWeek: () => void;
  loadSample: () => Promise<void>;
  dismissNotice: () => void;
};

const BoardContext = createContext<BoardValue | null>(null);

function extrasMatch(left: DayRow["extraChecks"] | undefined, right: DayRow["extraChecks"] | undefined): boolean {
  const keys = new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})]);
  for (const key of keys) {
    if (Boolean(left?.[key]?.checked) !== Boolean(right?.[key]?.checked)) return false;
  }
  return true;
}

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

// A task title or the notes box. A checkbox is not editing: those saves are
// already in the queue, and waiting on them is writesInFlight's job.
function isTextEditing(): boolean {
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement) return true;
  return active instanceof HTMLInputElement && active.type === "text";
}

export function BoardProvider({ children }: { children: ReactNode }) {
  const { ready: authReady, user, role, roleReady, profileName } = useAuth();
  const [selectedWeek, setSelectedWeek] = useState(currentMonday());
  const [weeks, setWeeks] = useState<Record<string, WeekRecord>>({});
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [scoringMode, setScoringMode] = useState<"individual" | "teams">("individual");
  const [season, setSeason] = useState<SeasonSpan>({ name: "", startsOn: currentMonday(), lengthWeeks: 12 });
  const [nicknames, setNicknames] = useState<Record<string, string>>({});
  const [rates, setRates] = useState<ScoreRates>(DEFAULT_RATES);
  const weeksRef = useRef(weeks);
  // Bumped on every local edit. A reload that started before this number
  // changed is a picture of the week from before that edit. Applying it
  // puts the old title back and can uncheck a box that was just turned on.
  const editEpoch = useRef(0);
  const selectedRef = useRef(selectedWeek);
  const roleRef = useRef(role);
  const profileNameRef = useRef(profileName);
  selectedRef.current = selectedWeek;
  roleRef.current = role;
  profileNameRef.current = profileName;

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
      setSeason(state.season);
      setNicknames(state.nicknames);
      if (!keepSelection) setSelectedWeek(currentMonday());
    },
    [commitWeeks],
  );

  // Wait for the role lookup too. A member must not create blank days for the
  // rest of the roster, and that choice is only known after the role is read.
  const userId = user?.id;
  useEffect(() => {
    if (!authReady || !roleReady) return;
    let cancel = false;
    const staff = canOpenAdmin(role);
    // userId, not the user object: a token refresh must not reload the week
    // and jump the person back to This week while they are editing.
    const load = user
      ? enrollSignedInUser(user).then(() => loadBoardState({ createRosterWeek: staff }))
      : loadBoardState({ createRosterWeek: false });
    load
      .then((state) => {
        if (cancel) return;
        applyLoaded(state, false);
        setScoringMode(state.scoringMode);
        setSeason(state.season);
        setRates({ ...state.bonusPoints, pointsPerTask: state.pointsPerTask });
        setReady(true);
        if (state.empty) {
          setNotice({
            tone: "info",
            text: "No scorecard in Supabase yet. Import a CSV to fill a week.",
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
  }, [applyLoaded, authReady, role, roleReady, userId]);

  // While the tab stays open, a new Monday creates that week and selects it.
  // Future weeks made with New week stay in the menu, but they are not "this week".
  useEffect(() => {
    if (!ready) return;
    let seen = currentMonday();
    const watch = () => {
      const monday = currentMonday();
      if (monday === seen) return;
      seen = monday;
      loadBoardState({ createRosterWeek: canOpenAdmin(roleRef.current) })
        .then((state) => {
          applyLoaded(state, false);
          setScoringMode(state.scoringMode);
          setSeason(state.season);
          setRates({ ...state.bonusPoints, pointsPerTask: state.pointsPerTask });
          setNotice({ tone: "ok", text: `This week is now ${formatWeekLabel(monday)}.` });
        })
        .catch((error: unknown) => {
          setNotice({ tone: "error", text: errorText(error, "Could not open the new week.") });
        });
    };
    const timer = window.setInterval(watch, 60_000);
    window.addEventListener("focus", watch);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", watch);
    };
  }, [applyLoaded, ready]);

  // Admin saves seasons and bonuses in the same database. Reload so a new
  // point value shows up without a full browser refresh.
  useEffect(() => {
    if (!ready) return;
    const reload = () => {
      loadBoardState()
        .then((state) => {
          applyLoaded(state, true);
          setScoringMode(state.scoringMode);
          setSeason(state.season);
          setRates({ ...state.bonusPoints, pointsPerTask: state.pointsPerTask });
        })
        .catch((error: unknown) => {
          setNotice({ tone: "error", text: errorText(error, "Could not reload the scorecard.") });
        });
    };
    window.addEventListener("top5-reload", reload);
    return () => window.removeEventListener("top5-reload", reload);
  }, [applyLoaded, ready]);

  // A remote change reloads the week, but not while our own save is still
  // in flight and not while a task title is focused. Otherwise the reload
  // would wipe the letters still being typed.
  useEffect(() => {
    if (!ready) return;
    let timer = 0;
    const unsubscribe = subscribeToBoard(() => {
      window.clearTimeout(timer);
      const reload = () => {
        // Wait out our own save and a title that is still focused. The
        // fetch itself also has to be thrown away if an edit lands while
        // it is in flight. Otherwise the response, which left before the
        // blur, arrives a moment later and overwrites the field they left.
        if (writesInFlight() || isTextEditing()) {
          timer = window.setTimeout(reload, 400);
          return;
        }
        const epoch = editEpoch.current;
        loadBoardState()
          .then((state) => {
            if (epoch !== editEpoch.current || writesInFlight() || isTextEditing()) {
              timer = window.setTimeout(reload, 400);
              return;
            }
            applyLoaded(state, true);
          })
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

  const dismissNotice = useCallback(() => {
    setNotice(null);
  }, []);

  const reportSaveError = useCallback((error: unknown) => {
    setNotice({
      tone: "error",
      text: errorText(error, "Could not save that change to Supabase."),
    });
  }, []);

  // Checkbox, title, and note edits all arrive here from the grid or the board.
  // React state updates first, so the box looks checked before the network
  // returns. saveDays is the only call that writes that day to Supabase.
  // Admin season/bonus/role saves do not come through here. They call
  // supabase.from() directly in Admin.tsx.
  const onPatch = useCallback(
    (id: string, patch: Partial<GridRow>) => {
      const week = weeksRef.current[selectedWeek];
      if (!week) return;
      const current = week.rows.find((row) => row.id === id);
      if (!current || !canEditPerson(roleRef.current, profileNameRef.current, current.person)) {
        setNotice({
          tone: "error",
          text: "You can edit your own tasks. An admin or commissioner can edit anyone.",
        });
        return;
      }
      // withAutomaticTop5 drops a check on a blank title and turns Top 5 off
      // when that was the box holding it on. Blur writes the title before the
      // checkbox click, so both land in this object and a filled line can
      // still be checked in the same gesture.
      const merged = withAutomaticTop5({ ...current, ...patch });
      // Clicking Top 5 itself does not stick. If the five task boxes already
      // agree with it, there is nothing to save.
      if (
        merged.top5 === current.top5 &&
        merged.topDone === current.topDone &&
        merged.highDone === current.highDone &&
        merged.med1Done === current.med1Done &&
        merged.med2Done === current.med2Done &&
        merged.lowDone === current.lowDone &&
        merged.topLabel === current.topLabel &&
        merged.highLabel === current.highLabel &&
        merged.med1Label === current.med1Label &&
        merged.med2Label === current.med2Label &&
        merged.lowLabel === current.lowLabel &&
        merged.notes === current.notes &&
        merged.exercise === current.exercise &&
        merged.reading === current.reading &&
        extrasMatch(merged.extraChecks, current.extraChecks)
      ) {
        return;
      }
      editEpoch.current += 1;
      const rows = week.rows.map((row) => (row.id === id ? merged : row));
      commitWeeks({
        ...weeksRef.current,
        [selectedWeek]: { ...week, rows },
      });
      void saveDays(selectedWeek, [merged], week.source).catch(reportSaveError);
    },
    [commitWeeks, reportSaveError, selectedWeek],
  );

  const importCsv = useCallback(
    async (file: File) => {
      if (!canOpenAdmin(roleRef.current)) {
        setNotice({ tone: "error", text: "Only an admin or commissioner can import a CSV." });
        return;
      }
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

  const selectWeek = useCallback((weekId: string) => {
    setSelectedWeek(weekId);
    setNotice(null);
  }, []);

  const openWeek = useCallback(
    (weekId: string, fromWeek: string) => {
      const existed = Boolean(weeksRef.current[weekId]);
      // A member can open a week that is already saved. Creating one writes a
      // blank day for every person, which only an admin or commissioner may do.
      if (!existed && !canOpenAdmin(roleRef.current)) return;
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
    // Next week does not create a week. Once the Monday four weeks out is the
    // next one, the button stays clickable so this note can appear. A disabled
    // button would swallow the click and the message would never show.
    if (isPastPlan(next)) {
      setNotice({ tone: "info", text: planAheadMessage(), planLimit: true });
      return;
    }
    // A future week is only opened once New week has saved it. Next week does not create one.
    if (next > currentMonday() && !weeksRef.current[next]) return;
    setNotice(null);
    openWeek(next, selectedWeek);
  }, [openWeek, selectedWeek]);

  // The season is filled in ahead of time. This copies the roster onto the
  // following Monday, including a Monday that has not started yet.
  // The copy stops four weeks past the current Monday. The planning notice
  // shows on the click that creates that furthest week, and again on any
  // later click that would go past it. It lives in component state, so a
  // refresh does not show it again until the next stopped click.
  const createNewWeek = useCallback(() => {
    if (!canOpenAdmin(roleRef.current)) {
      setNotice({ tone: "error", text: "Only an admin or commissioner can start a new week." });
      return;
    }
    const target = nextNewWeekId(selectedWeek, Object.keys(weeksRef.current));
    if (isPastPlan(target)) {
      setNotice({ tone: "info", text: planAheadMessage(), planLimit: true });
      return;
    }
    const createdHorizon = target === furthestPlannableMonday();
    setNotice(
      createdHorizon
        ? { tone: "info", text: planAheadMessage(), planLimit: true }
        : {
            tone: "ok",
            text: `New week started for ${formatWeekLabel(target)}. The roster is blank until you fill it in.`,
          },
    );
    openWeek(target, selectedWeek);
  }, [openWeek, selectedWeek]);

  // Load sample writes the signed-in person's current week only.
  // The week on screen may be an older one. The button still fills today's
  // Monday–Friday, then moves the board there so the new titles are visible.
  // Other people are not in the save. The database would reject their rows
  // for a member, and the button is not a roster import.
  const loadSample = useCallback(async () => {
    const name = profileNameRef.current.trim();
    if (!name) {
      setNotice({ tone: "info", text: "Sign in to load sample tasks for your week." });
      return;
    }
    const weekId = currentMonday();
    const known = Object.values(weeksRef.current)
      .flatMap((week) => week.rows)
      .find((row) => row.person === name);
    const week = weeksRef.current[weekId] ?? { rows: [], source: "Supabase" };
    const { rows: mine, changed, filled } = fillBlankSampleTasks(name, known?.team ?? null, weekId, week.rows);
    if (filled === 0 || changed.length === 0) {
      setSelectedWeek(weekId);
      setNotice({ tone: "ok", text: "Your week already has a task in every slot. Nothing was replaced." });
      return;
    }
    const byDay = new Map(mine.map((row) => [row.day, row]));
    const replaced = week.rows.map((row) => (row.person === name ? (byDay.get(row.day) ?? row) : row));
    const present = new Set(week.rows.filter((row) => row.person === name).map((row) => row.day));
    const added = mine.filter((row) => !present.has(row.day));
    commitWeeks({
      ...weeksRef.current,
      [weekId]: { ...week, rows: [...replaced, ...added] },
    });
    setSelectedWeek(weekId);
    setNotice(null);
    try {
      // Only days that gained a blank-slot title are written. A day whose
      // tasks were already filled is not sent, so those titles stay put.
      await saveDays(weekId, changed, week.source);
      setNotice({ tone: "ok", text: `Added ${filled} sample tasks to empty slots. Tasks that were already written were left alone.` });
    } catch (error: unknown) {
      reportSaveError(error);
    }
  }, [commitWeeks, reportSaveError]);

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
      scoringMode,
      season,
      nicknames,
      rates,
      onPatch,
      importCsv,
      selectWeek,
      goToPreviousWeek,
      goToNextWeek,
      goToCurrentWeek,
      createNewWeek,
      loadSample,
      dismissNotice,
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
      scoringMode,
      season,
      nicknames,
      rates,
      onPatch,
      importCsv,
      selectWeek,
      goToPreviousWeek,
      goToNextWeek,
      goToCurrentWeek,
      createNewWeek,
      loadSample,
      dismissNotice,
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
export function toGridRows(rows: DayRow[], rates: ScoreRates = DEFAULT_RATES): GridRow[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = personKey(row);
    totals.set(key, (totals.get(key) ?? 0) + dailyPoints(row, rates));
  }
  return rows.map((row) => ({
    ...row,
    daily: dailyPoints(row, rates),
    week: totals.get(personKey(row)) ?? weekPoints(rows, personKey(row), rates),
  }));
}

type ScoreGridProps = {
  rows: DayRow[];
  canEdit: boolean;
  showWeek?: boolean;
  showPerson?: boolean;
  showGroup?: boolean;
  showDay?: boolean;
  height?: number | string;
  quickFilter?: string;
};

// key={selectedWeek} remounts the grid so a week change cannot leave stale checkboxes.
// Omitting height lets the grid grow to its rows. The dashboard uses that so one
// person's Monday–Friday stays together instead of scrolling inside a shared list.
export function ScoreGrid({
  rows,
  canEdit,
  showWeek = false,
  showPerson = true,
  showGroup,
  showDay = true,
  height,
  quickFilter,
}: ScoreGridProps) {
  const { onPatch, selectedWeek, rates, nicknames } = useBoard();
  const { theme } = useTheme();
  const gridRows = useMemo(() => toGridRows(rows, rates), [rates, rows]);
  const grouped = showGroup ?? rows.some((row) => row.team);
  const columnDefs = useMemo(
    () => buildColumns(showWeek, grouped, rates, showPerson, showDay, nicknames),
    [grouped, nicknames, rates, showDay, showPerson, showWeek],
  );
  const context = useMemo<GridContext>(() => ({ canEdit, onPatch }), [canEdit, onPatch]);

  return (
    <div className={height == null ? "grid-wrap grid-wrap-auto" : "grid-wrap"} key={selectedWeek} style={height == null ? undefined : { height }}>
      <AgGridReact<GridRow>
        theme={theme === "dark" ? darkGridTheme : gridTheme}
        rowData={gridRows}
        columnDefs={columnDefs}
        context={context}
        getRowId={(params) => params.data.id}
        defaultColDef={{ sortable: true, resizable: true, suppressMovable: true }}
        enableBrowserTooltips
        tooltipShowDelay={400}
        quickFilterText={quickFilter}
        domLayout={height == null ? "autoHeight" : "normal"}
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
