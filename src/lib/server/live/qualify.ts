import {parseAbi} from "viem";
import {PONS_FACTORY_ADDRESSES, QUOTE_USDG, QUOTE_WETH} from "@/lib/contracts";
import {isAddress, normalizeAddress} from "@/lib/address";
import {isListed, qualifiesForUniverse, quoteKindFor, statusFor} from "@/lib/universe";
import {RWA_BY_ADDRESS} from "./robinhood";
import {launchpadsFor} from "./launchpads";
import {resolveLongAuthenticity} from "./longAuthenticity";
import {rpc, erc20Abi} from "./chain";
import {db, hasDatabase} from "../db";
import {commitListedWithPrice} from "./onchainPrice";
import {getTokenRow, upsertTokens, rowToAsset, type TokenWrite} from "./universeStore";

const ponsLaunchAbi = parseAbi([
  "function getLaunchedToken(address) view returns ((address token,address curve,address deployer,address creatorFeeRecipient,address pairToken,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,uint16 creatorTaxBps,bool buybackEnabled,uint8 phase,uint256 sweptQuote,uint256 sweptTokens,uint256 sweptAt,bool exists))",
]);
const longAssetAbi = parseAbi([
  "function getAssetData(address) view returns (address numeraire,address timelock,address governance,address liquidityMigrator,address poolInitializer,address pool)",
]);
const LONG_AIRLOCK = "0xeb7c034704ef8dcd2d32324c1545f62fb4ad0862" as const;

export type QualifyResult =
  | {status: "listed"; inserted: boolean; address: string}
  | {status: "ineligible"}
  | {status: "not_found"};

/**
 * Live universe test for an address that is not yet in Supabase.
 * The only writer besides the indexer.
 */
export async function qualifyAndInsert(address: string): Promise<QualifyResult> {
  const wanted = normalizeAddress(address);
  if (!isAddress(wanted)) return {status: "not_found"};

  const pads = await launchpadsFor([wanted]);
  const pad = pads.get(wanted);
  if (!pad || (pad.id !== "pons" && pad.id !== "long")) {
    return {status: "ineligible"};
  }

  let quoteToken: string | null = null;
  let bonded = pad.id === "long";
  let creator: string | null = null;

  if (pad.id === "pons") {
    const factory = [...PONS_FACTORY_ADDRESSES][0];
    try {
      const launch = await rpc().readContract({
        address: factory,
        abi: ponsLaunchAbi,
        functionName: "getLaunchedToken",
        args: [wanted as `0x${string}`],
      });
      if (launch?.exists) {
        quoteToken = normalizeAddress(String(launch.pairToken));
        bonded = Number(launch.phase) >= 2;
        creator = normalizeAddress(String(launch.deployer));
      }
    } catch {
      // factory miss
    }
  } else {
    try {
      const data = await rpc().readContract({
        address: LONG_AIRLOCK,
        abi: longAssetAbi,
        functionName: "getAssetData",
        args: [wanted as `0x${string}`],
      });
      quoteToken = normalizeAddress(String(Array.isArray(data) ? data[0] : data));
    } catch {
      // leave quote unknown
    }
  }

  const isRwa = Boolean(quoteToken && RWA_BY_ADDRESS.has(quoteToken));
  const quoteKind = quoteToken
    ? quoteKindFor(quoteToken, isRwa)
    : null;

  let rewardRwa: string | null = null;
  if (hasDatabase) {
    const {data} = await db()
      .from("reward_distributions")
      .select("rwa_ticker")
      .eq("token_address", wanted)
      .limit(1);
    rewardRwa = data?.[0]?.rwa_ticker ? String(data[0].rwa_ticker) : null;
  }

  const input = {
    launchpad: pad.id as "pons" | "long",
    quoteKind,
    rewardRwa,
    bonded,
  };
  if (!qualifiesForUniverse(input)) return {status: "ineligible"};

  let eligible = true;
  if (pad.id === "long") {
    const existing = hasDatabase ? await getTokenRow(wanted) : null;
    const auth = await resolveLongAuthenticity(wanted);
    if (auth === false || (auth == null && existing?.eligible === false)) {
      eligible = false;
    }
  }

  let symbol = "???";
  let name = "Unknown";
  let decimals = 18;
  let supply: number | null = null;
  try {
    const [s, n, d, sup] = await Promise.all([
      rpc().readContract({address: wanted as `0x${string}`, abi: erc20Abi, functionName: "symbol"}).catch(() => "???"),
      rpc().readContract({
        address: wanted as `0x${string}`,
        abi: parseAbi(["function name() view returns (string)"]),
        functionName: "name",
      }).catch(() => "Unknown"),
      rpc().readContract({address: wanted as `0x${string}`, abi: erc20Abi, functionName: "decimals"}).catch(() => 18),
      rpc().readContract({address: wanted as `0x${string}`, abi: erc20Abi, functionName: "totalSupply"}).catch(() => null),
    ]);
    symbol = String(s);
    name = String(n);
    decimals = Number(d) || 18;
    if (sup != null) supply = Number(sup) / 10 ** decimals;
  } catch {
    // keep defaults
  }

  const now = new Date().toISOString();
  const status = statusFor(input);
  const row: TokenWrite = {
    address: wanted,
    launchpad: pad.id,
    symbol,
    name,
    decimals,
    quote_token: quoteToken,
    quote_kind: quoteKind,
    reward_rwa: rewardRwa,
    reward_kind: rewardRwa ? "distribution" : null,
    creator,
    total_supply: supply,
    created_at: now,
    bonded_at: bonded && pad.id === "pons" ? now : null,
    listed_at: isListed(input) ? now : null,
    status,
    eligible,
  };

  if (!hasDatabase) return {status: "ineligible"};
  if (row.status === "listed") {
    await commitListedWithPrice([row]);
  } else {
    await upsertTokens([row]);
  }
  if (!row.eligible) return {status: "ineligible"};
  return {status: "listed", inserted: true, address: wanted};
}

export {rowToAsset};
