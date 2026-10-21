// Google sign-in for the browser app.
// Supabase Auth owns the session. This file only starts the redirect and
// remembers who came back. Adding that person to the roster happens after,
// in enrollSignedInUser, because Auth's user id is not a scorecard row by itself.
//
// The Google provider has to be turned on in the Supabase project, and both
// http://localhost:5173 and the Netlify origin must be redirect URLs.
// VITE_GOOGLE_WORKSPACE_DOMAIN, when set, asks Google to show that Workspace
// and refuses a personal Gmail account after the redirect. The hd parameter
// is only a hint, so the email check is what actually limits the roster.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "./supabaseClient";

type AuthValue = {
  ready: boolean;
  user: User | null;
  displayName: string;
  avatarUrl: string;
  // Roster name linked to this Google account. Task rows use this, not the Google label.
  profileName: string;
  profileId: string;
  nickname: string;
  role: string | null;
  roleReady: boolean;
  error: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

function googleMeta(user: User): Record<string, unknown> {
  const identity = user.identities?.find((item) => item.provider === "google")?.identity_data ?? {};
  return { ...identity, ...(user.user_metadata ?? {}) };
}

export function googleDisplayName(user: User): string {
  const meta = googleMeta(user);
  const fromGoogle = String(meta.full_name || meta.name || "").trim();
  if (fromGoogle) return fromGoogle;
  const local = (user.email ?? "").split("@")[0]?.replace(/[._]+/g, " ").trim();
  return local || "New member";
}

// Google puts the profile photo on avatar_url or picture. Either can be missing
// on an older session, so the header falls back to an initial.
export function googleAvatarUrl(user: User): string {
  const meta = googleMeta(user);
  return String(meta.avatar_url || meta.picture || "").trim();
}

function workspaceDomain(): string {
  return String(import.meta.env.VITE_GOOGLE_WORKSPACE_DOMAIN ?? "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}

// Supabase puts a failed Google return in the query or the hash, then getSession()
// comes back empty. Without reading that message the button stays "Sign in".
// An error left in the hash also makes the client skip a valid ?code= exchange.
function takeRedirectError(): string | null {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : "");
  const code = url.searchParams.get("code");
  const accessToken = hash.get("access_token");
  const errorText = url.searchParams.get("error_description") || hash.get("error_description") || url.searchParams.get("error") || hash.get("error");
  const hasError = url.searchParams.has("error") || hash.has("error") || hash.has("error_description");
  if ((code || accessToken) && hasError) {
    url.searchParams.delete("error");
    url.searchParams.delete("error_code");
    url.searchParams.delete("error_description");
    if (!accessToken) url.hash = "";
    window.history.replaceState(window.history.state, "", url.toString());
    return null;
  }
  if (!errorText) return null;
  url.searchParams.delete("error");
  url.searchParams.delete("error_code");
  url.searchParams.delete("error_description");
  url.hash = "";
  window.history.replaceState(window.history.state, "", url.toString());
  return decodeURIComponent(errorText.replace(/\+/g, " "));
}

// The setup screen is for a commissioner or an admin. A member edits tasks only.
// Assigning roles is separate: only an admin can do that.
export function canOpenAdmin(role: string | null): boolean {
  return role === "admin" || role === "commissioner";
}

export function canAssignRoles(role: string | null): boolean {
  return role === "admin";
}

// A member can change their own tasks on any day, including past days.
// A commissioner or an admin can change every person's tasks, today or past.
export function canEditPerson(role: string | null, profileName: string, person: string): boolean {
  if (canOpenAdmin(role)) return true;
  return profileName !== "" && profileName === person;
}

async function lookupSignedInProfile(userId: string): Promise<{ role: string | null; profileName: string; profileId: string; nickname: string }> {
  const supabase = getSupabase();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name, nickname")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!profile) return { role: null, profileName: "", profileId: "", nickname: "" };
  const { data: roleRow, error: roleError } = await supabase.from("user_roles").select("role").eq("profile_id", profile.id).maybeSingle();
  if (roleError) throw new Error(roleError.message);
  const role = String(roleRow?.role ?? "");
  return {
    role: role === "admin" || role === "commissioner" || role === "member" ? role : null,
    profileName: String(profile.display_name ?? ""),
    profileId: String(profile.id),
    nickname: String(profile.nickname ?? "").trim(),
  };
}

function clearCodeFromUrl(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("code")) return;
  url.searchParams.delete("code");
  window.history.replaceState(window.history.state, "", url.toString());
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileId, setProfileId] = useState("");
  const [nickname, setNickname] = useState("");
  const [role, setRole] = useState<string | null>(null);
  const [roleReady, setRoleReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const redirectError = takeRedirectError();
    if (redirectError) setError(redirectError);
    const supabase = getSupabase();
    // A null session here is not a sign-out. INITIAL_SESSION can arrive empty
    // after the Google code has already been stored, and treating that as
    // signed-out put the button back to "Sign in".
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") setUser(null);
      else if (session?.user) {
        setUser(session.user);
        setError(null);
      }
      setReady(true);
    });
    void supabase.auth.getSession().then(async ({ data: sessionData, error: sessionError }) => {
      if (sessionError) setError(sessionError.message);
      if (sessionData.session?.user) {
        setUser(sessionData.session.user);
        setError(null);
        clearCodeFromUrl();
        setReady(true);
        return;
      }
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      if (accessToken && refreshToken) {
        const { data: restored, error: restoreError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (restoreError) setError(restoreError.message);
        if (restored.session?.user) {
          setUser(restored.session.user);
          setError(null);
          window.location.hash = "";
        }
        setReady(true);
        return;
      }
      const code = new URL(window.location.href).searchParams.get("code");
      if (!code) {
        setReady(true);
        return;
      }
      const { data: exchanged, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) setError(exchangeError.message);
      if (exchanged.session?.user) {
        setUser(exchanged.session.user);
        setError(null);
        clearCodeFromUrl();
      }
      setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = user?.id;
  useEffect(() => {
    if (!ready) return;
    if (!userId) {
      setProfileName("");
      setProfileId("");
      setNickname("");
      setRole(null);
      setRoleReady(true);
      return;
    }
    let cancel = false;
    setRoleReady(false);
    const apply = (next: { role: string | null; profileName: string; profileId: string; nickname: string }, readyRole: boolean) => {
      if (cancel) return;
      setProfileName(next.profileName);
      setProfileId(next.profileId);
      setNickname(next.nickname);
      setRole(next.role);
      if (readyRole) setRoleReady(true);
    };
    // Outside onAuthStateChange. A database read inside that callback deadlocks the session save.
    void lookupSignedInProfile(userId)
      .then((next) => apply(next, true))
      .catch(() => {
        if (cancel) return;
        setProfileName("");
        setProfileId("");
        setNickname("");
        setRole(null);
        setRoleReady(true);
      });
    const refresh = () => {
      void lookupSignedInProfile(userId)
        .then((next) => apply(next, false))
        .catch(() => undefined);
    };
    window.addEventListener("top5-reload", refresh);
    return () => {
      cancel = true;
      window.removeEventListener("top5-reload", refresh);
    };
  }, [ready, userId]);

  const value = useMemo<AuthValue>(
    () => ({
      ready,
      user,
      displayName: user ? googleDisplayName(user) : "",
      avatarUrl: user ? googleAvatarUrl(user) : "",
      profileName,
      profileId,
      nickname,
      role,
      roleReady,
      error,
      signInWithGoogle: async () => {
        setError(null);
        const domain = workspaceDomain();
        const { error: signInError } = await getSupabase().auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: window.location.origin,
            // profile is what returns the account photo and name. Without it the
            // button can only say "Sign in" again after the redirect.
            scopes: "openid email profile",
            queryParams: domain ? { hd: domain } : undefined,
          },
        });
        if (signInError) setError(signInError.message);
      },
      signOut: async () => {
        setError(null);
        const { error: signOutError } = await getSupabase().auth.signOut();
        if (signOutError) setError(signOutError.message);
      },
    }),
    [error, nickname, profileId, profileName, ready, role, roleReady, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
