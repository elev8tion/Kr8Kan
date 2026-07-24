import { randomBytes } from "node:crypto";

/** Unambiguous lowercase alphanumerics (no 0/o/1/l). */
const ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";

/**
 * 12-char public identifier used in URLs and the REST API.
 * Internal serial ids never leave the database layer.
 */
export function generateUID(length = 12): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

export function isValidUID(value: string, length = 12): boolean {
  if (value.length !== length) return false;
  for (const ch of value) {
    if (!ALPHABET.includes(ch)) return false;
  }
  return true;
}
