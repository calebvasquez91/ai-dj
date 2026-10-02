// Shared shaping logic between the FX Route Handlers — mirrors trackApi.ts's
// Prisma-row -> client-JSON mapping (and storage-backend-dependent
// sourceUrl) so the two resource types stay consistent.
import type { FxSound as PrismaFxSound } from "@/generated/prisma/client";
import type { FxSound, FxCategory } from "@/types/music";
import { getStorageBackend } from "@/lib/storage";

const FX_CATEGORIES: FxCategory[] = ["transition", "loop", "effect", "background", "vocal"];

export function isFxCategory(value: unknown): value is FxCategory {
  return typeof value === "string" && (FX_CATEGORIES as string[]).includes(value);
}

export function fxSourceUrl(fx: Pick<PrismaFxSound, "id" | "storageKey">): string {
  return getStorageBackend() === "local" ? `/api/fx/${fx.id}/audio` : fx.storageKey;
}

export function toFxApiResponse(fx: PrismaFxSound): FxSound {
  return {
    id: fx.id,
    name: fx.name,
    fileName: fx.fileName,
    sourceUrl: fxSourceUrl(fx),
    mimeType: fx.mimeType,
    category: isFxCategory(fx.category) ? fx.category : "effect",
    durationSec: fx.durationSec,
    bpm: fx.bpm ?? undefined,
    key: fx.key ?? undefined,
    tags: fx.tagsJson ? JSON.parse(fx.tagsJson) : [],
    playlistAffinity: fx.playlistAffinityJson ? JSON.parse(fx.playlistAffinityJson) : [],
    addedAt: fx.createdAt.getTime(),
  };
}
