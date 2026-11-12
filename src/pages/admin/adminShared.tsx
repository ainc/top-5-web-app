// Shared pieces for the admin cards. Each card loads and saves its own table.
// Admin.tsx only places the cards and shows the banner they report.

import { useEffect, useRef, useState } from "react";

export type SeasonStatus = "draft" | "active" | "closed";

export type Season = {
  id: string;
  name: string;
  starts_on: string;
  length_weeks: number;
  scoring_mode: "individual" | "teams";
  status: SeasonStatus;
};

export type Flash = "idle" | "saving" | "saved";

export type AdminNotice = {
  saved: (text: string) => void;
  failed: (reason: unknown, fallback: string) => void;
};

export function fail(error: { message: string } | null, action: string): void {
  if (error) throw new Error(`${action}: ${error.message}`);
}

export function seasonStatus(value: unknown): SeasonStatus {
  if (value === "draft" || value === "active" || value === "closed") return value;
  return "closed";
}

export function seasonLabel(status: SeasonStatus): string {
  if (status === "active") return "Active";
  if (status === "draft") return "Draft";
  return "Closed";
}

export function sortSeasons(rows: Season[]): Season[] {
  const rank: Record<SeasonStatus, number> = { active: 0, draft: 1, closed: 2 };
  return [...rows].sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    if (a.status === "closed") return b.starts_on.localeCompare(a.starts_on);
    return a.starts_on.localeCompare(b.starts_on) || a.name.localeCompare(b.name);
  });
}

// One timer per card so a second save does not clear the first "Saved" early.
export function useSaveFlash() {
  const [flash, setFlash] = useState<Flash>("idle");
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    };
  }, []);

  function run(action: () => Promise<void>, failed: AdminNotice["failed"], fallback: string) {
    if (timer.current != null) window.clearTimeout(timer.current);
    setFlash("saving");
    action()
      .then(() => {
        setFlash("saved");
        timer.current = window.setTimeout(() => setFlash("idle"), 1800);
      })
      .catch((reason: unknown) => {
        setFlash("idle");
        failed(reason, fallback);
      });
  }

  return { flash, run };
}

export function SaveButtonView({ label, flash }: { label: string; flash: Flash }) {
  return (
    <button type="submit" className={flash === "saved" ? "save-flash" : undefined} disabled={flash === "saving"}>
      {flash === "saving" ? "Saving…" : flash === "saved" ? "Saved" : label}
    </button>
  );
}
