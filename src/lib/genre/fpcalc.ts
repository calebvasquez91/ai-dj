/**
 * Fingerprints a stored file by running the `fpcalc` tool (Chromaprint) named by FPCALC_PATH. Server-only. Only a file in
 * local storage can be fingerprinted this way; the tool is an external program on the machine running the app, never
 * bundled or shipped with it. Returns null when the tool is not there, the file is, or the tool fails.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getStorageBackend, localFilePath } from "@/lib/storage";
import type { Fingerprint } from "@/lib/genre/fingerprint";
import type { ProviderInput } from "@/lib/genre/types";

const run = promisify(execFile);

export function createFpcalcFingerprinter(fpcalcPath: string | undefined): ((input: ProviderInput) => Promise<Fingerprint | null>) | null {
  if (!fpcalcPath) return null;
  return async (input) => {
    if (!input.storageKey || getStorageBackend() !== "local") return null;
    try {
      // Only the first two minutes are needed to identify a recording.
      const { stdout } = await run(fpcalcPath, ["-json", "-length", "120", localFilePath(input.storageKey)], { timeout: 30_000, maxBuffer: 1024 * 1024 });
      const parsed = JSON.parse(stdout) as { duration?: number; fingerprint?: string };
      if (typeof parsed.fingerprint !== "string" || parsed.fingerprint === "" || typeof parsed.duration !== "number") return null;
      return { durationSec: parsed.duration, fingerprint: parsed.fingerprint };
    } catch {
      return null;
    }
  };
}
