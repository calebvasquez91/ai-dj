/**
 * Whether this deployment can separate stems at all. Separation needs Replicate (a token) and a publicly reachable
 * audio URL for it to fetch, which only the "blob" storage backend provides — the "local" backend serves files from
 * the dev machine's disk. Pure: callers pass what they read from the environment, so the answer can be tested and the
 * stems route, the summary route and the UI all say the same thing.
 */

export type StemSupport =
  | { available: true }
  | { available: false; reason: "storage" | "replicate"; message: string };

export function stemSupport({
  storageBackend,
  hasReplicateToken,
}: {
  storageBackend: "local" | "blob";
  hasReplicateToken: boolean;
}): StemSupport {
  if (storageBackend !== "blob") {
    return {
      available: false,
      reason: "storage",
      message:
        'This server stores audio on local disk, so Replicate has no URL to fetch it from. Stems need NEXT_PUBLIC_STORAGE_BACKEND="blob" (the deployed app has it).',
    };
  }
  if (!hasReplicateToken) {
    return {
      available: false,
      reason: "replicate",
      message: "Stem separation isn't set up on this server: REPLICATE_API_TOKEN is missing.",
    };
  }
  return { available: true };
}
