// Editable scorecard for one person. A Google sign-in opens that person's rows.
// Anyone can look at another person. The fields stay locked unless this account
// is that person, or an admin or commissioner.
// Board is the default: five day columns side by side. Grid keeps the original table.
// The choice is stored in this browser so a refresh does not flip the layout back.
import { useMemo, useState } from "react";
import { canEditPerson, useAuth } from "../auth";
import { useBoard } from "../board";
import { MAX_WEEK_POINTS, personKey, weekPoints } from "../points";
import { WeekBoard } from "./WeekBoard";
import { WeekGrid } from "./WeekGrid";

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
  const dayCount = mine.length || 5;
  const average = total / dayCount;
  const averageLabel = Number.isInteger(average) ? String(average) : average.toFixed(1);
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
          <p>Top 5 checks itself when all five tasks are done. Exercise and Reading are still checked by hand.</p>
        </div>
        <aside className="week-score">
          <span className="week-score-label">Total</span>
          <strong>
            {total}
            <span> / {MAX_WEEK_POINTS}</span>
          </strong>
          <span className="week-score-avg">Average {averageLabel} per day</span>
        </aside>
      </div>
      <div className="week-tools">
        <div className="week-pickers">
          <label className="person-picker">
            Whose week
            <select value={selected} onChange={(event) => setSelectedKey(event.target.value)}>
              {people.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.person}
                </option>
              ))}
            </select>
          </label>
          <div className="person-picker">
            <span>Team</span>
            <div className="team-readout">{person?.team || "No team"}</div>
          </div>
        </div>
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
        <WeekGrid rows={mine} weekId={selectedWeek} canEdit={canEdit} />
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
