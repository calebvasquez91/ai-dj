/**
 * The AI DJ's part in a Song Sync morph: one call when a sync starts. The audio engineer (lib/syncEngine.ts) has
 * already produced the SyncReport and lib/songSync.ts the plan; the DJ confirms it or makes at most one override, and
 * writes a sentence for the listener about what they are about to hear.
 *
 * Server-only for the Claude call (reads process.env.ANTHROPIC_API_KEY, called from app/api/dj/sync-plan/route.ts),
 * but the local review and the note wording are pure and shared: they are what runs when there is no key, the call
 * fails, or the client times out waiting, so a sync never stalls on the network. Same shape and never-throws contract
 * as lib/ai-fx.ts and lib/ai-dj.ts.
 */
import type { SongSyncOverrides, SongSyncPlan } from "@/lib/songSync";
import { SONG_SYNC_MAX_PITCH_SEMITONES } from "@/lib/songSync";
import type { SyncReport } from "@/lib/syncEngine";
import { extractJsonObject } from "@/lib/json-extract";

export interface SyncReviewOverride {
  morphBars?: number;
  pitchShiftSemitones?: number;
  /** The shift (or the tempo gap) is big enough that a different next track would simply sound better. Surfaced to the listener; the sync still runs, capped. */
  recommendDifferentTrack?: boolean;
}

export interface SyncReview {
  confirm: boolean;
  override: SyncReviewOverride | null;
  /** One sentence: what the listener will hear. */
  listenerNote: string;
  /** true when this came from reviewSyncPlanLocally rather than a real Claude response. */
  usedFallback: boolean;
}

export interface SyncReviewInput {
  currentTitle: string;
  nextTitle: string;
  report: SyncReport;
  plan: SongSyncPlan;
}

const MODEL = "claude-sonnet-5";
const ANTHROPIC_TIMEOUT_MS = 6000;
const MAX_NOTE_CHARS = 240;
/** A tempo gap this wide with no half- or double-time reading is a long morph. */
const LONG_MORPH_BPM_DELTA = 15;

const SYSTEM_PROMPT =
  "You are an AI DJ overseeing a BPM and key morph between two tracks. The Audio Engineer has computed the SyncReport below. Your job is to confirm the plan or make one override if needed, and to write a one-sentence note for the listener describing what they will hear.\n\n" +
  "Rules for overrides:\n" +
  "- If the pitch move is 6 semitones either way (the largest the plan ever makes, a tritone): recommend choosing a different next track instead of a large pitch shift. Flag this.\n" +
  "- If the tempo gap is over 15 BPM and no half/double time applies: make sure morphBars is 16 and note it will be a long morph.\n" +
  "- If keyCompatibility is 'perfect' or 'compatible': confirm the plan as-is, no overrides needed.\n\n" +
  "The input is JSON: { currentTitle, nextTitle, syncReport, plan }. plan.morphBars and plan.pitchTargetSemitones are what will play.\n\n" +
  "Return only JSON: { confirm: boolean, override: { morphBars?: number, pitchShiftSemitones?: number, recommendDifferentTrack?: boolean } | null, listenerNote: string }";

