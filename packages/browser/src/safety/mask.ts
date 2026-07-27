/**
 * The `mask` effect, implemented.
 *
 * dodis-browser declares `mask` in the effect union and ranks it between
 * `allow` and `confirm`, but the dispatcher's mask branch is empty with a
 * comment deferring redaction to the caller. Nothing downstream ever did
 * it. Here it is real: when the gate returns `mask`, page-derived text
 * passes through `maskPageText` before it leaves the package.
 *
 * Masking runs on top of `redactSecrets` from @kr8kan/shared, so the
 * browser and the Pi runner agree on what a secret looks like.
 */

import { redactSecrets } from "@kr8kan/shared";

const EMAIL_RE = /\b[\w.%+-]+@[\w.-]+\.[a-z]{2,}\b/gi;
// Card-shaped digit runs, optionally grouped. Deliberately loose — a false
// positive costs a masked number, a false negative leaks a card.
const CARD_RE = /\b(?:\d[ -]?){13,19}\b/g;
const US_SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
// Long opaque runs: JWTs, session ids, API keys that redactSecrets misses
// because they are not preceded by a recognisable label.
const OPAQUE_TOKEN_RE = /\b[A-Za-z0-9_-]{32,}\b/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

/** Query-string keys whose values are masked wherever a URL appears. */
const SENSITIVE_QUERY_KEYS = new Set([
  "access_token",
  "api_key",
  "apikey",
  "auth",
  "code",
  "id_token",
  "key",
  "password",
  "refresh_token",
  "secret",
  "session",
  "sig",
  "signature",
  "token",
]);

export function maskPageText(text: string): string {
  return redactSecrets(text)
    .replace(JWT_RE, "[redacted-jwt]")
    .replace(EMAIL_RE, "[redacted-email]")
    .replace(US_SSN_RE, "[redacted-ssn]")
    .replace(CARD_RE, (match) => {
      const digits = match.replace(/\D/g, "");
      return digits.length >= 13 && digits.length <= 19
        ? "[redacted-card]"
        : match;
    })
    .replace(OPAQUE_TOKEN_RE, "[redacted-token]");
}

/** Mask sensitive query values while keeping the URL readable. */
export function maskUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return maskPageText(rawUrl);
  }
  if (url.username || url.password) {
    url.username = "";
    url.password = "";
  }
  for (const key of [...url.searchParams.keys()]) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
      url.searchParams.set(key, "[redacted]");
    }
  }
  return url.toString();
}

/**
 * Values an agent typed into a page never travel back out in clear text —
 * not in a result envelope, not in a confirm summary a human will read.
 */
export function maskInputValue(value: string): string {
  if (!value) return value;
  return `[${value.length} chars]`;
}

export interface MaskableCapture {
  text?: string;
  urls?: string[];
}

export function maskCapture(capture: MaskableCapture): MaskableCapture {
  return {
    text: capture.text === undefined ? undefined : maskPageText(capture.text),
    urls: capture.urls?.map(maskUrl),
  };
}
