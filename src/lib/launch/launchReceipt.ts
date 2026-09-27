/**
 * Which token a launch transaction actually created.
 *
 * Read from the receipt's own logs rather than from anything a caller says,
 * so `/api/launch/confirm` cannot be talked into recording somebody else's
 * token — or one that does not exist. A log only counts when it came from
 * the launchpad's own contract *and* carries that launchpad's launch event;
 * either alone is forgeable by emitting a lookalike.
 *
 * Kept out of the route so it can be tested without pulling in `next/server`.
 */

import {LONG_MODULES, PONS_LAUNCH_FACTORY, type LaunchpadTarget} from "./launchConfig";

/** `TokenLaunched(address,address,address,address,uint256,uint256)` */
export const PONS_LAUNCHED_TOPIC =
  "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607";
/** `Create(address,address,address,address)` */
export const AIRLOCK_CREATE_TOPIC =
  "0x68ff1cfcdcf76864161555fc0de1878d8f83ec6949bf351df74d8a4a1a2679ab";

export interface ReceiptLog {
  address: string;
  topics: readonly string[];
  data: string;
}

export function launchedToken(
  logs: readonly ReceiptLog[],
  launchpad: LaunchpadTarget,
): string | null {
  const source = (
    launchpad === "pons" ? PONS_LAUNCH_FACTORY : LONG_MODULES.airlock
  ).toLowerCase();
  const topic = launchpad === "pons" ? PONS_LAUNCHED_TOPIC : AIRLOCK_CREATE_TOPIC;

  for (const log of logs) {
    if (log.address.toLowerCase() !== source) continue;
    if (log.topics[0]?.toLowerCase() !== topic) continue;
    // Pons indexes the token; the Airlock puts the asset first in the data.
    const raw =
      launchpad === "pons"
        ? log.topics[1]?.slice(26)
        : log.data.slice(2 + 24, 2 + 64);
    if (raw && /^[0-9a-f]{40}$/i.test(raw)) return `0x${raw}`.toLowerCase();
  }
  return null;
}
