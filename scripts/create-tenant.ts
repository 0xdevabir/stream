/**
 * Create a provider tenant + API key.
 *
 *   pnpm exec tsx scripts/create-tenant.ts --name "Acme LMS"
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

const user = await prisma.user.create({
  data: {
    email: `provider+${slug}@stream.local`,
    name: `${name} (API)`,
    passwordHash: await hashPassword(randomBytes(32).toString("hex")),
  },
});

const org = await prisma.organization.create({
  data: {
    name,
    slug: `tenant-${slug}`,
    memberships: { create: { userId: user.id, role: "OWNER" } },
  },
});

const tenant = await prisma.tenant.create({
  data: {
    name,
    slug,
    organizationId: org.id,
    serviceUserId: user.id,
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
      note: "Store the apiKey now; it cannot be recovered.",
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
