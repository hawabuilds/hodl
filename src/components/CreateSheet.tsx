"use client";

import {useEffect, useMemo, useRef, useState} from "react";

import {ImageCropper} from "./ImageCropper";
import {RocketIcon} from "./ui/Icons";
import {Modal} from "./ui/Modal";
import {cn} from "@/lib/cn";
import {useSession} from "@/lib/session";
import {useUser} from "@/hooks/useUser";
import {useLaunch} from "@/hooks/useLaunch";
import {
  MAX_DESCRIPTION,
  MAX_NAME,
  MAX_SYMBOL,
  launchBlockReason,
  launchSignatureCount,
  type LaunchDraft,
  type PairOption,
} from "@/lib/launch/launchForm";
import type {LaunchpadTarget} from "@/lib/launch/launchConfig";

/**
 * Launch a token on Pons or Long, priced in a stock, from one pop-up.
 *
 * Laid out like the order ticket and the same width. The form is short on
 * purpose — picture, name, ticker, the stock it is priced in, the launchpad's
 * one real choice, and an optional first buy — and underneath it, before any
 * button is pressed, the whole bill.
 *
 * With no first buy that is one signature; with one it is two, because Pons
 * reverts unless `msg.value` equals the launch fee exactly and a buy cannot
 * ride along. The form says so before the button is pressed, not after.
 *
 * Nothing here decides whether a draft is launchable. It renders the sentence
 * `launchForm` returns, so this and the confirm route cannot disagree.
 */

type Stage =
  | {kind: "idle"}
  | {kind: "working"; label: string}
  | {kind: "done"; address: string; symbol: string; txHash: string}
  | {kind: "failed"; message: string};

interface PadOptions {
  pairs: PairOption[];
  quotePairs: PairOption[];
}

interface OptionsResponse {
  pons: PadOptions;
  long: PadOptions;
  launchFee: string | null;
  rewardStocks: string[];
}

const LAUNCHPADS: {value: LaunchpadTarget; label: string}[] = [
  {value: "pons", label: "Pons"},
  {value: "long", label: "Long"},
];

const DEV_BUY_PRESETS = ["0.01", "0.05", "0.1"];
const CREATOR_FEE_CHOICES = [0, 100, 300, 500];

/** ETH with as many decimals as it takes to show a small fee honestly. */
function eth(wei: bigint): string {
  const value = Number(wei) / 1e18;
  if (value === 0) return "0 ETH";
  if (value >= 1) return `${value.toFixed(3)} ETH`;
  if (value >= 0.01) return `${value.toFixed(4)} ETH`;
  return `${value.toPrecision(2)} ETH`;
}

/** Read a picked file as a data URL. */
function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.readAsDataURL(file);
  });
}

