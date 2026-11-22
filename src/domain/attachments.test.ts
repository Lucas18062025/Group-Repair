import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_CATEGORIES,
  CATEGORY_LABELS,
  generateR2StorageKey,
  isValidCategory,
  MAX_PHOTO_SIZE_BYTES,
  sanitizeFileName,
  validateImageSignature
} from "./attachments";

describe("attachments domain", () => {
  it("defines the 7 required technical categories with user-friendly labels", () => {
    expect(ATTACHMENT_CATEGORIES).toEqual([
      "RECEPCION",
      "ESTADO_FISICO",
      "DIAGNOSTICO",
      "PROCESO",
      "REPARACION",
      "ENTREGA",
      "OTROS"
    ]);
    expect(CATEGORY_LABELS.RECEPCION).toBe("Recepción");
    expect(CATEGORY_LABELS.ESTADO_FISICO).toBe("Estado físico");
    expect(CATEGORY_LABELS.DIAGNOSTICO).toBe("Diagnóstico");
    expect(isValidCategory("DIAGNOSTICO")).toBe(true);
    expect(isValidCategory("INVALID_CATEGORY")).toBe(false);
  });

  it("validates JPEG, PNG and WebP magic numbers while rejecting spoofed files", () => {
    // Valid JPEG
    const jpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
    expect(validateImageSignature(jpeg)).toEqual({ valid: true, detectedMime: "image/jpeg" });

    // Valid PNG
    const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);
    expect(validateImageSignature(png)).toEqual({ valid: true, detectedMime: "image/png" });

    // Valid WebP
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x20, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50  // WEBP
    ]);
    expect(validateImageSignature(webp)).toEqual({ valid: true, detectedMime: "image/webp" });

    // Invalid executable / HTML / SVG masquerading as image
    const fakeHtml = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    expect(validateImageSignature(fakeHtml)).toEqual({ valid: false });

    // Truncated header
    expect(validateImageSignature(new Uint8Array([0xFF, 0xD8]))).toEqual({ valid: false });
  });

  it("sanitizes filenames preventing path traversal", () => {
    expect(sanitizeFileName("../../../etc/passwd")).toBe(".._.._.._etc_passwd");
    expect(sanitizeFileName("foto equipo (1) & reparación.jpg")).toBe("foto_equipo__1____reparaci_n.jpg");
    expect(sanitizeFileName("")).toBe("archivo");
  });

  it("builds structured, unguessable R2 storage keys", () => {
    const key = generateR2StorageKey("workshop-main", "ord-123", "rand-456", "evidencia.jpg");
    expect(key).toBe("workshops/workshop-main/orders/ord-123/evidence/rand-456_evidencia.jpg");
  });

  it("enforces maximum photo size boundary of 15MB", () => {
    expect(MAX_PHOTO_SIZE_BYTES).toBe(15728640);
  });
});
