/**
 * The classification pipeline for one track: file tags, then fingerprint + MusicBrainz, then Last.fm, then the audio
 * classifier, then (only if needed) the LLM reconciler, stopping as soon as the answer is confident. Each step is a
 * provider that never throws; one being down or unconfigured just leaves a note in the log and the next goes on.
 *
 * "Confident" is the combined result (combine.ts): its best genre at or above EARLY_STOP_CONFIDENCE with the sources not in
 * conflict. A track the sources disagree on, or that nothing is sure of, goes to the LLM; a confirmed track (a person's
 * own genres) skips it, since there is nothing left to decide. The run returns the raw tags; mergeRun (stored.ts) folds
 * them into what is stored without ever touching a person's tags.
 */
import { LLM_LOW_CONFIDENCE } from "@/lib/genre/constants";
import { EARLY_STOP_CONFIDENCE, combineSourceTags } from "@/lib/genre/combine";
import type { FingerprintResolver } from "@/lib/genre/fingerprint";
import type { GenreTag } from "@/types/music";
import type { GenreProvider, ProviderInput, ProviderResult, SourceEvidence } from "@/lib/genre/types";

export interface PipelineDeps {
  fileTags: GenreProvider;
  fingerprint: FingerprintResolver | null;
  musicbrainz: GenreProvider;
  lastfm: GenreProvider;
  audioClassifier: GenreProvider | null;
  llm: GenreProvider | null;
  /** For timing the log (ms). */
  clock?: () => number;
}

/** One line of the log: what a provider did for this track. */
export interface SourceLog {
  source: string;
  ran: boolean;
  /** How many genre tags it gave. */
  tags: number;
  ms: number;
  note?: string;
  /** For the fingerprint step: whether it found a recording. */
  hit?: boolean;
}

export interface ClassifyOutcome {
  /** Raw tags from the sources that ran (no manual tags). */
  tags: GenreTag[];
  moods: string[];
  sources: SourceLog[];
  usedLlm: boolean;
  stoppedEarly: boolean;
}

export interface ClassifyOptions {
  /** The track already has genres a person set: the LLM adds nothing, so it is not called. */
  confirmed?: boolean;
}

const MOODS_KEPT = 5;

export async function classifyTrack(input: ProviderInput, deps: PipelineDeps, options: ClassifyOptions = {}): Promise<ClassifyOutcome> {
  const clock = deps.clock ?? Date.now;
  const ctx: ProviderInput = { ...input };
  const tags: GenreTag[] = [];
  const moods: string[] = [];
  const sources: SourceLog[] = [];
  const evidence: SourceEvidence[] = [];
  let stoppedEarly = false;

  const absorb = (r: ProviderResult) => {
    if (r.meta?.album && !ctx.album) ctx.album = r.meta.album;
    if (r.meta?.year && !ctx.year) ctx.year = r.meta.year;
    if (r.meta?.recordingMbid) ctx.recordingMbid = r.meta.recordingMbid;
  };
  const step = async (provider: GenreProvider | null, label: string) => {
    if (!provider) {
      sources.push({ source: label, ran: false, tags: 0, ms: 0, note: "not available" });
      return;
    }
    const started = clock();
    let r: ProviderResult;
    try {
      r = await provider.classify({ ...ctx, evidence: provider.id === "llm" ? [...evidence] : undefined });
    } catch (err) {
      // A provider is meant never to throw; if one does, it is one failed source, not a failed track.
      r = { tags: [], moods: [], note: `failed: ${err instanceof Error ? err.message : "error"}` };
    }
    sources.push({ source: label, ran: true, tags: r.tags.length, ms: clock() - started, note: r.note });
    absorb(r);
    tags.push(...r.tags);
    for (const m of r.moods) if (!moods.includes(m)) moods.push(m);
    evidence.push({ source: provider.id, tags: r.tags, moods: r.moods });
  };
  const skip = (label: string) => sources.push({ source: label, ran: false, tags: 0, ms: 0, note: "already confident" });
  const confident = () => {
    const { best, conflict } = combineSourceTags(tags);
    return best >= EARLY_STOP_CONFIDENCE && !conflict;
  };

  await step(deps.fileTags, "file-tags");
  const hadFileTags = tags.length > 0;

  if (!confident()) {
    // With no usable tags in the file, a fingerprint is the way to learn which recording this is.
    if (!hadFileTags && deps.fingerprint) {
      const started = clock();
      const match = await deps.fingerprint.resolve(ctx).catch(() => ({ recordingMbid: null as string | null, note: "failed" }));
      sources.push({ source: "fingerprint", ran: true, tags: 0, ms: clock() - started, hit: match.recordingMbid != null, note: match.note });
      if (match.recordingMbid) ctx.recordingMbid = match.recordingMbid;
    }
    await step(deps.musicbrainz, "musicbrainz");
  } else {
    stoppedEarly = true;
    skip("fingerprint");
    skip("musicbrainz");
  }
  if (!confident()) await step(deps.lastfm, "lastfm");
  else {
    stoppedEarly = true;
    skip("lastfm");
  }
  if (!confident()) await step(deps.audioClassifier, "audio-classifier");
  else {
    stoppedEarly = true;
    skip("audio-classifier");
  }

  let usedLlm = false;
  if (!options.confirmed && deps.llm) {
    const { best, conflict } = combineSourceTags(tags);
    if (conflict || best < LLM_LOW_CONFIDENCE) {
      await step(deps.llm, "llm");
      usedLlm = true;
    }
  }
  if (!usedLlm) sources.push({ source: "llm", ran: false, tags: 0, ms: 0, note: options.confirmed ? "genres confirmed by a person" : "not needed" });

  return { tags, moods: moods.slice(0, MOODS_KEPT), sources, usedLlm, stoppedEarly };
}
