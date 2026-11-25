/**
 * Just enough WAV to turn separated stems into a vocal-free "instrumental": read a PCM or float WAV (including the WAVE_FORMAT_EXTENSIBLE header the
 * separation model writes: 24-bit stereo), add stems together sample by sample, and write a 16-bit PCM WAV. Pure and dependency-free, so the server job and
 * the tests use the same code. Not a general audio library: no resampling, no compression.
 */

export interface WavAudio {
  sampleRate: number;
  /** One Float32Array per channel, samples in [-1, 1] (or beyond, for float files). All the same length. */
  channels: Float32Array[];
}

const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;
const FORMAT_EXTENSIBLE = 0xfffe;

export class WavError extends Error {}

/** Decodes a WAV file. Throws WavError for anything it does not understand (so a bad file is never silently turned into noise). */
export function parseWav(bytes: Uint8Array): WavAudio {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (bytes.length < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new WavError("not a WAV file");
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  let dataStart = -1;
  let dataLength = 0;
  let o = 12;
  while (o + 8 <= bytes.length) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    const body = o + 8;
    if (id === "fmt ") {
      let format = v.getUint16(body, true);
      const channels = v.getUint16(body + 2, true);
      const sampleRate = v.getUint32(body + 4, true);
      const bits = v.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE: the real format is the first two bytes of the sub-format GUID, 24 bytes into the chunk
      if (format === FORMAT_EXTENSIBLE && size >= 26) format = v.getUint16(body + 24, true);
      fmt = { format, channels, sampleRate, bits };
    } else if (id === "data") {
      dataStart = body;
      // a streamed file can carry 0 or 0xFFFFFFFF as the size: take what is there
      dataLength = size === 0 || size === 0xffffffff || body + size > bytes.length ? bytes.length - body : size;
      break;
    }
    o = body + size + (size % 2);
  }
  if (!fmt || dataStart < 0) throw new WavError("no fmt or data chunk");
  const { format, channels: nCh, sampleRate, bits } = fmt;
  if (nCh < 1 || nCh > 8) throw new WavError(`unsupported channel count ${nCh}`);
  const supported = (format === FORMAT_PCM && (bits === 16 || bits === 24 || bits === 32)) || (format === FORMAT_FLOAT && bits === 32);
  if (!supported) throw new WavError(`unsupported sample format (format ${format}, ${bits} bits)`);
  const bytesPerSample = bits / 8;
  const frames = Math.floor(dataLength / (bytesPerSample * nCh));
  const channels = Array.from({ length: nCh }, () => new Float32Array(frames));
  let p = dataStart;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nCh; c++) {
      let s: number;
      if (format === FORMAT_FLOAT) s = v.getFloat32(p, true);
      else if (bits === 16) s = v.getInt16(p, true) / 32768;
      else if (bits === 24) s = ((v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getInt8(p + 2) << 16)) | 0) / 8388608;
      else s = v.getInt32(p, true) / 2147483648;
      channels[c][i] = s;
      p += bytesPerSample;
    }
  }
  return { sampleRate, channels };
}

/** The sum of several stems (their sample-wise addition): what is left of a mix when one stem is taken out. Stems must agree on rate and channel count; the shorter ones are padded with silence. */
export function sumWav(stems: readonly WavAudio[]): WavAudio {
  if (stems.length === 0) throw new WavError("nothing to sum");
  const { sampleRate } = stems[0];
  const nCh = stems[0].channels.length;
  for (const s of stems) {
    if (s.sampleRate !== sampleRate) throw new WavError("stems have different sample rates");
    if (s.channels.length !== nCh) throw new WavError("stems have different channel counts");
  }
  const frames = Math.max(...stems.map((s) => s.channels[0].length));
  const out = Array.from({ length: nCh }, () => new Float32Array(frames));
  for (const s of stems) for (let c = 0; c < nCh; c++) {
    const src = s.channels[c];
    const dst = out[c];
    for (let i = 0; i < src.length; i++) dst[i] += src[i];
  }
  return { sampleRate, channels: out };
}

/** The largest absolute sample. */
export function peakOf(audio: WavAudio): number {
  let peak = 0;
  for (const ch of audio.channels) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > peak) peak = a; }
  return peak;
}

/**
 * Encodes 16-bit PCM. A sum can exceed full scale, and a hard clip is audible, so when the peak is over 1 the whole file is scaled down by it (the same
 * "rescale" the separation model applies to its own stems); a file that fits is left exactly as it is.
 */
export function writeWav16(audio: WavAudio): { bytes: Uint8Array; scaledBy: number } {
  const nCh = audio.channels.length;
  const frames = audio.channels[0]?.length ?? 0;
  const peak = peakOf(audio);
  const scale = peak > 1 ? 1 / peak : 1;
  const dataBytes = frames * nCh * 2;
  const out = new Uint8Array(44 + dataBytes);
  const v = new DataView(out.buffer);
  const put = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  put(0, "RIFF"); v.setUint32(4, 36 + dataBytes, true); put(8, "WAVE");
  put(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, FORMAT_PCM, true); v.setUint16(22, nCh, true);
  v.setUint32(24, audio.sampleRate, true); v.setUint32(28, audio.sampleRate * nCh * 2, true); v.setUint16(32, nCh * 2, true); v.setUint16(34, 16, true);
  put(36, "data"); v.setUint32(40, dataBytes, true);
  let p = 44;
  for (let i = 0; i < frames; i++) for (let c = 0; c < nCh; c++) {
    const s = Math.max(-1, Math.min(1, audio.channels[c][i] * scale));
    v.setInt16(p, Math.round(s < 0 ? s * 32768 : s * 32767), true);
    p += 2;
  }
  return { bytes: out, scaledBy: scale };
}

/** The instrumental of a track: the sum of every stem except the vocals, as a 16-bit WAV. */
export function instrumentalFromStemFiles(stemFiles: readonly Uint8Array[]): { bytes: Uint8Array; scaledBy: number; durationSec: number } {
  const summed = sumWav(stemFiles.map(parseWav));
  const { bytes, scaledBy } = writeWav16(summed);
  return { bytes, scaledBy, durationSec: summed.channels[0].length / summed.sampleRate };
}