export function CreateSheet({open, onClose}: {open: boolean; onClose: () => void}) {
  const session = useSession();
  const user = useUser();
  const launcher = useLaunch();

  const [launchpad, setLaunchpad] = useState<LaunchpadTarget>("pons");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [links, setLinks] = useState({x: "", telegram: "", website: ""});
  const [pair, setPair] = useState<PairOption | null>(null);
  const [rewardRwa, setRewardRwa] = useState<string | null>(null);
  const [creatorFeeBps, setCreatorFeeBps] = useState(100);
  const [devBuy, setDevBuy] = useState("");
  const [search, setSearch] = useState("");
  const [showMore, setShowMore] = useState(false);

  /** What is shown: a data URL as soon as it is cropped. */
  const [image, setImage] = useState<string | null>(null);
  /** What goes on chain: the hosted URL, once the upload lands. */
  const [imageUrl, setImageUrl] = useState("");
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [stage, setStage] = useState<Stage>({kind: "idle"});
  const [options, setOptions] = useState<OptionsResponse | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const working = stage.kind === "working";
  const authenticated = Boolean(user.authenticated || user.embeddedWallet);

  // Start clean each time, so a previous attempt's error or a half-typed
  // ticker is never the first thing someone sees.
  useEffect(() => {
    if (!open) return;
    setStage({kind: "idle"});
    setCropSource(null);
    setSearch("");
    setShowMore(false);
    launcher.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || options) return;
    let cancelled = false;
    void fetch("/api/launch/options")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: OptionsResponse | null) => {
        if (!cancelled && body) setOptions(body);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, options]);

  const forPad: PadOptions | null = options?.[launchpad] ?? null;

  const stocks = useMemo(() => {
    if (!forPad) return [];
    const query = search.trim().toUpperCase();
    const matched = query
      ? forPad.pairs.filter((entry) => entry.label.toUpperCase().includes(query))
      : forPad.pairs;
    return [...matched.slice(0, 60), ...forPad.quotePairs];
  }, [forPad, search]);

  const draft: LaunchDraft = {
    launchpad,
    name,
    symbol,
    logo: imageUrl,
    description,
    pair,
    rewardRwa,
    creatorTaxBps: creatorFeeBps,
    devBuy,
    socials: {x: links.x, telegram: links.telegram, website: links.website},
  };

  const blocked = launchBlockReason(draft);
  const signatures = launchSignatureCount(draft);
  const launchFee = options?.launchFee ? BigInt(options.launchFee) : null;
  const formReady = Boolean(name.trim() && symbol.trim() && pair);
  const ready = !blocked && !working && !uploading && launchFee !== null;

  async function pickImage(file: File | undefined) {
    if (!file) return;
    try {
      const data = await readFile(file);
      if (!/^data:image\/(png|jpeg|webp|gif)/.test(data)) {
        throw new Error("Use a PNG, JPEG, WebP or GIF image.");
      }
      // An animated GIF keeps its animation; cropping through a canvas would
      // flatten it to one frame.
      if (file.type === "image/gif") {
        setImage(data);
        void upload(data);
      } else {
        setCropSource(data);
      }
    } catch (error) {
      setStage({kind: "failed", message: (error as Error).message});
    }
  }

  /**
   * Send the cropped picture to storage.
   *
   * The preview is the data URL, so the form is usable the instant it is
   * cropped. This only has to finish before the launch is signed, and the
   * button stays disabled until it does — the URL is what goes on chain, and
   * a launch carrying a data URL would be a token with a broken picture
   * forever.
   */
  async function upload(dataUrl: string) {
    setUploading(true);
    setImageUrl("");
    try {
      const token = await session.getAccessToken();
      if (!token) {
        setStage({kind: "failed", message: "Sign in to upload a picture."});
        return;
      }
      const body = new FormData();
      body.append("file", await (await fetch(dataUrl)).blob(), "logo");
      const response = await fetch("/api/launch/logo", {
        method: "POST",
        headers: {authorization: `Bearer ${token}`},
        body,
      });
      const result = (await response.json()) as {url?: string; error?: string};
      if (!response.ok || !result.url) {
        setStage({
          kind: "failed",
          message: result.error ?? "That image did not upload.",
        });
        return;
      }
      setImageUrl(result.url);
      setStage({kind: "idle"});
    } catch {
      setStage({kind: "failed", message: "That image did not upload."});
    } finally {
      setUploading(false);
    }
  }

  async function launch() {
    if (!ready || launchFee === null) return;
    setStage({kind: "working", label: "Confirm in your wallet"});
    const result = await launcher.launch(draft, launchFee);
    if (!result) {
      setStage({
        kind: "failed",
        message: launcher.error ?? "That did not go through.",
      });
      return;
    }
    setStage({
      kind: "done",
      address: result.address ?? "",
      symbol: symbol.toUpperCase(),
      txHash: result.txHash,
    });
  }

  const padLabel = LAUNCHPADS.find((entry) => entry.value === launchpad)?.label ?? "";
  const title =
    stage.kind === "done"
      ? `${stage.symbol} is live`
      : cropSource
        ? "Crop image"
        : "Launch a token";

  return (
    <Modal
      open={open}
      onClose={working ? () => undefined : onClose}
      surface="popup"
      title={title}
      className="max-w-[352px] p-5 pt-5"
    >
      {stage.kind === "done" ? (
        <Launched stage={stage} onClose={onClose} />
      ) : cropSource ? (
        <ImageCropper
          source={cropSource}
          onCancel={() => setCropSource(null)}
          onDone={(data) => {
            setImage(data);
            setCropSource(null);
            void upload(data);
          }}
        />
      ) : (
        <>
          {/* Where it launches. */}
          <div className="flex gap-0.5 rounded-full bg-[var(--segment-track)] p-[3px]">
            {LAUNCHPADS.map((entry) => (
              <button
                key={entry.value}
                type="button"
                aria-pressed={launchpad === entry.value}
                disabled={working}
                onClick={() => {
                  setLaunchpad(entry.value);
                  // A pair one launchpad accepts the other may not.
                  setPair(null);
                }}
                className={cn(
                  "flex-1 rounded-full py-1.5 text-[12.5px] font-extrabold transition-colors disabled:opacity-40",
                  launchpad === entry.value
                    ? "bg-[var(--bg-input)] text-ink shadow-tab-active"
                    : "text-faint hover:text-muted",
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <div className="mt-3 flex gap-3">
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                aria-label={image ? "Change the image" : "Choose an image"}
                className="grid h-[76px] w-[76px] place-items-center overflow-hidden rounded-2xl bg-[var(--bg-input)] text-[11px] font-bold text-faint shadow-inset-soft transition-colors hover:text-muted"
              >
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image} alt="" className="h-full w-full object-cover" />
                ) : (
                  "Image"
                )}
              </button>
              {image && !image.startsWith("data:image/gif") ? (
                <button
                  type="button"
                  onClick={() => setCropSource(image)}
                  className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full bg-surface-popup px-2 py-0.5 text-[10px] font-extrabold text-muted shadow-panel hover:text-ink"
                >
                  Crop
                </button>
              ) : null}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(event) => {
                void pickImage(event.target.files?.[0]);
                event.target.value = "";
              }}
            />

            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <input
                value={name}
                onChange={(event) => setName(event.target.value.slice(0, MAX_NAME))}
                placeholder="Name"
                aria-label="Token name"
                className="h-[34px] rounded-xl bg-[var(--bg-input)] px-3 text-[13.5px] max-lg:text-[16px] font-bold text-ink shadow-inset-soft outline-none placeholder:font-semibold placeholder:text-faint focus:shadow-inset-focus"
              />
              <input
                value={symbol}
                onChange={(event) =>
                  setSymbol(
                    event.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, "")
                      .slice(0, MAX_SYMBOL),
                  )
                }
                placeholder="TICKER"
                aria-label="Ticker"
                className="h-[34px] rounded-xl bg-[var(--bg-input)] px-3 text-[13.5px] max-lg:text-[16px] font-extrabold uppercase tracking-[0.02em] text-ink shadow-inset-soft outline-none placeholder:font-semibold placeholder:text-faint focus:shadow-inset-focus"
              />
            </div>
          </div>

          {/* The stock it is priced in, searchable. */}
          <div className="mb-1.5 mt-3.5 flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.09em] text-faint">
              Priced in
            </span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search stocks"
              aria-label="Search stocks"
              className="h-[26px] w-[140px] rounded-full bg-[var(--bg-input)] px-3 text-[11.5px] max-lg:text-[16px] font-semibold text-ink shadow-inset-soft outline-none placeholder:text-faint focus:shadow-inset-focus"
            />
          </div>
          <div className="rail -mx-5 flex gap-1.5 overflow-x-auto overscroll-x-contain px-5">
            {stocks.length === 0 ? (
              <span className="py-1.5 text-[12px] font-semibold text-faint">
                {forPad === null ? "Loading stocks…" : `No match on ${padLabel}`}
              </span>
            ) : (
              stocks.map((entry) => {
                const active = pair?.address === entry.address;
                return (
                  <button
                    key={`${entry.address}-${entry.label}`}
                    type="button"
                    title={entry.name ?? entry.label}
                    aria-pressed={active}
                    onClick={() => {
                      setPair(entry);
                      if (entry.isRwa) setRewardRwa(null);
                    }}
                    className={cn(
                      "shrink-0 rounded-full px-3 py-1.5 text-[12px] font-extrabold transition-colors",
                      active
                        ? "bg-brand-500 text-white"
                        : "bg-[var(--overlay-wash)] text-muted hover:text-ink",
                    )}
                  >
                    {entry.label}
                  </button>
                );
              })
            )}
          </div>

          {/*
            Only asked for when it is load-bearing. Off a stock pair the token
            already qualifies; against ETH or USDG it does not, and paying
            holders in a stock is the only thing that changes that.
          */}
          {pair && !pair.isRwa ? (
            <>
              <OptionRow
                label="Pay holders in"
                hint={
                  rewardRwa
                    ? `Holders earn ${rewardRwa}`
                    : "Required — otherwise it will not show in hodl"
                }
              >
                <span className="text-[11.5px] font-extrabold text-ink">
                  {rewardRwa ?? "—"}
                </span>
              </OptionRow>
              <div className="rail -mx-5 mt-1.5 flex gap-1.5 overflow-x-auto overscroll-x-contain px-5">
                {(options?.rewardStocks ?? []).slice(0, 40).map((ticker) => (
                  <button
                    key={ticker}
                    type="button"
                    aria-pressed={rewardRwa === ticker}
                    onClick={() => setRewardRwa(rewardRwa === ticker ? null : ticker)}
                    className={cn(
                      "shrink-0 rounded-full px-3 py-1.5 text-[12px] font-extrabold transition-colors",
                      rewardRwa === ticker
                        ? "bg-brand-500 text-white"
                        : "bg-[var(--overlay-wash)] text-muted hover:text-ink",
                    )}
                  >
                    {ticker}
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {/* The launchpad's own choice. */}
          {launchpad === "pons" ? (
            <OptionRow label="Creator fee" hint="Taken on every trade on the curve">
              <Segments
                values={CREATOR_FEE_CHOICES}
                value={creatorFeeBps}
                onChange={setCreatorFeeBps}
                format={(bps) => `${bps / 100}%`}
              />
            </OptionRow>
          ) : (
            <OptionRow label="Pool fees" hint="Long splits them 95% to you, 5% protocol">
              <span className="text-[11.5px] font-extrabold text-ink">95%</span>
            </OptionRow>
          )}

          {/* Buying your own token in the same flow. */}
          <div className="mt-3 flex items-center justify-between gap-2">
            <div>
              <div className="text-[12px] font-semibold text-faint">First buy</div>
              <div className="text-[10.5px] font-medium text-faint">
                Optional · buy first, at launch price
              </div>
            </div>
            <div className="flex items-center gap-1">
              {DEV_BUY_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setDevBuy(devBuy === preset ? "" : preset)}
                  className={cn(
                    "rounded-full px-2 py-1 text-[11px] font-extrabold transition-colors",
                    devBuy === preset
                      ? "bg-brand-500 text-white"
                      : "bg-[var(--overlay-wash)] text-muted hover:text-ink",
                  )}
                >
                  {preset}
                </button>
              ))}
              <div className="flex h-[28px] w-[74px] items-center rounded-full bg-[var(--bg-input)] pr-2 shadow-inset-soft focus-within:shadow-inset-focus">
                <input
                  value={devBuy}
                  inputMode="decimal"
                  onChange={(event) =>
                    setDevBuy(event.target.value.replace(/[^0-9.]/g, "").slice(0, 8))
                  }
                  placeholder="0"
                  aria-label="First buy amount"
                  className="w-full min-w-0 bg-transparent pl-2.5 text-right text-[12px] max-lg:text-[16px] font-bold text-ink outline-none placeholder:text-faint"
                />
                <span className="pl-1 text-[10px] font-bold text-faint">
                  {pair?.label ?? "ETH"}
                </span>
              </div>
            </div>
          </div>

          {showMore ? (
            <div className="mt-3 flex flex-col gap-1.5">
              <textarea
                value={description}
                onChange={(event) =>
                  setDescription(event.target.value.slice(0, MAX_DESCRIPTION))
                }
                placeholder="Description (optional)"
                aria-label="Description"
                rows={2}
                className="resize-none rounded-xl bg-[var(--bg-input)] px-3 py-2 text-[12.5px] max-lg:text-[16px] font-semibold text-ink shadow-inset-soft outline-none placeholder:text-faint focus:shadow-inset-focus"
              />
              {(["x", "telegram", "website"] as const).map((key) => (
                <input
                  key={key}
                  value={links[key]}
                  onChange={(event) => setLinks({...links, [key]: event.target.value})}
                  placeholder={
                    key === "x"
                      ? "https://x.com/…"
                      : key === "telegram"
                        ? "https://t.me/…"
                        : "https://…"
                  }
                  aria-label={key}
                  className="h-[32px] rounded-xl bg-[var(--bg-input)] px-3 text-[12.5px] max-lg:text-[16px] font-semibold text-ink shadow-inset-soft outline-none placeholder:text-faint focus:shadow-inset-focus"
                />
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowMore(true)}
              className="mt-2.5 text-[12px] font-bold text-faint transition-colors hover:text-accent-link"
            >
              + Description &amp; links
            </button>
          )}

          {authenticated ? (
            <Bill
              formReady={formReady}
              launchFee={launchFee}
              creatorFeeBps={creatorFeeBps}
              devBuy={devBuy}
              pairLabel={pair?.label ?? ""}
              padLabel={padLabel}
              signatures={signatures}
              uploading={uploading}
            />
          ) : null}

          {stage.kind === "failed" ? (
            <p role="alert" className="mt-3 text-[12px] font-semibold leading-[1.45] text-error">
              {stage.message}
            </p>
          ) : null}

          {!authenticated ? (
            <button
              type="button"
              onClick={() => user.login?.()}
              className="mt-4 flex h-[50px] w-full items-center justify-center rounded-2xl bg-brand-500 text-[15px] font-extrabold text-white shadow-brand"
            >
              Sign in to launch
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                // The picture is on screen but never reached storage, so the
                // launch would carry an empty logo. Offer the retry here
                // rather than making them pick the file again.
                if (image && !imageUrl && !uploading) {
                  void upload(image);
                  return;
                }
                void launch();
              }}
              disabled={uploading || working || (imageUrl ? Boolean(blocked) : !image)}
              className="mt-4 flex h-[50px] w-full items-center justify-center gap-2 rounded-2xl bg-brand-500 text-[15px] font-extrabold text-white shadow-brand transition-[transform,opacity] duration-150 hover:-translate-y-px disabled:translate-y-0 disabled:opacity-45"
            >
              {working ? (
                launchPhaseLabel(launcher.phase, stage.label)
              ) : (
                <>
                  <RocketIcon className="h-4 w-4" />
                  {uploading
                    ? "Uploading image…"
                    : image && !imageUrl
                      ? "Retry image upload"
                      : !image && formReady
                        ? "Add an image to launch"
                        : `Launch${symbol ? ` ${symbol}` : ""}${
                            devBuy && Number(devBuy) > 0 ? " + buy" : ""
                          }`}
                </>
              )}
            </button>
          )}

          <p className="mt-2 text-center text-[11px] font-medium leading-[1.45] text-faint">
            {blocked && formReady
              ? blocked
              : signatures === 2
                ? `Two approvals: the launch, then your ${pair?.label ?? ""} buy`
                : `One approval · listed on ${padLabel}${
                    pair ? `, priced in ${pair.label}` : ""
                  }`}
          </p>
        </>
      )}
    </Modal>
  );
}

/** Button copy while a launch is in flight. */
function launchPhaseLabel(phase: string, fallback: string): string {
  if (phase === "pending") return "Launching…";
  if (phase === "recording") return "Listing it…";
  return fallback;
}

function OptionRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[12px] font-semibold text-faint">{label}</div>
        <div className="truncate text-[10.5px] font-medium text-faint">{hint}</div>
      </div>
      {children}
    </div>
  );
}

