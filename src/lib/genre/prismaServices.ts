/**
 * The database-backed cache and rate limiter (tables ProviderCache and ProviderRateLimit, prisma/genre-tables.sql). Server-only.
 * Both treat a missing table as "no cache / no shared limit" rather than an error: until the SQL has been run the providers
 * still work, they only lose the sharing.
 */
import { prisma } from "@/lib/prisma";
import type { ProviderCacheStore } from "@/lib/genre/types";
import { memoryRateStore, type RateStore } from "@/lib/genre/services";

export function prismaCache(): ProviderCacheStore {
  return {
    async get(key) {
      try {
        const row = await prisma.providerCache.findUnique({ where: { key } });
        if (!row || row.expiresAt.getTime() <= Date.now()) return undefined;
        return JSON.parse(row.valueJson) as unknown;
      } catch {
        return undefined;
      }
    },
    async set(key, provider, value, ttlMs) {
      const valueJson = JSON.stringify(value);
      const expiresAt = new Date(Date.now() + ttlMs);
      try {
        await prisma.providerCache.upsert({
          where: { key },
          create: { key, provider, valueJson, expiresAt },
          update: { provider, valueJson, expiresAt, fetchedAt: new Date() },
        });
      } catch {
        // No cache table yet, or a race on the same key: the answer is simply not kept.
      }
    },
  };
}

/**
 * One atomic statement claims the slot using the database's own clock (so serverless instances with different clocks agree):
 * it inserts the row, or moves lastRequestAt to now only if the last request is at least `minIntervalMs` old. If it claimed
 * nothing, a second read says how long until the slot opens.
 */
export function prismaRateStore(): RateStore {
  // Used when the table is missing: this one process still spaces its own requests.
  const local = memoryRateStore();
  return {
    async claim(provider, minIntervalMs) {
      try {
        const claimed = await prisma.$queryRaw<{ provider: string }[]>`
          INSERT INTO "ProviderRateLimit" ("provider", "lastRequestAt") VALUES (${provider}, now())
          ON CONFLICT ("provider") DO UPDATE SET "lastRequestAt" = now()
          WHERE "ProviderRateLimit"."lastRequestAt" <= now() - (${minIntervalMs} * interval '1 millisecond')
          RETURNING "provider"`;
        if (claimed.length > 0) return 0;
        const rows = await prisma.$queryRaw<{ waitMs: number }[]>`
          SELECT GREATEST(0, ${minIntervalMs} - EXTRACT(EPOCH FROM (now() - "lastRequestAt")) * 1000)::float8 AS "waitMs"
          FROM "ProviderRateLimit" WHERE "provider" = ${provider}`;
        return Math.max(1, Math.ceil(rows[0]?.waitMs ?? minIntervalMs));
      } catch {
        return local.claim(provider, minIntervalMs);
      }
    },
  };
}
