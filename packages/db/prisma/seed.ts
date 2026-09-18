/**
 * Development seed — provider demo tenant only.
 *
 * Creates a console login, API key, and two live inputs (smoke + isolation)
 * for local LMS / smoke testing. Credentials land in `.seed-output.json`.
 */
import { writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

import { PrismaClient } from "@prisma/client";

import {
  generateContentKey,
  wrapContentKey,
  wrapSecret,
} from "../src/content-key";
import {
  generateApiKey,
  generateContentKeyId,
  generateShareToken,
  generateStreamKey,
  hashStreamKey,
  streamKeyPrefix,
} from "../src/ids";
import { hashPassword } from "../src/password";

const REPO_ROOT = resolve(__dirname, "..", "..", "..");

try {
  process.loadEnvFile(resolve(REPO_ROOT, ".env"));
} catch {
  // .env is optional when the variables are already exported.
}

if (process.env.DATABASE_URL_HOST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_HOST;
}

const prisma = new PrismaClient();

const CONTENT_KEY_SECRET = process.env.CONTENT_KEY_SECRET;
if (!CONTENT_KEY_SECRET) {
  throw new Error(
    "CONTENT_KEY_SECRET is required. Run: node scripts/gen-secrets.mjs",
  );
}

const DEV_PASSWORD = "changeme-please";
const SMOKE_STREAM_KEY = "sk_dev_smoke_0000000000000000000000000";

async function main() {
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_PROD_SEED) {
    throw new Error(
      "Refusing to seed with NODE_ENV=production. Set ALLOW_PROD_SEED=1 to override.",
    );
  }

  const passwordHash = await hashPassword(DEV_PASSWORD);

  // Platform super-admin (no tenant required).
  await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: { name: "Platform Admin", passwordHash, platformAdmin: true },
    create: {
      email: "admin@example.com",
      name: "Platform Admin",
      passwordHash,
      platformAdmin: true,
    },
  });

  const providerSlug = "demo-provider";
  const providerEmail = `provider+${providerSlug}@stream.local`;

  const providerUser = await prisma.user.upsert({
    where: { email: providerEmail },
    update: {},
    create: {
      email: providerEmail,
      name: "Demo Provider (API)",
      passwordHash: await hashPassword(randomBytes(24).toString("hex")),
    },
  });

  const providerOrg = await prisma.organization.upsert({
    where: { slug: `tenant-${providerSlug}` },
    update: {},
    create: {
      name: "Demo Provider",
      slug: `tenant-${providerSlug}`,
      memberships: {
        create: { userId: providerUser.id, role: "OWNER" },
      },
    },
  });

  const tenant = await prisma.tenant.upsert({
    where: { slug: providerSlug },
    update: {},
    create: {
      name: "Demo Provider",
      slug: providerSlug,
      organizationId: providerOrg.id,
      serviceUserId: providerUser.id,
      maxConcurrentLives: 5,
      maxMinutesPerMonth: 50_000,
    },
  });

  const consoleUser = await prisma.user.upsert({
    where: { email: "console@example.com" },
    update: { name: "Console Admin", passwordHash },
    create: {
      email: "console@example.com",
      name: "Console Admin",
      passwordHash,
    },
  });
  await prisma.membership.upsert({
    where: {
      userId_organizationId: {
        userId: consoleUser.id,
        organizationId: providerOrg.id,
      },
    },
    update: { role: "OWNER" },
    create: {
      userId: consoleUser.id,
      organizationId: providerOrg.id,
      role: "OWNER",
    },
  });

  await prisma.apiKey.deleteMany({ where: { tenantId: tenant.id } });
  const apiKey = generateApiKey();
  await prisma.apiKey.create({
    data: {
      tenantId: tenant.id,
      name: "Seed key",
      keyPrefix: apiKey.prefix,
      keyHash: apiKey.hash,
    },
  });

  async function upsertLiveInput(opts: {
    title: string;
    slug: string;
    streamKey: string;
    scheduledAt: Date;
  }) {
    const contentKey = generateContentKey();
    const existing = await prisma.stream.findUnique({
      where: { slug: opts.slug },
    });

    if (existing) {
      const reopened = await prisma.stream.update({
        where: { id: existing.id },
        data: {
          status: "SCHEDULED",
          tenantId: tenant.id,
          organizationId: providerOrg.id,
          instructorId: providerUser.id,
          scheduledAt: opts.scheduledAt,
          startedAt: null,
          endedAt: null,
          peakViewers: 0,
          accessMode: "PUBLIC",
          chatEnabled: false,
          questionsEnabled: false,
          recordEnabled: true,
        },
      });
      return { stream: reopened, streamKey: opts.streamKey };
    }

    const stream = await prisma.stream.create({
      data: {
        organizationId: providerOrg.id,
        tenantId: tenant.id,
        instructorId: providerUser.id,
        slug: opts.slug,
        title: opts.title,
        scheduledAt: opts.scheduledAt,
        accessMode: "PUBLIC",
        latencyMode: "LOW",
        recordEnabled: true,
        chatEnabled: false,
        questionsEnabled: false,
        shareToken: generateShareToken(),
        streamKeyHash: hashStreamKey(opts.streamKey),
        streamKeyWrapped: wrapSecret(opts.streamKey, CONTENT_KEY_SECRET!),
        streamKeyPrefix: streamKeyPrefix(opts.streamKey),
        contentKeyId: generateContentKeyId(),
        contentKeyWrapped: wrapContentKey(contentKey, CONTENT_KEY_SECRET!),
      },
    });

    return { stream, streamKey: opts.streamKey };
  }

  const now = Date.now();
  const smoke = await upsertLiveInput({
    title: "Smoke live input",
    slug: "smoke-live-input",
    streamKey: SMOKE_STREAM_KEY,
    scheduledAt: new Date(now + 5 * 60_000),
  });

  const other = await upsertLiveInput({
    title: "Isolation live input",
    slug: "isolation-live-input",
    streamKey: generateStreamKey(),
    scheduledAt: new Date(now + 24 * 60 * 60_000),
  });

  const output = {
    generatedAt: new Date().toISOString(),
    logins: {
      admin: { email: "admin@example.com", password: DEV_PASSWORD },
      console: { email: "console@example.com", password: DEV_PASSWORD },
    },
    smokeStream: {
      id: smoke.stream.id,
      slug: smoke.stream.slug,
      streamKey: smoke.streamKey,
      contentKeyId: smoke.stream.contentKeyId,
    },
    upcomingStream: { id: other.stream.id, slug: other.stream.slug },
    provider: {
      tenantId: tenant.id,
      slug: tenant.slug,
      apiKey: apiKey.raw,
      apiBase: "/v1/provider",
      consoleEmail: "console@example.com",
    },
  };

  writeFileSync(
    resolve(REPO_ROOT, ".seed-output.json"),
    `${JSON.stringify(output, null, 2)}\n`,
  );

  console.log("Seeded Stream provider demo");
  console.log(`  admin       admin@example.com / ${DEV_PASSWORD}  (super-admin)`);
  console.log(`  console     console@example.com / ${DEV_PASSWORD}  (tenant)`);
  console.log(`  smoke input ${smoke.stream.slug}  (key ${smoke.streamKey})`);
  console.log(`  provider    tenant=${tenant.slug}  apiKey=${apiKey.raw}`);
  console.log("  credentials written to .seed-output.json");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

