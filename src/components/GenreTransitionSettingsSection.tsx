"use client";

import { useEffect } from "react";
import { GenreRuleEditor } from "@/components/GenreRuleEditor";
import { GENRE_TRANSITIONS_ENABLED } from "@/lib/featureFlags";
import { mergeRules } from "@/lib/genreTransitionOverrides";
import { useGenreTransitions } from "@/lib/genreTransitionStore";

/**
 * Settings for genre-aware transitions: the on/off switch (off by default until the feature is verified) and, for this device, each genre's preferred
 * styles and blend length. The admin's own edits to the shared table apply to every device and are made on the admin's Transitions page; what is
 * edited here is this device only. The switch does nothing while the feature is not available in this build.
 */
export function GenreTransitionSettingsSection() {
  const settings = useGenreTransitions((s) => s.settings);
  const shared = useGenreTransitions((s) => s.shared);
  const load = useGenreTransitions((s) => s.load);
  const loadShared = useGenreTransitions((s) => s.loadShared);
  const setEnabled = useGenreTransitions((s) => s.setEnabled);
  const setDeviceOverride = useGenreTransitions((s) => s.setDeviceOverride);
  useEffect(() => {
    load();
    void loadShared();
  }, [load, loadShared]);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="genre-transitions-heading">
      <h2 id="genre-transitions-heading" className="text-sm font-semibold text-muted">Genre-aware transitions</h2>
      <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
        <span>
          Genre-aware transitions
          <span className="block text-xs text-muted">The DJ and the audio engineer choose each transition from the two songs&apos; genres.</span>
        </span>
        <input type="checkbox" checked={settings.enabled && GENRE_TRANSITIONS_ENABLED} disabled={!GENRE_TRANSITIONS_ENABLED} onChange={(e) => setEnabled(e.target.checked)} className="h-5 w-5 accent-[var(--accent)]" aria-label="Genre-aware transitions" />
      </label>
      {!GENRE_TRANSITIONS_ENABLED && <p className="text-xs text-muted" role="status">Not available in this version yet: it is still being verified.</p>}
      <details className="flex flex-col gap-2">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Per-genre overrides (this device only)</summary>
        <p className="pb-2 text-xs text-muted">Reorder the preferred styles and set the blend length for a genre on this device. Nothing here changes what other devices do.</p>
        <GenreRuleEditor rules={mergeRules(shared, settings.overrides)} overrides={settings.overrides} onSave={setDeviceOverride} />
      </details>
    </section>
  );
}
