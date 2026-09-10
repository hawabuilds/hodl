"use client";

import {Avatar} from "@/components/ui/Avatar";
import {Button} from "@/components/ui/Button";
import {ArrowUpRightIcon, WalletIcon} from "@/components/ui/Icons";
import {Sheet, SheetTitle} from "@/components/ui/Sheet";
import {cn} from "@/lib/cn";

const SHOTS = [
  "edit-profile",
  "export-wallet",
  "import-wallet",
  "followers",
] as const;

type Shot = (typeof SHOTS)[number];

function isShot(value: string): value is Shot {
  return (SHOTS as readonly string[]).includes(value);
}

/** Dev-only — captures sheet surfaces after token-level popup fix. */
export function SurfaceScreenMocks({shot}: {shot: string}) {
  const active = isShot(shot) ? shot : "edit-profile";

  return (
    <div className="relative flex h-full flex-col bg-surface-base">
      <div className="px-[22px] pb-6 pt-8">
        <div className="flex items-center gap-3">
          <Avatar name="Trader" size={52} ring />
          <div>
            <div className="text-[19px] font-extrabold tracking-[-0.03em]">Trader</div>
            <div className="text-[12.5px] font-semibold text-faint">@dev · 0x1234…5678</div>
          </div>
        </div>
        <p className="mt-4 text-[13px] text-muted">
          Background mock for sheet surface capture — {active}
        </p>
      </div>

      {active === "edit-profile" ? <EditProfileMock /> : null}
      {active === "export-wallet" ? <ExportWalletMock /> : null}
      {active === "import-wallet" ? <ImportWalletMock /> : null}
      {active === "followers" ? <FollowersMock /> : null}
    </div>
  );
}

function EditProfileMock() {
  return (
    <Sheet
      open
      onClose={() => {}}
      height="auto"
      label="Edit profile"
      header={<SheetTitle title="Edit profile" onClose={() => {}} />}
    >
      <div className="flex flex-col gap-3.5 pb-2 pt-1">
        <MockField label="Display name" value="Trader" />
        <div>
          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.07em] text-faint">
            Bio
          </label>
          <div className="rounded-2xl bg-[var(--bg-input)] px-3.5 py-3 text-[14px] text-ink shadow-inset-soft">
            What you trade and why
          </div>
        </div>
        <MockField label="X" value="https://x.com/you" />
        <Button fullWidth className="mt-1">
          Save profile
        </Button>
      </div>
    </Sheet>
  );
}

function ExportWalletMock() {
  return (
    <Sheet
      open
      onClose={() => {}}
      height="auto"
      label="Export wallet"
      header={<SheetTitle title="Export wallet" onClose={() => {}} />}
    >
      <p className="mt-1 text-[14px] leading-[1.55] text-muted">
        Save this somewhere only you can reach. You will need it to restore your
        wallet on another device.
      </p>
      <Button variant="dark" fullWidth className="mt-5">
        Continue
      </Button>
    </Sheet>
  );
}

function ImportWalletMock() {
  return (
    <Sheet
      open
      onClose={() => {}}
      height="auto"
      label="Use another wallet"
      header={<SheetTitle title="Use another wallet" onClose={() => {}} />}
    >
      <p className="mb-4 mt-1 text-[13px] leading-[1.5] text-muted">
        A wallet was created for you at sign-in. Import another only if you
        already have one you would rather hold your positions in.
      </p>
      <div className="flex flex-col gap-2">
        {["MetaMask", "Rabby", "Coinbase Wallet"].map((name) => (
          <div
            key={name}
            className={cn(
              "flex items-center gap-3 rounded-2xl bg-[var(--overlay-wash)] px-4 py-3.5",
            )}
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-wash">
              <WalletIcon className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-bold tracking-[-0.01em]">
                {name}
              </span>
              <span className="block text-[12px] text-faint">Connect</span>
            </span>
            <ArrowUpRightIcon className="h-4 w-4 shrink-0 text-faint" />
          </div>
        ))}
      </div>
    </Sheet>
  );
}

function FollowersMock() {
  return (
    <Sheet
      open
      onClose={() => {}}
      height="auto"
      label="Followers"
      header={<SheetTitle title="Followers" onClose={() => {}} />}
    >
      <ul className="-mx-[22px] pb-2 pt-1">
        {[
          {name: "Alice", handle: "alice", followers: 128},
          {name: "Bob", handle: "bob", followers: 42},
        ].map((person) => (
          <li key={person.handle}>
            <div className="flex items-center gap-3 px-[22px] py-2.5">
              <Avatar name={person.name} size={38} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-extrabold tracking-[-0.015em]">
                  {person.name}
                </div>
                <div className="truncate text-[12px] font-semibold text-faint">
                  @{person.handle} · {person.followers} followers
                </div>
              </div>
              <span className="tabular-nums shrink-0 text-[12.5px] font-bold text-muted">
                $1.2K
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

function MockField({label, value}: {label: string; value: string}) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.07em] text-faint">
        {label}
      </label>
      <div className="rounded-2xl bg-[var(--bg-input)] px-3.5 py-3 text-[14px] font-medium text-ink shadow-inset-soft">
        {value}
      </div>
    </div>
  );
}
