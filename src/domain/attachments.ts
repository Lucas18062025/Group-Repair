export const ATTACHMENT_CATEGORIES = [
  "RECEPCION",
  "ESTADO_FISICO",
  "DIAGNOSTICO",
  "PROCESO",
  "REPARACION",
  "ENTREGA",
  "OTROS"
] as const;

export type AttachmentCategory = typeof ATTACHMENT_CATEGORIES[number];

export const CATEGORY_LABELS: Record<AttachmentCategory, string> = {
  RECEPCION: "Recepción",
  ESTADO_FISICO: "Estado físico",
  DIAGNOSTICO: "Diagnóstico",
  PROCESO: "Proceso",
  REPARACION: "Reparación",
  ENTREGA: "Entrega",
  OTROS: "Otros"
};

export const ALLOWED_PHOTO_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedPhotoMime = typeof ALLOWED_PHOTO_MIMES[number];

export const MAX_PHOTO_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * Validates file signature (magic numbers) to prevent MIME spoofing.
 */
export function validateImageSignature(bytes: Uint8Array): { valid: boolean; detectedMime?: AllowedPhotoMime } {
  if (bytes.length < 12) return { valid: false };

  // JPEG: FF D8 FF
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return { valid: true, detectedMime: "image/jpeg" };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 &&
    bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A
  ) {
    return { valid: true, detectedMime: "image/png" };
  }

  // WebP: RIFF ... WEBP
  // bytes 0-3: 52 49 46 46 ("RIFF")
  // bytes 8-11: 57 45 42 50 ("WEBP")
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { valid: true, detectedMime: "image/webp" };
  }

  return { valid: false };
}

/**
 * Sanitizes original filename to prevent path traversal and script injection.
 */
export function sanitizeFileName(name: string): string {
  const base = name.replace(/[/\\]/g, "_").trim();
  const clean = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  return clean.slice(0, 120) || "archivo";
}

/**
 * Generates an unpredictable, scoped R2 storage key.
 */
export function generateR2StorageKey(workshopId: string, orderId: string, randomId: string, safeName: string): string {
  return `workshops/${workshopId}/orders/${orderId}/evidence/${randomId}_${safeName}`;
}

export function isValidCategory(category: unknown): category is AttachmentCategory {
  return typeof category === "string" && (ATTACHMENT_CATEGORIES as readonly string[]).includes(category);
}
