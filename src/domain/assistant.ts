const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

export function isValidPhone(value: string): boolean {
  const digits = normalizePhone(value);
  return digits.length >= 6 && digits.length <= 20;
}

export function isValidEmail(value: string): boolean {
  return value.length <= 180 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function phonesMatch(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  const leftDigits = normalizePhone(left);
  const rightDigits = normalizePhone(right);
  if (leftDigits.length === 0 || rightDigits.length === 0) return false;
  if (leftDigits === rightDigits) return true;
  const minLen = Math.min(leftDigits.length, rightDigits.length);
  if (minLen >= 8 && (leftDigits.endsWith(rightDigits) || rightDigits.endsWith(leftDigits))) {
    return true;
  }
  if (leftDigits.length >= 10 && rightDigits.length >= 10 && leftDigits.slice(-10) === rightDigits.slice(-10)) {
    return true;
  }
  return false;
}

export function createPublicReference(prefix: string, date: Date = new Date()): string {
  const year = String(date.getUTCFullYear()).slice(2);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const suffix = Array.from(bytes, (byte) => REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length]).join("");
  return `${prefix}-${year}${month}${day}-${suffix}`;
}
