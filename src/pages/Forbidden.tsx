// Shown when a person opens a staff page without an admin or commissioner
// role. The address is real, so this is not the 404 page. The lock is drawn
// here so the screen does not depend on a third-party template.

import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../auth";

export function ForbiddenPage() {
  const { user } = useAuth();

  useEffect(() => {
    const previous = document.title;
    document.title = "403 · Top 5";
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <section className="page not-found">
      <div className="not-found-art forbidden-art">
        <svg className="forbidden-lock" viewBox="0 0 120 140" aria-hidden="true">
          <rect x="22" y="58" width="76" height="64" rx="14" fill="#c12029" />
          <path
            d="M40 60 V42 a20 20 0 0 1 40 0 V60"
            fill="none"
            stroke="#f1f1f2"
            strokeWidth="8"
            strokeLinecap="round"
          />
          <circle cx="60" cy="86" r="6" fill="#111111" />
          <rect x="56.5" y="90" width="7" height="14" rx="3" fill="#111111" />
        </svg>
      </div>
      <h1 className="forbidden-code">403</h1>
      <p className="forbidden-lead">Access denied</p>
      <p>
        {user
          ? "This page is for admins and commissioners."
          : "Sign in with a staff account to open this page."}
      </p>
      <NavLink className="not-found-home" to="/">
        Back to My week
      </NavLink>
    </section>
  );
}
