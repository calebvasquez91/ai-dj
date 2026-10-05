// Real-audio evaluation of the song map (src/lib/song-map.ts).
//
// Point it at a folder of loops whose FILE NAME carries the tempo as `_<bpm>_` (Splice's convention) and which start
// exactly on bar 1. The truth grid is then beats at k * 60/bpm from t=0 and bar lines every 4 beats. It prints tempo
// accuracy (exact / octave / other) against the old analyser and the song map, beat timing error, downbeat accuracy,
// and accuracy by confidence band — the numbers the trust gate in isPhraseGridTrustworthy was calibrated on.
//
//   npx tsx scripts/eval-song-map.ts "C:/path/to/loops" [--nobase] [--list]
//
// Not part of the build or tests (it needs audio that isn't in the repo).
// Real-audio evaluation: Splice loops whose file name carries the BPM and which start exactly on bar 1.
// Truth grid: beats at k * 60/bpm from t=0; bar lines every 4 beats.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { buildSongMap } from "../src/lib/song-map";
import { analyzeSamples } from "../src/lib/audio-analysis-core";
import { fMeasure } from "../src/lib/song-map.fixtures";

const ROOT = process.argv.find((a, i) => i >= 2 && !a.startsWith("--")) ?? "";
if (!ROOT) {
  console.error("usage: npx tsx scripts/eval-song-map.ts <folder of .wav loops> [--nobase] [--list]");
  process.exit(1);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.wav$/i.test(e)) out.push(p);
  }
  return out;
}

function readWav(path: string): { mono: Float32Array; sr: number } | null {
  const b = readFileSync(path);
  if (b.toString("ascii", 0, 4) !== "RIFF") return null;
  let fmtTag = 1, ch = 1, sr = 44100, bits = 16, dataOff = -1, dataLen = 0;
  let i = 12;
  while (i + 8 <= b.length) {
    const id = b.toString("ascii", i, i + 4);
    const sz = b.readUInt32LE(i + 4);
    if (id === "fmt ") {
      fmtTag = b.readUInt16LE(i + 8);
      ch = b.readUInt16LE(i + 10);
      sr = b.readUInt32LE(i + 12);
      bits = b.readUInt16LE(i + 22);
      if (fmtTag === 0xfffe) fmtTag = b.readUInt16LE(i + 8 + 24); // extensible sub-format
    } else if (id === "data") {
      dataOff = i + 8;
      dataLen = Math.min(sz, b.length - dataOff);
      break;
    }
    i += 8 + sz + (sz & 1);
  }
  if (dataOff < 0) return null;
  const bytes = bits / 8;
  const n = Math.floor(dataLen / (bytes * ch));
  const mono = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let sum = 0;
    for (let c = 0; c < ch; c++) {
      const o = dataOff + (f * ch + c) * bytes;
      let v: number;
      if (fmtTag === 3 && bits === 32) v = b.readFloatLE(o);
      else if (bits === 16) v = b.readInt16LE(o) / 32768;
      else if (bits === 24) v = (b.readIntLE(o, 3)) / 8388608;
      else if (bits === 32) v = b.readInt32LE(o) / 2147483648;
      else v = 0;
      sum += v;
    }
    mono[f] = sum / ch;
  }
  return { mono, sr };
}

interface Row { rhythmic?: boolean; baseCls?: string; name: string; group: string; bpm: number; dur: number; est?: number; cls?: string; f70?: number; signed?: number; dbF?: number; ms?: number; conf?: number; dbc?: number; bars?: number }
const rows: Row[] = [];
for (const p of walk(ROOT)) {
  const m = basename(p).match(/_(\d{2,3})_/);
  if (!m) continue;
  const bpm = Number(m[1]);
  if (bpm < 60 || bpm > 200) continue;
  const w = readWav(p);
  if (!w) continue;
  const dur = w.mono.length / w.sr;
  const group = relative(ROOT, p).split(/[\\/]/).slice(0, 2).join("/");
  const row: Row = { name: basename(p).slice(0, 52), group, bpm, dur, rhythmic: /drum|perc|top|hihat|shaker|breakbeat/i.test(basename(p)) };
  if (dur >= 6 && !process.argv.includes("--nobase")) {
    const base = analyzeSamples(w.mono, w.sr, dur);
    const br = base.bpm / bpm;
    row.baseCls = Math.abs(br - 1) < 0.03 ? "exact" : Math.abs(br - 2) < 0.06 || Math.abs(br - 0.5) < 0.03 ? "octave" : "wrong";
  }
  if (dur < 6) { row.cls = "too-short"; rows.push(row); continue; }
  const t0 = performance.now();
  const map = buildSongMap(w.mono, w.sr, dur, { minDurationSec: 6 });
  row.ms = performance.now() - t0;
  if (!map) { row.cls = "null"; rows.push(row); continue; }
  row.est = map.bpm;
  row.conf = map.tempoConfidence;
  row.dbc = map.downbeatConfidence;
  const r = map.bpm / bpm;
  row.cls = Math.abs(r - 1) < 0.03 ? "exact" : Math.abs(r - 2) < 0.06 || Math.abs(r - 0.5) < 0.03 ? "octave" : Math.abs(r - 1.5) < 0.05 || Math.abs(r - 2 / 3) < 0.04 ? "3:2" : "wrong";
  const period = 60 / bpm;
  const nBeats = Math.floor(dur / period);
  const truthBeats = Array.from({ length: nBeats }, (_, k) => k * period);
  const truthBars = truthBeats.filter((_, k) => k % 4 === 0);
  if (row.cls === "exact") {
    const f = fMeasure(map.beats, truthBeats, 0.07);
    row.f70 = f.f;
    row.signed = f.medianSignedErrMs;
    row.dbF = fMeasure(map.downbeats, truthBars, 0.07).f;
    row.bars = truthBars.length;
  }
  rows.push(row);
}

