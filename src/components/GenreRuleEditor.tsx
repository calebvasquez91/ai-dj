"use client";

import { useState } from "react";
import { MAX_BARS, MAX_PREFERRED_STYLES, MIN_BARS, overrideFromEdit, type OverrideTable, type RuleOverride } from "@/lib/genreTransitionOverrides";
import { GENRE_TRANSITIONS, TRANSITION_STYLES, type GenreTransitionRule, type TransitionStyle } from "@/lib/genreTransitions";

function Row({ genre, rule, existing, onSave, busy }: { genre: string; rule: GenreTransitionRule; existing: RuleOverride | undefined; onSave: (genre: string, override: RuleOverride | null) => void; busy: boolean }) {
  const overridden = existing !== undefined;
  const [styles, setStyles] = useState<TransitionStyle[]>([...rule.preferredStyles]);
  const [lo, setLo] = useState(String(rule.blendBarsRange[0]));
  const [hi, setHi] = useState(String(rule.blendBarsRange[1]));
  const available = TRANSITION_STYLES.filter((s) => !styles.includes(s));
  const loN = Number(lo), hiN = Number(hi);
  const barsOk = Number.isInteger(loN) && Number.isInteger(hiN) && loN >= MIN_BARS && hiN <= MAX_BARS && loN <= hiN;
  // Only what changed is saved (and what this layer already had is kept), so reordering styles does not also pin the bar range.
  const edit = barsOk ? overrideFromEdit(rule, existing, { preferredStyles: styles, blendBarsRange: [loN, hiN] }) : null;
  const changed = edit !== null && JSON.stringify(edit) !== JSON.stringify(existing ?? null);
  const move = (i: number, d: -1 | 1) => setStyles((cur) => {
    const next = [...cur];
    const j = i + d;
    if (j < 0 || j >= next.length) return cur;
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  return (
    <details className="rounded-card border border-border/10 bg-surface">
      <summary className="flex min-h-11 cursor-pointer flex-wrap items-baseline gap-x-3 px-3 py-2 text-sm">
        <span className="font-semibold">{genre}</span>
        {overridden && <span className="text-xs font-semibold text-accent-teal">edited</span>}
        <span className="min-w-0 break-words text-xs text-muted">{rule.preferredStyles.join(", ")} · {rule.blendBarsRange[0]}–{rule.blendBarsRange[1]} bars</span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-border/10 p-3">
        <ol className="flex flex-col gap-1" aria-label={`${genre} preferred styles, best first`}>
          {styles.map((s, i) => (
            <li key={s} className="flex items-center gap-2 text-sm">
              <span className="w-5 text-right text-xs text-muted">{i + 1}.</span>
              <span className="min-w-0 flex-1 break-words">{s}</span>
              <button type="button" className="btn-outline !px-2 !text-xs" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${s} up`}>↑</button>
              <button type="button" className="btn-outline !px-2 !text-xs" onClick={() => move(i, 1)} disabled={i === styles.length - 1} aria-label={`Move ${s} down`}>↓</button>
              <button type="button" className="btn-outline !px-2 !text-xs" onClick={() => setStyles((cur) => cur.filter((x) => x !== s))} disabled={styles.length <= 1} aria-label={`Remove ${s}`}>✕</button>
            </li>
          ))}
        </ol>
        {available.length > 0 && styles.length < MAX_PREFERRED_STYLES && (
          <label className="flex flex-col gap-1 text-xs text-muted">
            Add a style
            <select className="min-h-11 rounded-card border border-border/10 bg-surface px-2 text-sm text-foreground" value="" onChange={(e) => e.target.value && setStyles((cur) => [...cur, e.target.value as TransitionStyle])}>
              <option value="">Choose…</option>
              {available.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Shortest blend (bars)
            <input type="number" inputMode="numeric" min={MIN_BARS} max={MAX_BARS} value={lo} onChange={(e) => setLo(e.target.value)} className="min-h-11 w-28 rounded-card border border-border/10 bg-surface px-2 text-sm text-foreground" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Longest blend (bars)
            <input type="number" inputMode="numeric" min={MIN_BARS} max={MAX_BARS} value={hi} onChange={(e) => setHi(e.target.value)} className="min-h-11 w-28 rounded-card border border-border/10 bg-surface px-2 text-sm text-foreground" />
          </label>
        </div>
        {!barsOk && <p className="text-xs text-accent-pink" role="alert">Use whole bars from {MIN_BARS} to {MAX_BARS}, shortest first.</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-outline !text-xs" disabled={busy || !barsOk || !changed} onClick={() => onSave(genre, edit)}>Save {genre}</button>
          {overridden && <button type="button" className="btn-outline !text-xs" disabled={busy} onClick={() => onSave(genre, null)}>Reset to the default</button>}
        </div>
      </div>
    </details>
  );
}

/**
 * Every genre's preferred transition styles and blend bar range, each editable. `rules` are what is in force now (the built-in table with whatever is
 * already applied below this editor); `overrides` marks which genres this editor's own layer has changed. Saving sends the genre's whole override up;
 * Reset sends null (the genre goes back to the layer below).
 */
export function GenreRuleEditor({ rules, overrides, onSave, busy = false }: { rules: Readonly<Record<string, GenreTransitionRule>>; overrides: OverrideTable; onSave: (genre: string, override: RuleOverride | null) => void; busy?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      {Object.keys(GENRE_TRANSITIONS).map((genre) => (
        // Remounted when the rule underneath changes, so the form always starts from what is in force.
        <Row key={`${genre}:${JSON.stringify(rules[genre])}`} genre={genre} rule={rules[genre] ?? GENRE_TRANSITIONS[genre]} existing={Object.hasOwn(overrides, genre) ? overrides[genre] : undefined} onSave={onSave} busy={busy} />
      ))}
    </div>
  );
}
