import type {Launchpad} from "@/lib/types";
import {multicallChunked, rpc} from "./chain";
import {getAddress, parseAbi, type Abi} from "viem";

/**
 * Which launchpad a token was actually deployed from.
 *
 * Attribution is read from the token contract, never from its name, its symbol
 * or a third-party listing site. Robinhood Chain has several launchpads running
 * near-identical contracts, and the live universe contains a token whose symbol
 * is PONS but which Pons did not launch — a badge that trusted the symbol would
 * have vouched for it.
 *
 * The two launchpads here identify their tokens differently, so each declares
 * how it is recognised rather than sharing one rule:
 *
 * - Pons writes the factory into the token, which answers `launchFactory()`.
 * - Long deploys minimal proxies over a shared implementation and keeps them
 *   under one manager, so a token is matched on both its proxy target and its
 *   `owner()`.
 *
 * Long needs both halves because either alone is weak. `owner()` is ordinary
 * mutable storage that anyone can point at Long's manager, and the
 * implementation is a public address anyone can deploy their own proxy over.
 * Together they describe a contract that both runs Long's code and answers to
 * Long, which is not something a copy gets by accident.
 */

const factoryAbi = parseAbi(["function launchFactory() view returns (address)"]);

const ownerAbi = parseAbi(["function owner() view returns (address)"]);

/**
 * EIP-1167 minimal proxies, both encodings in circulation. The twenty bytes in
 * the middle are the implementation the proxy delegates to, and they sit in
 * immutable runtime code — a deployed proxy can never be repointed.
 *
 * Both patterns are needed. Long uses the second, and a check written against
 * only the first quietly matched none of its tokens.
 */
const MINIMAL_PROXY = [
  /^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/,
  /^0x3d3d3d3d363d3d37363d73([0-9a-f]{40})5af43d3d93803e602a57fd5bf3$/,
];

function implementationOf(code: string): string | null {
  const low = code.toLowerCase();
  for (const pattern of MINIMAL_PROXY) {
    const match = low.match(pattern);
    if (match) return "0x" + match[1];
  }
  return null;
}

interface LaunchpadSpec {
  id: string;
  name: string;
  /**
   * Brand colour, used only when no logo file is bundled. Both current marks
   * ship as images, so this is a fallback rather than the badge's real colour.
   */
  color: string;
  /** Brand mark bundled under `/public`, or null to draw the initial instead. */
  logoUrl: string | null;
  /**
   * This launchpad's page for one token. Taken from the launchpad's own site
   * rather than guessed, including the address casing each one uses.
   */
  tokenUrl: (address: string) => string;
  /**
   * Factory addresses, lowercased, as returned by `launchFactory()`.
   *
   * One entry per generation — a token deployed from an older factory keeps
   * pointing at it forever, so retiring an address here would silently drop the
   * badge from every token that used it.
   */
  factories?: string[];
  /**
   * Proxy implementation plus manager, both lowercased and both required to
   * match. For launchpads that clone a shared template instead of recording a
   * factory on the token.
   */
  proxy?: {implementation: string; owner: string};
}

/**
 * The launchpads this app can prove a token came from.
 *
 * Adding one means finding its addresses in something the launchpad publishes
 * or serves itself, then checking them against the tokens it lists — never
 * inferring them from a token that merely claims membership.
 */
const LAUNCHPADS: LaunchpadSpec[] = [
  {
    id: "pons",
    name: "Pons",
    color: "#6FA980",
    logoUrl: "/launchpads/pons.jpg",
    // Checksummed: that is the form the launchpad's own sitemap publishes.
    tokenUrl: (address) =>
      `https://www.ponsfamily.com/launchpad/${getAddress(address)}`,
    // The first two are published at github.com/ponsdotdev/ponsfamily: V1 is
    // the CREATE2 factory that opens a locked Uniswap v3 position, V2 the
    // bonding curve that graduates into Uniswap v4.
    //
    // The third is not in that README, and was nearly written off as an
    // impostor. It is real: Pons lists both of its tokens — the platform's own
    // PONS and wire bot — in its sitemap. The README is a partial list, so the
    // launchpad's sitemap is the check that matters when adding an address.
    factories: [
      "0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb",
      "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e",
      "0x0c37a24f5d23a486fa692d1500881d698b1f77a4",
    ],
  },
  {
    id: "long",
    name: "Long",
    color: "#79FF77",
    logoUrl: "/launchpads/long.svg",
    // Lowercased: the form app.long.xyz links to its own token pages with.
    tokenUrl: (address) => `https://app.long.xyz/tokens/${address.toLowerCase()}`,
    // Checked against all 177 tokens listed on app.long.xyz: every one is a
    // minimal proxy over this implementation and answers with this owner.
    proxy: {
      implementation: "0x3be8b97fd0e713b5abe0649fa830223b6b4bc599",
      owner: "0xeb7c034704ef8dcd2d32324c1545f62fb4ad0862",
    },
  },
];

