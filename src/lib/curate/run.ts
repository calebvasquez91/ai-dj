/**
 * One curation request, start to finish, with every outside thing (the model, the database, Last.fm) passed in, so the
 * sequence is tested with fakes and the route only wires it to the real ones:
 *   read the request into a spec (the model, else the local reader) -> a clarifying question if it names nothing usable ->
 *   select tracks locally -> plan the energy and order -> let the model refine the order and describe it (checked) ->
 *   if the library is short, suggest similar artists (metadata only).
 * The filtering, scoring and energy math never leave this machine; the model only reads the request and refines the order.
 */
import { finishCuration, refineOrder, selectForCuration, type CurationPreview } from "@/lib/curate/curate";
import type { DiscoverSuggestion } from "@/lib/curate/discover";
import { parseRequestLocally, validateSpec, type CurationSpec, type SpecResult } from "@/lib/curate/spec";
import type { Track } from "@/types/music";

export const MAX_REQUEST_CHARS = 500;

export interface CurateRequestBody {
  /** The request in the person's words. */
  request?: unknown;
  /** The person's answer to a clarifying question, added to the request. */
  answer?: unknown;
  /** A spec to use as it is (validated again), for "Regenerate": it skips reading the request. */
  spec?: unknown;
  /** Changes which near-equal tracks and orderings come out. */
  seed?: unknown;
}

export interface CurateDeps {
  parseWithLlm: (text: string) => Promise<unknown | null>;
  loadLibrary: () => Promise<{ tracks: Track[]; bpmOf: (track: Track) => number | null }>;
  loudnessOf: (trackIds: string[]) => Promise<Map<string, number | null>>;
  refine: (request: string, preview: CurationPreview) => Promise<unknown | null>;
  discover: (seeds: string[], libraryArtists: string[]) => Promise<DiscoverSuggestion[]>;
}

export type CurateResponse =
  | { kind: "clarification"; question: string; notes: string[] }
  | { kind: "preview"; preview: CurationPreview; discover: DiscoverSuggestion[]; usedModel: { spec: boolean; refine: boolean } }
  | { kind: "error"; status: number; error: string };

export async function runCuration(body: CurateRequestBody, deps: CurateDeps): Promise<CurateResponse> {
  const request = typeof body.request === "string" ? body.request.trim() : "";
  const answer = typeof body.answer === "string" ? body.answer.trim() : "";
  const seed = typeof body.seed === "number" && Number.isFinite(body.seed) ? Math.trunc(body.seed) : 0;
  if (body.spec == null && !request) return { kind: "error", status: 400, error: "Say what kind of playlist you want." };
  if (request.length > MAX_REQUEST_CHARS || answer.length > MAX_REQUEST_CHARS) return { kind: "error", status: 400, error: `Keep the request under ${MAX_REQUEST_CHARS} characters.` };
  const text = answer ? `${request}. ${answer}` : request;

  let spec: CurationSpec;
  let notes: string[];
  let usedModelForSpec = false;
  if (body.spec != null) {
    const checked = validateSpec(body.spec);
    if (checked.clarification) return { kind: "clarification", question: checked.clarification, notes: checked.notes };
    ({ spec, notes } = checked);
  } else {
    const raw = await deps.parseWithLlm(text);
    const fromModel = raw != null ? validateSpec(raw) : null;
    let result: SpecResult;
    if (fromModel && !fromModel.clarification) {
      result = fromModel;
      usedModelForSpec = true;
    } else {
      // The model is off, failed or found nothing usable: the local reader gets a go before the person is asked anything.
      const local = parseRequestLocally(text);
      result = !local.clarification ? local : (fromModel ?? local);
    }
    if (result.clarification) return { kind: "clarification", question: result.clarification, notes: result.notes };
    ({ spec, notes } = result);
  }

  const { tracks, bpmOf } = await deps.loadLibrary();
  const selection = selectForCuration({ spec, library: tracks, bpmOf, seed });
  const loudness = await deps.loudnessOf(selection.chosen.map((c) => c.track.id));
  const inputs = { spec, notes, library: tracks, bpmOf, loudnessOf: (id: string) => loudness.get(id) ?? null, seed };
  let preview = finishCuration(inputs, selection);

  let refined = false;
  if (preview.tracks.length >= 4) {
    const reply = await deps.refine(text || "playlist", preview).catch(() => null);
    if (reply != null) {
      const next = refineOrder(preview, reply);
      refined = next.title !== preview.title || next.description !== preview.description || next.tracks.some((t, i) => t.id !== preview.tracks[i].id);
      preview = next;
    }
  }

  let discover: DiscoverSuggestion[] = [];
  if (preview.shortfall) {
    const artists = [...new Set(preview.tracks.map((t) => t.artist.trim()).filter(Boolean))];
    discover = await deps.discover(artists, tracks.map((t) => t.artist)).catch(() => []);
  }
  return { kind: "preview", preview, discover, usedModel: { spec: usedModelForSpec, refine: refined } };
}