function Segments<T extends number>({
  values,
  value,
  onChange,
  format,
}: {
  values: T[];
  value: T;
  onChange: (value: T) => void;
  format: (value: T) => string;
}) {
  return (
    <div className="flex shrink-0 gap-0.5 rounded-full bg-[var(--segment-track)] p-[2px]">
      {values.map((entry) => (
        <button
          key={entry}
          type="button"
          aria-pressed={value === entry}
          onClick={() => onChange(entry)}
          className={cn(
            "rounded-full px-3 py-1 text-[11.5px] font-extrabold transition-colors",
            value === entry
              ? "bg-[var(--bg-input)] text-ink shadow-tab-active"
              : "text-faint hover:text-muted",
          )}
        >
          {format(entry)}
        </button>
      ))}
    </div>
  );
}

/**
 * The whole bill, line by line, before anything is signed.
 *
 * The launch fee is read from the factory rather than assumed, because it is
 * the one number the transaction reverts over if it is wrong.
 */
function Bill({
  formReady,
  launchFee,
  creatorFeeBps,
  devBuy,
  pairLabel,
  padLabel,
  signatures,
  uploading,
}: {
  formReady: boolean;
  launchFee: bigint | null;
  creatorFeeBps: number;
  devBuy: string;
  pairLabel: string;
  padLabel: string;
  signatures: 1 | 2;
  uploading: boolean;
}) {
  if (!formReady) {
    return (
      <p className="mt-3 rounded-2xl bg-[var(--segment-track)] px-3 py-2.5 text-[11.5px] font-medium text-faint shadow-inset-soft">
        Add a name, ticker and pair to see the full cost.
      </p>
    );
  }
  if (launchFee === null) {
    return (
      <div className="mt-3 rounded-2xl bg-[var(--segment-track)] px-3 py-2.5 text-[11.5px] font-medium text-faint shadow-inset-soft">
        Reading the launch fee…
      </div>
    );
  }

  const buying = Boolean(devBuy && Number(devBuy) > 0);

  return (
    <div
      className={cn(
        "mt-3 rounded-2xl bg-[var(--segment-track)] px-3 py-2.5 shadow-inset-soft transition-opacity",
        uploading && "opacity-60",
      )}
    >
      <Section title="Launch">
        <Line
          label={`${padLabel} launch fee`}
          note="Paid to the launchpad with the launch"
          value={launchFee === 0n ? "Free" : eth(launchFee)}
        />
        <Line
          label="Creator fee"
          note="Yours, taken on every trade on the curve"
          value={`${(creatorFeeBps / 100).toFixed(2)}%`}
        />
      </Section>

      {buying ? (
        <Section title="First buy">
          <Line
            label={`Spends your ${pairLabel}`}
            note="A second transaction, sent once the launch confirms"
            value={`${devBuy} ${pairLabel}`}
            strong
          />
        </Section>
      ) : null}

      <Line label="hodl fee" note="hodl takes nothing on a launch" value="None" />

      <div className="mt-2 flex items-baseline justify-between border-t border-[var(--overlay-wash-hover)] pt-2">
        <span className="text-[12.5px] font-extrabold text-ink">Total</span>
        <span className="tabular-nums text-right">
          <span className="text-[13.5px] font-extrabold text-ink">{eth(launchFee)}</span>
          {buying ? (
            <span className="ml-1 text-[11px] font-semibold text-faint">
              + {devBuy} {pairLabel}
            </span>
          ) : null}
        </span>
      </div>
      <div className="mt-0.5 text-right text-[10.5px] font-semibold tabular-nums text-faint">
        Plus gas · {signatures} {signatures === 1 ? "signature" : "signatures"}
      </div>
    </div>
  );
}

