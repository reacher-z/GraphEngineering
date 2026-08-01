/**
 * Unicode code-point ordering. The contract orders capabilities, hosts,
 * environment names, provider metrics, usage resources and provider-safe detail
 * fields by code point so that two runtimes in two languages produce the same
 * canonical document.
 */

export function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  const common = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < common; index += 1) {
    const a = leftPoints[index] as number;
    const b = rightPoints[index] as number;
    if (a !== b) return a - b;
  }
  return leftPoints.length - rightPoints.length;
}

/** Strictly ascending: equal neighbours are a duplicate, not an order. */
export function isSortedByCodePoint(values: readonly string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1] as string;
    const current = values[index] as string;
    if (compareUnicodeCodePoints(previous, current) >= 0) return false;
  }
  return true;
}

export function sortByCodePoint(values: readonly string[]): string[] {
  return [...values].sort(compareUnicodeCodePoints);
}
