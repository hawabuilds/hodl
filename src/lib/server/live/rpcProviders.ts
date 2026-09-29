import {fallback, http, type HttpTransportConfig, type Transport} from "viem";

/** Public Robinhood mainnet RPC — last-resort fallback only. */
export const PUBLIC_MAINNET_RPC = "https://rpc.mainnet.chain.robinhood.com";

/** Primary HTTP: ALCHEMY_RPC_URL → CHAINSTACK_RPC_URL → public. */
/**
 * How often the tape should poll: every two seconds when a private RPC is
 * configured to read the chain head from, otherwise at the indexer's pace.
 *
 * This keyed off ALCHEMY_RPC_URL alone, so dropping Alchemy for Chainstack
 * would have slowed every tape to twelve seconds.
 */
export function tapePollMs(): number {
  const privateRpc = [process.env.ALCHEMY_RPC_URL, process.env.CHAINSTACK_RPC_URL]
    .some((url) => url?.trim().startsWith("https://"));
  return privateRpc ? 2_000 : 12_000;
}

export function httpRpcUrls(): string[] {
  const urls: string[] = [];
  const alchemy = process.env.ALCHEMY_RPC_URL?.trim();
  const chainstack = process.env.CHAINSTACK_RPC_URL?.trim();
  if (alchemy?.startsWith("https://")) urls.push(alchemy);
  if (chainstack?.startsWith("https://")) urls.push(chainstack);
  urls.push(PUBLIC_MAINNET_RPC);
  return urls;
}

/** Primary WSS: ALCHEMY_WSS_URL (or derived from ALCHEMY_RPC_URL) → CHAINSTACK_WSS_URL. */
export function headWsUrls(): string[] {
  const urls: string[] = [];
  const alchemyWss = process.env.ALCHEMY_WSS_URL?.trim();
  if (alchemyWss?.startsWith("wss://")) {
    urls.push(alchemyWss);
  } else {
    const alchemyHttp = process.env.ALCHEMY_RPC_URL?.trim();
    if (alchemyHttp?.startsWith("https://")) {
      urls.push(`wss://${alchemyHttp.slice("https://".length)}`);
    }
  }
  const chainstackWss = process.env.CHAINSTACK_WSS_URL?.trim();
  if (chainstackWss?.startsWith("wss://")) urls.push(chainstackWss);
  return urls;
}

export function isRpcRateLimitError(text: string): boolean {
  return /429|too many requests|rate limit|capacity limit|quota|compute units/i.test(
    text,
  );
}

/**
 * Credentials the endpoint rejected: a key that was rotated, expired or
 * revoked, or a URL that lost its key.
 *
 * This is a failover signal, not a retry signal, and it has to be classified
 * as one. A dead Alchemy key answers `eth_getLogs` with HTTP 401 and the body
 * `Must be authenticated!`, which viem surfaces as `InvalidRequestRpcError`.
 * That text matched none of the log-scan retry rules, so the live tip scan
 * halved its window against the same dead endpoint until it hit the floor and
 * reported the pass incomplete — every minute, for four days — while
 * Chainstack and the public RPC sat untried behind it in the provider list.
 * The cursor never advanced and the feed never gained a row.
 *
 * 403 is deliberately absent: the log scan treats it as a Cloudflare
 * challenge on the public RPC and retries the same provider.
 */
export function isRpcAuthError(text: string): boolean {
  return /\b401\b|must be authenticated|unauthorized|invalid api key|invalid key|api key is required|authentication failed/i.test(
    text,
  );
}

const READ_HTTP_OPTS: HttpTransportConfig = {
  batch: true,
  timeout: 12_000,
  retryCount: 0,
};

/** viem transport for eth_call / multicall — Alchemy first, then Chainstack, then public. */
export function createReadTransport(
  onFetchRequest?: HttpTransportConfig["onFetchRequest"],
): Transport {
  const opts = onFetchRequest
    ? {...READ_HTTP_OPTS, onFetchRequest}
    : READ_HTTP_OPTS;
  const urls = httpRpcUrls();
  if (urls.length === 1) return http(urls[0], opts);
  return fallback(urls.map((url) => http(url, opts)));
}
