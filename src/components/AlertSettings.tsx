"use client";

import {useEffect, useRef, useState} from "react";

import {Button} from "@/components/ui/Button";
import {Sheet} from "@/components/ui/Sheet";
import {useAlertPrefs} from "@/hooks/useActivity";
import type {AlertPrefs, AlertSwitch} from "@/lib/alerts";
import {cn} from "@/lib/cn";

/**
 * Settings → Alerts, on the desktop terminal.
 *
 * In-app only: the Following count, the bell and the pop-ups. None of these
 * sends a push or an email. Each change saves as it is made and applies at
 * once — the next pop-up already follows it.
 */

const SWITCHES: {key: AlertSwitch; title: string; note?: string}[] = [
  {key: "followBuys", title: "Someone I follow buys"},
  {key: "followSells", title: "Someone I follow sells"},
  {key: "followComments", title: "Someone I follow comments"},
  {key: "replies", title: "Someone replies to my comment"},
  {key: "newFollowers", title: "Someone follows me"},
  {
    key: "popups",
    title: "Show pop-ups",
    note: "Off: no pop-ups, but the bell and Following still update.",
  },
];

export function AlertSettings({open, onClose}: {open: boolean; onClose: () => void}) {
  const {prefs, loaded, error, save} = useAlertPrefs();
  const [status, setStatus] = useState<string | null>(null);
  const [minDraft, setMinDraft] = useState("");
  const typing = useRef(false);

  useEffect(() => {
    if (!typing.current) setMinDraft(prefs.minTradeUsd > 0 ? String(prefs.minTradeUsd) : "");
  }, [prefs.minTradeUsd]);

  async function change(patch: Partial<AlertPrefs>) {
    setStatus(null);
    try {
      await save(patch);
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "Couldn't save. Try again.");
    }
  }

  // The amount saves once typing pauses, not on every keystroke.
  useEffect(() => {
    if (!typing.current) return;
    const next = minDraft.trim() === "" ? 0 : Number(minDraft);
    if (!Number.isFinite(next) || next < 0 || next === prefs.minTradeUsd) return;
    const timer = window.setTimeout(() => {
      typing.current = false;
      setStatus(null);
      save({minTradeUsd: next}).catch((cause: unknown) =>
        setStatus(cause instanceof Error ? cause.message : "Couldn't save. Try again."),
      );
    }, 500);
    return () => window.clearTimeout(timer);
  }, [minDraft, prefs.minTradeUsd, save]);

  return (
    <Sheet open={open} onClose={onClose} height="90%" surface="popup" label="Alerts">
      <div className="px-1 pb-8">
        <h2 className="text-[17px] font-extrabold tracking-[-0.02em]">Alerts</h2>
        <p className="mt-1 text-[12.5px] leading-[1.45] text-faint">
          What counts on the Following tab and the bell, and what pops up. Never sent as a push or an email.
        </p>

        {!loaded && !error ? (
          <p className="mt-5 text-[13px] text-muted">Loading…</p>
        ) : error && !loaded ? (
          <p className="mt-5 text-[13px] text-muted">Couldn&apos;t load your alerts. Close and try again.</p>
        ) : (
          <>
            <ul className="mt-4 divide-y divide-[var(--overlay-wash)]">
              {SWITCHES.map((row) => (
                <li key={row.key}>
                  <SwitchRow
                    title={row.title}
                    note={row.note}
                    on={prefs[row.key]}
                    onToggle={() => void change({[row.key]: !prefs[row.key]})}
                  />
                </li>
              ))}
            </ul>

            <label className="mt-4 block">
              <span className="text-[14px] font-bold">Only alert me for trades over</span>
              <span className="mt-2 flex items-center gap-1 rounded-xl bg-[var(--bg-input)] px-3 py-2 shadow-inset-soft focus-within:shadow-inset-focus">
                <span className="text-[14px] font-bold text-faint">$</span>
                <input
                  inputMode="decimal"
                  placeholder="0"
                  value={minDraft}
                  onChange={(event) => {
                    typing.current = true;
                    setMinDraft(event.target.value.replace(/[^0-9.]/g, ""));
                  }}
                  aria-describedby="alerts-min-note"
                  className="min-w-0 flex-1 bg-transparent text-[14px] font-bold tabular-nums text-ink outline-none"
                />
              </span>
              <span id="alerts-min-note" className="mt-1.5 block text-[11.5px] text-faint">
                $0 means every trade.
              </span>
            </label>

            {status ? <p className="mt-3 text-[12px] font-semibold text-error">{status}</p> : null}
            <p className="mt-4 text-[11px] text-faint">Changes save as you make them.</p>
            <Button type="button" variant="ghost" className="mt-3" onClick={onClose}>
              Done
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}

function SwitchRow({
  title,
  note,
  on,
  onToggle,
}: {
  title: string;
  note?: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className="flex w-full items-center justify-between gap-4 py-2.5 text-left"
    >
      <span className="min-w-0">
        <span className="block text-[14px] font-bold">{title}</span>
        {note ? <span className="mt-0.5 block text-[11.5px] leading-[1.4] text-faint">{note}</span> : null}
      </span>
      <span
        className={cn(
          "relative h-6 w-10 shrink-0 rounded-full transition-colors",
          on ? "bg-success" : "bg-surface-hover",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform",
            on ? "left-[18px]" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}
