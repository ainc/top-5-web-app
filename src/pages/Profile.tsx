// Team and nickname used to sit on My week, next to the week's points.
// Team is a roster fact. The signed-in person can read it here and cannot
// change it. An admin edits teams on the Admin page.
// Nickname is the only field this person writes. Saving it updates their
// profile row and calls reload(), so the picker and leaderboard pick up
// the new label.

import { useEffect, useState } from "react";
import { useAuth } from "../auth";
import { useBoard } from "../board";
import { ScorecardLoading } from "../ScorecardLoading";
import { getSupabase } from "../supabaseClient";

export function ProfilePage() {
  const { people, ready, reload } = useBoard();
  const { nickname, profileId, profileName, user } = useAuth();
  const [nicknameDraft, setNicknameDraft] = useState(nickname);
  const [nicknameError, setNicknameError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setNicknameDraft(nickname);
  }, [nickname]);

  const mine = people.find((person) => person.person === profileName);

  async function saveNickname() {
    const next = nicknameDraft.trim();
    if (!profileId || next === nickname) return;
    setNicknameError("");
    setSaved(false);
    const { error } = await getSupabase().from("profiles").update({ nickname: next || null }).eq("id", profileId);
    if (error) {
      setNicknameError(error.message);
      return;
    }
    setSaved(true);
    reload();
  }

  if (!ready) return <ScorecardLoading label="Loading profile…" />;

  return (
    <section className="page">
      <div className="page-head">
        <h1>Profile</h1>
      </div>
      <div className="profile-card">
        <label>
          Team
          <div className="team-readout">{mine?.team || "No team"}</div>
        </label>
        <p className="field-help">Team comes from this season's roster. An admin changes it on the Admin page.</p>
        {user && profileId ? (
          <label>
            Nickname
            <input
              value={nicknameDraft}
              maxLength={40}
              placeholder="Shown instead of your name"
              aria-label="Your nickname"
              onChange={(event) => {
                setNicknameDraft(event.target.value);
                setSaved(false);
              }}
              onBlur={() => void saveNickname()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void saveNickname();
                }
              }}
            />
          </label>
        ) : (
          <p className="field-help">Sign in to set a nickname.</p>
        )}
        {saved ? <p className="field-help">Nickname saved.</p> : null}
        {nicknameError ? <p className="banner error">{nicknameError}</p> : null}
      </div>
    </section>
  );
}
