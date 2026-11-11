// Inbox for admins and commissioners. The icon sits in the header, left of
// the account chip, in the same spot GitHub puts its inbox. Clicking it
// opens this page. There is no dropdown: one list is easier to scan, and
// members never see the icon.
//
// Unread rows keep a red dot until that person marks them. Each staff member
// has their own marks, so one person reading the feed does not clear it for
// everyone else.

import { Inbox } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { canOpenAdmin, useAuth } from "../auth";
import { ForbiddenPage } from "./Forbidden";
import { loadNotices, markNoticesRead, refreshSeasonReminder, subscribeToNotices, unreadCount, type StaffNotice } from "../notifications";

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function StaffInbox() {
  const { profileId } = useAuth();
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(() => {
    if (!profileId) return;
    unreadCount(profileId)
      .then(setUnread)
      .catch(() => setUnread(0));
  }, [profileId]);

  useEffect(() => {
    if (!profileId) return;
    refreshSeasonReminder()
      .catch(() => undefined)
      .finally(refresh);
    const channel = subscribeToNotices(refresh);
    window.addEventListener("top5-notifications", refresh);
    return () => {
      window.removeEventListener("top5-notifications", refresh);
      void channel.unsubscribe();
    };
  }, [profileId, refresh]);

  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";
  return (
    <NavLink
      to="/notifications"
      className={({ isActive }) => (isActive ? "inbox-link active" : "inbox-link")}
      aria-label={label}
      title={label}
    >
      <Inbox aria-hidden="true" />
      {unread > 0 ? <span className="inbox-count">{unread > 9 ? "9+" : unread}</span> : null}
    </NavLink>
  );
}

export function NotificationsPage() {
  const { profileId, ready, role, roleReady } = useAuth();
  const [notices, setNotices] = useState<StaffNotice[] | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    if (!profileId) return;
    loadNotices(profileId)
      .then((rows) => {
        setNotices(rows);
        setError("");
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load notifications."));
  }, [profileId]);

  useEffect(() => {
    if (!profileId) return;
    refreshSeasonReminder()
      .catch(() => undefined)
      .finally(refresh);
    const channel = subscribeToNotices(refresh);
    return () => {
      void channel.unsubscribe();
    };
  }, [profileId, refresh]);

  if (!ready || !roleReady) return null;
  if (!canOpenAdmin(role)) return <ForbiddenPage />;

  async function mark(ids: number[]) {
    if (!profileId || ids.length === 0) return;
    setNotices((current) => current?.map((notice) => (ids.includes(notice.id) ? { ...notice, read: true } : notice)) ?? current);
    try {
      await markNoticesRead(profileId, ids);
      window.dispatchEvent(new Event("top5-notifications"));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not mark that read.");
      refresh();
    }
  }

  const unread = (notices ?? []).filter((notice) => !notice.read);
  return (
    <section className="page">
      <div className="page-head">
        <h1>
          <Inbox aria-hidden="true" />
          Notifications
        </h1>
        {unread.length > 0 ? (
          <button type="button" className="quiet-button" onClick={() => void mark(unread.map((notice) => notice.id))}>
            Mark all read
          </button>
        ) : null}
      </div>
      {error ? <p className="banner error">{error}</p> : null}
      {notices === null ? (
        <p className="status">Loading notifications…</p>
      ) : notices.length === 0 ? (
        <p className="field-help">No notifications yet. New signups, team changes, and the end of the season show up here.</p>
      ) : (
        <ul className="notice-feed">
          {notices.map((notice) => (
            <li key={notice.id} className={notice.read ? undefined : "is-unread"}>
              <button type="button" onClick={() => void mark([notice.id])}>
                <span className="notice-dot" aria-hidden="true" />
                <span>
                  <strong>{notice.title}</strong>
                  <small>{notice.body}</small>
                  <time dateTime={notice.createdAt}>{when(notice.createdAt)}</time>
                </span>
              </button>
              {notice.href?.includes("roster-links") ? (
                <Link className="notice-open" to={notice.href}>
                  Open the roster
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
