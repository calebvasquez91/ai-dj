"use client";

import { useTheme } from "@/lib/theme";

/** Small on/off switch for light/dark mode — see globals.css's .theme-toggle for the track/thumb styling. */
export function ThemeToggle() {
  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggleTheme);
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      onClick={toggleTheme}
      data-active={isDark}
      className="theme-toggle"
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <span className="theme-toggle-thumb" aria-hidden="true">
        {isDark ? "🌙" : "☀️"}
      </span>
    </button>
  );
}
