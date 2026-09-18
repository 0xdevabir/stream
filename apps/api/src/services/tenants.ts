import { createHash, randomBytes } from "node:crypto";

import {
  generateApiKey,
  hashApiKey,
  hashPassword,
  prisma,
  slugify,
} from "@stream/db";

import { ApiError } from "../errors";

export interface TenantContext {
  tenantId: string;
  organizationId: string;
  serviceUserId: string;
  apiKeyId: string;
  scopes: string[];
  maxConcurrentLives: number;
  maxMinutesPerMonth: number;
}

export async function createTenant(input: {
  name: string;
  apiKeyName?: string;
}): Promise<{
  tenantId: string;
  slug: string;
  apiKey: string;
  apiKeyPrefix: string;
}> {
  const slug = slugify(input.name);
  const passwordHash = await hashPassword(randomBytes(32).toString("hex"));
  const serviceEmail = `provider+${slug}@stream.local`;

  const serviceUser = await prisma.user.create({
    data: {
      email: serviceEmail,
      name: `${input.name} (API)`,
      passwordHash,
    },
  });

  const organization = await prisma.organization.create({
    data: {
      name: input.name,
      slug: `tenant-${slug}`,
      maxConcurrentStreams: 3,
      memberships: {
        create: {
          userId: serviceUser.id,
          role: "OWNER",
        },
      },
    },
  });

  const tenant = await prisma.tenant.create({
    data: {
      name: input.name,
      slug,
      organizationId: organization.id,
      serviceUserId: serviceUser.id,
    },
  });

  const key = generateApiKey();
  await prisma.apiKey.create({
    data: {
      tenantId: tenant.id,
      name: input.apiKeyName ?? "Default",
      keyPrefix: key.prefix,
      keyHash: key.hash,
    },
  });

  return {
    tenantId: tenant.id,
    slug: tenant.slug,
    apiKey: key.raw,
    apiKeyPrefix: key.prefix,
  };
}

export async function resolveApiKey(
  authorizationHeader: string | undefined,
): Promise<TenantContext> {
  if (!authorizationHeader) throw ApiError.unauthorized("Missing API key");

  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader);
  const raw = match?.[1]?.trim();
  if (!raw || !raw.startsWith("sk_")) {
    throw ApiError.unauthorized("Invalid API key");
  }

  const keyHash = hashApiKey(raw);
  const record = await prisma.apiKey.findUnique({
    where: { keyHash },
    include: {
      tenant: {
        select: {
          id: true,
          organizationId: true,
          serviceUserId: true,
          maxConcurrentLives: true,
          maxMinutesPerMonth: true,
        },
      },
    },
  });

  if (!record || record.revokedAt) {
    throw ApiError.unauthorized("Invalid API key");
  }

  void prisma.apiKey
    .update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => undefined);

  return {
    tenantId: record.tenant.id,
    organizationId: record.tenant.organizationId,
    serviceUserId: record.tenant.serviceUserId,
    apiKeyId: record.id,
    scopes: record.scopes,
    maxConcurrentLives: record.tenant.maxConcurrentLives,
    maxMinutesPerMonth: record.tenant.maxMinutesPerMonth,
  };
}

export function requireScope(ctx: TenantContext, scope: string): void {
  if (!ctx.scopes.includes(scope) && !ctx.scopes.includes("*")) {
    throw ApiError.forbidden(`API key missing scope: ${scope}`);
  }
}

/** Constant-time-ish compare for webhook signing verification helpers. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
