import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "../env";

/**
 * Object storage for recordings.
 *
 * Deliberately plain S3 API so the same code runs against MinIO in
 * development and against Backblaze B2, Hetzner Object Storage, Wasabi, or
 * real S3 in production -- the choice is an env var, not a code change. Egress
 * pricing is the main thing that differs, and it is the main reason not to be
 * locked in.
 */
export const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
});

export async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(
      new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Time-limited direct download link, used for the "download MP4" action.
 *
 * Playback goes through the edge instead, so that authorization is re-checked
 * on every segment rather than once when the page loaded.
 */
export async function presignDownload(
  key: string,
  options: { expiresInSeconds?: number; filename?: string } = {},
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
    ...(options.filename
      ? {
          ResponseContentDisposition: `attachment; filename="${options.filename.replace(/"/g, "")}"`,
        }
      : {}),
  });

  return getSignedUrl(s3, command, {
    expiresIn: options.expiresInSeconds ?? 3600,
  });
}

export async function listObjects(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await s3.send(
      new ListObjectsV2Command({
        Bucket: env.S3_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    for (const object of response.Contents ?? []) {
      if (object.Key) keys.push(object.Key);
    }
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return keys;
}

/** Deletes an entire recording prefix. Used when a recording is removed. */
export async function deletePrefix(prefix: string): Promise<number> {
  const keys = await listObjects(prefix);
  if (keys.length === 0) return 0;

  // The API caps a single delete request at 1000 keys.
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: env.S3_BUCKET,
        Delete: { Objects: batch.map((Key) => ({ Key })) },
      }),
    );
  }

  return keys.length;
}
