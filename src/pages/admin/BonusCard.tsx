// Bonus names, point values, and streak milestones for the season being
// edited. Top 5, Exercise, and Reading cannot be removed. A retired bonus
// stays in the database so a day that already earned it keeps those points.

import { Gift } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "../../supabaseClient";
import { fail, SaveButtonView, useSaveFlash, type AdminNotice, type Season } from "./adminShared";

const BUILTIN_ORDER = ["top5", "exercise", "reading"];

type Bonus = { id: string; key: string; name: string; points: number; builtIn: boolean };
type MilestoneRow = { id?: string; day: number; points: number };

export function BonusCard({ season, saved, failed }: AdminNotice & { season: Season }) {
  const [bonuses, setBonuses] = useState<Bonus[]>([]);
  const [milestones, setMilestones] = useState<MilestoneRow[]>([]);
  const [removedMilestoneIds, setRemovedMilestoneIds] = useState<string[]>([]);
  const [newBonusName, setNewBonusName] = useState("");
  const [newBonusPoints, setNewBonusPoints] = useState(5);
  const [newMilestoneDay, setNewMilestoneDay] = useState(30);
  const [newMilestonePoints, setNewMilestonePoints] = useState(25);
  const { flash, run } = useSaveFlash();
  const closed = season.status === "closed";

  const load = useCallback(async () => {
    const supabase = getSupabase();
    const [{ data: bonusRows, error }, { data: milestoneRows, error: milestoneError }] = await Promise.all([
      supabase.from("bonus_definitions").select("id, key, name, points, retired_at").eq("season_id", season.id).order("key"),
      supabase.from("streak_milestones").select("id, day, points").eq("season_id", season.id).order("day"),
    ]);
    fail(error, "read bonuses");
    fail(milestoneError, "read streak milestones");
    setBonuses(
      (bonusRows ?? [])
        .filter((row) => row.retired_at == null)
        .map((row) => ({
          id: row.id,
          key: row.key,
          name: row.name,
          points: row.points,
          builtIn: BUILTIN_ORDER.includes(row.key),
        }))
        .sort((a, b) => {
          const left = BUILTIN_ORDER.indexOf(a.key);
          const right = BUILTIN_ORDER.indexOf(b.key);
          return (left === -1 ? 9 : left) - (right === -1 ? 9 : right) || a.name.localeCompare(b.name);
        }),
    );
    setMilestones(
      (milestoneRows ?? []).map((row) => ({
        id: String(row.id),
        day: Number(row.day),
        points: Number(row.points),
      })),
    );
    setRemovedMilestoneIds([]);
  }, [season.id]);

  useEffect(() => {
    load().catch((reason: unknown) => failed(reason, "Could not load bonuses."));
  }, [load, failed]);

  async function addBonus() {
    if (season.status === "closed") return;
    const name = newBonusName.trim();
    if (!name) return;
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24);
    if (!base) throw new Error("Use a bonus name with letters or numbers.");
    if (BUILTIN_ORDER.includes(base)) throw new Error("Top 5, Exercise, and Reading are already on the board.");
    const taken = new Set(bonuses.map((bonus) => bonus.key));
    let key = base;
    let suffix = 2;
    while (taken.has(key)) {
      key = `${base}${suffix}`;
      suffix += 1;
    }
    const supabase = getSupabase();
    const { data: existing, error: findError } = await supabase
      .from("bonus_definitions")
      .select("id")
      .eq("season_id", season.id)
      .eq("key", key)
      .maybeSingle();
    fail(findError, "find bonus");
    if (existing) {
      const { error } = await supabase.from("bonus_definitions").update({ name, points: newBonusPoints, retired_at: null }).eq("id", existing.id);
      fail(error, "restore bonus");
    } else {
      const { error } = await supabase.from("bonus_definitions").insert({
        season_id: season.id,
        key,
        name,
        points: newBonusPoints,
      });
      fail(error, "add bonus");
    }
    setNewBonusName("");
  }

  function addMilestone() {
    if (closed) return;
    const day = Math.round(newMilestoneDay);
    const points = Math.round(newMilestonePoints);
    if (!Number.isFinite(day) || day < 1) {
      failed(new Error("A streak milestone needs at least 1 day."), "Could not add milestone.");
      return;
    }
    if (!Number.isFinite(points) || points < 0) {
      failed(new Error("Milestone points cannot be negative."), "Could not add milestone.");
      return;
    }
    if (milestones.some((row) => row.day === day)) {
      failed(new Error(`Day ${day} already has a milestone on this season.`), "Could not add milestone.");
      return;
    }
    setMilestones((current) => [...current, { day, points }].sort((a, b) => a.day - b.day));
    setNewMilestoneDay(day + 5);
  }

  function removeMilestone(index: number) {
    if (closed) return;
    const target = milestones[index];
    if (target?.id) setRemovedMilestoneIds((current) => [...current, target.id!]);
    setMilestones((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function saveBonuses() {
    if (season.status === "closed") throw new Error("A closed season stays as it was.");
    const seenDays = new Set<number>();
    for (const row of milestones) {
      const day = Math.round(row.day);
      const points = Math.round(row.points);
      if (!Number.isFinite(day) || day < 1) throw new Error("Each streak milestone needs at least 1 day.");
      if (!Number.isFinite(points) || points < 0) throw new Error("Milestone points cannot be negative.");
      if (seenDays.has(day)) throw new Error(`Day ${day} appears more than once in streak milestones.`);
      seenDays.add(day);
    }

    const supabase = getSupabase();
    for (const bonus of bonuses) {
      const { error } = await supabase
        .from("bonus_definitions")
        .update({
          name: bonus.name.trim(),
          points: bonus.points,
          retired_at: null,
        })
        .eq("id", bonus.id);
      fail(error, `save ${bonus.key}`);
    }
    const added = newBonusName.trim();
    if (added) await addBonus();

    // Delete removed or replaced milestone rows before writing the updated set
    // so changing a milestone's day does not hit the unique (season_id, day) index.
    if (removedMilestoneIds.length > 0) {
      const { error: deleteError } = await supabase.from("streak_milestones").delete().in("id", removedMilestoneIds);
      fail(deleteError, "remove streak milestones");
    }
    const existingIds = milestones.map((row) => row.id).filter((id): id is string => Boolean(id));
    if (existingIds.length > 0) {
      const { error: clearError } = await supabase.from("streak_milestones").delete().in("id", existingIds);
      fail(clearError, "update streak milestones");
    }
    if (milestones.length > 0) {
      const { error: insertError } = await supabase.from("streak_milestones").insert(
        milestones.map((row) => ({
          season_id: season.id,
          day: Math.round(row.day),
          points: Math.round(row.points),
        })),
      );
      fail(insertError, "save streak milestones");
    }

    saved(added ? `${added} is on each day.` : "Bonuses and milestones saved.");
    await load();
  }

  async function removeBonus(bonus: Bonus) {
    if (bonus.builtIn) return;
    const { error } = await getSupabase().from("bonus_definitions").update({ retired_at: new Date().toISOString() }).eq("id", bonus.id);
    fail(error, "remove bonus");
    saved(`${bonus.name} was removed. Days that already earned it keep those points.`);
    await load();
  }

  return (
    <form
      className="admin-card tone-bonus"
      onSubmit={(event) => {
        event.preventDefault();
        run(saveBonuses, failed, "Could not save bonuses.");
      }}
    >
      <h2>
        <Gift aria-hidden="true" />
        Bonuses
      </h2>
      <p className="field-help">
        Top 5, Exercise, and Reading stay on every day. Top 5 checks itself when all five tasks are done. Type another bonus below and save to put a new checkbox on each day. Removing one hides that checkbox. A day that already earned it keeps those points.
      </p>
      {season.status === "draft" ? <p className="field-help">These point values are saved on this draft. The live board keeps the active season until you activate.</p> : null}
      {bonuses.map((bonus, index) => (
        <div className="admin-row" key={bonus.id}>
          <input
            aria-label={`${bonus.builtIn ? "Built-in bonus" : "Bonus"} name`}
            value={bonus.name}
            disabled={closed}
            onChange={(event) => setBonuses(bonuses.map((item, itemIndex) => (itemIndex === index ? { ...item, name: event.target.value } : item)))}
          />
          <input
            type="number"
            min={0}
            aria-label={`${bonus.name} points`}
            value={bonus.points}
            disabled={closed}
            onChange={(event) => setBonuses(bonuses.map((item, itemIndex) => (itemIndex === index ? { ...item, points: Number(event.target.value) } : item)))}
          />
          {bonus.builtIn ? (
            <span className="field-help">Always on</span>
          ) : (
            <button
              type="button"
              disabled={closed}
              onClick={() => removeBonus(bonus).catch((reason: unknown) => failed(reason, "Could not remove that bonus."))}
            >
              Remove
            </button>
          )}
        </div>
      ))}
      <div className="admin-row">
        <input value={newBonusName} placeholder="Add a bonus" aria-label="New bonus name" disabled={closed} onChange={(event) => setNewBonusName(event.target.value)} />
        <input
          type="number"
          min={0}
          aria-label="New bonus points"
          value={newBonusPoints}
          disabled={closed}
          onChange={(event) => setNewBonusPoints(Number(event.target.value))}
        />
      </div>
      <h3>Streak milestones</h3>
      <p className="field-help">
        Weekday streak lengths that pay a bonus on this season. Each new streak run can earn them again.
      </p>
      {milestones.map((milestone, index) => (
        <div className="admin-row" key={milestone.id ?? `new-${index}`}>
          <label className="admin-inline">
            Day
            <input
              type="number"
              min={1}
              aria-label={`Streak milestone ${index + 1} day`}
              value={milestone.day}
              disabled={closed}
              onChange={(event) =>
                setMilestones((current) =>
                  current.map((item, itemIndex) => (itemIndex === index ? { ...item, day: Number(event.target.value) } : item)),
                )
              }
            />
          </label>
          <label className="admin-inline">
            Points
            <input
              type="number"
              min={0}
              aria-label={`Streak milestone ${index + 1} points`}
              value={milestone.points}
              disabled={closed}
              onChange={(event) =>
                setMilestones((current) =>
                  current.map((item, itemIndex) => (itemIndex === index ? { ...item, points: Number(event.target.value) } : item)),
                )
              }
            />
          </label>
          <button type="button" disabled={closed} onClick={() => removeMilestone(index)}>
            Remove
          </button>
        </div>
      ))}
      <div className="admin-row">
        <label className="admin-inline">
          Day
          <input
            type="number"
            min={1}
            aria-label="New streak milestone day"
            value={newMilestoneDay}
            disabled={closed}
            onChange={(event) => setNewMilestoneDay(Number(event.target.value))}
          />
        </label>
        <label className="admin-inline">
          Points
          <input
            type="number"
            min={0}
            aria-label="New streak milestone points"
            value={newMilestonePoints}
            disabled={closed}
            onChange={(event) => setNewMilestonePoints(Number(event.target.value))}
          />
        </label>
        <button type="button" disabled={closed} onClick={addMilestone}>
          Add milestone
        </button>
      </div>
      {closed ? null : <SaveButtonView label="Save bonuses" flash={flash} />}
    </form>
  );
}
