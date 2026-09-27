"use client";

import {useState, type ReactNode} from "react";
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

/**
 * Wallet and account controls in the profile settings menu.
 *
 * Keeps HODL embedded wallet and optional external connect in one place so
 * export, disconnect, and sign-out stay aligned with the Option B model.
 */
export function WalletControls({onNavigate}: {onNavigate?: () => void}) {
  const {displayName, handle, embeddedWallet, logout} = useUser();
  const {exportEmbeddedWallet} = useSession();
  const wallet = useWallet();

  const [connectOpen, setConnectOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  const external = wallet.isConnected ? wallet.address : null;

  async function copyAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(address);
      window.setTimeout(() => setCopiedAddress(null), 1600);
    } catch {
      setCopiedAddress(null);
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
      <div className="flex items-start justify-between gap-2 px-2.5 pb-2.5 pt-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-extrabold tracking-[-0.01em]">
            {displayName ?? "Trader"}
          </div>
          <div className="truncate text-[12px] font-medium text-faint">
            {handle ? `@${handle}` : "Signed in"}
          </div>
        </div>
      </div>

      <div className="mx-1 mt-2 flex flex-col gap-2">
        {embeddedWallet ? (
          <WalletCard
            title="Your HODL wallet"
            subtitle={
              external
                ? "Created at sign-in · counts toward portfolio"
                : "Created at sign-in · default for trading"
            }
            address={embeddedWallet}
            active={!external}
            copied={copiedAddress === embeddedWallet}
            onCopy={() => void copyAddress(embeddedWallet)}
          />
        ) : null}

        {external ? (
          <WalletCard
            title={wallet.walletName ?? "External wallet"}
            subtitle="Active for trading · both wallets count toward portfolio"
            address={external}
            active
            copied={copiedAddress === external}
            onCopy={() => void copyAddress(external)}
          />
        ) : (
          <div className="rounded-[13px] bg-wash px-3 py-2.5">
            <div className="text-[12.5px] font-bold">Connect external wallet</div>
            <p className="mt-0.5 text-[11px] leading-snug text-faint">
              Optional MetaMask or Rabby. Both addresses count toward your
              portfolio.
            </p>
          </div>
        )}
      </div>

      <div className="mt-1 flex flex-col">
        {!external ? (
          <MenuRow
            onClick={() => {
              onNavigate?.();
              setConnectOpen(true);
            }}
            icon={<WalletIcon className="h-4 w-4" />}
            label="Connect external wallet"
          />
        ) : null}
        {exportEmbeddedWallet && embeddedWallet ? (
          <MenuRow
            onClick={() => {
              onNavigate?.();
              setBackupOpen(true);
            }}
            icon={<CopyIcon className="h-4 w-4" />}
            label="Export HODL wallet"
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
            label="Disconnect external wallet"
          />
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          logout();
        }}
        className="mx-1 mt-1 flex w-[calc(100%-8px)] items-center gap-2 rounded-[10px] px-2.5 py-2.5 text-[14px] font-bold text-error transition-colors hover:bg-surface-hover"
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
        label="Export HODL wallet"
        header={
          <SheetTitle title="Export HODL wallet" onClose={() => setBackupOpen(false)} />
        }
      >
        <p className="mt-1 text-[14px] leading-[1.55] text-muted">
          This exports your HODL embedded wallet only — the one created when you
          signed in. If you connected MetaMask or another external wallet, export
          those keys from that wallet app instead.
        </p>
        <p className="mt-3 text-[13px] leading-[1.55] text-faint">
          Save the backup somewhere only you can reach. You will need it to
          restore your HODL wallet on another device.
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

function WalletCard({
  title,
  subtitle,
  address,
  active,
  copied,
  onCopy,
}: {
  title: string;
  subtitle: string;
  address: string;
  active?: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-[13px] bg-wash px-3 py-2.5">
      <div className="flex items-center gap-2">
        <div className="text-[12.5px] font-bold">{title}</div>
        {active ? (
          <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-bold text-success">
            Active
          </span>
        ) : null}
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-faint">{subtitle}</p>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] font-medium text-muted">
          {shortAddress(address)}
        </span>
        <button
          type="button"
          onClick={onCopy}
          aria-label={copied ? "Address copied" : "Copy address"}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-muted transition-colors hover:bg-card hover:text-ink"
        >
          <CopyIcon className="h-3.5 w-3.5" />
        </button>
        <a
          href={addressUrlForChain(address, RH_MAINNET_ID)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View on explorer"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-muted transition-colors hover:bg-card hover:text-ink"
        >
          <ArrowUpRightIcon className="h-3.5 w-3.5" />
        </a>
      </div>
      {copied ? (
        <div className="mt-1 text-[11px] font-semibold text-success">Copied</div>
      ) : null}
    </div>
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
