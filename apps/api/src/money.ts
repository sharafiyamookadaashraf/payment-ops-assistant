// All supported currencies have two minor-unit digits. Never add JS floats.
export function toMinorUnits(value: string | number): bigint {
  const text = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error("Invalid monetary precision");
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

export function formatMinorUnits(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}

export function sumByCurrency(rows: { currency: string; amount: string | number; status: string }[]) {
  const totals = new Map<string, bigint>();
  for (const row of rows) {
    if (row.status === "SUCCESS") totals.set(row.currency, (totals.get(row.currency) ?? 0n) + toMinorUnits(row.amount));
  }
  return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) => ({ currency, amount: formatMinorUnits(amount) }));
}
