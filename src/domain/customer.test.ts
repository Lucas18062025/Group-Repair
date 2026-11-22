import { describe, expect, it } from "vitest";
import { determineCustomerDeletionAction } from "./customer";

describe("customer domain", () => {
  it("allows permanent physical deletion only when there are zero dependencies (Case A)", () => {
    expect(determineCustomerDeletionAction({ devices: 0, orders: 0, chats: 0, requests: 0 })).toBe("delete");
    expect(determineCustomerDeletionAction({ devices: 0, orders: 0 })).toBe("delete");
  });

  it("mandates safe archiving when customer has devices, orders, chats or requests (Case B)", () => {
    expect(determineCustomerDeletionAction({ devices: 1, orders: 0, chats: 0, requests: 0 })).toBe("archive");
    expect(determineCustomerDeletionAction({ devices: 0, orders: 2, chats: 0, requests: 0 })).toBe("archive");
    expect(determineCustomerDeletionAction({ devices: 0, orders: 0, chats: 1, requests: 0 })).toBe("archive");
    expect(determineCustomerDeletionAction({ devices: 0, orders: 0, chats: 0, requests: 1 })).toBe("archive");
    expect(determineCustomerDeletionAction({ devices: 3, orders: 5, chats: 2, requests: 1 })).toBe("archive");
  });
});
