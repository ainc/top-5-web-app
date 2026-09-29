// Editable scorecard for one person. Sign-in does not exist yet, so the menu picks who.
import { useMemo, useState } from "react";
import { ScoreGrid, useBoard } from "../board";
import { MAX_WEEK_POINTS, weekPoints } from "../points";

export function MyWeek() {
  const { rows, people, ready } = useBoard();
  const [selectedKey, setSelectedKey] = useState("");
  const selected = people.some((person) => person.key === selectedKey) ? selectedKey : (people[0]?.key ?? "");
  const person = people.find((item) => item.key === selected);
  const mine = useMemo(() => rows.filter((row) => `${row.team}|${row.person}` === selected), [rows, selected]);
  const total = person ? weekPoints(rows, person.key) : 0;

  if (!ready) return <p className="status">Loading the scorecard…</p>;

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h1>My week</h1>
          <p>Check Top 5, Exercise, and Reading. Those three boxes are the only ones that add points.</p>
        </div>
        <div className="week-score">
          {total}
          <span> / {MAX_WEEK_POINTS}</span>
        </div>
      </div>
      <label className="person-picker">
        Whose week
        <select value={selected} onChange={(event) => setSelectedKey(event.target.value)}>
          {people.map((item) => (
            <option key={item.key} value={item.key}>
              {item.person} · {item.team}
            </option>
          ))}
        </select>
      </label>
      <ScoreGrid rows={mine} canEdit height={340} />
    </section>
  );
}
