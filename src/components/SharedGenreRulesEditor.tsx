"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { GenreRuleEditor } from "@/components/GenreRuleEditor";
import { mergeRules, type OverrideTable, type RuleOverride } from "@/lib/genreTransitionOverrides";

/** The admin's editor for the SHARED genre transition table: a save here changes what every account's DJ does. */
export function SharedGenreRulesEditor({ overrides }: { overrides: OverrideTable }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save(genre: string, override: RuleOverride | null) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/genre-transitions", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ genre, override }) });
      if (res.ok) {
        setMessage(override ? `${genre} saved for every account.` : `${genre} is back to the default.`);
        router.refresh();
      } else {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setMessage(body?.error ?? "Could not save that. Try again.");
      }
    } catch {
      setMessage("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <GenreRuleEditor rules={mergeRules(overrides)} overrides={overrides} onSave={save} busy={busy} />
      {message && <p className="text-sm" role="status">{message}</p>}
    </div>
  );
}