const MAX_TITLE_CHARS = 200;
const MAX_REPORT_FIELDS = 40;
const MAX_REPORT_STRING_CHARS = 60;
const PLAN_DIRECTIONS: readonly string[] = ["faster", "slower", "hold"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Builds the review input from a request body the server doesn't trust. Only what a review needs gets through: the
 * titles (capped), the plan's own fields (checked types, a known direction), and the report's flat fields (numbers,
 * booleans and short strings — its nested stem tables and free text are dropped, and so is anything past a field cap).
 * null when the body isn't a usable review request. Nothing the client sends is forwarded to the model as it came.
 */
export function sanitizeSyncReviewInput(body: unknown): SyncReviewInput | null {
  if (!isRecord(body) || typeof body.currentTitle !== "string" || typeof body.nextTitle !== "string") return null;
  const { report, plan } = body;
  if (!isRecord(report) || !isRecord(plan)) return null;
  if (
    !isFiniteNumber(plan.morphBars) ||
    !isFiniteNumber(plan.bpmFrom) ||
    !isFiniteNumber(plan.bpmTo) ||
    !isFiniteNumber(plan.pitchTargetSemitones) ||
    typeof plan.direction !== "string" ||
    !PLAN_DIRECTIONS.includes(plan.direction)
  ) {
    return null;
  }

  const cleanPlan = {
    morphBars: plan.morphBars,
    bpmFrom: plan.bpmFrom,
    bpmTo: plan.bpmTo,
    rateTarget: isFiniteNumber(plan.rateTarget) ? plan.rateTarget : plan.bpmFrom > 0 ? plan.bpmTo / plan.bpmFrom : 1,
    direction: plan.direction,
    pitchTargetSemitones: plan.pitchTargetSemitones,
    keyFrom: typeof plan.keyFrom === "string" ? plan.keyFrom.slice(0, MAX_REPORT_STRING_CHARS) : "",
    keyTo: typeof plan.keyTo === "string" ? plan.keyTo.slice(0, MAX_REPORT_STRING_CHARS) : "",
    bpmB: isFiniteNumber(plan.bpmB) ? plan.bpmB : plan.bpmTo,
  } as SongSyncPlan;

  const cleanReport: Record<string, number | boolean | string | null> = {};
  for (const [key, value] of Object.entries(report)) {
    if (Object.keys(cleanReport).length >= MAX_REPORT_FIELDS) break;
    if (isFiniteNumber(value) || typeof value === "boolean" || value === null) cleanReport[key] = value;
    else if (typeof value === "string") cleanReport[key] = value.slice(0, MAX_REPORT_STRING_CHARS);
  }

  return {
    currentTitle: body.currentTitle.slice(0, MAX_TITLE_CHARS),
    nextTitle: body.nextTitle.slice(0, MAX_TITLE_CHARS),
    report: cleanReport as unknown as SyncReport,
    plan: cleanPlan,
  };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "Easing Solar Drift up 3 BPM and lifting the key two semitones - you'll feel it tighten as Midnight Pulse takes over." */
export function listenerNoteFor(plan: SongSyncPlan, currentTitle: string, nextTitle: string): string {
  const bpmMove = Math.abs(plan.bpmTo - plan.bpmFrom);
  const bpmText = bpmMove >= 10 ? Math.round(bpmMove).toString() : (Math.round(bpmMove * 10) / 10).toString();
  const tempo =
    plan.direction === "hold"
      ? `Holding ${currentTitle} at its tempo`
      : `Easing ${currentTitle} ${plan.direction === "faster" ? "up" : "down"} ${bpmText} BPM`;
  const s = plan.pitchTargetSemitones;
  const key = s === 0 ? "" : ` and ${s > 0 ? "lifting" : "lowering"} the key ${plural(Math.abs(s), "semitone")}`;
  const feel = plan.direction === "faster" ? "tighten" : plan.direction === "slower" ? "relax" : "settle";
  return `${tempo}${key} — you'll feel it ${feel} as ${nextTitle} takes over.`;
}

/**
 * The same review the prompt asks Claude for, by the same rules, with no network: confirm unless the tempo gap is
 * wide with no octave reading (extend to a long morph) or the pitch move is large (flag a different track).
 */
export function reviewSyncPlanLocally(input: SyncReviewInput): SyncReview {
  const { plan, report, currentTitle, nextTitle } = input;
  const base = listenerNoteFor(plan, currentTitle, nextTitle);
  const keyOk = report.keyCompatibility === "perfect" || report.keyCompatibility === "compatible";
  const octaveReading = report.bpmStrategy === "halftime" || report.bpmStrategy === "doubletime";
  const override: SyncReviewOverride = {};
  let note = base;

  // The pitch move is folded to -6..+6, so "the biggest move there is" (a tritone) is the line, not "past 6".
  if (!keyOk && Math.abs(report.morphPitchShiftSemitones) >= SONG_SYNC_MAX_PITCH_SEMITONES) {
    override.recommendDifferentTrack = true;
    note = `${base} Heads up: that is a big key move, so a different next track would sound cleaner.`;
  }
  if (!octaveReading && Math.abs(plan.bpmTo - plan.bpmFrom) > LONG_MORPH_BPM_DELTA) {
    // The planner already spreads a gap this wide over 16 bars, so this is normally just the note; the override only
    // matters for a shorter plan.
    if (plan.morphBars < 16) override.morphBars = 16;
    note = `${note} It is a long morph, spread over 16 bars.`;
  }
  const hasOverride = Object.keys(override).length > 0;
  return { confirm: !hasOverride, override: hasOverride ? override : null, listenerNote: note.slice(0, MAX_NOTE_CHARS), usedFallback: true };
}

/** The part of a review the plan can use. */
export function overridesFromReview(review: Pick<SyncReview, "override">): SongSyncOverrides {
  const o = review.override;
  if (!o) return {};
  const out: SongSyncOverrides = {};
  if (typeof o.morphBars === "number" && Number.isFinite(o.morphBars)) out.morphBars = o.morphBars;
  if (typeof o.pitchShiftSemitones === "number" && Number.isFinite(o.pitchShiftSemitones)) out.pitchShiftSemitones = o.pitchShiftSemitones;
  return out;
}

/** Validates Claude's JSON into a review; null when it is unusable (the caller falls back). */
export function parseSyncReview(raw: unknown): Omit<SyncReview, "usedFallback"> | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as { confirm?: unknown; override?: unknown; listenerNote?: unknown };
  if (typeof r.listenerNote !== "string" || r.listenerNote.trim() === "") return null;
  let override: SyncReviewOverride | null = null;
  if (typeof r.override === "object" && r.override !== null) {
    const o = r.override as Record<string, unknown>;
    const next: SyncReviewOverride = {};
    if (typeof o.morphBars === "number" && Number.isFinite(o.morphBars)) next.morphBars = o.morphBars;
    if (typeof o.pitchShiftSemitones === "number" && Number.isFinite(o.pitchShiftSemitones)) next.pitchShiftSemitones = o.pitchShiftSemitones;
    if (o.recommendDifferentTrack === true) next.recommendDifferentTrack = true;
    override = Object.keys(next).length > 0 ? next : null;
  }
  return {
    confirm: r.confirm === true && override == null,
    override,
    listenerNote: r.listenerNote.trim().slice(0, MAX_NOTE_CHARS),
  };
}

/**
 * Asks Claude to confirm or override the morph. Never throws: a missing API key, a network error, a timeout or an
 * unusable response all fall back to reviewSyncPlanLocally.
 */
export async function reviewSyncPlanWithAI(input: SyncReviewInput): Promise<SyncReview> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return reviewSyncPlanLocally(input);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              currentTitle: input.currentTitle,
              nextTitle: input.nextTitle,
              syncReport: input.report,
              plan: input.plan,
            }),
          },
        ],
      }),
      signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[ai-sync] Anthropic API returned ${res.status}: ${await res.text().catch(() => "")}`);
      return reviewSyncPlanLocally(input);
    }
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((block) => block.type === "text")?.text;
    if (!text) {
      console.warn("[ai-sync] Anthropic response had no text content block", JSON.stringify(data));
      return reviewSyncPlanLocally(input);
    }
    const parsed = parseSyncReview(extractJsonObject(text));
    if (!parsed) {
      console.warn(`[ai-sync] Claude returned an unusable review: ${text.slice(0, 200)}`);
      return reviewSyncPlanLocally(input);
    }
    return { ...parsed, usedFallback: false };
  } catch (err) {
    console.warn("[ai-sync] Anthropic call failed, falling back:", err);
    return reviewSyncPlanLocally(input);
  }
}
