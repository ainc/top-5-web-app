// The three inbox switches. They live on Admin because that page is already
// staff-only. Each switch is the org's setting, not a personal one, so two
// commissioners do not end up with different feeds.
//
// The control is a bell and a pill. Off shows a muted bell and a quiet line.
// On rings the bell once and swaps in a cheerful line. The lock sits beside
// the pill. Only an admin can press it. A commissioner sees a closed lock
// and cannot move a locked switch.

import { Bell, BellOff, Inbox, Lock, LockOpen } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { canAssignRoles, useAuth } from "../auth";
import { NOTICE_KINDS, loadNoticeSettings, saveNoticeSetting, type NoticeKind, type NoticeSetting } from "../notifications";

export function NotificationSettings() {
  const { role } = useAuth();
  const admin = canAssignRoles(role);
  const [settings, setSettings] = useState<NoticeSetting[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    loadNoticeSettings()
      .then(setSettings)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load notification settings."));
  }, []);

  async function change(kind: NoticeKind, patch: { enabled?: boolean; locked?: boolean }) {
    const previous = settings;
    setSettings((current) => current?.map((row) => (row.kind === kind ? { ...row, ...patch } : row)) ?? current);
    setError("");
    try {
      await saveNoticeSetting(kind, patch);
    } catch (reason: unknown) {
      setSettings(previous);
      setError(reason instanceof Error ? reason.message : "Could not save that switch.");
    }
  }

  return (
    <div className="admin-card">
      <h2>
        <Inbox aria-hidden="true" />
        Notifications
      </h2>
      <p className="field-help">
        These fill the inbox next to the account menu. Turning one off stops new items. Items already there stay. A lock holds the switch where an admin left it.
      </p>
      {error ? <p className="banner error">{error}</p> : null}
      {settings === null ? (
        <p className="status">Loading notification settings…</p>
      ) : (
        <ul className="notice-settings">
          {NOTICE_KINDS.map((kind) => {
            const row = settings.find((item) => item.kind === kind.kind);
            return (
              <NoticeSwitch
                key={kind.kind}
                kind={kind}
                enabled={row?.enabled ?? true}
                locked={row?.locked ?? false}
                admin={admin}
                onEnabled={(enabled) => void change(kind.kind, { enabled })}
                onLock={() => void change(kind.kind, { locked: !(row?.locked ?? false) })}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

function NoticeSwitch({
  kind,
  enabled,
  locked,
  admin,
  onEnabled,
  onLock,
}: {
  kind: (typeof NOTICE_KINDS)[number];
  enabled: boolean;
  locked: boolean;
  admin: boolean;
  onEnabled: (enabled: boolean) => void;
  onLock: () => void;
}) {
  const id = useId();
  const held = locked && !admin;
  return (
    <li className={enabled ? "notice-row is-on" : "notice-row"}>
      <span className="notice-bell" aria-hidden="true">
        <BellOff className="notice-bell-off" />
        <Bell className="notice-bell-on" />
      </span>
      <div className="notice-copy">
        <strong>
          {kind.label}
          <span className="notice-state-off">Off</span>
          <span className="notice-state-on">On</span>
        </strong>
        <p className="field-help">{kind.help}</p>
        <p className="notice-line notice-line-off">{kind.quiet}</p>
        <p className="notice-line notice-line-on">{kind.cheer}</p>
        {held ? <p className="field-help">An admin locked this.</p> : null}
      </div>
      <label className="notice-toggle" htmlFor={id}>
        <input id={id} type="checkbox" role="switch" checked={enabled} disabled={held} aria-label={`${kind.label} ${enabled ? "on" : "off"}`} onChange={(event) => onEnabled(event.target.checked)} />
      </label>
      {admin ? (
        <button
          type="button"
          className={locked ? "notice-lock is-locked" : "notice-lock"}
          aria-pressed={locked}
          aria-label={locked ? "Unlock. Only admins can change this." : "Lock so only admins can change this."}
          title={locked ? "Only admins can change this" : "Commissioners can change this"}
          onClick={onLock}
        >
          {locked ? <Lock aria-hidden="true" /> : <LockOpen aria-hidden="true" />}
        </button>
      ) : held ? (
        <span className="notice-lock is-locked" role="img" aria-label="An admin locked this" title="An admin locked this">
          <Lock aria-hidden="true" />
        </span>
      ) : (
        <span className="notice-lock-gap" aria-hidden="true" />
      )}
    </li>
  );
}
