import { describe, expect, it } from "vitest";
import { canTransition } from "./status";

describe("order status transitions", () => {
  it("allows diagnosis after reception", () => {
    expect(canTransition("RECEIVED", "DIAGNOSIS")).toBe(true);
  });

  it("blocks work from reaching repair before approval", () => {
    expect(canTransition("QUOTED", "IN_REPAIR")).toBe(false);
  });

  it("allows approved work to enter repair", () => {
    expect(canTransition("APPROVED", "IN_REPAIR")).toBe(true);
  });
});
