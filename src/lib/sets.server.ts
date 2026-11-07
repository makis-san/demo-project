type DecimalLike = { toNumber(): number };

/**
 * Prisma returns Decimal columns as Decimal objects, which cannot be sent
 * through a server function. Every function that returns sets maps them here
 * first. The type changes with the value, so a missed call is a compile error.
 */
export function withNumberWeight<T extends { weight: DecimalLike }>(set: T): Omit<T, "weight"> & { weight: number } {
  return { ...set, weight: set.weight.toNumber() };
}
