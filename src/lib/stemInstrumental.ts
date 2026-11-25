/**
 * The instrumental job (VOCAL_SPLIT_ENABLED): for a track whose four stems are already separated (lib/stemJobs.ts), build the vocal-free mix by summing
 * drums + bass + other, store it next to the stems, and keep a vocal activity timeline (when the lead vocal is present) made from the vocal stem's energy.
 *
 * Why a sum and not a second separation run: the model already produced the stems, and its two-stem mode (isolate_stem) hands back "no_vocals" as the
 * sum of the same non-vocal sources, so a second paid run would buy the same audio. Summing reuses the finished stems (no new cost) and takes about two
 * seconds. Evaluation notes are in README.md ("Vocal / instrumental separation").
 *
 * The job never starts a separation: it only works from stems that exist. Separated files are for playback inside the app; nothing here (or anywhere) offers
 * them for download. Dependencies are injected so the logic is tested without the network or the database.
 */
import { instrumentalFromStemFiles, parseWav } from "@/lib/wav";
import { voiceMapFromStem, type VoiceMap } from "@/lib/voiceMap";

export interface StemJobForInstrumental {
  id: string;
  trackId: string;
  vocalsUrl: string | null;
  drumsUrl: string | null;
  bassUrl: string | null;
  otherUrl: string | null;
}

export interface InstrumentalDeps {
  fetchBytes: (url: string) => Promise<Uint8Array>;
  /** Stores the file and returns its URL. */
  store: (pathname: string, bytes: Uint8Array, contentType: string) => Promise<string>;
}

export interface InstrumentalResult {
  instrumentalUrl: string;
  voiceMap: VoiceMap;
  /** How far the sum had to be scaled down to avoid clipping (1 = untouched). */
  scaledBy: number;
  durationSec: number;
}

/** Builds the instrumental and the vocal activity for one finished job. Throws when a stem is missing or unreadable (the caller leaves the job as it was). */
export async function buildInstrumental(job: StemJobForInstrumental, deps: InstrumentalDeps): Promise<InstrumentalResult> {
  const { vocalsUrl, drumsUrl, bassUrl, otherUrl } = job;
  if (!vocalsUrl || !drumsUrl || !bassUrl || !otherUrl) throw new Error("the job does not have all four stems yet");
  const [vocals, drums, bass, other] = await Promise.all([vocalsUrl, drumsUrl, bassUrl, otherUrl].map((u) => deps.fetchBytes(u)));
  const instrumental = instrumentalFromStemFiles([drums, bass, other]);

  // The vocal activity: the vocal stem folded to mono, then the same voice-map rule the rest of the app uses.
  const vocalAudio = parseWav(vocals);
  const mono = new Float32Array(vocalAudio.channels[0].length);
  for (const ch of vocalAudio.channels) for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / vocalAudio.channels.length;
  const voiceMap = voiceMapFromStem(mono, vocalAudio.sampleRate);

  const instrumentalUrl = await deps.store(`stems/${job.trackId}/${job.id}-instrumental.wav`, instrumental.bytes, "audio/wav");
  return { instrumentalUrl, voiceMap, scaledBy: instrumental.scaledBy, durationSec: instrumental.durationSec };
}

/** The voice map stored on a job, or null when there is none or it is damaged. */
export function parseVocalActivity(json: string | null | undefined): VoiceMap | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<VoiceMap> | null;
    if (!v || typeof v !== "object" || !Array.isArray(v.segments) || typeof v.durationSec !== "number") return null;
    const segments = v.segments.filter((s): s is [number, number] => Array.isArray(s) && s.length === 2 && typeof s[0] === "number" && typeof s[1] === "number" && s[1] > s[0]);
    return { source: "stem", durationSec: v.durationSec, segments };
  } catch {
    return null;
  }
}
