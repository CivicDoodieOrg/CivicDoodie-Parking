// R2 image upload helpers for Doodie attachments.
// Each Doodie can have up to MAX_IMAGES images keyed by position.
// Object key format: doodies/{doodie_id}/{position}.{ext}
// MIME and size are revalidated server-side; client claims are not trusted.

export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const ALLOWED_MIMES = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export function validateImageUpload(file: File): string | null {
  if (file.size === 0) return "Empty image upload.";
  if (file.size > MAX_IMAGE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return `Image too large: ${mb} MB. Max ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`;
  }
  if (!ALLOWED_MIMES.has(file.type)) {
    return `Unsupported image type "${file.type}". Use JPEG, PNG, or WebP.`;
  }
  return null;
}

export function imageKey(doodieId: string, position: number, mime: string): string {
  const ext = ALLOWED_MIMES.get(mime) ?? "bin";
  return `doodies/${doodieId}/${position}.${ext}`;
}

export interface StoredImage {
  r2_key: string;
  mime_type: string;
  size_bytes: number;
}

export async function storeImage(
  bucket: R2Bucket,
  doodieId: string,
  position: number,
  file: File
): Promise<StoredImage> {
  const key = imageKey(doodieId, position, file.type);
  const body = await file.arrayBuffer();
  await bucket.put(key, body, {
    httpMetadata: { contentType: file.type },
  });
  return {
    r2_key: key,
    mime_type: file.type,
    size_bytes: file.size,
  };
}

// Deletes all images for a Doodie. Used on Doodie deletion. Best-effort —
// errors don't block the DB delete; orphan objects are cheap and a future
// janitor can sweep.
export async function deleteImages(
  bucket: R2Bucket,
  keys: readonly string[]
): Promise<void> {
  await Promise.allSettled(keys.map((k) => bucket.delete(k)));
}
