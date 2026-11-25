/**
 * Edits to the genre transition table (lib/genreTransitions.ts): the admin's edits to the SHARED table (stored in the database, seen by every account)
 * and one device's own overrides (kept in that browser). Each edit changes only a genre's preferred styles and its blend bar range; everything else in a
 * rule stays as the shared table has it. Pure: parsing is strict, so a stored or posted value that is not a known genre, a known style or a sane range is
 * dropped instead of reaching the planner.
 *
 * Precedence, most specific first: this device's override, then the shared table (admin edits), then the built-in table.
 */
import { GENRE_TRANSITIONS, TRANSITION_STYLES, type GenreTransitionRule, type TransitionStyle } from "@/lib/genreTransitions";

export interface RuleOverride {
  /** Best first. Replaces the genre's list when present. */
  preferredStyles?: TransitionStyle[];
  /** [shortest, longest] bars a blend may last. Replaces the genre's range when present. */
  blendBarsRange?: [number, number];
}

/** Keyed by top-level genre label. */
export type OverrideTable = Record<string, RuleOverride>;

export const MAX_PREFERRED_STYLES = 12;
export const MIN_BARS = 1;
export const MAX_BARS = 64;

const isStyle = (v: unknown): v is TransitionStyle => typeof v === "string" && (TRANSITION_STYLES as readonly string[]).includes(v);

/** One override, or null when nothing in it is usable. */
export function parseRuleOverride(raw: unknown): RuleOverride | null {
  if (!raw || typeof raw !== "object") return null;
  const { preferredStyles, blendBarsRange } = raw as { preferredStyles?: unknown; blendBarsRange?: unknown };
  const out: RuleOverride = {};
  if (Array.isArray(preferredStyles)) {
    const styles = [...new Set(preferredStyles.filter(isStyle))].slice(0, MAX_PREFERRED_STYLES);
    if (styles.length > 0) out.preferredStyles = styles;
  }
  if (Array.isArray(blendBarsRange) && blendBarsRange.length === 2) {
    const [lo, hi] = blendBarsRange.map((n) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n) : NaN));
    if (lo >= MIN_BARS && hi <= MAX_BARS && lo <= hi) out.blendBarsRange = [lo, hi];
  }
  return out.preferredStyles || out.blendBarsRange ? out : null;
}

/** A whole table, from stored JSON text or an already-parsed value. Unknown genres and unusable entries are dropped. */
export function parseOverrideTable(raw: unknown): OverrideTable {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: OverrideTable = {};
  for (const [genre, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!Object.hasOwn(GENRE_TRANSITIONS, genre)) continue;
    const parsed = parseRuleOverride(entry);
    if (parsed) out[genre] = parsed;
  }
  return out;
}

function apply(rule: GenreTransitionRule, o: RuleOverride | undefined): GenreTransitionRule {
  if (!o) return rule;
  return { ...rule, ...(o.preferredStyles ? { preferredStyles: o.preferredStyles } : {}), ...(o.blendBarsRange ? { blendBarsRange: o.blendBarsRange } : {}) };
}

/**
 * What to store after an edit, for one layer (this device, or the shared table): only the fields the person actually changed from the rule now in force,
 * plus anything this layer already overrode. A person who only reorders styles does not also pin the bar range. Null when there is nothing to store.
 */
export function overrideFromEdit(
  rule: GenreTransitionRule,
  existing: RuleOverride | undefined,
  edited: { preferredStyles: readonly TransitionStyle[]; blendBarsRange: readonly [number, number] },
): RuleOverride | null {
  const out: RuleOverride = { ...(existing ?? {}) };
  const sameStyles = edited.preferredStyles.length === rule.preferredStyles.length && edited.preferredStyles.every((s, i) => s === rule.preferredStyles[i]);
  const sameBars = edited.blendBarsRange[0] === rule.blendBarsRange[0] && edited.blendBarsRange[1] === rule.blendBarsRange[1];
  if (!sameStyles) out.preferredStyles = [...edited.preferredStyles];
  if (!sameBars) out.blendBarsRange = [edited.blendBarsRange[0], edited.blendBarsRange[1]];
  return out.preferredStyles || out.blendBarsRange ? out : null;
}

/** The table the planner reads: the built-in one with the shared edits applied, then this device's. Always has every built-in genre. */
export function mergeRules(shared: OverrideTable = {}, device: OverrideTable = {}, base: Readonly<Record<string, GenreTransitionRule>> = GENRE_TRANSITIONS): Record<string, GenreTransitionRule> {
  const out: Record<string, GenreTransitionRule> = {};
  const own = (table: OverrideTable, genre: string): RuleOverride | undefined => (Object.hasOwn(table, genre) ? table[genre] : undefined);
  for (const [genre, rule] of Object.entries(base)) out[genre] = apply(apply(rule, own(shared, genre)), own(device, genre));
  return out;
}
