#!/usr/bin/env node
/**
 * Creates .env from .env.example and fills in real random secrets.
 *
 *   node scripts/gen-secrets.mjs           # fill placeholders only
 *   node scripts/gen-secrets.mjs --force   # regenerate every secret
 *
 * Safe to re-run: a value that has already been changed away from its
 * shipped placeholder is left alone, so running this again after pulling a
 * new variable into .env.example tops up only what is missing.
 *
 * Node rather than shell so it behaves identically on macOS, Linux, and
 * Windows, and so the randomness comes from the platform CSPRNG.
 */
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");
const examplePath = resolve(root, ".env.example");

const force = process.argv.includes("--force");

if (!existsSync(envPath)) {
  copyFileSync(examplePath, envPath);
  console.log("created .env from .env.example");
}

let lines = readFileSync(envPath, "utf8").split("\n");

const readVar = (key) => {
  const line = lines.find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1) : "";
};

const writeVar = (key, value) => {
  const index = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (index === -1) lines.push(`${key}=${value}`);
  else lines[index] = `${key}=${value}`;
};

/** Placeholders are exactly what the repository ships. */
const isPlaceholder = (value) =>
  value === "" ||
  value.startsWith("dev_") ||
  value === "devpassword_change_me" ||
  /^0+$/.test(value);

const hex = (bytes) => randomBytes(bytes).toString("hex");

const secrets = {
  AUTH_SECRET: () => hex(32),
  PLAYBACK_SECRET: () => hex(32),
  INTERNAL_TOKEN: () => hex(32),
  CONTENT_KEY_SECRET: () => hex(32),
};

console.log("generating secrets:");
for (const [key, generate] of Object.entries(secrets)) {
  if (force || isPlaceholder(readVar(key))) {
    writeVar(key, generate());
    console.log(`  set  ${key}`);
  } else {
    console.log(`  keep ${key} (already customised)`);
  }
}

// The database password appears in three variables that must agree.
if (force || isPlaceholder(readVar("POSTGRES_PASSWORD"))) {
  const password = hex(16);
  const user = readVar("POSTGRES_USER") || "stream";
  const database = readVar("POSTGRES_DB") || "stream";
  const hostPort = readVar("POSTGRES_HOST_PORT") || "5433";

  writeVar("POSTGRES_PASSWORD", password);
  writeVar(
    "DATABASE_URL",
    `postgresql://${user}:${password}@postgres:5432/${database}?schema=public`,
  );
  writeVar(
    "DATABASE_URL_HOST",
    `postgresql://${user}:${password}@localhost:${hostPort}/${database}?schema=public`,
  );
  console.log("  set  POSTGRES_PASSWORD (+ DATABASE_URL, DATABASE_URL_HOST)");
} else {
  console.log("  keep POSTGRES_PASSWORD (already customised)");
}

writeFileSync(envPath, lines.join("\n"));

console.log(
  "\ndone. .env is gitignored -- back it up before deploying:\n" +
    "CONTENT_KEY_SECRET is required to decrypt every existing recording.",
);
