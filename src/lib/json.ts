/** Normalizes a raw phone input to a bare 10-digit Indian mobile number (strips +91, spaces, dashes). */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}
