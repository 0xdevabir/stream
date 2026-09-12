import { PrismaClient } from "@prisma/client";

/**
 * A single PrismaClient per process.
 *
 * Node's module cache normally guarantees this, but `tsx --watch` and Next.js
 * dev both re-evaluate modules on reload, which otherwise leaks a connection
 * pool per edit until Postgres refuses new connections.
 */
const globalForPrisma = globalThis as unknown as {
  __streamPrisma?: PrismaClient;
};

function create(): PrismaClient {
  return new PrismaClient({
    log:
      process.env.PRISMA_LOG === "query"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
  });
}

export const prisma: PrismaClient = globalForPrisma.__streamPrisma ?? create();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__streamPrisma = prisma;
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}

/** Used by the API's readiness probe and by scripts waiting on Postgres. */
export async function pingDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
