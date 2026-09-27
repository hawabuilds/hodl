"use client";

import {useCallback, useState} from "react";

import {useSession} from "@/lib/session";
import {formatRevertForUser, tradeHashFromError} from "@/lib/revertReason";
import {LONG_MODULES, PONS_LAUNCH_FACTORY} from "@/lib/launch/launchConfig";
import {encodeLongCreate} from "@/lib/launch/longLaunch";
import {encodePonsLaunch} from "@/lib/launch/ponsLaunch";
import type {LaunchDraft} from "@/lib/launch/launchForm";
import {useSendTx} from "./useSendTx";

/**
 * Send a launch, then tell the server about it.
 *
 * The transaction is the easy half. The half that decides whether the person
 * gets anything useful is `/api/launch/confirm`: until the token is recorded,
 * it exists on chain and nowhere in hodl, and the creator has paid for a page
 * that does not load. So a confirmed launch always attempts the record, and a
 * failure there is reported as a delay rather than as a failed launch —
 * because the launch did happen and saying otherwise would be a lie the user
 * could act on.
 */

export type LaunchPhase =
  | "idle"
  | "signing"
  | "pending"
  | "recording"
  | "done"
  | "failed";

export interface LaunchResult {
  address: string | null;
  txHash: `0x${string}`;
}

/** A random 32-byte salt that is not the clone factory's mined `ba3`. */
function launchSalt(): `0x${string}` {
  for (let attempt = 0; attempt < 8; attempt++) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const hex = Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    // The salt is not the address, but there is no reason to spend one that
    // the authenticity check would have to reason about later.
    if (!hex.endsWith("ba3")) return `0x${hex}`;
  }
  throw new Error("Could not pick a salt.");
}

export function useLaunch() {
  const session = useSession();
  const {address, sendTx, wait} = useSendTx();
  const [phase, setPhase] = useState<LaunchPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setTxHash(null);
  }, []);

  const launch = useCallback(
    async (draft: LaunchDraft, launchFee: bigint): Promise<LaunchResult | null> => {
      if (!address) {
        setError("Sign in to launch.");
        setPhase("failed");
        return null;
      }
      if (!draft.pair) {
        setError("Pick what it trades against.");
        setPhase("failed");
        return null;
      }

      setError(null);
      setPhase("signing");
      const salt = launchSalt();

      try {
        const tx =
          draft.launchpad === "pons"
            ? {
                to: PONS_LAUNCH_FACTORY as `0x${string}`,
                data: encodePonsLaunch({
                  name: draft.name.trim(),
                  symbol: draft.symbol.trim().toUpperCase(),
                  logo: draft.logo,
                  description: draft.description.trim(),
                  socials: draft.socials,
                  creatorFeeRecipient: address,
                  creatorTaxBps: draft.creatorTaxBps,
                  buybackEnabled: false,
                  launchConfigId: 0n,
                  pairToken: draft.pair.address,
                  salt,
                }),
                // Exactly the fee. The factory reverts on anything else, which
                // is also why a first buy cannot ride along here.
                value: launchFee,
              }
            : {
                to: LONG_MODULES.airlock as `0x${string}`,
                data: encodeLongCreate({
                  name: draft.name.trim(),
                  symbol: draft.symbol.trim().toUpperCase(),
                  tokenUri: draft.logo,
                  creator: address,
                  mintStart: BigInt(Math.floor(Date.now() / 1000)),
                  salt,
                }),
                value: 0n,
              };

        const hash = await sendTx(tx);
        setTxHash(hash);
        setPhase("pending");
        await wait(hash);

        setPhase("recording");
        const token = await session.getAccessToken();
        const response = await fetch("/api/launch/confirm", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? {authorization: `Bearer ${token}`} : {}),
          },
          body: JSON.stringify({
            txHash: hash,
            launchpad: draft.launchpad,
            pairToken: draft.pair.address,
            rewardRwa: draft.rewardRwa,
            name: draft.name.trim(),
            symbol: draft.symbol.trim().toUpperCase(),
            image: draft.logo,
          }),
        });
        const recorded = (await response.json().catch(() => ({}))) as {
          address?: string;
          error?: string;
        };

        setPhase("done");
        if (!response.ok) {
          // The launch landed. Only the listing is behind, so say that.
          setError(
            "Launched, but hodl has not picked it up yet. It will appear shortly.",
          );
        }
        return {address: recorded.address ?? null, txHash: hash};
      } catch (cause) {
        const hash = tradeHashFromError(cause);
        if (hash) setTxHash(hash);
        setPhase("failed");
        setError(explainLaunchError(cause));
        return null;
      }
    },
    [address, sendTx, session, wait],
  );

  return {phase, error, txHash, launch, reset};
}

/** A revert reason where there is one, a wallet message where there is not. */
function explainLaunchError(cause: unknown): string {
  const decoded = formatRevertForUser(cause);
  if (decoded) return decoded;
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/user rejected|denied|4001/i.test(message)) return "You declined that.";
  if (/insufficient funds/i.test(message)) {
    return "Not enough ETH to cover the launch fee and gas.";
  }
  if (/LaunchFeeNotPaid/i.test(message)) return "The launch fee changed. Try again.";
  if (/PairTokenNotApproved/i.test(message)) {
    return "That pair is no longer accepted by the launchpad.";
  }
  return message.slice(0, 180) || "The launch could not be sent.";
}
