// Bonus names and point values for the season being edited. Top 5, Exercise,
// and Reading cannot be removed. A retired bonus stays in the database so a
// day that already earned it keeps those points.

import { Gift } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "../../supabaseClient";
import { fail, SaveButtonView, useSaveFlash, type AdminNotice, type Season } from "./adminShared";

const BUILTIN_ORDER = ["top5", "exercise", "reading"];

type Bonus = { id: string; key: string; name: string; points: number; builtIn: boolean };

export function BonusCard({ season, saved, failed }: AdminNotice & { season: Season }) {
  const [bonuses, setBonuses] = useState<Bonus[]>([]);
  const [newBonusName, setNewBonusName] = useState("");
  const [newBonusPoints, setNewBonusPoints] = useState(5);
  const { flash, run } = useSaveFlash();
  const closed = season.status === "closed";

  const load = useCallback(async () => {
    const { data: bonusRows, error } = await getSupabase()
      .from("bonus_definitions")
      .select("id, key, name, points, retired_at")
      .eq("season_id", season.id)
      .order("key");
    fail(error, "read bonuses");
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

  async function saveBonuses() {
    if (season.status === "closed") throw new Error("A closed season stays as it was.");
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
    saved(added ? `${added} is on each day.` : "Bonuses saved.");
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
      {closed ? null : <SaveButtonView label="Save bonuses" flash={flash} />}
    </form>
  );
}
