"use client";

import {Sheet, SheetTitle} from "./ui/Sheet";
import {WalletControls} from "./WalletControls";

/** The same account controls as the header menu, opened from the Profile tab. */
export function SettingsSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      height="auto"
      label="Settings"
      header={<SheetTitle title="Settings" onClose={onClose} />}
    >
      <div className="pb-2">
        <WalletControls />
      </div>
    </Sheet>
  );
}
