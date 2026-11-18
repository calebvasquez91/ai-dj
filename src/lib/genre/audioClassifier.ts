/**
 * AudioClassifierProvider: runs an audio genre model on the file itself. This is only the interface and the gate; no model
 * is bundled, and none is enabled.
 *
 * The published Essentia genre models (and the Essentia library, AGPL-3.0) cannot be used here: CLAUDE.md bars AGPL/GPL code
 * in the build, and the model files themselves are licensed non-commercially (see README.md, "Genre classification: models
 * and licenses"). A model with a license that allows this app's use can be plugged in by implementing AudioGenreModel
 * and passing it to the provider: no other code changes. The provider is also behind CLASSIFIER_ENABLED, so it can be
 * switched off without a deploy of code.
 *
 * A model hears the sound, not the lyrics or the scene, so it is trusted more for a top-level genre than for a subgenre:
 * a genre's confidence is the model's probability (at most 0.8), a subgenre's is capped at 0.5.
 */
import { normalize } from "@/lib/genres";
import type { GenreTag } from "@/types/music";
import { EMPTY_RESULT, type GenreProvider, type ProviderInput, type ProviderResult } from "@/lib/genre/types";

export interface AudioGenrePrediction {
  /** The model's own label ("Hip Hop---Trap", "rock", "electronic"). Mapped onto the taxonomy here. */
  label: string;
  /** 0-1. */
  probability: number;
}

export interface AudioGenreModel {
  /** For the log and the license table. */
  name: string;
  license: string;
  predict(input: ProviderInput): Promise<AudioGenrePrediction[]>;
}

export const CLASSIFIER_GENRE_CAP = 0.8;
export const CLASSIFIER_SUBGENRE_CAP = 0.5;
/** A prediction below this probability is noise. */
export const CLASSIFIER_MIN_PROBABILITY = 0.15;

/** CLASSIFIER_ENABLED=true turns the provider on; anything else (or unset) leaves it off. */
export function isClassifierEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.CLASSIFIER_ENABLED === "true";
}

/** The taxonomy nodes a model's label names: a "Genre---Style" label gives the style if the taxonomy has it, else the genre. */
export function nodesFromModelLabel(label: string) {
  const parts = label.split(/\s*---\s*|\s*>\s*/).map((p) => p.trim()).filter(Boolean);
  const style = parts.length > 1 ? normalize(parts[parts.length - 1]) : null;
  if (style) return style;
  return normalize(parts[0] ?? label);
}

export interface AudioClassifierOptions {
  enabled: () => boolean;
  model: AudioGenreModel | null;
  now?: () => number;
}

export function createAudioClassifierProvider({ enabled, model, now = Date.now }: AudioClassifierOptions): GenreProvider {
  return {
    id: "audio-classifier",
    async classify(input: ProviderInput): Promise<ProviderResult> {
      if (!enabled()) return { ...EMPTY_RESULT, skipped: true, note: "the audio classifier is off (CLASSIFIER_ENABLED)" };
      if (!model) return { ...EMPTY_RESULT, skipped: true, note: "no audio genre model is installed" };
      if (input.source !== "local" || !input.storageKey) return { ...EMPTY_RESULT, skipped: true, note: "no audio file to classify" };
      try {
        const predictions = await model.predict(input);
        const at = now();
        const byNode = new Map<string, GenreTag>();
        for (const p of predictions) {
          if (!(p.probability >= CLASSIFIER_MIN_PROBABILITY)) continue;
          const node = nodesFromModelLabel(p.label);
          if (!node) continue;
          const confidence = Math.min(node.subgenre ? CLASSIFIER_SUBGENRE_CAP : CLASSIFIER_GENRE_CAP, p.probability);
          const id = `${node.genre}/${node.subgenre ?? ""}`;
          const have = byNode.get(id);
          if (!have || confidence > have.confidence) {
            byNode.set(id, { genre: node.genre, ...(node.subgenre ? { subgenre: node.subgenre } : {}), source: "audio-classifier", confidence, updatedAt: at });
          }
        }
        const tags = [...byNode.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 4);
        return { tags, moods: [], note: tags.length === 0 ? "the model named nothing on the taxonomy" : undefined };
      } catch (err) {
        return { ...EMPTY_RESULT, note: `the audio model failed (${err instanceof Error ? err.message : "error"})` };
      }
    },
  };
}
