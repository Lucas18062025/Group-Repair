import { describe, expect, it } from "vitest";
import { createPublicReference, isValidEmail, isValidPhone, normalizePhone, phonesMatch } from "./assistant";

describe("assistant domain", () => {
  it("normalizes phone numbers for deduplication and matching", () => {
    expect(normalizePhone("+54 9 381 524-9553")).toBe("5493815249553");
    expect(phonesMatch("+54 9 381 524-9553", "5493815249553")).toBe(true);
    expect(phonesMatch("3815249553", "3815249553")).toBe(true);
    expect(phonesMatch("+54 9 381 524-9553", "3815249553")).toBe(true);
    expect(phonesMatch("03815249553", "+54 9 381 524 9553")).toBe(true);
    expect(phonesMatch("3815249553", "3815249554")).toBe(false);
    expect(phonesMatch("12345678", "87654321")).toBe(false);
    expect(phonesMatch(null, "3815249553")).toBe(false);
    expect(phonesMatch("3815249553", undefined)).toBe(false);
    expect(phonesMatch("", "")).toBe(false);
  });

  it("rejects malformed contact data", () => {
    expect(isValidPhone("123")).toBe(false);
    expect(isValidPhone("12345")).toBe(false);
    expect(isValidPhone("381 524 9553")).toBe(true);
    expect(isValidPhone("+54 9 381 524-9553")).toBe(true);
    expect(isValidPhone("1".repeat(21))).toBe(false);
    expect(isValidEmail("cliente@example.com")).toBe(true);
    expect(isValidEmail("cliente@example")).toBe(false);
    expect(isValidEmail("invalid email@test.com")).toBe(false);
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("a".repeat(175) + "@test.com")).toBe(false);
  });

  it("creates non-sequential public references resistant to enumeration and collisions", () => {
    const date = new Date("2026-11-22T12:00:00.000Z");
    const first = createPublicReference("SA", date);
    const second = createPublicReference("SA", date);
    expect(first).toMatch(/^SA-261122-[A-Z2-9]{4}$/);
    expect(second).toMatch(/^SA-261122-[A-Z2-9]{4}$/);
    expect(first).not.toBe(second);

    const generated = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      generated.add(createPublicReference("SA", date));
    }
    expect(generated.size).toBe(50);
  });
});
