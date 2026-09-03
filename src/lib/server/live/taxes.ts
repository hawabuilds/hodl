import {encodeFunctionData, decodeFunctionResult, parseAbi} from "viem";
import {rpc} from "./chain";
import {cached} from "./cache";

/**
 * The tax on a token, as its launchpad and its contract define it.
 *
 * Two things can withhold value from a trade, and which of them counts as "the
 * token's tax" depends on the launchpad:
 *
 * - **Pons** lets a creator set a tax on the pool at launch, snapshotted in the
 *   hook alongside a separate, fixed platform cut. Only the creator's own
 *   figure is reported as this token's tax, matching what Pons's own pages
 *   show — an earlier version added the platform's fixed 1% into the total,
 *   which was wrong on every launch and confirmed wrong against a real one.
 * - **Long** and everything else charge nothing of their own. Their pools carry
 *   an ordinary Uniswap fee, which belongs to the venue rather than the token
 *   and is deliberately *not* counted — a Long token shows 0% because its
 *   deployer set no tax.
 *
 * On top of either sits a fee-on-transfer written into the token contract.
 * That cannot be read — plenty of contracts expose no getter — so it is
 * measured by executing a real transfer and comparing what arrives against what
 * was sent, in both directions, since a taxing contract usually charges
 * different rates depending on which side of the pool you are on.
 *
 * Nothing here is assumed. What cannot be measured is `null`, which the UI
 * reports as unmeasured — an earlier version hard coded zero, so the chart page
 * told every visitor "No transfer tax" about tokens nobody had checked.
 */

/** Uniswap v4 singleton. Every v4 pool's tokens and state live here. */
const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951" as const;

/** Canonical Multicall3, used as a stand-in caller. See the simulation below. */
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

/**
 * Pons's Uniswap v4 hook, which holds each launch's fee split.
 *
 * `hookFeeBps` is Pons's own cut and `creatorTaxBps` the one the deployer
 * picked at launch. An earlier version of this reported their *sum* as "the
 * token's tax" on the strength of a comment that turned out to be wrong: a
 * live check found `hookFeeBps` fixed at exactly 100 across every launch
 * sampled, so it is a platform-wide charge rather than anything specific to a
 * token, and it does not appear on the number Pons's own pages show — a token
 * whose creator set two hundred basis points read three hundred here against
 * two hundred there. `creatorTaxBps` alone is what is now reported as the
 * tax; the platform's cut still appears in the fee-destination breakdown.
 */
const PONS_HOOK = "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044" as const;

const ponsHookAbi = parseAbi([
  "function launches(bytes32) view returns (bool registered, bool memecoinIsCurrency0, address memecoin, address quoteToken, address creator, address buybackCreatorRecipient, address protocolFeeRecipient, uint16 creatorTaxBps, uint16 protocolFeeShareBps, uint16 buybackBurnBps, uint16 hookFeeBps, uint16 maxInternalPriceImpactBps, bool buybackEnabled)",
]);


/**
 * A scratch address that stands in for an ordinary trader. Owns nothing and is
 * given Multicall3's code for the duration of a simulation.
 */
const RELAY = "0x00000000000000000000000000000000000000b1" as const;

const TTL_MS = 30 * 60_000;

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
]);

const multicallAbi = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) payable returns (Result[] returnData)",
]);

/**
 * Who receives a token's trade fee, read from the launch record.
 *
 * There is no holder share. Pons splits a trade fee between the protocol, the
 * creator's own tax, and a buyback lock — and the buyback vault releases to the
 * creator and protocol too, not to holders. Worth stating in the shape itself,
 * because "rewards" on a launchpad usually implies otherwise.
 */
export interface FeeSplit {
  /** The launchpad's base fee, in percent. */
  basePct: number;
  /** The creator's own tax, chosen at launch, in percent. */
  creatorPct: number;
  /** Whether part of the fee funds a buyback-and-lock of the token. */
  buybackEnabled: boolean;
}

export interface Taxes {
  /** Tax withheld on a buy, in percent, or null if it could not be measured. */
  buyPct: number | null;
  /** Tax withheld on a sell, in percent, or null if it could not be measured. */
  sellPct: number | null;
  /** Where that tax ends up, when the launchpad records it. */
  split: FeeSplit | null;
}

