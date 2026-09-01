"use client";

import {useState, type ReactNode} from "react";
import {useTheme} from "@/hooks/useTheme";
import {useUser} from "@/hooks/useUser";
import {useWallet} from "@/hooks/useWallet";
import {cn} from "@/lib/cn";
import {shortAddress} from "@/lib/format";
import {useSession} from "@/lib/session";
import {addressUrlForChain, RH_MAINNET_ID} from "@/config/chain";
import {ConnectWalletSheet} from "./ConnectWalletSheet";
import {Button} from "./ui/Button";
import {
  ArrowUpRightIcon,
  CopyIcon,
  LogoutIcon,
  MoonIcon,
  SunIcon,
  WalletIcon,
} from "./ui/Icons";
import {SegmentedToggle} from "./ui/SegmentedToggle";
import {Sheet, SheetTitle} from "./ui/Sheet";
import type {Theme} from "@/lib/theme";

/**
 * Wallet and account controls.
 *
 * Rendered in two places — the avatar dropdown in the header and the settings
 * sheet on the Profile tab — so the body lives here once. Both entry points
 * need the same import / export / sign-out set, and having them drift apart is
 * exactly the kind of thing nobody notices until someone cannot find export.
 */
export function WalletControls({onNavigate}: {onNavigate?: () => void}) {
  const {displayName, handle, embeddedWallet, logout} = useUser();
  const {exportEmbeddedWallet} = useSession();
  const wallet = useWallet();
  const {theme, setTheme} = useTheme();

  const [connectOpen, setConnectOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [copied, setCopied] = useState(false);

  const external = wallet.isConnected ? wallet.address : null;
  const destination = external ?? embeddedWallet;

  async function copyAddress() {
    if (!destination) return;
    try {
      await navigator.clipboard.writeText(destination);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  async function saveBackup() {
    if (!exportEmbeddedWallet) return;
    setBackingUp(true);
    try {
      await exportEmbeddedWallet();
      setBackupOpen(false);
    } catch {
      // Privy surfaces its own refusal.
    } finally {
      setBackingUp(false);
    }
  }

  return (
    <>
      <div className="flex items-start justify-between gap-2 border-b border-hairline px-2.5 pb-2.5 pt-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-extrabold tracking-[-0.01em]">
            {displayName ?? "Trader"}
          </div>
          <div className="truncate text-[12px] font-medium text-faint">
            {handle ? `@${handle}` : "Signed in"}
          </div>
        </div>
        <SegmentedToggle<Theme>
          value={theme}
          onChange={setTheme}
          className="shrink-0"
          options={[
            {
              value: "light",
              label: "Light mode",
              icon: <SunIcon className="h-[15px] w-[15px]" />,
            },
            {
              value: "dark",
              label: "Dark mode",
              icon: <MoonIcon className="h-[15px] w-[15px]" />,
            },
          ]}
        />
      </div>

      <div className="mx-1 mt-2 rounded-[13px] bg-wash px-3 py-2.5">
        <div className="text-[12.5px] font-bold">
          {external ? (wallet.walletName ?? "Imported wallet") : "Your wallet"}
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] font-medium text-muted">
            {destination ? shortAddress(destination) : "Setting up…"}
          </span>
          {destination ? (
            <>
              <button
                type="button"
                onClick={() => void copyAddress()}
                aria-label={copied ? "Address copied" : "Copy address"}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-muted transition-colors hover:bg-card hover:text-ink"
              >
                <CopyIcon className="h-3.5 w-3.5" />
              </button>
              <a
                href={addressUrlForChain(destination, RH_MAINNET_ID)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View on explorer"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-muted transition-colors hover:bg-card hover:text-ink"
              >
                <ArrowUpRightIcon className="h-3.5 w-3.5" />
              </a>
            </>
          ) : null}
        </div>
        {copied ? (
          <div className="mt-1 text-[11px] font-semibold text-green-deep">Copied</div>
        ) : null}
      </div>

      <div className="mt-1 flex flex-col">
        <MenuRow
          onClick={() => {
            onNavigate?.();
            setConnectOpen(true);
          }}
          icon={<WalletIcon className="h-4 w-4" />}
          label="Import wallet"
        />
        {exportEmbeddedWallet && embeddedWallet ? (
          <MenuRow
            onClick={() => {
              onNavigate?.();
              setBackupOpen(true);
            }}
            icon={<CopyIcon className="h-4 w-4" />}
            label="Export wallet"
          />
        ) : null}
        {external && wallet.onWrongChain ? (
          <MenuRow
            onClick={() => void wallet.ensureCorrectChain()}
            icon={<WalletIcon className="h-4 w-4" />}
            label="Switch network"
          />
        ) : null}
        {external ? (
          <MenuRow
            onClick={() => wallet.disconnect()}
            icon={<WalletIcon className="h-4 w-4" />}
            label="Disconnect wallet"
          />
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          logout();
        }}
        className="mx-1 mt-1 flex w-[calc(100%-8px)] items-center gap-2 rounded-[10px] px-2.5 py-2.5 text-[14px] font-bold text-red transition-colors hover:bg-wash"
      >
        <LogoutIcon className="h-4 w-4" />
        Sign out
      </button>

      <ConnectWalletSheet
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        connectors={wallet.connectors}
        onConnect={wallet.connectWith}
      />

      <Sheet
        open={backupOpen}
        onClose={() => setBackupOpen(false)}
        height="auto"
        label="Export wallet"
        header={<SheetTitle title="Export wallet" onClose={() => setBackupOpen(false)} />}
      >
        <p className="mt-1 text-[14px] leading-[1.55] text-muted">
          Save this somewhere only you can reach. You will need it to restore
          your wallet on another device.
        </p>
        <Button
          variant="dark"
          fullWidth
          className="mt-5"
          disabled={backingUp}
          onClick={() => void saveBackup()}
        >
          {backingUp ? "Opening export…" : "Continue"}
        </Button>
      </Sheet>
    </>
  );
}

function MenuRow({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-left text-[14px] font-semibold",
        "transition-colors hover:bg-wash disabled:opacity-45",
      )}
    >
      <span className="text-muted">{icon}</span>
      {label}
    </button>
  );
}
