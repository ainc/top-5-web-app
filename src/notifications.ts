// Shared staff inbox.
//
// The header icon and the Notifications page both read this module.
// Postgres writes the rows: a first sign-in, a live-season team change, and
// one season-ending reminder. This file only reads them, marks them read,
// and asks the database to refresh that reminder.
//
// Members have no policy on these tables. The icon is also hidden unless the
// signed-in role is admin or commissioner, so the feed is not a second page
// a member can stumble into.

import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "./supabaseClient";

export type NoticeKind = "signup" | "team" | "season_end";

export type StaffNotice = {
  id: number;
  createdAt: string;
  kind: NoticeKind;
  title: string;
  body: string;
  read: boolean;
};

export type NoticeSetting = {
  kind: NoticeKind;
  enabled: boolean;
  locked: boolean;
};

// Labels stay here so Admin and the feed describe the same three switches.
// quiet is the line under a switch that is off. cheer is the line when it is on.
export const NOTICE_KINDS: { kind: NoticeKind; label: string; help: string; quiet: string; cheer: string }[] = [
  { kind: "signup", label: "New signups", help: "Someone signs in for the first time.", quiet: "The inbox can rest.", cheer: "A new hello will land here." },
  { kind: "team", label: "Team signups", help: "A team is added on the live season, or someone is placed on a team.", quiet: "Team news can wait.", cheer: "You'll hear when a team changes." },
  { kind: "season_end", label: "Season ending", help: "One reminder during the last week of the live season.", quiet: "No closing reminder.", cheer: "A friendly nudge before the season ends." },
];

const FEED_LIMIT = 100;

function asKind(value: string): NoticeKind {
  if (value === "signup" || value === "team" || value === "season_end") return value;
  return "signup";
}

// Asks Postgres whether the live season is in its last 7 days. Safe to call
// often: the reminder is stored once per season.
export async function refreshSeasonReminder(): Promise<void> {
  const { error } = await getSupabase().rpc("refresh_season_reminder");
  if (error) throw new Error(error.message);
}

export async function loadNotices(profileId: string): Promise<StaffNotice[]> {
  const supabase = getSupabase();
  const [{ data: rows, error }, { data: reads, error: readError }] = await Promise.all([
    supabase.from("notifications").select("id, created_at, kind, title, body").order("created_at", { ascending: false }).limit(FEED_LIMIT),
    supabase.from("notification_reads").select("notification_id").eq("profile_id", profileId),
  ]);
  if (error) throw new Error(error.message);
  if (readError) throw new Error(readError.message);
  const seen = new Set((reads ?? []).map((row) => Number(row.notification_id)));
  return (rows ?? []).map((row) => ({
    id: Number(row.id),
    createdAt: String(row.created_at),
    kind: asKind(String(row.kind)),
    title: String(row.title),
    body: String(row.body),
    read: seen.has(Number(row.id)),
  }));
}

export async function unreadCount(profileId: string): Promise<number> {
  const notices = await loadNotices(profileId);
  return notices.filter((notice) => !notice.read).length;
}

export async function markNoticesRead(profileId: string, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await getSupabase().from("notification_reads").upsert(
    ids.map((id) => ({ notification_id: id, profile_id: profileId })),
    { onConflict: "notification_id,profile_id", ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);
}

export async function loadNoticeSettings(): Promise<NoticeSetting[]> {
  const { data, error } = await getSupabase().from("notification_settings").select("kind, enabled, locked");
  if (error) throw new Error(error.message);
  const byKind = new Map((data ?? []).map((row) => [String(row.kind), row]));
  return NOTICE_KINDS.map(({ kind }) => {
    const row = byKind.get(kind);
    return { kind, enabled: row ? Boolean(row.enabled) : true, locked: row ? Boolean(row.locked) : false };
  });
}

export async function saveNoticeSetting(kind: NoticeKind, patch: { enabled?: boolean; locked?: boolean }): Promise<void> {
  const { error } = await getSupabase().from("notification_settings").update(patch).eq("kind", kind);
  if (error) throw new Error(error.message);
}

// The header badge listens for inserts. Reads stay local: marking one read
// updates this browser, and the other staff members keep their own dots.
export function subscribeToNotices(onInsert: () => void): RealtimeChannel {
  return getSupabase()
    .channel(`staff-notifications-${crypto.randomUUID()}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, onInsert)
    .subscribe();
}