function Section({title, children}: {title: string; children: React.ReactNode}) {
  return (
    <div className="mb-1.5">
      <div className="mb-0.5 text-[9.5px] font-bold uppercase tracking-[0.09em] text-faint">
        {title}
      </div>
      {children}
    </div>
  );
}

function Line({
  label,
  note,
  value,
  strong,
}: {
  label: string;
  note: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[2px]" title={note}>
      <span className="min-w-0 truncate text-[11.5px] font-semibold text-muted">
        {label}
      </span>
      <span
        className={cn(
          "shrink-0 tabular-nums text-[11.5px]",
          strong ? "font-extrabold text-ink" : "font-bold text-ink",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function Launched({
  stage,
  onClose,
}: {
  stage: Extract<Stage, {kind: "done"}>;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col items-center py-4 text-center">
      <span className="mb-3 text-brand-500">
        <RocketIcon className="h-8 w-8" />
      </span>
      <p className="text-[15px] font-extrabold text-ink">{stage.symbol} is live</p>
      <p className="mt-1 text-[12px] font-medium text-faint">
        It will show in New within a minute.
      </p>
      <button
        type="button"
        onClick={onClose}
        className="mt-5 h-[46px] w-full rounded-2xl bg-brand-500 text-[14.5px] font-extrabold text-white shadow-brand"
      >
        Done
      </button>
    </div>
  );
}