const UNMEASURED: Taxes = {buyPct: null, sellPct: null, split: null};

async function call(to: string, data: string): Promise<string> {
  return rpc().request({
    method: "eth_call",
    params: [{to, data} as never, "latest"],
  } as never) as Promise<string>;
}

/** Multicall3's deployed runtime, copied over other addresses during a sim. */
let multicallCode: Promise<string> | null = null;
function multicallRuntime(): Promise<string> {
  multicallCode ??= rpc()
    .getBytecode({address: MULTICALL3})
    .then((code) => code ?? "0x");
  return multicallCode;
}

/**
 * The tax Pons charges on a token: its base fee plus the creator's.
 *
 * Searches the token's pools for the one Pons registered rather than assuming
 * the deepest pool is it. Those are often different: UBIK's deepest market is
 * its USDG pool, while the pool Pons graduated it into — and the only one
 * carrying its fee record — is the GLD one. Reading the fee off the deepest
 * pool reported no tax at all for exactly that reason.
 *
 * Falls back to the token's own v3 fee tier, which is where a V1 launch that
 * predates the hook keeps the equivalent charge.
 */
async function ponsPoolTax(
  token: string,
  poolIds: string[],
): Promise<{total: number; split: FeeSplit | null} | null> {
  for (const poolId of poolIds) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(poolId)) continue;
    try {
      const raw = await call(
        PONS_HOOK,
        encodeFunctionData({
          abi: ponsHookAbi,
          functionName: "launches",
          args: [poolId as `0x${string}`],
        }),
      );
      const info = decodeFunctionResult({
        abi: ponsHookAbi,
        functionName: "launches",
        data: raw as `0x${string}`,
      }) as readonly unknown[];

      if (info[0] !== true) continue;
      // Confirm the record is this token's: a pool id is a hash, and a stray
      // match would attribute someone else's fee to this page.
      if (String(info[2]).toLowerCase() !== token.toLowerCase()) continue;

      const creatorBps = Number(info[7]);
      const hookBps = Number(info[10]);
      return {
        // The creator's own cut, not the sum — see the note above.
        total: creatorBps / 100,
        split: {
          basePct: hookBps / 100,
          creatorPct: creatorBps / 100,
          buybackEnabled: Boolean(info[12]),
        },
      };
    } catch {
      // Try the next pool.
    }
  }

  // A V1 launch predates the hook, so there is no per-launch fee record to
  // read here. Its constructor carries no tax field at all — only wallet and
  // transaction size limits — so a Pons V1 token genuinely has no launchpad
  // tax to report, rather than one this app failed to find.
  return {total: 0, split: null};
}

/**
 * Where the token sits in bulk, so a transfer can be simulated against it.
 *
 * The PoolManager holds every v4 pool's tokens, which makes it both the source
 * of a buy and the destination of a sell — the two directions a fee-on-transfer
 * token distinguishes between.
 */
async function reservoirBalance(token: string): Promise<bigint> {
  try {
    return BigInt(
      await call(
        token,
        encodeFunctionData({
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [POOL_MANAGER],
        }),
      ),
    );
  } catch {
    return 0n;
  }
}

/**
 * Run real transfers, in both directions, and report what actually landed.
 *
 * `eth_call` only returns the last frame's value, so each leg is bundled into a
 * Multicall3 `aggregate3`: state changes persist across sub-calls inside one
 * call, so a balance read after a transfer sees it.
 *
 * The sender is chosen by overriding an address's *code* with Multicall3's.
 * Overriding code leaves the token's storage alone, so the pool keeps its real
 * balance while becoming, for one simulated call, a contract that will transfer
 * on request. That is what makes this work without a router.
 *
 * Both directions come from one call, nested:
 *
 *   pool  -> relay   the buy leg; what the relay receives reveals the buy tax
 *   relay -> pool    the sell leg, run from inside the relay so the transfer's
 *                    sender is an ordinary address rather than the pool
 *
 * The relay is funded by the buy leg rather than by writing a balance into the
 * token's storage. An earlier version searched for the `balanceOf` slot to do
 * that, which cost ten calls a token and simply failed on Long's proxies, whose
 * storage layout is not any of the usual ones. Routing through a second
 * overridden address needs no knowledge of the token's internals at all.
 */
