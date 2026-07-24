import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Optional S3-compatible attachment storage (AWS, MinIO, R2…). Configured
 * entirely via env; when unset, attachment endpoints respond with an
 * honest "not configured" error instead of pretending.
 */

export function s3Configured(): boolean {
  return Boolean(
    process.env.S3_ENDPOINT &&
      process.env.S3_BUCKET &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY,
  );
}

export const S3_UNCONFIGURED_MESSAGE =
  "Attachment storage is not configured — set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY";

let client: S3Client | null = null;

function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION ?? "us-east-1",
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      },
    });
  }
  return client;
}

const PRESIGN_EXPIRY_S = 15 * 60;

export function presignPut(key: string, contentType: string): Promise<string> {
  return getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: PRESIGN_EXPIRY_S },
  );
}

export function presignGet(key: string, filename: string): Promise<string> {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      ResponseContentDisposition: `inline; filename="${filename.replace(/"/g, "")}"`,
    }),
    { expiresIn: PRESIGN_EXPIRY_S },
  );
}

/** Best-effort object delete — the soft-deleted DB row is authoritative. */
export async function deleteObject(key: string): Promise<void> {
  try {
    await s3().send(
      new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
    );
  } catch {
    // orphaned object; acceptable
  }
}
