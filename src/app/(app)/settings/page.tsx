"use client";

import { THEME_PREFERENCES, useTheme, type ThemePreference } from "@/lib/theme";

const LABEL: Record<ThemePreference, string> = { system: "System", dark: "Dark", light: "Light" };
const HINT: Record<ThemePreference, string> = {
  system: "Follows your device's light or dark setting",
  dark: "Quiet dark surfaces (the default)",
  light: "Bright surfaces",
};

export default function SettingsPage() {
  const preference = useTheme((s) => s.preference);
  const setPreference = useTheme((s) => s.setPreference);

  return (
    <div className="p-4 sm:p-6 flex flex-col gap-6 max-w-2xl">
      <h1 className="text-2xl heading">Settings</h1>

      <section className="flex flex-col gap-3" aria-labelledby="appearance-heading">
        <h2 id="appearance-heading" className="text-sm font-semibold text-muted">
          Appearance
        </h2>
        <div role="radiogroup" aria-labelledby="appearance-heading" className="grid grid-cols-3 gap-2">
          {THEME_PREFERENCES.map((option) => {
            const selected = option === preference;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setPreference(option)}
                className={`min-h-11 rounded-card border px-3 py-2 text-sm font-semibold transition-colors ${
                  selected
                    ? "border-accent bg-surface-raised text-foreground"
                    : "border-border/10 bg-surface text-muted hover:bg-surface-hover"
                }`}
              >
                {LABEL[option]}
              </button>
            );
          })}
        </div>
        <p className="text-sm text-muted">{HINT[preference]}</p>
      </section>
    </div>
  );
}
