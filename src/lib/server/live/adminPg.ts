/**
 * Shared admin Postgres (DATABASE_URL) for the worker and scripts.
 * Do not log DATABASE_URL.
 *
 * Railway (and many containers) have no IPv6 route. Supabase's direct
 * `db.*.supabase.co` host is IPv6-only, which surfaces as
 * `connect ENETUNREACH <aaaa>:5432`. Resolve A records and connect by IPv4;
 * keep the original hostname as TLS SNI.
 *
 * Supabase passwords often contain `/`, `@`, or `#`. `new URL()` treats those
 * as path / authority / fragment, so this file splits userinfo by hand and
 * hands `pg` discrete fields instead of a reconstructed URI.
 */
import dns from "node:dns";
import {lookup as dnsLookup} from "node:dns/promises";
import net from "node:net";
import type pg from "pg";

dns.setDefaultResultOrder("ipv4first");

export type AdminPgConfig = pg.ClientConfig & {
  connectionString: string;
};

type PgParts = {
  user: string;
  password: string;
  host: string;
  port: string;
  database: string;
  search: string;
};

function stripWrappingQuotes(raw: string): string {
  let trimmed = raw.trim().replace(/^\uFEFF/, "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function invalidDatabaseUrl(): Error {
  return new Error(
    "DATABASE_URL is not a valid postgres:// URL. Percent-encode reserved characters in the password (/ → %2F, @ → %40, # → %23).",
  );
}

function decodePart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function looksLikeAuthorityHost(after: string): boolean {
  if (!after) return false;
  if (after.startsWith("[")) return after.includes("]");
  const head = after.split(/[/?#]/, 1)[0] ?? "";
  if (!head) return false;
  const colon = head.lastIndexOf(":");
  const host = colon === -1 ? head : /^\d+$/.test(head.slice(colon + 1)) ? head.slice(0, colon) : head;
  if (!host) return false;
  if (host === "localhost" || net.isIPv4(host) || net.isIPv6(host)) return true;
  return /^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host);
}

function parsePathAndSearch(rest: string): Pick<PgParts, "database" | "search"> {
  let database = "";
  let search = "";
  let body = rest;
  if (body.startsWith("/")) {
    const end = body.search(/[?#]/);
    const path = end === -1 ? body.slice(1) : body.slice(1, end);
    database = decodePart(path.replace(/\/+$/, ""));
    body = end === -1 ? "" : body.slice(end);
  }
  if (body.startsWith("?")) {
    const hash = body.indexOf("#");
    search = hash === -1 ? body : body.slice(0, hash);
  }
  return {database, search};
}

function parseHostPart(hostpart: string): Omit<PgParts, "user" | "password"> {
  if (hostpart.startsWith("[")) {
    const end = hostpart.indexOf("]");
    if (end === -1) throw invalidDatabaseUrl();
    const host = hostpart.slice(1, end);
    let rest = hostpart.slice(end + 1);
    let port = "";
    const portMatch = rest.match(/^:(\d+)/);
    if (portMatch) {
      port = portMatch[1] ?? "";
      rest = rest.slice(portMatch[0].length);
    }
    if (!host) throw invalidDatabaseUrl();
    return {host, port, ...parsePathAndSearch(rest)};
  }

  const match = hostpart.match(/^([^/?#:]+)(?::(\d+))?/);
  if (!match?.[1]) throw invalidDatabaseUrl();
  return {
    host: match[1],
    port: match[2] ?? "",
    ...parsePathAndSearch(hostpart.slice(match[0].length)),
  };
}

function parseUserinfo(userinfo: string): Pick<PgParts, "user" | "password"> {
  if (!userinfo) return {user: "", password: ""};
  const colon = userinfo.indexOf(":");
  if (colon === -1) return {user: decodePart(userinfo), password: ""};
  return {
    user: decodePart(userinfo.slice(0, colon)),
    password: decodePart(userinfo.slice(colon + 1)),
  };
}

function parsePostgresUri(trimmed: string): PgParts {
  const scheme = trimmed.match(/^(postgres(?:ql)?):\/\//i);
  if (!scheme) throw invalidDatabaseUrl();

  const rest = trimmed.slice(scheme[0].length);
  let split = -1;
  for (let i = rest.length - 1; i >= 0; i--) {
    if (rest[i] !== "@") continue;
    if (looksLikeAuthorityHost(rest.slice(i + 1))) {
      split = i;
      break;
    }
  }
  if (split === -1) split = rest.lastIndexOf("@");

  const userinfo = split === -1 ? "" : rest.slice(0, split);
  const hostpart = split === -1 ? rest : rest.slice(split + 1);
  const hostBits = parseHostPart(hostpart);
  if (!hostBits.host) throw invalidDatabaseUrl();
  return {...parseUserinfo(userinfo), ...hostBits};
}

function parseKeywordValue(trimmed: string): PgParts {
  const parts: PgParts = {user: "", password: "", host: "", port: "", database: "", search: ""};
  const extras: string[] = [];
  const re = /([A-Za-z_]+)\s*=\s*(?:'([^']*)'|"([^"]*)"|(\S+))/g;
  for (const match of trimmed.matchAll(re)) {
    const key = match[1]?.toLowerCase() ?? "";
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    switch (key) {
      case "host":
      case "hostaddr":
        parts.host = value;
        break;
      case "port":
        parts.port = value;
        break;
      case "user":
      case "username":
        parts.user = value;
        break;
      case "password":
        parts.password = value;
        break;
      case "dbname":
      case "database":
        parts.database = value;
        break;
      default:
        extras.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }
  if (!parts.host) throw invalidDatabaseUrl();
  if (extras.length) parts.search = `?${extras.join("&")}`;
  return parts;
}

function parseAdminParts(raw: string): PgParts {
  const trimmed = stripWrappingQuotes(raw);
  if (!trimmed) throw new Error("DATABASE_URL is not set (direct Postgres, port 5432)");
  if (/^(postgres(?:ql)?):\/\//i.test(trimmed)) return parsePostgresUri(trimmed);
  if (/^(?:host|hostaddr|dbname|database|user|username|password|port)\s*=/i.test(trimmed)) {
    return parseKeywordValue(trimmed);
  }
  throw invalidDatabaseUrl();
}

function buildAdminPgUrl(parts: PgParts): URL {
  const url = new URL("postgresql://localhost/postgres");
  url.hostname = parts.host;
  url.port = parts.port;
  url.username = parts.user;
  url.password = parts.password;
  url.pathname = parts.database ? `/${parts.database}` : "/";
  url.search = parts.search;
  if (!/^postgres(?:ql)?:$/i.test(url.protocol)) throw invalidDatabaseUrl();
  return url;
}

function toClientConfig(parts: PgParts, ssl?: pg.ClientConfig["ssl"]): AdminPgConfig {
  const url = buildAdminPgUrl(parts);
  return {
    connectionString: url.href,
    host: parts.host,
    port: parts.port ? Number(parts.port) : undefined,
    user: parts.user || undefined,
    password: parts.password || undefined,
    database: parts.database || undefined,
    ssl,
  };
}

/**
 * `new URL()` rejects common Supabase passwords that contain `/` or `#`
 * unless those characters are already percent-encoded. Split on the last `@`
 * that is followed by a host so the password never becomes a port / path / fragment.
 */
export function toAdminPgUrl(raw: string): URL {
  return buildAdminPgUrl(parseAdminParts(raw));
}

export function parseAdminDatabaseUrl(raw: string): string {
  return toAdminPgUrl(raw).href;
}

function isNoIpv4(error: unknown): boolean {
  const code =
    error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return (
    code === "ENOTFOUND" ||
    code === "ENODATA" ||
    code === "EAI_ADDRFAMILY" ||
    code === "ENETUNREACH"
  );
}

export function ipv6UnreachableError(host: string): Error {
  return new Error(
    `Postgres host ${host} is IPv6-only and this runtime has no IPv6 route. ` +
      "Point DATABASE_URL at the Supabase session pooler (*.pooler.supabase.com, port 5432), not db.*.supabase.co.",
  );
}

export async function resolveIpv4Address(host: string): Promise<string> {
  if (net.isIPv4(host) || host === "localhost") return host;
  if (net.isIPv6(host)) throw ipv6UnreachableError(host);
  try {
    const {address} = await dnsLookup(host, {family: 4});
    return address;
  } catch (error) {
    if (isNoIpv4(error)) throw ipv6UnreachableError(host);
    throw error;
  }
}

export async function adminPgConfig(
  raw = process.env.DATABASE_URL ?? "",
  lookup: (host: string) => Promise<string> = resolveIpv4Address,
): Promise<AdminPgConfig> {
  const parts = parseAdminParts(raw);
  const host = parts.host;
  const local = /localhost|127\.0\.0\.1/i.test(host);

  if (local || net.isIPv4(host)) {
    return toClientConfig(parts, local ? undefined : {rejectUnauthorized: false});
  }
  if (net.isIPv6(host)) throw ipv6UnreachableError(host);

  let address: string;
  try {
    address = await lookup(host);
  } catch (error) {
    if (isNoIpv4(error)) throw ipv6UnreachableError(host);
    throw error;
  }
  if (address === host) {
    return toClientConfig(parts, {rejectUnauthorized: false, servername: host});
  }

  return toClientConfig(
    {...parts, host: address},
    {rejectUnauthorized: false, servername: host},
  );
}
