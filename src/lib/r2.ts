// R2 image upload helpers for Doodie attachments.
// Each Doodie can have up to MAX_IMAGES images keyed by position.
// Object key format: doodies/{doodie_id}/{position}.{ext}
// MIME type is detected from magic bytes — browser-reported file.type is not trusted.

export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const ALLOWED_MIMES = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

function sniffMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 &&
    bytes[2] === 0x4e && bytes[3] === 0x47
  ) return "image/png";
  // WebP: RIFF at 0-3, WEBP at 8-11
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  return null;
}

export async function validateImageUpload(
  file: File
): Promise<{ error: string | null; mime: string }> {
  if (file.size === 0) return { error: "Empty image upload.", mime: "" };
  if (file.size > MAX_IMAGE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return {
      error: `Image too large: ${mb} MB. Max ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
      mime: "",
    };
  }
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const mime = sniffMime(header);
  if (!mime) return { error: "Unsupported image type. Use JPEG, PNG, or WebP.", mime: "" };
  return { error: null, mime };
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
  file: File,
  mime: string,
): Promise<StoredImage> {
  const key = imageKey(doodieId, position, mime);
  const body = await file.arrayBuffer();
  await bucket.put(key, body, {
    httpMetadata: { contentType: mime },
  });
  return {
    r2_key: key,
    mime_type: mime,
    size_bytes: file.size,
  };
}

export async function deleteImages(
  bucket: R2Bucket,
  keys: readonly string[]
): Promise<void> {
  await Promise.allSettled(keys.map((k) => bucket.delete(k)));
}