const summarize = (label: string, rs: Row[]) => {
  const n = rs.length;
  const c = (k: string) => rs.filter((r) => r.cls === k).length;
  const b = (k: string) => rs.filter((r) => r.baseCls === k).length;
  const ex = rs.filter((r) => r.cls === "exact" && r.f70 !== undefined);
  const dbs = ex.filter((r) => r.dbF !== undefined);
  console.log(`${label.padEnd(18)} n=${String(n).padStart(3)} | NEW exact ${pct(c("exact"), n)} octave ${pct(c("octave"), n)} null ${pct(c("null"), n)} other ${pct(n - c("exact") - c("octave") - c("null"), n)} ${process.argv.includes("--nobase") ? "" : `| OLD exact ${pct(b("exact"), n)} octave ${pct(b("octave"), n)} other ${pct(b("wrong"), n)} `}| beatF70 med ${median(ex.map((r) => r.f70!)).toFixed(2)} bias med ${median(ex.map((r) => r.signed!)).toFixed(1)}ms | downbeat>0.8 ${pct(dbs.filter((r) => r.dbF! > 0.8).length, dbs.length)}`);
};
const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(0) + "%" : "n/a");
const median = (v: number[]) => (v.length ? [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] : NaN);
console.log(`files evaluated: ${rows.length}`);
const all = rows.filter((r) => r.cls !== "too-short");
summarize("ALL", all);
summarize("rhythmic (drums..)", all.filter((r) => r.rhythmic));
summarize("melodic/vocal", all.filter((r) => !r.rhythmic));
summarize("bpm <= 95", all.filter((r) => r.bpm <= 95));
summarize("bpm 96-139", all.filter((r) => r.bpm > 95 && r.bpm < 140));
summarize("bpm >= 140", all.filter((r) => r.bpm >= 140));
const exactAll = all.filter((r) => r.cls === "exact");
console.log(`\nALL n=${all.length}: tempo exact ${pct(exactAll.length, all.length)}, octave ${pct(all.filter((r) => r.cls === "octave").length, all.length)}, 3:2 ${pct(all.filter((r) => r.cls === "3:2").length, all.length)}, null ${pct(all.filter((r) => r.cls === "null").length, all.length)}, wrong ${pct(all.filter((r) => r.cls === "wrong").length, all.length)}`);
for (const th of [0, 0.1, 0.2, 0.3, 0.4]) {
  const g = all.filter((r) => r.conf !== undefined && r.conf >= th);
  const ex = g.filter((r) => r.cls === "exact").length;
  const oc = g.filter((r) => r.cls === "octave").length;
  const dbg = g.filter((r) => r.cls === "exact" && r.dbF !== undefined);
  console.log(`tempoConfidence >= ${th.toFixed(1)}: covers ${pct(g.length, all.length)} of files; of those exact ${pct(ex, g.length)}, octave ${pct(oc, g.length)}, wrong ${pct(g.length - ex - oc, g.length)}; downbeat F70>0.8 on ${pct(dbg.filter((r) => r.dbF! > 0.8).length, dbg.length)} of exact`);
}
{
  const trusted = all.filter((r) => r.conf !== undefined && r.conf >= 0.3 && (r.dbc ?? 0) >= 0.3);
  const tex = trusted.filter((r) => r.cls === "exact");
  const tdb = tex.filter((r) => r.dbF !== undefined);
  console.log(`FULL TRUST GATE (tempoConf>=0.3 & downbeatConf>=0.3): ${pct(trusted.length, all.length)} of files (${trusted.length}); tempo exact ${pct(tex.length, trusted.length)}, octave ${pct(trusted.filter((r) => r.cls === "octave").length, trusted.length)}, wrong ${pct(trusted.filter((r) => r.cls !== "exact" && r.cls !== "octave").length, trusted.length)}; of exact: downbeats right (F70>0.8) ${pct(tdb.filter((r) => r.dbF! > 0.8).length, tdb.length)}`);
}
const sg = exactAll.filter((r) => r.signed !== undefined).map((r) => r.signed!);
console.log(`bias over exact-tempo files: median ${median(sg).toFixed(1)}ms, p10 ${[...sg].sort((a, b) => a - b)[Math.floor(sg.length * 0.1)]?.toFixed(1)}ms, p90 ${[...sg].sort((a, b) => a - b)[Math.floor(sg.length * 0.9)]?.toFixed(1)}ms`);
const dbs = exactAll.filter((r) => r.dbF !== undefined);
console.log(`downbeat F70>0.8 in ${pct(dbs.filter((r) => r.dbF! > 0.8).length, dbs.length)} of exact-tempo files; mean analysis time ${(all.reduce((s, r) => s + (r.ms ?? 0), 0) / all.length).toFixed(0)}ms`);
if (process.argv.includes("--list")) for (const r of all) console.log(`${r.cls?.padEnd(7)} ${String(r.bpm).padStart(3)}→${r.est?.toFixed(1).padStart(6)} c${r.conf?.toFixed(2)} dur${r.dur.toFixed(1)} F${r.f70?.toFixed(2)} b${r.signed?.toFixed(0)} db${r.dbF?.toFixed(2)} dc${r.dbc?.toFixed(2)} ${r.name}`);
