/**
 * Development seed.
 *
 * Creates one organization, an instructor, three students, a course, and two
 * classes -- one scheduled for tomorrow and one ready to go live right now.
 *
 * The smoke-test class uses a fixed stream key so `scripts/smoke-stream.sh`
 * can push a test pattern without a human copying credentials around. Every
 * generated credential is also written to `.seed-output.json` at the repo
 * root (gitignored) for the smoke scripts to read.
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

/**
 * `DATABASE_URL` names `postgres:5432`, which only resolves inside the compose
 * network. Seeding is run from the host, so prefer the published-port URL when
 * one is configured. Inside a container DATABASE_URL_HOST is never set, so
 * this is a no-op there.
 */
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

/** Fixed so the smoke test is reproducible. Dev only -- never seeded in prod. */
const SMOKE_STREAM_KEY = "sk_dev_smoke_0000000000000000000000000";

async function main() {
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_PROD_SEED) {
    throw new Error(
      "Refusing to seed with NODE_ENV=production. Set ALLOW_PROD_SEED=1 to override.",
    );
  }

  const passwordHash = await hashPassword(DEV_PASSWORD);

  const org = await prisma.organization.upsert({
    where: { slug: "northgate" },
    update: {},
    create: { name: "Northgate Academy", slug: "northgate" },
  });

  async function upsertUser(email: string, name: string, role: "OWNER" | "INSTRUCTOR" | "STUDENT") {
    const user = await prisma.user.upsert({
      where: { email },
      update: { name },
      create: { email, name, passwordHash },
    });
    await prisma.membership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
      update: { role },
      create: { userId: user.id, organizationId: org.id, role },
    });
    return user;
  }

  const instructor = await upsertUser(
    "instructor@example.com",
    "Dr. Amara Osei",
    "OWNER",
  );

  const students = await Promise.all([
    upsertUser("student1@example.com", "Rin Takahashi", "STUDENT"),
    upsertUser("student2@example.com", "Diego Marchetti", "STUDENT"),
    upsertUser("student3@example.com", "Priya Raghunathan", "STUDENT"),
  ]);

  const course = await prisma.course.upsert({
    where: { organizationId_slug: { organizationId: org.id, slug: "systems-programming" } },
    update: {},
    create: {
      organizationId: org.id,
      slug: "systems-programming",
      title: "Introduction to Systems Programming",
      description:
        "Memory, processes, and the C toolchain, taught live twice a week.",
    },
  });

  for (const student of students) {
    await prisma.courseEnrollment.upsert({
      where: { userId_courseId: { userId: student.id, courseId: course.id } },
      update: {},
      create: { userId: student.id, courseId: course.id },
    });
  }

  async function createStream(opts: {
    title: string;
    description: string;
    scheduledAt: Date;
    streamKey: string;
    slug: string;
  }) {
    const contentKey = generateContentKey();
    const existing = await prisma.stream.findUnique({ where: { slug: opts.slug } });

    if (existing) {
      // Re-seeding is how you reset the dev loop, so a class that has already
      // been broadcast has to become publishable again. Leaving it ENDED means
      // the MediaMTX auth hook refuses the next publish and the smoke test
      // fails with a misleading "authentication failed".
      const reopened = await prisma.stream.update({
        where: { id: existing.id },
        data: {
          status: "SCHEDULED",
          scheduledAt: opts.scheduledAt,
          startedAt: null,
          endedAt: null,
          peakViewers: 0,
        },
      });
      return { stream: reopened, streamKey: opts.streamKey };
    }

    const stream = await prisma.stream.create({
      data: {
        organizationId: org.id,
        courseId: course.id,
        instructorId: instructor.id,
        slug: opts.slug,
        title: opts.title,
        description: opts.description,
        scheduledAt: opts.scheduledAt,
        accessMode: "ENROLLED",
        shareToken: generateShareToken(),
        streamKeyHash: hashStreamKey(opts.streamKey),
        streamKeyWrapped: wrapSecret(opts.streamKey, CONTENT_KEY_SECRET!),
        streamKeyPrefix: streamKeyPrefix(opts.streamKey),
        contentKeyId: generateContentKeyId(),
        contentKeyWrapped: wrapContentKey(contentKey, CONTENT_KEY_SECRET!),
      },
    });

    await prisma.enrollment.createMany({
      data: students.map((s) => ({ userId: s.id, streamId: stream.id })),
      skipDuplicates: true,
    });

    return { stream, streamKey: opts.streamKey };
  }

  const now = Date.now();

  const smoke = await createStream({
    title: "Lecture 7 — Virtual Memory",
    description:
      "Page tables, TLBs, and why your program's addresses are a polite fiction.",
    scheduledAt: new Date(now + 5 * 60_000),
    streamKey: SMOKE_STREAM_KEY,
    slug: "lecture-7-virtual-memory",
  });

  const tomorrow = await createStream({
    title: "Lecture 8 — Dynamic Linking",
    description: "Shared objects, symbol resolution, and the loader.",
    scheduledAt: new Date(now + 24 * 60 * 60_000),
    streamKey: generateStreamKey(),
    slug: "lecture-8-dynamic-linking",
  });

  // Provider demo tenant + API key for LMS / embed integrations.
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

  const output = {
    generatedAt: new Date().toISOString(),
    organization: { id: org.id, slug: org.slug },
    logins: {
      instructor: { email: "instructor@example.com", password: DEV_PASSWORD },
      student: { email: "student1@example.com", password: DEV_PASSWORD },
    },
    smokeStream: {
      id: smoke.stream.id,
      slug: smoke.stream.slug,
      streamKey: smoke.streamKey,
      contentKeyId: smoke.stream.contentKeyId,
    },
    upcomingStream: { id: tomorrow.stream.id, slug: tomorrow.stream.slug },
    provider: {
      tenantId: tenant.id,
      slug: tenant.slug,
      apiKey: apiKey.raw,
      apiBase: "/v1/provider",
    },
  };

  writeFileSync(
    resolve(REPO_ROOT, ".seed-output.json"),
    `${JSON.stringify(output, null, 2)}\n`,
  );

  console.log("Seeded Northgate Academy");
  console.log(`  instructor  instructor@example.com / ${DEV_PASSWORD}`);
  console.log(`  students    student1..3@example.com / ${DEV_PASSWORD}`);
  console.log(`  smoke class ${smoke.stream.slug}  (key ${smoke.streamKey})`);
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