const BY_FACTORY = new Map<string, LaunchpadSpec>(
  LAUNCHPADS.flatMap((pad) =>
    (pad.factories ?? []).map((factory) => [factory, pad] as const),
  ),
);

const BY_OWNER = new Map<string, LaunchpadSpec>(
  LAUNCHPADS.flatMap((pad) =>
    pad.proxy ? [[pad.proxy.owner, pad] as const] : [],
  ),
);

function toLaunchpad(spec: LaunchpadSpec, address: string): Launchpad {
  return {
    id: spec.id,
    name: spec.name,
    color: spec.color,
    logoUrl: spec.logoUrl,
    url: spec.tokenUrl(address),
  };
}

/**
 * Answers already known, keyed by token address.
 *
 * A token's factory and its proxy target are both fixed at deployment, so an
 * answer is good for the life of the process — including `null`, which saves
 * re-asking the majority of the feed that came from no known launchpad.
 */
const known = new Map<string, Launchpad | null>();

/** One `eth_call` across many contracts, failures included as nulls. */
async function readAddresses(
  addresses: string[],
  abi: Abi,
  functionName: string,
): Promise<(string | null | undefined)[]> {
  const results = await multicallChunked<unknown>(
    addresses.map((address) => ({
      address: address as `0x${string}`,
      abi,
      functionName,
    })),
    `launchpads/${functionName}`,
  );

  return results.map((result) =>
    result.status === "success"
      ? String(result.result).toLowerCase()
      : // Undefined where the batch never ran, null where the call reverted.
        // Only the second is an answer worth remembering.
        result.unreachable
        ? undefined
        : null,
  );
}

/**
 * Launchpads for a set of token addresses.
 *
 * Two multicalls for the whole set, then `eth_getCode` only on the handful that
 * named a known manager. Reading code cannot be batched, so it is spent
 * confirming candidates rather than surveying every token in the feed.
 */
export async function launchpadsFor(
  addresses: string[],
): Promise<Map<string, Launchpad>> {
  const out = new Map<string, Launchpad>();
  const wanted: string[] = [];

  for (const raw of addresses) {
    const address = raw.toLowerCase();
    if (known.has(address)) {
      const hit = known.get(address);
      if (hit) out.set(address, hit);
      continue;
    }
    if (!wanted.includes(address)) wanted.push(address);
  }

  if (wanted.length === 0) return out;

  let factories: (string | null | undefined)[];
  let owners: (string | null | undefined)[];
  try {
    [factories, owners] = await Promise.all([
      readAddresses(wanted, factoryAbi, "launchFactory"),
      readAddresses(wanted, ownerAbi, "owner"),
    ]);
  } catch (error) {
    // A failed lookup must not cost the feed its rows. Nothing is cached, so
    // the next request tries again rather than persisting a wrong answer.
    console.error("launchpad lookup failed", error);
    return out;
  }

  const resolved = new Map<string, LaunchpadSpec | null>();
  const candidates: {address: string; spec: LaunchpadSpec}[] = [];

  wanted.forEach((address, i) => {
    const factory = factories[i];
    const byFactory = factory ? BY_FACTORY.get(factory) : undefined;
    if (byFactory) {
      resolved.set(address, byFactory);
      return;
    }

    const owner = owners[i];
    const byOwner = owner ? BY_OWNER.get(owner) : undefined;
    if (byOwner) {
      // Naming the right manager is not enough on its own.
      candidates.push({address, spec: byOwner});
      return;
    }

    // Unreachable on either read means no answer yet; leaving it unresolved
    // keeps it out of the permanent map so the next pass asks again.
    if (factory === undefined || owner === undefined) return;
    resolved.set(address, null);
  });

  await Promise.all(
    candidates.map(async ({address, spec}) => {
      try {
        const code = await rpc().getBytecode({
          address: address as `0x${string}`,
        });
        const implementation = implementationOf(code ?? "0x");
        resolved.set(
          address,
          implementation === spec.proxy?.implementation ? spec : null,
        );
      } catch {
        // Unproven is not the same as disproven: leave it unresolved so the
        // next pass can try again rather than caching a false negative.
      }
    }),
  );

  for (const [address, spec] of resolved) {
    const launchpad = spec ? toLaunchpad(spec, address) : null;
    known.set(address, launchpad);
    if (launchpad) out.set(address, launchpad);
  }

  return out;
}
