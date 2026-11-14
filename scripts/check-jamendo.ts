// The first real run against Jamendo's live API, once there is a client id (free, at devportal.jamendo.com).
//
//   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/check-jamendo.ts [origin]
//
// It needs JAMENDO_CLIENT_ID in .env, makes four small searches (about 4 of the 35,000 free monthly requests plus a
// couple of 1 KB audio probes) and prints what the catalog code could only assume from the documentation:
//   1. the real response shape, and how much of the catalog the license rules leave usable;
//   2. whether the stream URLs carry the client id (so the "key never reaches the browser" wording can be settled);
//   3. whether the audio host sends CORS headers that let Web Audio read it from `origin` (default: the live site);
//   4. what Jamendo's own ccnc / ccnd / ccsa filters do, so a server-side filter can be used (or not) to avoid thin pages.
// The client id is never printed. Not part of the build or the tests.
import { buildJamendoSearchUrl, createJamendoAdapter } from "../src/lib/catalog/jamendo";
import { corsVerdict, licenseMix, streamUrlInfo } from "../src/lib/catalog/probe";

const clientId = process.env.JAMENDO_CLIENT_ID?.trim() ?? "";
if (!clientId) {
  console.error("JAMENDO_CLIENT_ID is not set (put it in .env, then run with: node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/check-jamendo.ts).");
  process.exit(1);
}
const origin = process.argv[2] ?? "https://ai-dj-gamma.vercel.app";
const mask = (text: string) => text.split(clientId).join("<client id>");

async function rawSearch(extra: Record<string, string> = {}, limit = 40): Promise<{ results: Record<string, unknown>[]; status: number; headers: unknown }> {
  const url = new URL(buildJamendoSearchUrl({ text: "electronic", limit }, clientId));
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  const res = await fetch(url);
  const body = (await res.json().catch(() => ({}))) as { results?: Record<string, unknown>[]; headers?: unknown };
  return { results: body.results ?? [], status: res.status, headers: body.headers };
}

async function main() {
  console.log("1. Response shape and licenses");
  const base = await rawSearch();
  console.log(`   HTTP ${base.status}, header block: ${mask(JSON.stringify(base.headers))}`);
  const first = base.results[0];
  if (!first) {
    console.log("   no results: stopping (is the client id valid?)");
    return;
  }
  console.log(`   fields on a result: ${Object.keys(first).join(", ")}`);
  const mix = licenseMix(base.results.map((r) => r.license_ccurl as string | undefined));
  console.log(`   ${mix.usable} of ${mix.total} results are usable under the app's license rules; by license: ${JSON.stringify(mix.byCode)}`);

  console.log("\n2. Does a stream URL carry the client id?");
  const audioUrls = base.results.map((r) => r.audio).filter((u): u is string => typeof u === "string").slice(0, 5);
  for (const url of audioUrls) {
    const info = streamUrlInfo(url, clientId);
    console.log(`   ${info.host}: carries id = ${info.carriesClientId}${info.paramsWithClientId.length ? ` (in: ${info.paramsWithClientId.join(", ")})` : ""}`);
  }

  console.log(`\n3. CORS for Web Audio from ${origin}`);
  for (const url of audioUrls.slice(0, 2)) {
    try {
      const res = await fetch(url, { headers: { Origin: origin, Range: "bytes=0-1023" } });
      console.log(
        `   ${streamUrlInfo(url, clientId).host}: HTTP ${res.status}, ${res.headers.get("content-type")}, accept-ranges=${res.headers.get("accept-ranges")}, ` +
          `access-control-allow-origin=${res.headers.get("access-control-allow-origin")} -> ${corsVerdict(res.headers, origin)}`
      );
    } catch (err) {
      console.log(`   probe failed: ${mask(err instanceof Error ? err.message : String(err))}`);
    }
  }

  console.log("\n4. Jamendo's own license filters (are the usable shares higher with a flag?)");
  for (const [label, extra] of [
    ["none", {}],
    ["ccnc=false", { ccnc: "false" }],
    ["ccnc=false&ccnd=false", { ccnc: "false", ccnd: "false" }],
    ["ccnc=false&ccnd=false&ccsa=false", { ccnc: "false", ccnd: "false", ccsa: "false" }],
  ] as [string, Record<string, string>][]) {
    const { results, status } = await rawSearch(extra);
    const m = licenseMix(results.map((r) => r.license_ccurl as string | undefined));
    console.log(`   ${label.padEnd(34)} HTTP ${status}: ${m.usable}/${m.total} usable; ${JSON.stringify(m.byCode)}`);
  }

  console.log("\n5. The adapter end to end");
  const page = await createJamendoAdapter({ clientId }).search({ text: "electronic", limit: 20 });
  console.log(`   ${page.tracks.length} usable tracks, next offset ${page.nextOffset}, left out: ${JSON.stringify(page.skipped)}`);
  const sample = page.tracks[0];
  if (sample) console.log(`   e.g. ${mask(JSON.stringify({ id: sample.id, title: sample.title, license: sample.license.label, stream: sample.streamUrl }))}`);
}

main().catch((err) => {
  console.error(mask(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
