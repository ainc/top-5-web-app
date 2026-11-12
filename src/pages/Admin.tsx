// The admin page places one card per setup job. Season, bonuses, waiting
// accounts, the roster, teams, and roles each load and save their own tables.
// This file keeps the banner, the draft frame, and the local sign-in tool.
//
// One season is active. "Plan next season" on the season card copies that
// season's roster, teams, and scoring into a draft. The board keeps reading
// the active season until Activate closes it and opens the draft. Days and
// scores are not copied.

import { Settings } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "../supabaseClient";
import { EditLog } from "./EditLog";
import { NotificationSettings } from "./NotificationSettings";
import { PastSeasons } from "./PastSeasons";
import { BonusCard } from "./admin/BonusCard";
import { RosterCard, type RosterName } from "./admin/RosterCard";
import { RosterLinksCard } from "./admin/RosterLinksCard";
import { RolesCard } from "./admin/RolesCard";
import { SeasonCard } from "./admin/SeasonCard";
import { TeamsCard } from "./admin/TeamsCard";
import type { Season } from "./admin/adminShared";

export function Admin() {
  const [season, setSeason] = useState<Season | null>(null);
  const [people, setPeople] = useState<RosterName[]>([]);
  const [signInAsName, setSignInAsName] = useState("");
  const [signingInAs, setSigningInAs] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const onSeason = useCallback((next: Season) => setSeason(next), []);
  const onPeople = useCallback((next: RosterName[]) => setPeople(next), []);
  const saved = useCallback((text: string) => {
    setError("");
    setMessage(text);
    window.dispatchEvent(new Event("top5-reload"));
  }, []);
  const failed = useCallback((reason: unknown, fallback: string) => {
    setError(reason instanceof Error ? reason.message : fallback);
  }, []);

  // The tape is a frame, not a cover. The class insets the header, the
  // week row, and the phone tab bar by the same thickness as the stripes.
  useEffect(() => {
    const root = document.documentElement;
    if (season?.status !== "draft") {
      root.classList.remove("is-draft-caution");
      return;
    }
    root.classList.add("is-draft-caution");
    return () => root.classList.remove("is-draft-caution");
  }, [season?.status]);

  // The dev server mints a one-time token for that person's existing Google account.
  // The session is applied in this browser. Production has no /dev/sign-in-as route,
  // and this block is omitted from the build.
  async function signInLocally(name: string) {
    setError("");
    setSigningInAs(true);
    try {
      const response = await fetch("/dev/sign-in-as", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = (await response.json()) as { tokenHash?: string; type?: "magiclink"; error?: string };
      if (!response.ok || !payload.tokenHash || !payload.type) {
        setError(payload.error || "Could not sign in as that person.");
        setSigningInAs(false);
        return;
      }
      const { error: verifyError } = await getSupabase().auth.verifyOtp({
        token_hash: payload.tokenHash,
        type: payload.type,
      });
      if (verifyError) {
        setError(verifyError.message);
        setSigningInAs(false);
        return;
      }
      window.location.assign("/");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not sign in as that person.");
      setSigningInAs(false);
    }
  }

  const editingDraft = season?.status === "draft";

  return (
    <section className={editingDraft ? "page admin is-editing-draft" : "page admin"}>
      {editingDraft ? <div className="draft-caution" aria-hidden="true" /> : null}
      <h1>
        <Settings aria-hidden="true" />
        Admin
      </h1>
      {season ? (
        <p>Scoring, teams, the roster, notifications, and the next season. A commissioner or an admin can change these. Only an admin can assign roles, and only an admin can lock a notification. One season is live. The next one can be drafted and edited before it is activated.</p>
      ) : (
        <p className="status">{error || "Loading admin…"}</p>
      )}
      {season && message ? <p className="banner ok">{message}</p> : null}
      {season && error ? <p className="banner error">{error}</p> : null}
      <SeasonCard onSeason={onSeason} saved={saved} failed={failed} />
      {season ? (
        <>
          <BonusCard season={season} saved={saved} failed={failed} />
          <RosterLinksCard saved={saved} failed={failed} />
          <RosterCard season={season} onPeople={onPeople} saved={saved} failed={failed} />
          {season.scoring_mode === "teams" ? <TeamsCard season={season} saved={saved} failed={failed} /> : null}
          {import.meta.env.DEV ? (
            <form
              className="admin-card"
              onSubmit={(event) => {
                event.preventDefault();
                void signInLocally(signInAsName);
              }}
            >
              <h2>Local sign-in</h2>
              <p className="field-help">
                Shown only on this computer. Opens that person's real account in this browser so you can try their task cells. A task you save is written on the live board. This does not create a second Garrett or Hannah.
              </p>
              <div className="admin-row">
                <select value={signInAsName} onChange={(event) => setSignInAsName(event.target.value)} disabled={people.length === 0 || signingInAs}>
                  <option value="">Choose a person</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.name}>
                      {person.name}
                    </option>
                  ))}
                </select>
                <button type="submit" disabled={!signInAsName || signingInAs}>
                  {signingInAs ? "Signing in…" : "Sign in as this person"}
                </button>
              </div>
            </form>
          ) : null}
          <RolesCard season={season} saved={saved} failed={failed} />
          <NotificationSettings />
          <PastSeasons />
          <EditLog people={people} />
        </>
      ) : null}
    </section>
  );
}
