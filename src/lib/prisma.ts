import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 requires an explicit driver adapter (no more implicit
// DATABASE_URL-only connections). Must agree with schema.prisma's
// `datasource db { provider = "postgresql" }`.
const adapter = new PrismaPg(process.env.DATABASE_URL as string);

// Next.js dev-mode hot-reload re-evaluates this module on every edit, which
// would otherwise open a fresh PrismaClient (and DB connection pool) each
// time — cache it on the global object so dev reloads reuse the same one.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
