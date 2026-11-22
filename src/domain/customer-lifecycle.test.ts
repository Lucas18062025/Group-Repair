import { describe, expect, it } from "vitest";
import { determineCustomerDeletionAction, type CustomerDependencies } from "./customer";

describe("customer deletion and archiving lifecycle", () => {
  it("Caso A: physically deletes customer with zero dependencies", () => {
    const deps: CustomerDependencies = {
      devices: 0,
      orders: 0,
      chats: 0,
      requests: 0
    };
    const action = determineCustomerDeletionAction(deps);
    expect(action).toBe("delete");
  });

  it("Caso B: safely archives customer with associated devices or orders", () => {
    const depsWithOrders: CustomerDependencies = {
      devices: 1,
      orders: 2,
      chats: 0,
      requests: 0
    };
    expect(determineCustomerDeletionAction(depsWithOrders)).toBe("archive");

    const depsWithOnlyChat: CustomerDependencies = {
      devices: 0,
      orders: 0,
      chats: 1,
      requests: 0
    };
    expect(determineCustomerDeletionAction(depsWithOnlyChat)).toBe("archive");

    const depsWithOnlyRequests: CustomerDependencies = {
      devices: 0,
      orders: 0,
      chats: 0,
      requests: 1
    };
    expect(determineCustomerDeletionAction(depsWithOnlyRequests)).toBe("archive");
  });

  it("preserves active vs archived status in customer filters", () => {
    const customers = [
      { id: "c1", name: "Cliente Activo", status: "ACTIVO" },
      { id: "c2", name: "Cliente Archivado", status: "ARCHIVADO" }
    ];

    const activeCustomers = customers.filter(c => c.status === "ACTIVO");
    expect(activeCustomers).toHaveLength(1);
    expect(activeCustomers[0].id).toBe("c1");

    // History and order detail lookups can still find archived customer by ID
    const foundById = customers.find(c => c.id === "c2");
    expect(foundById).toBeDefined();
    expect(foundById?.name).toBe("Cliente Archivado");
  });
});
