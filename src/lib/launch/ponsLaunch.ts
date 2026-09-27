/**
 * Encode a Pons launch: `PonsV2LaunchFactory.launchToken`, selector 0xa72101af.
 *
 * Pons publishes its contracts at github.com/ponsdotdev/ponsfamily and they
 * are verified on chain, so unlike Long this shape could be read from source —
 * but it is still checked against a real launch byte for byte in
 * `test/launch-encoding.test.ts`, because a published source and a deployed
 * bytecode are not the same claim.
 *
 * Pons runs a periphery contract its own site launches through (0xe33e9e47…,
 * selector 0xf85f8e41). hodl calls the factory directly: it accepts the call,
 * and it is one fewer contract whose behaviour we would be trusting without
 * reading it.
 *
 * Three rules from the factory that the UI has to respect, not discover:
 *
 *   - `if (msg.value != launchFee) revert LaunchFeeNotPaid()`. Exact equality,
 *     so an initial buy cannot ride along on the launch — it is a second
 *     transaction against the curve.
 *   - `expectedEconomics` is a commitment to the terms the user was shown.
 *     Zero waives it. We send the real hash when we have quoted terms, so a
 *     config changed between preview and signature reverts instead of
 *     launching on terms nobody agreed to.
 *   - `approvedPairTokens[pairToken]` gates the pair; `address(0)` is native
 *     ETH. The picker reads this rather than guessing.
 */

import {encodeFunctionData, keccak256, encodeAbiParameters, parseAbi, parseAbiParameters} from "viem";

import {normalizeAddress} from "@/lib/address";

export const ponsFactoryAbi = parseAbi([
  "struct Socials { string x; string telegram; string discord; string website; string extra; }",
  "struct TokenParams { string name; string symbol; string logo; string description; Socials socials; address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bytes32 expectedEconomics; bytes32 salt; }",
  "struct LaunchConfig { uint256 supply; uint256 curveFeeBps; uint256 phantomQuote; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; bool enabled; }",
  "function launchToken(TokenParams params, uint256 launchConfigId, address pairToken, address[] snipeTaxExemptions) payable returns (address token, address curve)",
  "function launchFee() view returns (uint256)",
  "function getLaunchConfig(uint256 id) view returns (LaunchConfig)",
  "function approvedPairTokens(address token) view returns (bool)",
]);

/** Custom errors, so a revert reads as a sentence instead of a hex blob. */
export const ponsErrorsAbi = parseAbi([
  "error LaunchFeeNotPaid()",
  "error PairTokenNotApproved()",
  "error LaunchEconomicsMismatch(bytes32 expected, bytes32 actual)",
]);

/** Zero waives the economics commitment. Named so call sites say why. */
export const NO_ECONOMICS_COMMITMENT =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

export interface PonsSocials {
  x?: string;
  telegram?: string;
  discord?: string;
  website?: string;
  extra?: string;
}

export interface PonsLaunchForm {
  name: string;
  symbol: string;
  /** Image URL. Pons takes a free string; existing launches use `ipfs://`. */
  logo: string;
  description: string;
  socials?: PonsSocials;
  /** Who receives the creator tax. */
  creatorFeeRecipient: string;
  /** Creator tax in basis points, chosen at launch and fixed after. */
  creatorTaxBps: number;
  buybackEnabled: boolean;
  launchConfigId: bigint;
  /** The token the curve is priced in. `address(0)` is native ETH. */
  pairToken: string;
  salt: `0x${string}`;
  /** Terms the user was shown. Omit only when nothing was quoted. */
  expectedEconomics?: `0x${string}`;
  /** Addresses exempt from the snipe tax. Empty on an ordinary launch. */
  snipeTaxExemptions?: readonly string[];
}

/**
 * The factory's own economics hash, over the ten values it hashes.
 *
 * Kept here so a preview and a launch cannot disagree about what was quoted:
 * the same function produces the number shown in the bill and the commitment
 * sent with the transaction.
 */
export function ponsEconomicsHash(input: {
  phantomQuote: bigint;
  graduationThreshold: bigint;
  supply: bigint;
  curveFeeBps: bigint;
  poolFee: number;
  tickSpacing: number;
  protocolFeeShareBps: number;
  buybackBurnBps: number;
  hookFeeBps: number;
  maxInternalPriceImpactBps: number;
}): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "uint256,uint256,uint256,uint256,uint24,int24,uint16,uint16,uint16,uint16",
      ),
      [
        input.phantomQuote,
        input.graduationThreshold,
        input.supply,
        input.curveFeeBps,
        input.poolFee,
        input.tickSpacing,
        input.protocolFeeShareBps,
        input.buybackBurnBps,
        input.hookFeeBps,
        input.maxInternalPriceImpactBps,
      ] as never,
    ),
  );
}

export function encodePonsLaunch(form: PonsLaunchForm): `0x${string}` {
  const socials = form.socials ?? {};
  return encodeFunctionData({
    abi: ponsFactoryAbi,
    functionName: "launchToken",
    args: [
      {
        name: form.name,
        symbol: form.symbol,
        logo: form.logo,
        description: form.description,
        socials: {
          x: socials.x ?? "",
          telegram: socials.telegram ?? "",
          discord: socials.discord ?? "",
          website: socials.website ?? "",
          extra: socials.extra ?? "",
        },
        creatorFeeRecipient: normalizeAddress(form.creatorFeeRecipient) as `0x${string}`,
        creatorTaxBps: form.creatorTaxBps,
        buybackEnabled: form.buybackEnabled,
        expectedEconomics: form.expectedEconomics ?? NO_ECONOMICS_COMMITMENT,
        salt: form.salt,
      },
      form.launchConfigId,
      normalizeAddress(form.pairToken) as `0x${string}`,
      (form.snipeTaxExemptions ?? []).map(
        (address) => normalizeAddress(address) as `0x${string}`,
      ),
    ] as never,
  });
}
