// The three inbox switches. They live on Admin because that page is already
// staff-only. Each switch is the org's setting, not a personal one, so two
// commissioners do not end up with different feeds.
//
// Lock is the admin override. It is only drawn for an admin. A commissioner
// sees a locked switch as disabled, with one line saying an admin locked it.

import { Inbox } from "lucide-react";
import { useEffect, useState } from "react";
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
            const enabled = row?.enabled ?? true;
            const locked = row?.locked ?? false;
            const held = locked && !admin;
            return (
              <li key={kind.kind}>
                <div>
                  <strong>{kind.label}</strong>
                  <p className="field-help">{kind.help}</p>
                  {held ? <p className="field-help">An admin locked this.</p> : null}
                </div>
                <label>
                  <input
                    type="checkbox"
                    checked={enabled}
                    disabled={held}
                    onChange={(event) => void change(kind.kind, { enabled: event.target.checked })}
                  />
                  On
                </label>
                {admin ? (
                  <label>
                    <input type="checkbox" checked={locked} onChange={(event) => void change(kind.kind, { locked: event.target.checked })} />
                    Only admins can change this
                  </label>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
