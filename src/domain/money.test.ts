import { describe, expect, it } from "vitest";
import { calculateLineTotal } from "./money";

describe("minor-unit money", () => {
  it("calculates an exact integer line total", () => {
    expect(calculateLineTotal(3, 12550)).toBe(37650);
  });

  it("rejects negative prices", () => {
    expect(() => calculateLineTotal(1, -1)).toThrow("Precio inválido");
  });
});
