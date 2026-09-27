import {parseAbi} from "viem";
import {toHttp} from "./deployImages";
import {rpc} from "./chain";
import {
  longAuthenticityFromSignals,
  type LongAuthenticity,
} from "@/lib/longAuthenticity";
import {launchedByHodl} from "./launchProvenance";

const tokenUriAbi = parseAbi(["function tokenURI() view returns (string)"]);

const IPFS_GATEWAYS = [
  "https://w3s.link/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://ipfs.io/ipfs/",
];

function ipfsPath(uri: string): string | null {
  const value = uri.trim();
  if (value.startsWith("ipfs://")) {
    return value.slice("ipfs://".length).replace(/^ipfs\//, "");
  }
  const embedded = value.match(/\/ipfs\/([^?#]+)/);
  return embedded ? embedded[1] : null;
}

async function readUriJson(uri: string): Promise<unknown | null> {
  const path = ipfsPath(uri);
  const urls = path
    ? IPFS_GATEWAYS.map((gate) => gate + path)
    : [toHttp(uri) ?? uri];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(6_000),
        headers: {accept: "application/json,*/*"},
      });
      if (res.status === 429) continue;
      if (!res.ok) continue;
      const type = res.headers.get("content-type") ?? "";
      if (type.startsWith("image/")) return null;
      return (await res.json()) as unknown;
    } catch {
      // next gateway
    }
  }
  return null;
}

/**
 * Proven fake → false. Proven Long-app URI → true. Unreachable URI → null
 * so a gateway miss does not hide a real launch.
 */
export async function resolveLongAuthenticity(
  address: string,
): Promise<LongAuthenticity> {
  const denied = longAuthenticityFromSignals({address});
  if (denied === false) return false;

  // A launch hodl made itself and verified on chain. Asked before the URI is
  // fetched: the question that check answers — "did app.long.xyz make this" —
  // is the wrong one for a token we created, and the answer would be no.
  if (await launchedByHodl(address)) {
    return longAuthenticityFromSignals({address, launchedByHodl: true});
  }

  try {
    const uri = await rpc().readContract({
      address: address as `0x${string}`,
      abi: tokenUriAbi,
      functionName: "tokenURI",
    });
    const metadata = await readUriJson(String(uri ?? ""));
    if (metadata == null) return null;
    return longAuthenticityFromSignals({
      address,
      metadata,
      metadataResolved: true,
    });
  } catch {
    return null;
  }
}
