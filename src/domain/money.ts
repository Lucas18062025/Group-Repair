export function calculateLineTotal(quantity: number, unitPriceMinor: number): number {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error("Cantidad inválida");
  }
  if (!Number.isSafeInteger(unitPriceMinor) || unitPriceMinor < 0) {
    throw new Error("Precio inválido");
  }
  const total = quantity * unitPriceMinor;
  if (!Number.isSafeInteger(total)) {
    throw new Error("El total excede el rango admitido");
  }
  return total;
}

export function formatMinor(amountMinor: number, currency = "ARS"): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency
  }).format(amountMinor / 100);
}
