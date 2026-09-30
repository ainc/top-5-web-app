// Editable scorecard for one person. A Google sign-in opens that person's rows.
// The menu stays until row writes are limited to the signed-in user.
import { useMemo, useState } from "react";
import { useAuth } from "../auth";
import { ScoreGrid, useBoard } from "../board";
import { MAX_WEEK_POINTS, personKey, weekPoints } from "../points";

export function MyWeek() {
  const { rows, people, ready, rates } = useBoard();
  const { displayName } = useAuth();
  const [selectedKey, setSelectedKey] = useState("");
  const signedInKey = people.find((person) => person.person === displayName)?.key ?? "";
  const selected = people.some((person) => person.key === selectedKey) ? selectedKey : signedInKey || (people[0]?.key ?? "");
  const person = people.find((item) => item.key === selected);
  const mine = useMemo(() => rows.filter((row) => personKey(row) === selected), [rows, selected]);
  const total = person ? weekPoints(rows, person.key, rates) : 0;

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
              {item.team ? `${item.person} · ${item.team}` : item.person}
            </option>
          ))}
        </select>
      </label>
      <ScoreGrid rows={mine} canEdit height={340} />
    </section>
  );
}
