// Editable scorecard for one person. A Google sign-in opens that person's rows.
// Anyone can look at another person. The fields stay locked unless this account
// is that person, or an admin or commissioner.
// Board is the default: a card per day, tasks stacked inside it.
// Grid turns that card sideways: weekdays across the top, tasks down the side.
// Grid (Legacy) is the original spreadsheet, one table per day.
// The choice is stored in this browser so a refresh does not flip the layout back.
// An older save used "grid" for that spreadsheet, so that value still opens Legacy.
import { useEffect, useMemo, useState } from "react";
import { canEditPerson, useAuth } from "../auth";
import { useBoard } from "../board";
import { shownName } from "../names";
import { maxWeekPoints, personKey, weekPoints } from "../points";
import { getSupabase } from "../supabaseClient";
import { WeekBoard } from "./WeekBoard";
import { WeekGrid } from "./WeekGrid";
import { WeekMatrix } from "./WeekMatrix";

type WeekLayout = "board" | "matrix" | "legacy";

const LAYOUT_KEY = "top5-week-layout";

function readWeekLayout(): WeekLayout {
  try {
    const saved = localStorage.getItem(LAYOUT_KEY);
    if (saved === "matrix") return "matrix";
    if (saved === "grid" || saved === "legacy") return "legacy";
    return "board";
  } catch {
    return "board";
  }
}

export function MyWeek() {
  const { rows, people, ready, rates, selectedWeek, nicknames } = useBoard();
  const { nickname, profileId, profileName, role, roleReady, user } = useAuth();
  const [selectedKey, setSelectedKey] = useState("");
  const [nicknameDraft, setNicknameDraft] = useState(nickname);
  const [nicknameError, setNicknameError] = useState("");
  useEffect(() => {
    setNicknameDraft(nickname);
  }, [nickname]);
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

  async function saveNickname() {
    const next = nicknameDraft.trim();
    if (!profileId || next === nickname) return;
    setNicknameError("");
    const { error } = await getSupabase().from("profiles").update({ nickname: next || null }).eq("id", profileId);
    if (error) {
      setNicknameError(error.message);
      return;
    }
    window.dispatchEvent(new Event("top5-reload"));
  }

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
            <span> / {maxWeekPoints(rates)}</span>
          </strong>
          <span className="week-score-avg">Average {averageLabel} per day</span>
        </aside>
      </div>
      <div className="whose-week">
        <label>
          Look at someone's tasks
          <select value={selected} onChange={(event) => setSelectedKey(event.target.value)}>
            {people.map((item) => (
              <option key={item.key} value={item.key}>
                {shownName(item.person, nicknames)}
              </option>
            ))}
          </select>
        </label>
        <p>{canEdit ? "You can edit this list." : "This list is read only. Pick your own name to edit."}</p>
      </div>
      <div className="week-tools">
        <div className="week-pickers">
          <div className="person-picker">
            <span>Team</span>
            <div className="team-readout">{person?.team || "No team"}</div>
          </div>
          {user && profileId ? (
            <label className="person-picker">
              Your nickname
              <input
                value={nicknameDraft}
                maxLength={40}
                placeholder="Shown instead of your name"
                aria-label="Your nickname"
                onChange={(event) => setNicknameDraft(event.target.value)}
                onBlur={() => void saveNickname()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void saveNickname();
                  }
                }}
              />
            </label>
          ) : null}
        </div>
        <div className="layout-toggle" role="group" aria-label="Week layout">
          <button type="button" aria-pressed={layout === "board"} onClick={() => chooseLayout("board")}>
            Board
          </button>
          <button type="button" aria-pressed={layout === "matrix"} onClick={() => chooseLayout("matrix")}>
            Grid
          </button>
          <button type="button" aria-pressed={layout === "legacy"} onClick={() => chooseLayout("legacy")}>
            Grid (Legacy)
          </button>
        </div>
      </div>
      {layout === "board" ? (
        <WeekBoard rows={mine} weekId={selectedWeek} canEdit={canEdit} />
      ) : layout === "matrix" ? (
        <WeekMatrix rows={mine} weekId={selectedWeek} canEdit={canEdit} />
      ) : (
        <WeekGrid rows={mine} weekId={selectedWeek} canEdit={canEdit} />
      )}
      {nicknameError ? <p className="banner error">{nicknameError}</p> : null}
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
