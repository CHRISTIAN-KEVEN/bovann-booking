/**
 * Formats an XOF amount the way it is written in Togo: "51 000 FCFA".
 * Uses a regular space as thousands separator so output is stable across
 * Node and browser ICU builds (Intl uses a narrow no-break space for fr-FR).
 */
export function formatXof(amount: number): string {
  if (!Number.isInteger(amount)) {
    throw new RangeError(`XOF amounts must be whole numbers, got ${amount}`);
  }
  const sign = amount < 0 ? '−' : '';
  const digits = Math.abs(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${digits} FCFA`;
}

/**
 * Discount percentage of a package versus buying the same slots one by one,
 * rounded to the nearest whole percent. Returns 0 when there is no saving.
 */
export function discountPercent(
  packagePrice: number,
  unitPrice: number,
  slotCount: number,
): number {
  const reference = unitPrice * slotCount;
  if (reference <= 0 || packagePrice >= reference) return 0;
  return Math.round(((reference - packagePrice) / reference) * 100);
}
