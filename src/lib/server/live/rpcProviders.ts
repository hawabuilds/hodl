import {fallback, http, type HttpTransportConfig, type Transport} from "viem";

/** Public Robinhood mainnet RPC — last-resort fallback only. */
export const PUBLIC_MAINNET_RPC = "https://rpc.mainnet.chain.robinhood.com";

/** Primary HTTP: ALCHEMY_RPC_URL → CHAINSTACK_RPC_URL → public. */
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
