import { describe, expect, it } from "vitest";
import {
  formatDateDisplay,
  formatDateTimeDisplay,
  formatDateTimeLocal,
  parseDateTimeLocalToUtcIso,
  WORKSHOP_TIMEZONE
} from "./dates";

describe("dates domain", () => {
  it("uses America/Argentina/Buenos_Aires as workshop timezone", () => {
    expect(WORKSHOP_TIMEZONE).toBe("America/Argentina/Buenos_Aires");
  });

  it("formats dates into datetime-local in Argentine timezone avoiding UTC shift errors", () => {
    // 2026-11-23T01:30:00.000Z is 2026-11-22 22:30 in Argentina (UTC-3)
    const lateNightUtc = new Date("2026-11-23T01:30:00.000Z");
    expect(formatDateTimeLocal(lateNightUtc)).toBe("2026-11-22T22:30");
    expect(formatDateDisplay(lateNightUtc.toISOString())).toBe("22/11/2026");

    // 2026-11-22T02:00:00.000Z is 2026-11-21 23:00 in Argentina (UTC-3)
    const previousDayNightUtc = new Date("2026-11-22T02:00:00.000Z");
    expect(formatDateTimeLocal(previousDayNightUtc)).toBe("2026-11-21T23:00");
    expect(formatDateDisplay(previousDayNightUtc.toISOString())).toBe("21/11/2026");

    // Specific examples requested by user
    const date1 = new Date("2026-11-22T15:00:00.000Z"); // 12:00 in AR
    expect(formatDateDisplay(date1.toISOString())).toBe("22/11/2026");

    const date2 = new Date("2026-11-29T15:00:00.000Z"); // 12:00 in AR
    expect(formatDateDisplay(date2.toISOString())).toBe("29/11/2026");

    const date3 = new Date("2026-12-06T15:00:00.000Z"); // 12:00 in AR
    expect(formatDateDisplay(date3.toISOString())).toBe("06/12/2026");
  });

  it("parses datetime-local input strings to UTC ISO with Argentina offset", () => {
    // 2026-11-22 18:30 in Argentina is 2026-11-22 21:30:00 UTC
    const parsed = parseDateTimeLocalToUtcIso("2026-11-22T18:30");
    expect(parsed).toBe("2026-11-22T21:30:00.000Z");

    // Re-converting to local preserves the exact input time
    expect(formatDateTimeLocal(new Date(parsed))).toBe("2026-11-22T18:30");
    expect(formatDateDisplay(parsed)).toBe("22/11/2026");
  });

  it("handles empty or already formatted ISO values safely", () => {
    const directIso = "2026-11-22T14:00:00.000Z";
    expect(parseDateTimeLocalToUtcIso(directIso)).toBe(directIso);

    const empty = parseDateTimeLocalToUtcIso("");
    expect(empty).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
