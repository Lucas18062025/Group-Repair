export interface CustomerDependencies {
  devices: number;
  orders: number;
  chats?: number;
  requests?: number;
}

export type CustomerDeleteAction = "delete" | "archive";

/**
 * Determines whether a customer can be permanently deleted (Case A: 0 dependencies)
 * or must be safely archived (Case B: has devices, orders, chats or requests).
 */
export function determineCustomerDeletionAction(dependencies: CustomerDependencies): CustomerDeleteAction {
  const total = (dependencies.devices || 0) +
    (dependencies.orders || 0) +
    (dependencies.chats || 0) +
    (dependencies.requests || 0);
  return total > 0 ? "archive" : "delete";
}
