/**
 * Navigation policy — deny by default.
 *
 * dodis-browser's URL normalizer is a desktop address bar: it maps bare
 * paths to `file://`, treats loopback as a first-class target, and falls
 * back to a web search. All three are wrong on a server, so the policy is
 * inverted here:
 *
 *  - only http/https survive; `file:`, `data:`, `about:`, `javascript:`
 *    and everything else are denied outright
 *  - the host must match the operator's allowlist (../config.ts)
 *  - the host is then *resolved*, and private, loopback, link-local and
 *    carrier-grade addresses are denied — unless the allowlist entry that
 *    matched was itself a local literal, which is how the dev server at
 *    localhost:3310 stays reachable without opening an SSRF hole
 *
 * That last step is the one that matters: an allowlisted public domain
 * whose DNS answer points at 169.254.169.254 must not become a path to
 * cloud instance metadata.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class NavigationDeniedError extends Error {
  constructor(
    message: string,
    readonly url: string,
  ) {
    super(message);
    this.name = "NavigationDeniedError";
  }
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Host entries the operator can name that are inherently local. */
const LOCAL_HOST_LITERALS = new Set(["localhost", "[::1]", "::1"]);

export interface AllowedHostEntry {
  hostname: string;
  /** null ⇒ any port. */
  port: number | null;
  /** True when this entry names loopback/private space on purpose. */
  local: boolean;
}

function isPrivateIPv4(address: string): boolean {
  const parts = address.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p))) {
    return true; // unparseable ⇒ treat as unsafe
  }
  const [a = 0, b = 0] = parts;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function isPrivateIPv6(address: string): boolean {
  const addr =
    address
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .split("%")[0] ?? "";
  if (addr === "::" || addr === "::1") return true;
  // IPv4-mapped and IPv4-compatible forms defer to the v4 rules.
  const mapped = /^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (mapped?.[1]) return isPrivateIPv4(mapped[1]);
  if (/^f[cd]/.test(addr)) return true; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(addr)) return true; // fe80::/10 link-local
  if (/^ff/.test(addr)) return true; // multicast
  if (addr.startsWith("64:ff9b:")) return true; // NAT64
  return false;
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIPv4(address);
  if (family === 6) return isPrivateIPv6(address);
  return true; // not an IP literal ⇒ unsafe to assume otherwise
}

/**
 * Parse one allowlist entry. Accepts "example.com", "localhost:3310",
 * "127.0.0.1:8080", "[::1]:3310".
 */
export function parseAllowedHost(raw: string): AllowedHostEntry | null {
  const trimmed = raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "");
  if (!trimmed) return null;

  let hostname = trimmed;
  let port: number | null = null;

  const bracketed = /^(\[[0-9a-f:]+\])(?::(\d+))?$/i.exec(trimmed);
  if (bracketed?.[1]) {
    hostname = bracketed[1];
    port = bracketed[2] ? Number(bracketed[2]) : null;
  } else {
    const lastColon = trimmed.lastIndexOf(":");
    if (lastColon > -1) {
      const maybePort = trimmed.slice(lastColon + 1);
      if (/^\d+$/.test(maybePort)) {
        hostname = trimmed.slice(0, lastColon);
        port = Number(maybePort);
      }
    }
  }

  if (!hostname) return null;
  if (port !== null && (port < 1 || port > 65535)) return null;

  const bare = hostname.replace(/^\[|\]$/g, "");
  const local =
    LOCAL_HOST_LITERALS.has(hostname) ||
    hostname.endsWith(".localhost") ||
    (isIP(bare) !== 0 && isPrivateAddress(bare));

  return { hostname, port, local };
}

export function parseAllowedHosts(raws: readonly string[]): AllowedHostEntry[] {
  const out: AllowedHostEntry[] = [];
  for (const raw of raws) {
    const entry = parseAllowedHost(raw);
    if (entry) out.push(entry);
  }
  return out;
}

function hostMatches(entry: AllowedHostEntry, url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  const entryHost = entry.hostname.replace(/^\[|\]$/g, "");
  const urlHost = hostname.replace(/^\[|\]$/g, "");
  const nameOk =
    urlHost === entryHost ||
    (isIP(entryHost) === 0 && urlHost.endsWith(`.${entryHost}`));
  if (!nameOk) return false;
  if (entry.port === null) return true;
  const urlPort = url.port
    ? Number(url.port)
    : url.protocol === "https:"
      ? 443
      : 80;
  return urlPort === entry.port;
}

/**
 * Turn agent-supplied navigation input into a URL object.
 * No search fallback and no filesystem paths — an agent navigates to
 * addresses, it does not use an address bar.
 */
export function parseNavigationTarget(rawUrl: string): URL | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  const candidate = SCHEME_RE.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

export interface NavigationPolicyOptions {
  allowedHosts: readonly AllowedHostEntry[];
  /** Swappable for tests; defaults to a real DNS lookup. */
  resolveHost?(hostname: string): Promise<string[]>;
}

async function defaultResolveHost(hostname: string): Promise<string[]> {
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (isIP(bare) !== 0) return [bare];
  const records = await lookup(bare, { all: true, verbatim: true });
  return records.map((r) => r.address);
}

/**
 * Resolve and authorise a navigation target, or throw.
 * Callers must pass the *destination* URL, never the current page's.
 */
export async function assertNavigable(
  rawUrl: string,
  options: NavigationPolicyOptions,
): Promise<string> {
  const url = parseNavigationTarget(rawUrl);
  if (!url) {
    throw new NavigationDeniedError("not a parseable URL", rawUrl);
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new NavigationDeniedError(
      `protocol ${url.protocol} is not navigable (only http and https are)`,
      rawUrl,
    );
  }
  if (url.username || url.password) {
    throw new NavigationDeniedError(
      "credentials in the URL are not permitted",
      rawUrl,
    );
  }
  if (options.allowedHosts.length === 0) {
    throw new NavigationDeniedError(
      "no hosts are allowlisted — set KR8KAN_BROWSER_ALLOWED_HOSTS",
      rawUrl,
    );
  }

  const entry = options.allowedHosts.find((e) => hostMatches(e, url));
  if (!entry) {
    throw new NavigationDeniedError(
      `host ${url.host} is not in KR8KAN_BROWSER_ALLOWED_HOSTS`,
      rawUrl,
    );
  }

  // An entry that names loopback or private space did so deliberately —
  // that is the dev-server case. Every other entry must resolve public.
  if (entry.local) return url.toString();

  const resolveHost = options.resolveHost ?? defaultResolveHost;
  let addresses: string[];
  try {
    addresses = await resolveHost(url.hostname);
  } catch (err) {
    throw new NavigationDeniedError(
      `could not resolve ${url.hostname}: ${(err as Error).message}`,
      rawUrl,
    );
  }
  if (addresses.length === 0) {
    throw new NavigationDeniedError(
      `${url.hostname} resolved to no addresses`,
      rawUrl,
    );
  }
  const offender = addresses.find((a) => isPrivateAddress(a));
  if (offender) {
    throw new NavigationDeniedError(
      `${url.hostname} resolves to the non-public address ${offender}`,
      rawUrl,
    );
  }
  return url.toString();
}
