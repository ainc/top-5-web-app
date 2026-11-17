import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const DEFAULT_TIMEZONE = "America/New_York";
const MAX_TITLE_LENGTH = 280;

interface ProfileRecord {
  id: string;
  display_name: string | null;
  nickname: string | null;
}

interface SeasonRecord {
  id: string;
  name: string;
}

interface TaskRow {
  slot: number;
  title: string | null;
  done: boolean | null;
}

interface BonusRow {
  entry_date: string;
  checked: boolean | null;
  points_awarded: number | null;
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function sha256Bytes(value: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return new Uint8Array(digest);
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = await sha256Bytes(value);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  if (!a || !b) {
    return false;
  }
  const [hashA, hashB] = await Promise.all([sha256Bytes(a), sha256Bytes(b)]);
  let diff = 0;
  for (let i = 0; i < hashA.length; i++) {
    diff |= hashA[i] ^ hashB[i];
  }
  return diff === 0;
}

function localDateIso(timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}

function parseIsoDateUtc(isoDate: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return null;
  }
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt;
}

function addDaysIso(isoDate: string, days: number): string {
  const dt = parseIsoDateUtc(isoDate);
  if (!dt) {
    throw new Error("Invalid ISO date");
  }
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function weekdayIndexMonZero(isoDate: string): number {
  const dt = parseIsoDateUtc(isoDate);
  if (!dt) {
    return -1;
  }
  return (dt.getUTCDay() + 6) % 7;
}

function weekMondayForIso(isoDate: string): string {
  const idx = weekdayIndexMonZero(isoDate);
  return addDaysIso(isoDate, -idx);
}

function formatDayLabel(isoDate: string): string {
  const dt = parseIsoDateUtc(isoDate);
  if (!dt) {
    return isoDate;
  }
  const dayName = WEEKDAY_NAMES[(dt.getUTCDay() + 6) % 7];
  const monthName = MONTH_NAMES[dt.getUTCMonth()];
  return `${dayName} (${monthName} ${dt.getUTCDate()})`;
}

function formatDateShort(isoDate: string): string {
  const dt = parseIsoDateUtc(isoDate);
  if (!dt) {
    return isoDate;
  }
  return `${MONTH_NAMES[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
}

function formatWeekLabel(weekMondayIso: string): string {
  const mon = parseIsoDateUtc(weekMondayIso);
  const fri = parseIsoDateUtc(addDaysIso(weekMondayIso, 4));
  if (!mon || !fri) {
    return weekMondayIso;
  }
  const monMonth = MONTH_NAMES[mon.getUTCMonth()];
  const friMonth = MONTH_NAMES[fri.getUTCMonth()];
  if (monMonth === friMonth) {
    return `${monMonth} ${mon.getUTCDate()} – ${fri.getUTCDate()}`;
  }
  return `${monMonth} ${mon.getUTCDate()} – ${friMonth} ${fri.getUTCDate()}`;
}

function displayProfileName(profile: ProfileRecord): string {
  const nick = (profile.nickname ?? "").trim();
  if (nick) {
    return nick;
  }
  return (profile.display_name ?? "").trim() || "Member";
}

async function resolveProfileByEmail(
  supabase: SupabaseClient,
  email: string,
): Promise<ProfileRecord | null> {
  const targetEmail = email.trim().toLowerCase();
  if (!targetEmail) {
    return null;
  }
  let page = 1;
  let matchedUserId: string | null = null;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) {
      throw new Error(error.message);
    }
    const users = data?.users ?? [];
    const match = users.find((user) => (user.email ?? "").trim().toLowerCase() === targetEmail);
    if (match) {
      matchedUserId = match.id;
      break;
    }
    if (users.length < 1000) {
      break;
    }
    page += 1;
  }
  if (!matchedUserId) {
    return null;
  }
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name, nickname")
    .eq("auth_user_id", matchedUserId)
    .maybeSingle();
  if (profileError) {
    throw new Error(profileError.message);
  }
  return profile as ProfileRecord | null;
}

async function resolveProfileByToken(
  supabase: SupabaseClient,
  bearerToken: string,
): Promise<ProfileRecord | null> {
  const tokenHash = await sha256Hex(bearerToken);
  const { data: tokenRow, error: tokenError } = await supabase
    .from("top5_ingest_tokens")
    .select("profile_id")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .maybeSingle();
  if (tokenError) {
    throw new Error(tokenError.message);
  }
  if (!tokenRow?.profile_id) {
    return null;
  }
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name, nickname")
    .eq("id", tokenRow.profile_id)
    .maybeSingle();
  if (profileError) {
    throw new Error(profileError.message);
  }
  return profile as ProfileRecord | null;
}

async function getActiveSeason(supabase: SupabaseClient): Promise<SeasonRecord> {
  const { data, error } = await supabase
    .from("seasons")
    .select("id, name")
    .eq("is_open", true)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("No open Top 5 season is active.");
  }
  return data as SeasonRecord;
}

async function handleAddTask(
  supabase: SupabaseClient,
  profile: ProfileRecord,
  body: Record<string, unknown>,
): Promise<Response> {
  const timezone = typeof body.timezone === "string" && body.timezone.trim()
    ? body.timezone.trim()
    : DEFAULT_TIMEZONE;
  const rawTitle = typeof body.title === "string" ? body.title.replace(/\s+/g, " ").trim() : "";
  if (!rawTitle) {
    return jsonResponse(400, {
      ok: false,
      error: "empty_task_title",
      message: "Task title cannot be empty.",
    });
  }
  const title = rawTitle.length > MAX_TITLE_LENGTH
    ? `${rawTitle.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`
    : rawTitle;

  const entryDate = typeof body.entry_date === "string" && body.entry_date.trim()
    ? body.entry_date.trim()
    : localDateIso(timezone);
  const weekdayIdx = weekdayIndexMonZero(entryDate);
  if (weekdayIdx < 0) {
    return jsonResponse(400, {
      ok: false,
      error: "invalid_date",
      message: "Invalid entry_date. Expected YYYY-MM-DD.",
    });
  }
  if (weekdayIdx > 4) {
    return jsonResponse(400, {
      ok: false,
      error: "weekend_not_supported",
      message: "Top 5 only tracks Monday through Friday. Open the Home tab to pick a weekday.",
    });
  }

  const season = await getActiveSeason(supabase);
  const { data: existingTasks, error: fetchError } = await supabase
    .from("tasks")
    .select("slot, title, done")
    .eq("profile_id", profile.id)
    .eq("entry_date", entryDate)
    .order("slot", { ascending: true });
  if (fetchError) {
    throw new Error(fetchError.message);
  }

  const filledSlots = new Set(
    ((existingTasks ?? []) as TaskRow[])
      .filter((row) => (row.title ?? "").trim().length > 0)
      .map((row) => Number(row.slot)),
  );

  let nextSlot: number | null = null;
  for (let slot = 1; slot <= 5; slot++) {
    if (!filledSlots.has(slot)) {
      nextSlot = slot;
      break;
    }
  }

  const dayLabel = formatDayLabel(entryDate);
  if (nextSlot === null) {
    return jsonResponse(409, {
      ok: false,
      error: "day_full",
      message: `All 5 slots for ${dayLabel} are already filled.`,
    });
  }

  const { error: upsertError } = await supabase
    .from("tasks")
    .upsert(
      {
        season_id: season.id,
        profile_id: profile.id,
        entry_date: entryDate,
        slot: nextSlot,
        title,
        done: false,
      },
      { onConflict: "profile_id,entry_date,slot" },
    );
  if (upsertError) {
    throw new Error(upsertError.message);
  }

  return jsonResponse(200, {
    ok: true,
    entry_date: entryDate,
    day_label: dayLabel,
    slot: nextSlot,
    title,
    done: false,
    profile_name: displayProfileName(profile),
  });
}

async function handleGetWeek(
  supabase: SupabaseClient,
  profile: ProfileRecord,
  body: Record<string, unknown>,
): Promise<Response> {
  const timezone = typeof body.timezone === "string" && body.timezone.trim()
    ? body.timezone.trim()
    : DEFAULT_TIMEZONE;
  const requestedMonday = typeof body.week_monday === "string" && body.week_monday.trim()
    ? body.week_monday.trim()
    : weekMondayForIso(localDateIso(timezone));
  if (!parseIsoDateUtc(requestedMonday)) {
    return jsonResponse(400, {
      ok: false,
      error: "invalid_date",
      message: "Invalid week_monday. Expected YYYY-MM-DD.",
    });
  }
  const weekMonday = weekMondayForIso(requestedMonday);
  const weekFriday = addDaysIso(weekMonday, 4);
  const season = await getActiveSeason(supabase);

  const [rulesRes, tasksRes, bonusRes] = await Promise.all([
    supabase
      .from("scoring_rules")
      .select("points_per_task")
      .eq("season_id", season.id)
      .maybeSingle(),
    supabase
      .from("tasks")
      .select("entry_date, slot, title, done")
      .eq("season_id", season.id)
      .eq("profile_id", profile.id)
      .gte("entry_date", weekMonday)
      .lte("entry_date", weekFriday)
      .order("slot", { ascending: true }),
    supabase
      .from("bonus_checks")
      .select("entry_date, checked, points_awarded")
      .eq("season_id", season.id)
      .eq("profile_id", profile.id)
      .gte("entry_date", weekMonday)
      .lte("entry_date", weekFriday),
  ]);

  if (rulesRes.error) {
    throw new Error(rulesRes.error.message);
  }
  if (tasksRes.error) {
    throw new Error(tasksRes.error.message);
  }
  if (bonusRes.error) {
    throw new Error(bonusRes.error.message);
  }

  const pointsPerTask = Number(rulesRes.data?.points_per_task ?? 0);
  const tasksByDate = new Map<string, TaskRow[]>();
  for (const row of (tasksRes.data ?? []) as Array<TaskRow & { entry_date: string }>) {
    const list = tasksByDate.get(row.entry_date) ?? [];
    list.push({ slot: Number(row.slot), title: row.title, done: row.done });
    tasksByDate.set(row.entry_date, list);
  }

  const bonusPointsByDate = new Map<string, number>();
  for (const row of (bonusRes.data ?? []) as BonusRow[]) {
    if (!row.checked) {
      continue;
    }
    const prev = bonusPointsByDate.get(row.entry_date) ?? 0;
    bonusPointsByDate.set(row.entry_date, prev + Number(row.points_awarded ?? 0));
  }

  let weeklyPoints = 0;
  const days = [];
  for (let offset = 0; offset < 5; offset++) {
    const entryDate = addDaysIso(weekMonday, offset);
    const dayTasks = tasksByDate.get(entryDate) ?? [];
    const normalizedTasks = [];
    let completedCount = 0;
    for (let slot = 1; slot <= 5; slot++) {
      const found = dayTasks.find((t) => Number(t.slot) === slot);
      const title = (found?.title ?? "").trim();
      const done = Boolean(found?.done) && title.length > 0;
      if (done) {
        completedCount += 1;
      }
      normalizedTasks.push({ slot, title, done });
    }
    const dayPoints = (bonusPointsByDate.get(entryDate) ?? 0) + completedCount * pointsPerTask;
    weeklyPoints += dayPoints;
    days.push({
      entry_date: entryDate,
      day_name: WEEKDAY_NAMES[offset],
      date_label: formatDateShort(entryDate),
      points: dayPoints,
      tasks: normalizedTasks,
    });
  }

  return jsonResponse(200, {
    ok: true,
    profile_id: profile.id,
    profile_name: displayProfileName(profile),
    season_name: season.name,
    week_monday: weekMonday,
    week_label: formatWeekLabel(weekMonday),
    weekly_points: weeklyPoints,
    weekly_max_points: 125,
    days,
  });
}

async function handleToggleTask(
  supabase: SupabaseClient,
  profile: ProfileRecord,
  body: Record<string, unknown>,
): Promise<Response> {
  const entryDate = typeof body.entry_date === "string" ? body.entry_date.trim() : "";
  const slot = Number(body.slot);
  const done = Boolean(body.done);

  if (!parseIsoDateUtc(entryDate) || !Number.isInteger(slot) || slot < 1 || slot > 5) {
    return jsonResponse(400, {
      ok: false,
      error: "invalid_task_target",
      message: "Valid entry_date and slot (1–5) are required.",
    });
  }

  const season = await getActiveSeason(supabase);
  const { data: existing, error: fetchError } = await supabase
    .from("tasks")
    .select("title")
    .eq("season_id", season.id)
    .eq("profile_id", profile.id)
    .eq("entry_date", entryDate)
    .eq("slot", slot)
    .maybeSingle();
  if (fetchError) {
    throw new Error(fetchError.message);
  }
  if (!existing || !(existing.title ?? "").trim()) {
    return jsonResponse(404, {
      ok: false,
      error: "task_not_found",
      message: `Slot ${slot} for ${formatDayLabel(entryDate)} is empty.`,
    });
  }

  const { error: updateError } = await supabase
    .from("tasks")
    .update({ done })
    .eq("season_id", season.id)
    .eq("profile_id", profile.id)
    .eq("entry_date", entryDate)
    .eq("slot", slot);
  if (updateError) {
    throw new Error(updateError.message);
  }

  return jsonResponse(200, {
    ok: true,
    entry_date: entryDate,
    slot,
    done,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse(405, {
      ok: false,
      error: "method_not_allowed",
      message: "Use POST.",
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const expectedSecret = Deno.env.get("TOP5_INGEST_SECRET") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, {
      ok: false,
      error: "server_misconfigured",
      message: "Supabase environment secrets are missing.",
    });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse(400, {
      ok: false,
      error: "invalid_json",
      message: "Request body must be valid JSON.",
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const providedSecret = req.headers.get("x-top5-ingest-secret") ?? "";
    const authHeader = req.headers.get("authorization") ?? "";
    const bearerToken = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";

    let profile: ProfileRecord | null = null;
    if (expectedSecret && (await constantTimeEqual(providedSecret, expectedSecret))) {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!email) {
        return jsonResponse(400, {
          ok: false,
          error: "missing_email",
          message: "Caller email is required.",
        });
      }
      profile = await resolveProfileByEmail(supabase, email);
      if (!profile) {
        return jsonResponse(404, {
          ok: false,
          error: "profile_not_found",
          message: `No Top 5 profile is linked to ${email}. Sign in at the Top 5 web app first.`,
        });
      }
    } else if (bearerToken) {
      profile = await resolveProfileByToken(supabase, bearerToken);
      if (!profile) {
        return jsonResponse(401, {
          ok: false,
          error: "invalid_token",
          message: "Invalid or revoked Top 5 ingest token.",
        });
      }
    } else {
      return jsonResponse(401, {
        ok: false,
        error: "unauthorized",
        message: "Missing or invalid Top 5 authentication.",
      });
    }

    const action = typeof body.action === "string" ? body.action : "add_task";
    if (action === "add_task") {
      return await handleAddTask(supabase, profile, body);
    }
    if (action === "get_week") {
      return await handleGetWeek(supabase, profile, body);
    }
    if (action === "toggle_task") {
      return await handleToggleTask(supabase, profile, body);
    }
    return jsonResponse(400, {
      ok: false,
      error: "unsupported_action",
      message: `Unsupported action: ${action}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected backend error.";
    return jsonResponse(500, {
      ok: false,
      error: "internal_error",
      message,
    });
  }
});
