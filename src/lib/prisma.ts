import { PrismaClient } from "@/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

// Prisma 7 requires an explicit driver adapter (no more implicit
// DATABASE_URL-only connections). This one is SQLite-specific (libsql, pure
// JS — better-sqlite3 needs a native compiler toolchain this machine
// doesn't have) and matches schema.prisma's `datasource db { provider =
// "sqlite" }`. Moving to Postgres in production means changing *both*:
// this adapter (-> @prisma/adapter-pg) and the schema's datasource
// provider (-> "postgresql") together — they have to agree.
const adapter = new PrismaLibSql({ url: process.env.DATABASE_URL ?? "file:./dev.db" });

// Next.js dev-mode hot-reload re-evaluates this module on every edit, which
// would otherwise open a fresh PrismaClient (and DB connection pool) each
// time — cache it on the global object so dev reloads reuse the same one.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
