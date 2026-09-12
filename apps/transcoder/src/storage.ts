import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { env } from "./env";
import { logger } from "./logger";

export const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
});

const CONTENT_TYPES: Record<string, string> = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
  ".mp4": "video/mp4",
  ".m4s": "video/iso.segment",
  ".jpg": "image/jpeg",
  ".vtt": "text/vtt",
};

export function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

export async function uploadFile(
  localPath: string,
  key: string,
): Promise<number> {
  const stats = await stat(localPath);

  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: createReadStream(localPath),
      ContentLength: stats.size,
      ContentType: contentTypeFor(localPath),
      // Segments are content-addressed by sequence number and never change,
      // so they can be cached indefinitely once fetched.
      CacheControl: localPath.endsWith(".m3u8")
        ? "no-cache"
        : "public, max-age=31536000, immutable",
    }),
  );

  return stats.size;
}

export async function uploadText(
  body: string,
  key: string,
  contentType: string,
): Promise<number> {
  const bytes = Buffer.from(body, "utf8");
  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: bytes,
      ContentLength: bytes.length,
      ContentType: contentType,
      CacheControl: "no-cache",
    }),
  );
  return bytes.length;
}

/**
 * Uploads many files with bounded concurrency.
 *
 * A two-hour class produces on the order of 30,000 segment files. Firing them
 * all at once exhausts sockets and file descriptors; a small pool keeps the
 * upload saturated without doing that.
 */
export async function uploadAll(
  files: Array<{ localPath: string; key: string }>,
  options: { concurrency?: number } = {},
): Promise<{ uploaded: number; bytes: number; failed: string[] }> {
  const concurrency = options.concurrency ?? 8;
  const failed: string[] = [];
  let uploaded = 0;
  let bytes = 0;
  let cursor = 0;

  async function worker() {
    for (;;) {
      const index = cursor++;
      const file = files[index];
      if (!file) return;

      try {
        bytes += await uploadFile(file.localPath, file.key);
        uploaded += 1;
      } catch (error) {
        logger.error(
          {
            key: file.key,
            err: error instanceof Error ? error.message : String(error),
          },
          "upload failed",
        );
        failed.push(basename(file.localPath));
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, files.length) }, worker),
  );

  return { uploaded, bytes, failed };
}
