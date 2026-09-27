/**
 * Encode a Long launch: `Airlock.create(CreateParams)`, selector 0x882db707.
 *
 * Long's own app submits these as ERC-4337 user operations, but the Airlock
 * takes a direct call and several launches a day arrive that way, so hodl
 * sends one transaction from the user's own wallet instead of standing up a
 * bundler.
 *
 * The shape below was not read from Doppler's docs. It was decoded out of a
 * real launch, re-encoded from plain values, and compared byte for byte
 * against the original — `test/launch-encoding.test.ts` does exactly that on
 * every run. A struct whose fields are in the wrong order still encodes
 * cleanly; only comparing bytes catches it.
 *
 * Almost everything is a constant of Long's, copied across in `launchConfig`.
 * Precisely two fields belong to the person launching, established by decoding
 * three unrelated launches and seeing which values moved:
 *
 *   - `tokenFactoryData[3]`, the vesting recipients
 *   - the 95% pool beneficiary
 *
 * Everything else — fee receiver, integrator, initializer owner, the 5%
 * protocol beneficiary, the migration split — was identical in all three and
 * is therefore Long's, not ours to change.
 */

import {encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiParameters} from "viem";

import {normalizeAddress} from "@/lib/address";
import {
  LONG_AUTHORIZED,
  LONG_BENEFICIARY_PROTOCOL,
  LONG_CREATOR_SHARE,
  LONG_CURVE,
  LONG_INITIAL_SUPPLY,
  LONG_INIT_FEE,
  LONG_INIT_MAX_TICK,
  LONG_INIT_OWNER,
  LONG_INIT_TICK_SPACING,
  LONG_INTEGRATOR,
  LONG_MIGRATOR_CONFIG,
  LONG_MODULES,
  LONG_NUMERAIRE,
  LONG_NUM_TOKENS_TO_SELL,
  LONG_PROTOCOL_SHARE,
  LONG_VESTING,
  LONG_VESTING_AMOUNT,
  LONG_YEARLY_MINT_RATE,
} from "./launchConfig";

export const airlockAbi = parseAbi([
  "struct CreateParams { uint256 initialSupply; uint256 numTokensToSell; address numeraire; address tokenFactory; bytes tokenFactoryData; address governanceFactory; bytes governanceFactoryData; address poolInitializer; bytes poolInitializerData; address liquidityMigrator; bytes liquidityMigratorData; address integrator; bytes32 salt; }",
  "function create(CreateParams createData) returns (address asset, address pool, address governance, address timelock, address migrationPool)",
  "function getModuleState(address module) view returns (uint8)",
]);

/** `abi.encode` layouts for the two blobs that carry real content. */
const TOKEN_FACTORY_DATA = parseAbiParameters(
  "string,string,(uint256,uint256)[],address[],uint256[],uint256[],string,uint256,uint256,address,address[]",
);
const POOL_INITIALIZER_DATA = parseAbiParameters(
  "(uint24,int24,int24,(int24,int24,uint16,uint256)[],(address,uint96)[],address,bytes,bytes)",
);

export interface LongLaunchForm {
  name: string;
  symbol: string;
  /** Where the token's JSON metadata lives. */
  tokenUri: string;
  /** The launching wallet: takes the vesting and the 95% fee share. */
  creator: string;
  /** Seconds since epoch that minting may begin. */
  mintStart: bigint;
  salt: `0x${string}`;
}

/**
 * Fee beneficiaries, ascending by address.
 *
 * Doppler validates the order, and a creator whose address happens to sort
 * below Long's protocol address would otherwise revert after the user had
 * already signed. Every launch observed was already ascending, which is easy
 * to mistake for "the creator always goes second".
 */
export function longBeneficiaries(
  creator: string,
): readonly (readonly [`0x${string}`, bigint])[] {
  const rows: [`0x${string}`, bigint][] = [
    [normalizeAddress(LONG_BENEFICIARY_PROTOCOL) as `0x${string}`, LONG_PROTOCOL_SHARE],
    [normalizeAddress(creator) as `0x${string}`, LONG_CREATOR_SHARE],
  ];
  return rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

export function encodeLongTokenFactoryData(form: LongLaunchForm): `0x${string}` {
  return encodeAbiParameters(TOKEN_FACTORY_DATA, [
    form.name,
    form.symbol,
    LONG_VESTING.map(([cliff, duration]) => [cliff, duration] as const),
    [normalizeAddress(form.creator) as `0x${string}`],
    // Paired with the vesting amounts below; zero in every launch observed.
    [0n],
    [LONG_VESTING_AMOUNT],
    form.tokenUri,
    LONG_YEARLY_MINT_RATE,
    form.mintStart,
    // Long's, not the creator's — identical across every launch decoded.
    normalizeAddress(LONG_INTEGRATOR) as `0x${string}`,
    LONG_AUTHORIZED.map((address) => normalizeAddress(address) as `0x${string}`),
  ] as never);
}

export function encodeLongPoolInitializerData(form: LongLaunchForm): `0x${string}` {
  return encodeAbiParameters(POOL_INITIALIZER_DATA, [
    [
      LONG_INIT_FEE,
      LONG_INIT_TICK_SPACING,
      LONG_INIT_MAX_TICK,
      LONG_CURVE.map(([lo, hi, flag, share]) => [lo, hi, flag, share] as const),
      longBeneficiaries(form.creator),
      normalizeAddress(LONG_INIT_OWNER) as `0x${string}`,
      LONG_MIGRATOR_CONFIG,
      "0x",
    ],
  ] as never);
}

/** Calldata for `Airlock.create`. The Airlock is payable-free; value is zero. */
export function encodeLongCreate(form: LongLaunchForm): `0x${string}` {
  return encodeFunctionData({
    abi: airlockAbi,
    functionName: "create",
    args: [
      {
        initialSupply: LONG_INITIAL_SUPPLY,
        numTokensToSell: LONG_NUM_TOKENS_TO_SELL,
        numeraire: normalizeAddress(LONG_NUMERAIRE) as `0x${string}`,
        tokenFactory: normalizeAddress(LONG_MODULES.tokenFactory) as `0x${string}`,
        tokenFactoryData: encodeLongTokenFactoryData(form),
        governanceFactory: normalizeAddress(
          LONG_MODULES.governanceFactory,
        ) as `0x${string}`,
        // One bool. Governance is declined on every launch observed.
        governanceFactoryData: encodeAbiParameters(parseAbiParameters("bool"), [false]),
        poolInitializer: normalizeAddress(LONG_MODULES.poolInitializer) as `0x${string}`,
        poolInitializerData: encodeLongPoolInitializerData(form),
        liquidityMigrator: normalizeAddress(
          LONG_MODULES.liquidityMigrator,
        ) as `0x${string}`,
        liquidityMigratorData: "0x",
        integrator: normalizeAddress(LONG_INTEGRATOR) as `0x${string}`,
        salt: form.salt,
      },
    ] as never,
  });
}
