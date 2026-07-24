import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Attachment upload endpoint. Requires S3-compatible storage (optional
 * infra — MinIO works). Without S3_* configured this reports clearly
 * instead of failing obscurely; the app boots and runs fine without it.
 */
export default function uploadRoute(_req: NextApiRequest, res: NextApiResponse) {
  const configured = Boolean(process.env.S3_ENDPOINT && process.env.S3_BUCKET);
  if (!configured) {
    res.status(501).json({
      error:
        "File storage is not configured. Set S3_ENDPOINT/S3_BUCKET (+ credentials) to enable attachments.",
    });
    return;
  }
  res.status(501).json({
    error: "Direct upload handler not implemented yet — use presigned S3 uploads.",
  });
}
