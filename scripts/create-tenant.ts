/**
 * Create a provider tenant + API key + console owner login.
 *
 *   pnpm exec tsx scripts/create-tenant.ts --name "Acme LMS"
 *
 * Prints apiKey (once) and consoleEmail / consolePassword.
 */
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

try {
  process.loadEnvFile(resolve(process.cwd(), ".env"));
} catch {
  // optional
}
if (process.env.DATABASE_URL_HOST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_HOST;
}

const { values } = parseArgs({
  options: { name: { type: "string" } },
});

if (!values.name) {
  console.error('Usage: pnpm exec tsx scripts/create-tenant.ts --name "Acme LMS"');
  process.exit(1);
}

const { prisma, generateApiKey, hashPassword, slugify } = await import(
  "@stream/db"
);

const name = values.name;
const slug = slugify(name);
const consolePassword = randomBytes(9).toString("base64url");
const consoleEmail = `console+${slug}@stream.local`;

const serviceUser = await prisma.user.create({
  data: {
    email: `provider+${slug}@stream.local`,
    name: `${name} (API)`,
    passwordHash: await hashPassword(randomBytes(32).toString("hex")),
  },
});

const consoleUser = await prisma.user.create({
  data: {
    email: consoleEmail,
    name: `${name} Console`,
    passwordHash: await hashPassword(consolePassword),
  },
});

const org = await prisma.organization.create({
  data: {
    name,
    slug: `tenant-${slug}`,
    memberships: {
      create: [
        { userId: serviceUser.id, role: "OWNER" },
        { userId: consoleUser.id, role: "OWNER" },
      ],
    },
  },
});

const tenant = await prisma.tenant.create({
  data: {
    name,
    slug,
    organizationId: org.id,
    serviceUserId: serviceUser.id,
  },
});

const key = generateApiKey();
await prisma.apiKey.create({
  data: {
    tenantId: tenant.id,
    name: "Default",
    keyPrefix: key.prefix,
    keyHash: key.hash,
  },
});

console.log(
  JSON.stringify(
    {
      tenantId: tenant.id,
      slug: tenant.slug,
      apiKey: key.raw,
      consoleEmail,
      consolePassword,
      note: "Store apiKey and consolePassword now; they cannot be recovered.",
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
