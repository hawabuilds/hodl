"use client";

import {useEffect, useRef, useState, type KeyboardEvent} from "react";
import Link from "next/link";

import {useComments} from "@/hooks/useComments";
import {cn} from "@/lib/cn";
import {compactMoney, stamp} from "@/lib/format";
import {profilePath} from "@/lib/routes";
import type {AssetComment, AssetKind, CommentThread} from "@/lib/types";
import {Avatar} from "../ui/Avatar";
import {CloseIcon, HeartIcon, ReplyIcon} from "../ui/Icons";
import {PanelError, PanelNote} from "./TradesPanel";

/**
 * Comments, each carrying what its author actually did in this asset.
 *
 * Laid out like a trading terminal's thesis feed: the author and a badge for
 * whether they still hold, then — on a line hanging off their avatar — the
 * asset, their return and how much they put in, then what they said, then
 * likes and replies.
 *
 * The position line is the point of the design. A take reads very differently
 * from someone up 60% than from someone who sold at a loss, and every figure
 * on it is derived from the position hodl already tracks. There is nowhere to
 * type it, so there is no way to fake it. Holding is also what earns a say at
 * all: the composer is closed to anyone without one.
 *
 * Timestamps stay absolute: a comment here is a call, and "3d ago" stops
 * meaning anything the moment someone scrolls back through a month of them.
 */
