// Editable scorecard for one person. A Google sign-in opens that person's rows.
// Anyone can look at another person. The fields stay locked unless this account
// is that person, or an admin or commissioner.
// Board is the default: five day columns side by side. Grid keeps the original table.
// The choice is stored in this browser so a refresh does not flip the layout back.
import { useMemo, useState } from "react";
import { canEditPerson, useAuth } from "../auth";
import { ScoreGrid, useBoard } from "../board";
import { MAX_WEEK_POINTS, personKey, weekPoints } from "../points";
import { WeekBoard } from "./WeekBoard";

type WeekLayout = "board" | "grid";

const LAYOUT_KEY = "top5-week-layout";

function readWeekLayout(): WeekLayout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "grid" ? "grid" : "board";
  } catch {
    return "board";
  }
}

export function MyWeek() {
  const { rows, people, ready, rates, selectedWeek } = useBoard();
  const { profileName, role, roleReady, user } = useAuth();
  const [selectedKey, setSelectedKey] = useState("");
  const [layout, setLayout] = useState<WeekLayout>(readWeekLayout);
  const signedInKey = people.find((person) => person.person === profileName)?.key ?? "";
  const selected = people.some((person) => person.key === selectedKey) ? selectedKey : signedInKey || (people[0]?.key ?? "");
  const person = people.find((item) => item.key === selected);
  const mine = useMemo(() => rows.filter((row) => personKey(row) === selected), [rows, selected]);
  const total = person ? weekPoints(rows, person.key, rates) : 0;
  const canEdit = Boolean(person) && roleReady && canEditPerson(role, profileName, person?.person ?? "");

  function chooseLayout(next: WeekLayout) {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // Private browsing can block storage. The choice still lasts for this visit.
    }
  }

  if (!ready) return <p className="status">Loading the scorecard…</p>;

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h1>📝 My week</h1>
          <p>Check Top 5, Exercise, and Reading. Those three boxes are the only ones that add points.</p>
        </div>
        <div className="week-score">
          {total}
          <span> / {MAX_WEEK_POINTS}</span>
        </div>
      </div>
      <div className="week-tools">
        <label className="person-picker">
          Whose week
          <select value={selected} onChange={(event) => setSelectedKey(event.target.value)}>
            {people.map((item) => (
              <option key={item.key} value={item.key}>
                {item.team ? `${item.person} · ${item.team}` : item.person}
              </option>
            ))}
          </select>
        </label>
        <div className="layout-toggle" role="group" aria-label="Week layout">
          <button type="button" aria-pressed={layout === "board"} onClick={() => chooseLayout("board")}>
            Board
          </button>
          <button type="button" aria-pressed={layout === "grid"} onClick={() => chooseLayout("grid")}>
            Grid
          </button>
        </div>
      </div>
      {layout === "board" ? (
        <WeekBoard rows={mine} weekId={selectedWeek} canEdit={canEdit} />
      ) : (
        <ScoreGrid rows={mine} canEdit={canEdit} height={340} />
      )}
      {roleReady && !canEdit ? (
        <p className="field-help">
          {user
            ? "You can edit your own tasks. An admin or commissioner can edit anyone."
            : "Sign in to edit your own tasks."}
        </p>
      ) : null}
    </section>
  );
}
