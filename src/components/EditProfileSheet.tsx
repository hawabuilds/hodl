"use client";

import {useEffect, useState} from "react";
import {useMe} from "@/hooks/useMe";
import {Button} from "./ui/Button";
import {Sheet, SheetTitle} from "./ui/Sheet";

const BIO_LIMIT = 160;

/**
 * Editing what a profile says about itself.
 *
 * Handle and avatar are not editable here: both come from the login identity,
 * and offering a field that silently does nothing is worse than not offering it.
 */
export function EditProfileSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const me = useMe();
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [x, setX] = useState("");
  const [telegram, setTelegram] = useState("");
  const [website, setWebsite] = useState("");

  // Reloaded each time the sheet opens so a cancelled edit does not linger.
  useEffect(() => {
    if (!open) return;
    setDisplayName(me.displayName ?? "");
    setBio(me.bio ?? "");
    setX(me.socials.x ?? "");
    setTelegram(me.socials.telegram ?? "");
    setWebsite(me.socials.website ?? "");
  }, [open, me.displayName, me.bio, me.socials.x, me.socials.telegram, me.socials.website]);

  function save() {
    me.save({
      displayName: displayName.trim() || null,
      bio: bio.trim() || null,
      socials: {
        x: x.trim() || null,
        telegram: telegram.trim() || null,
        website: website.trim() || null,
        discord: null,
      },
    });
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      height="auto"
      label="Edit profile"
      header={<SheetTitle title="Edit profile" onClose={onClose} />}
    >
      <div className="flex flex-col gap-3.5 pb-2 pt-1">
        <Field
          id="edit-name"
          label="Display name"
          value={displayName}
          onChange={setDisplayName}
          placeholder="How you show up in comments"
          maxLength={40}
        />

        <div>
          <label
            htmlFor="edit-bio"
            className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.07em] text-faint"
          >
            Bio
          </label>
          <textarea
            id="edit-bio"
            rows={3}
            value={bio}
            onChange={(event) => setBio(event.target.value.slice(0, BIO_LIMIT))}
            placeholder="What you trade and why"
            className="w-full resize-none rounded-control border border-hairline bg-card px-3.5 py-3 text-[14px] leading-[1.45] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-[rgba(0,200,5,0.35)] focus:shadow-[0_0_0_3px_rgba(0,200,5,0.08)]"
          />
          <p className="mt-1 text-right text-[11px] font-semibold text-faint">
            {BIO_LIMIT - bio.length}
          </p>
        </div>

        <Field
          id="edit-x"
          label="X"
          value={x}
          onChange={setX}
          placeholder="https://x.com/you"
          inputMode="url"
        />
        <Field
          id="edit-telegram"
          label="Telegram"
          value={telegram}
          onChange={setTelegram}
          placeholder="https://t.me/you"
          inputMode="url"
        />
        <Field
          id="edit-website"
          label="Website"
          value={website}
          onChange={setWebsite}
          placeholder="https://"
          inputMode="url"
        />

        <Button fullWidth onClick={save} className="mt-1">
          Save profile
        </Button>
        <p className="text-center text-[11.5px] font-medium text-faint">
          Saved in this browser until profiles are stored server-side.
        </p>
      </div>
    </Sheet>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  inputMode,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  inputMode?: "url" | "text";
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.07em] text-faint"
      >
        {label}
      </label>
      <input
        id={id}
        value={value}
        inputMode={inputMode}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-control border border-hairline bg-card px-3.5 py-3 text-[14px] font-medium text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-[rgba(0,200,5,0.35)] focus:shadow-[0_0_0_3px_rgba(0,200,5,0.08)]"
      />
    </div>
  );
}
