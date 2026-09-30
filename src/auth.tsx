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
  error: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function googleDisplayName(user: User): string {
  const meta = user.user_metadata ?? {};
  const fromGoogle = String(meta.full_name || meta.name || "").trim();
  if (fromGoogle) return fromGoogle;
  const local = (user.email ?? "").split("@")[0]?.replace(/[._]+/g, " ").trim();
  return local || "New member";
}

function workspaceDomain(): string {
  return String(import.meta.env.VITE_GOOGLE_WORKSPACE_DOMAIN ?? "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setReady(true);
    });
    // Do not call the database inside this callback. Supabase waits for it
    // to finish before the session is stored, which deadlocks a roster write.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      ready,
      user,
      displayName: user ? googleDisplayName(user) : "",
      error,
      signInWithGoogle: async () => {
        setError(null);
        const domain = workspaceDomain();
        const { error: signInError } = await getSupabase().auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: window.location.origin,
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
    [error, ready, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