async function simulateBothDirections(
  token: string,
  amount: bigint,
): Promise<{buy: number | null; sell: number | null}> {
  const balanceOf = (who: string) => ({
    target: token as `0x${string}`,
    allowFailure: true,
    callData: encodeFunctionData({
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [who as `0x${string}`],
    }),
  });

  const transfer = (to: string, value: bigint) => ({
    target: token as `0x${string}`,
    allowFailure: true,
    callData: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [to as `0x${string}`, value],
    }),
  });

  const aggregate = (calls: unknown[]) =>
    encodeFunctionData({
      abi: multicallAbi,
      functionName: "aggregate3",
      args: [calls as never],
    });

  // Half, so the relay can still cover it even if the buy leg was taxed.
  const half = amount / 2n;
  if (half === 0n) return {buy: null, sell: null};

  const sellLeg = aggregate([
    balanceOf(POOL_MANAGER),
    transfer(POOL_MANAGER, half),
    balanceOf(POOL_MANAGER),
  ]);

  const data = aggregate([
    balanceOf(RELAY),
    transfer(RELAY, amount),
    balanceOf(RELAY),
    {target: RELAY, allowFailure: true, callData: sellLeg},
  ]);

  const decode = (raw: string) =>
    decodeFunctionResult({
      abi: multicallAbi,
      functionName: "aggregate3",
      data: raw as `0x${string}`,
    }) as {success: boolean; returnData: `0x${string}`}[];

  try {
    const code = await multicallRuntime();
    const raw = (await rpc().request({
      method: "eth_call",
      params: [
        {to: POOL_MANAGER, data} as never,
        "latest",
        {[POOL_MANAGER]: {code}, [RELAY]: {code}} as never,
      ],
    } as never)) as string;

    const outer = decode(raw);
    if (!outer[1]?.success) return {buy: null, sell: null};

    const relayGot =
      BigInt(outer[2].returnData) - BigInt(outer[0].returnData);
    const buy = percentOf(amount, relayGot);

    if (!outer[3]?.success) return {buy, sell: null};
    const inner = decode(outer[3].returnData);
    if (!inner[1]?.success) return {buy, sell: null};

    const poolGot = BigInt(inner[2].returnData) - BigInt(inner[0].returnData);
    return {buy, sell: percentOf(half, poolGot)};
  } catch {
    return {buy: null, sell: null};
  }
}

const percentOf = (sent: bigint, received: bigint): number => {
  if (sent <= 0n) return 0;
  const withheld = sent - received;
  if (withheld <= 0n) return 0;
  return Number((withheld * 10_000n) / sent) / 100;
};

/**
 * The tax on a buy and on a sell.
 *
 * Only ever called for a single asset — the figures appear on a chart page, not
 * in the feed — so the cost is a few calls for a page nobody loads twice inside
 * the cache window.
 */
export async function taxesFor(
  token: string,
  poolIds: string[],
  launchpadId: string | null,
): Promise<Taxes> {
  return cached(`tax:${token}`, TTL_MS, async () => {
    // Only Pons puts a tax on the pool. Reading a Uniswap fee for anything else
    // would report the venue's charge as the token's.
    const pons =
      launchpadId === "pons"
        ? await ponsPoolTax(token, poolIds)
        : {total: 0, split: null};
    const launchpadTax = pons?.total ?? null;
    const split = pons?.split ?? null;

    const reservoir = await reservoirBalance(token);
    // Nothing to move means transfer behaviour cannot be observed at all.
    if (reservoir === 0n) return {...UNMEASURED, split};

    // A thousandth of the pool: large enough that a percentage tax rounds
    // cleanly, small enough not to trip any max-transaction limit.
    const amount = reservoir / 1000n;
    if (amount === 0n) return {...UNMEASURED, split};

    const {buy, sell} = await simulateBothDirections(token, amount);

    const total = (transfer: number | null): number | null =>
      transfer === null || launchpadTax === null
        ? null
        : Number((launchpadTax + transfer).toFixed(2));

    return {buyPct: total(buy), sellPct: total(sell), split};
  });
}
