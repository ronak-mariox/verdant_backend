/**
 * Converts a Mongoose document (or plain object) into a plain, JSON-safe object:
 * `_id` becomes a string `id`, `__v` is dropped, and any sensitive fields you name
 * are stripped (e.g. passwordHash, codeHash, tokenHash) before it's ever sent in a
 * response.
 */
export function toSafeJson(
  doc: { toObject?: () => Record<string, unknown> } | Record<string, unknown> | null,
  omit: string[] = [],
): Record<string, unknown> | null {
  if (!doc) return null;
  const plain: Record<string, unknown> =
    typeof (doc as { toObject?: () => Record<string, unknown> }).toObject === 'function'
      ? (doc as { toObject: () => Record<string, unknown> }).toObject()
      : (doc as Record<string, unknown>);

  const { _id, __v, ...rest } = plain;
  void __v;
  for (const key of omit) delete rest[key];

  return { id: String(_id), ...rest };
}

/** Escapes user input so it can be embedded in a `$regex` as a literal string. */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Bare-array list endpoints: optional `?page&limit` slices (limit 1-100, default 50);
 * with neither param the whole list is returned, capped at `cap`. */
export function arrayPagination(query: Record<string, unknown>, cap = 200): { skip: number; limit: number } {
  const hasPaging = query.page !== undefined || query.limit !== undefined;
  if (!hasPaging) return { skip: 0, limit: cap };
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
  return { skip: (page - 1) * limit, limit };
}

export function objectPagination(query: Record<string, unknown>, defaultLimit = 50): { page: number; limit: number; skip: number } {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}
