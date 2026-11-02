// Light or dark for the whole app. The choice is stored in this browser.
// With no saved choice, the first visit follows the operating system.
// index.html applies the same key before React paints, so the page does not flash cream and then go dark.

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type ThemeName = "light" | "dark";

const STORAGE_KEY = "top5-theme";

type ThemeValue = {
  theme: ThemeName;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeValue | null>(null);

function readTheme(): ThemeName {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // Private browsing can block storage. The system preference still applies.
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // The toggle still works for this visit.
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>(() => {
    const initial = readTheme();
    applyTheme(initial);
    return initial;
  });

  const value = useMemo<ThemeValue>(
    () => ({
      theme,
      toggleTheme: () => {
        setTheme((current) => {
          const next = current === "dark" ? "light" : "dark";
          applyTheme(next);
          return next;
        });
      },
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}

// Header control for the theme above. A word button painted in brand red sat
// in the same row as Sign out and read as the main action.
// This is a small switch: checked is light (sun and clouds), unchecked is
// dark (moon and stars). One checkbox stays mounted so the checked state
// follows the theme instead of swapping two inputs. The saved choice still
// lives in ThemeProvider.
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === "dark";
  return (
    <label className="theme-switch">
      <input
        type="checkbox"
        className="theme-switch-input"
        checked={!dark}
        onChange={toggleTheme}
        aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      />
      <span className="theme-switch-track" aria-hidden="true">
        <span className="theme-switch-thumb" />
      </span>
    </label>
  );
}
