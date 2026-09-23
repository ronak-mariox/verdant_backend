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