export function CommentsPanel({
  kind,
  assetId,
  symbol,
  imageUrl,
  focusCommentId,
}: {
  kind: AssetKind;
  assetId: string;
  symbol: string;
  /** The asset's art, for the position line. Stocks fall back to initials. */
  imageUrl?: string | null;
  /** Scrolled to and briefly marked once it loads — a reply from the bell. */
  focusCommentId?: string | null;
}) {
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<{rootId: string; label: string} | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const {
    threads,
    isLoading,
    error,
    retry,
    canPost,
    canLike,
    needsPosition,
    post,
    toggleLike,
  } = useComments(kind, assetId);

  useEffect(() => {
    setDraft("");
    setReplyTo(null);
  }, [assetId]);

  const trimmed = draft.trim();
  const remaining = 500 - draft.length;

  function submit() {
    if (!trimmed) return;
    post({body: trimmed, parentId: replyTo?.rootId ?? null});
    setDraft("");
    setReplyTo(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape" && replyTo) {
      setReplyTo(null);
      return;
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submit();
  }

  function startReply(comment: AssetComment, rootId: string) {
    setReplyTo({rootId, label: `@${comment.author.handle}`});
    composerRef.current?.focus();
  }

  // Newest first: a call made an hour ago is worth more than one made a month
  // ago, and the composer sits at the bottom either way.
  const ordered = [...threads].reverse();

  const focusLoaded = Boolean(
    focusCommentId &&
      threads.some(
        (thread) =>
          thread.root.id === focusCommentId ||
          thread.replies.some((reply) => reply.id === focusCommentId),
      ),
  );
  useEffect(() => {
    if (!focusCommentId || !focusLoaded) return;
    // After the thread holding it has opened its replies.
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(`c-${focusCommentId}`)
        ?.scrollIntoView({block: "center", behavior: "smooth"});
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusCommentId, focusLoaded]);

  return (
    <div>
      {isLoading ? (
        <PanelNote>Loading comments</PanelNote>
      ) : error ? (
        <PanelError message={error} onRetry={retry} />
      ) : ordered.length === 0 ? (
        <PanelNote>No takes on {symbol} yet. Post the first one.</PanelNote>
      ) : (
        <ul className="-mx-[22px]">
          {ordered.map((thread) => (
            <Thread
              key={thread.root.id}
              thread={thread}
              focusId={focusCommentId ?? null}
              symbol={symbol}
              imageUrl={imageUrl ?? null}
              onReply={startReply}
              onLike={toggleLike}
              canLike={canLike}
              canReply={canPost}
            />
          ))}
        </ul>
      )}

      <div className="sticky bottom-0 mt-2 bg-surface-base pt-2.5 shadow-[0_-10px_28px_-14px_var(--shadow-color)]">
        {replyTo ? (
          <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-faint">
            <span className="min-w-0 truncate">
              Replying to <b className="font-extrabold text-muted">{replyTo.label}</b>
            </span>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              aria-label="Cancel reply"
              className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-[var(--overlay-wash)] text-muted transition-colors hover:bg-[var(--overlay-wash-hover)]"
            >
              <CloseIcon className="h-2.5 w-2.5" />
            </button>
          </div>
        ) : null}

        <label htmlFor={`comment-${assetId}`} className="sr-only">
          {replyTo ? `Reply to ${replyTo.label}` : `Share your take on ${symbol}`}
        </label>
        <div className="flex items-end gap-2">
          <textarea
            ref={composerRef}
            id={`comment-${assetId}`}
            rows={1}
            value={draft}
            disabled={!canPost}
            onChange={(event) => setDraft(event.target.value.slice(0, 500))}
            onKeyDown={onKeyDown}
            placeholder={
              canPost
                ? replyTo
                  ? `Reply to ${replyTo.label}…`
                  : `Your take on ${symbol}…`
                : needsPosition
                  ? `Hold ${symbol} to comment`
                  : "Sign in to post"
            }
            className="max-h-[64px] min-h-[38px] flex-1 resize-none rounded-2xl bg-[var(--bg-input)] px-3 py-2.5 text-[13px] max-lg:text-[16px] leading-[1.4] text-ink shadow-inset-soft outline-none transition-[box-shadow,background-color] placeholder:text-faint focus:shadow-inset-focus disabled:cursor-not-allowed disabled:opacity-55"
          />
          <button
            type="button"
            disabled={!canPost || !trimmed}
            onClick={submit}
            className="shrink-0 rounded-full bg-brand-500 px-4 py-2.5 text-[12.5px] font-bold text-white shadow-brand transition-[transform,background-color,opacity] duration-150 hover:-translate-y-px hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {replyTo ? "Reply" : "Post"}
          </button>
        </div>
        {draft.length > 0 ? (
          <p
            className={cn(
              "mt-1.5 text-right text-[11px] font-semibold",
              remaining <= 0 ? "text-error" : "text-faint",
            )}
          >
            {remaining}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Thread({
  thread,
  symbol,
  imageUrl,
  onReply,
  onLike,
  canLike,
  canReply,
  focusId,
}: {
  thread: CommentThread;
  focusId: string | null;
  symbol: string;
  imageUrl: string | null;
  onReply: (comment: AssetComment, rootId: string) => void;
  onLike: (commentId: string) => void;
  canLike: boolean;
  canReply: boolean;
}) {
  // Replies collapsed by default, so a long argument does not bury the calls.
  const [open, setOpen] = useState(false);
  const replies = thread.replies;
  const focusInReplies = focusId != null && replies.some((reply) => reply.id === focusId);
  useEffect(() => {
    if (focusInReplies) setOpen(true);
  }, [focusInReplies]);

  return (
    <li className="border-b border-[var(--overlay-wash)] last:border-b-0">
      <CommentRow
        comment={thread.root}
        focused={focusId === thread.root.id}
        symbol={symbol}
        imageUrl={imageUrl}
        replyCount={replies.length}
        repliesOpen={open}
        onToggleReplies={() => setOpen((value) => !value)}
        onReply={(comment) => onReply(comment, thread.root.id)}
        onLike={onLike}
        canLike={canLike}
        canReply={canReply}
      />
      {open && replies.length > 0 ? (
        <ul className="ml-[44px] border-l-2 border-[var(--overlay-wash-hover)]">
          {replies.map((reply) => (
            <li key={reply.id}>
              <CommentRow
                comment={reply}
                focused={focusId === reply.id}
                symbol={symbol}
                imageUrl={imageUrl}
                compact
                onReply={(comment) => onReply(comment, thread.root.id)}
                onLike={onLike}
                canLike={canLike}
                canReply={canReply}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function CommentRow({
  comment,
  focused,
  symbol,
  imageUrl,
  compact,
  replyCount = 0,
  repliesOpen,
  onToggleReplies,
  onReply,
  onLike,
  canLike,
  canReply,
}: {
  comment: AssetComment;
  focused?: boolean;
  symbol: string;
  imageUrl: string | null;
  compact?: boolean;
  replyCount?: number;
  repliesOpen?: boolean;
  onToggleReplies?: () => void;
  onReply: (comment: AssetComment) => void;
  onLike: (commentId: string) => void;
  canLike: boolean;
  /** Replying is commenting, so it needs a holding too. */
  canReply: boolean;
}) {
  const position = comment.position ?? null;

  return (
    <div
      id={`c-${comment.id}`}
      className={cn(
        "px-[22px] transition-colors duration-700",
        compact ? "py-3" : "py-3.5",
        focused && "bg-[color-mix(in_srgb,var(--accent)_9%,transparent)]",
      )}
    >
      <div className="flex items-start gap-2.5">
        <Link href={profilePath(comment.author.handle)} className="shrink-0">
          <Avatar
            name={comment.author.displayName}
            src={comment.author.pfpUrl}
            size={compact ? 26 : 32}
          />
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Link
              href={profilePath(comment.author.handle)}
              className="truncate text-[13.5px] font-extrabold tracking-[-0.01em] transition-colors hover:text-accent-link"
            >
              @{comment.author.handle}
            </Link>
            {position ? <StatusBadge status={position.status} /> : null}
            <time
              dateTime={comment.createdAt}
              className="ml-auto shrink-0 pl-2 text-[11px] font-medium text-faint"
            >
              {stamp(comment.createdAt)}
            </time>
          </div>

          {/*
            The position line, hanging off the avatar. Omitted rather than
            filled with zeros when there is nothing to say: an author whose
            cost basis we never captured is not someone who is up 0%.
          */}
          {position && (position.gainPct !== null || position.boughtUsd > 0) ? (
            <div className="relative mt-1.5 flex items-center gap-1.5 pl-3.5">
              <span
                aria-hidden="true"
                className="absolute left-0 top-[-6px] h-[14px] w-2.5 rounded-bl-[6px] border-b-2 border-l-2 border-[var(--overlay-wash-hover)]"
              />
              <Avatar name={symbol} src={imageUrl} size={16} />
              {position.gainPct !== null ? (
                <span
                  className={cn(
                    "tabular-nums text-[12px] font-extrabold",
                    position.gainPct >= 0 ? "text-price-up" : "text-price-down",
                  )}
                >
                  {position.gainPct >= 0 ? "▲" : "▼"}{" "}
                  {position.gainPct >= 0 ? "+" : ""}
                  {position.gainPct.toFixed(2)}%
                </span>
              ) : null}
              {position.boughtUsd > 0 ? (
                <span className="tabular-nums text-[12px] font-semibold text-faint">
                  {position.gainPct !== null ? "· " : ""}
                  {compactMoney(position.boughtUsd)} bought
                </span>
              ) : null}
            </div>
          ) : null}

          <p className="mt-1.5 whitespace-pre-wrap break-words text-[13.5px] leading-[1.5] text-ink">
            {comment.body}
          </p>

          <div className="mt-2 flex items-center gap-4 text-[12px] font-bold text-faint">
            <button
              type="button"
              onClick={() => onLike(comment.id)}
              disabled={!canLike}
              aria-pressed={comment.liked}
              aria-label={comment.liked ? "Unlike" : "Like"}
              className={cn(
                "flex items-center gap-1.5 tabular-nums transition-colors disabled:cursor-default",
                comment.liked ? "text-price-down" : "hover:text-muted",
              )}
            >
              <HeartIcon filled={comment.liked} className="h-[15px] w-[15px]" />
              {comment.likes}
            </button>

            {canReply ? (
              <button
                type="button"
                onClick={() => onReply(comment)}
                className="flex items-center gap-1.5 transition-colors hover:text-accent-link"
              >
                <ReplyIcon className="h-[15px] w-[15px]" />
                Reply
              </button>
            ) : null}

            {replyCount > 0 && onToggleReplies ? (
              <button
                type="button"
                onClick={onToggleReplies}
                aria-expanded={repliesOpen}
                className="transition-colors hover:text-muted"
              >
                {repliesOpen
                  ? "Hide replies"
                  : `${replyCount} ${replyCount === 1 ? "reply" : "replies"}`}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** "Holding" or "Sold" — whether the author still has money on this. */
function StatusBadge({status}: {status: "holding" | "sold"}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-[5px] px-1.5 py-[3px] text-[10px] font-extrabold leading-none",
        status === "holding"
          ? "bg-[var(--price-up-wash)] text-price-up"
          : "bg-[var(--price-down-wash)] text-price-down",
      )}
    >
      {status === "holding" ? "Holding" : "Sold"}
    </span>
  );
}
