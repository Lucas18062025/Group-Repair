export const WORKSHOP_TIMEZONE = "America/Argentina/Buenos_Aires";

/**
 * Returns a 'YYYY-MM-DDTHH:mm' string formatted in the workshop timezone (America/Argentina/Buenos_Aires).
 * Suitable for <input type="datetime-local" /> default values.
 */
export function formatDateTimeLocal(date: Date = new Date(), timeZone: string = WORKSHOP_TIMEZONE): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
}

/**
 * Converts a datetime-local input value (e.g. '2026-11-22T18:30') or an ISO string
 * into a strict ISO UTC string (e.g. '2026-11-22T21:30:00.000Z') according to workshop timezone.
 */
export function parseDateTimeLocalToUtcIso(value: string | null | undefined, timeZone: string = WORKSHOP_TIMEZONE): string {
  if (!value || !value.trim()) {
    return new Date().toISOString();
  }
  const trimmed = value.trim();
  if (trimmed.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    const [, year, month, day, hour, min, sec] = match;
    // America/Argentina/Buenos_Aires is UTC-3 year-round (no DST)
    const isoWithOffset = `${year}-${month}-${day}T${hour}:${min}:${sec ?? "00"}-03:00`;
    const d = new Date(isoWithOffset);
    if (!isNaN(d.getTime())) {
      return d.toISOString();
    }
  }
  const fallback = new Date(trimmed);
  return isNaN(fallback.getTime()) ? new Date().toISOString() : fallback.toISOString();
}

/**
 * Formats an ISO UTC date string into displayable Argentine local date string (DD/MM/YYYY).
 */
export function formatDateDisplay(dateStr: string | null | undefined, timeZone: string = WORKSHOP_TIMEZONE): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat("es-AR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(d);
}

/**
 * Formats an ISO UTC date string into displayable Argentine local datetime string (DD/MM/YYYY, HH:mm).
 */
export function formatDateTimeDisplay(dateStr: string | null | undefined, timeZone: string = WORKSHOP_TIMEZONE): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat("es-AR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(d);
}
