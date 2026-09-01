"use client";

import {useMemo, useState} from "react";
import type {Connector} from "wagmi";
import {cn} from "@/lib/cn";
import {Sheet, SheetTitle} from "./ui/Sheet";
import {ArrowUpRightIcon, WalletIcon} from "./ui/Icons";

/**
 * Wallets we want at the top of the list whether or not they are installed, in
 * the order players are most likely to want them. Anything else discovered over
 * EIP-6963 is appended underneath.
 */
const PREFERRED = ["MetaMask", "Rabby", "Coinbase Wallet", "WalletConnect"];

function rank(connector: Connector) {
  const index = PREFERRED.findIndex((name) =>
    connector.name.toLowerCase().startsWith(name.toLowerCase()),
  );
  return index === -1 ? PREFERRED.length : index;
}

interface ConnectWalletSheetProps {
  open: boolean;
  onClose: () => void;
  connectors: readonly Connector[];
  onConnect: (connectorId: string) => Promise<void>;
}

export function ConnectWalletSheet({
  open,
  onClose,
  connectors,
  onConnect,
}: ConnectWalletSheetProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = useMemo(() => {
    const seen = new Set<string>();
    const deduped = connectors.filter((connector) => {
      // The generic injected connector duplicates whichever extension
      // announced itself over EIP-6963, so drop it once a named one exists.
      if (connector.id === "injected" && connectors.length > 2) return false;
      if (seen.has(connector.name)) return false;
      seen.add(connector.name);
      return true;
    });

    return deduped.sort((a, b) => rank(a) - rank(b));
  }, [connectors]);

  async function handle(connector: Connector) {
    setError(null);
    setBusyId(connector.uid);
    try {
      await onConnect(connector.uid);
      onClose();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Connection failed.";
      // Wallet rejections are a normal outcome, not an error worth shouting about.
      setError(/reject|denied|cancel/i.test(message) ? null : message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      height="auto"
      label="Use another wallet"
      header={<SheetTitle title="Use another wallet" onClose={onClose} />}
    >
      <p className="mb-4 mt-1 text-[13px] leading-[1.5] text-muted">
        A wallet was created for you at sign-in. Import another only if you
        already have one you would rather hold your positions in.
      </p>

      {list.length === 0 ? (
        <div className="rounded-[14px] border border-hairline bg-wash px-4 py-5 text-center text-[13px] text-muted">
          No wallets detected. Install MetaMask, Rabby or Coinbase Wallet, then
          reopen this sheet.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((connector) => (
            <button
              key={connector.uid}
              type="button"
              disabled={busyId !== null}
              onClick={() => void handle(connector)}
              className={cn(
                "flex items-center gap-3 rounded-[14px] border border-hairline bg-card px-4 py-3.5",
                "text-left transition-colors hover:bg-wash disabled:opacity-55",
              )}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-wash">
                {connector.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={connector.icon}
                    alt=""
                    className="h-9 w-9 object-cover"
                  />
                ) : (
                  <WalletIcon className="h-[18px] w-[18px]" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-bold tracking-[-0.01em]">
                  {connector.name}
                </span>
                <span className="block text-[12px] text-faint">
                  {busyId === connector.uid ? "Waiting for approval…" : "Connect"}
                </span>
              </span>
              <ArrowUpRightIcon className="h-4 w-4 shrink-0 text-faint" />
            </button>
          ))}
        </div>
      )}

      {error ? (
        <p className="mt-3 text-[12.5px] font-medium text-red">{error}</p>
      ) : null}
    </Sheet>
  );
}
