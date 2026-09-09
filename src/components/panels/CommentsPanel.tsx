"use client";

import {useEffect, useRef, useState, type KeyboardEvent} from "react";
import Link from "next/link";
import {useComments} from "@/hooks/useComments";
import {stamp} from "@/lib/format";
import {profilePath} from "@/lib/routes";
import type {AssetComment, AssetKind, CommentThread} from "@/lib/types";
import {Avatar} from "../ui/Avatar";
import {CloseIcon} from "../ui/Icons";
import {PanelError, PanelNote} from "./TradesPanel";

/**
 * Time-and-date stamped theses, one level of replies deep.
 *
 * Timestamps are absolute rather than relative: a comment here is a call, and
 * "3d ago" stops meaning anything the moment someone scrolls back through a
 * month of them.
 */
export function CommentsPanel({
  kind,
  assetId,
  symbol,
}: {
  kind: AssetKind;
  assetId: string;
  symbol: string;
}) {
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<{rootId: string; label: string} | null>(
    null,
  );
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const {threads, isLoading, error, retry, canPost, post} = useComments(kind, assetId);

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

  return (
    <div>
      {isLoading ? (
        <PanelNote>Loading comments</PanelNote>
      ) : error ? (
        <PanelError message={error} onRetry={retry} />
      ) : threads.length === 0 ? (
        <PanelNote>No reads on {symbol} yet. Post the first one.</PanelNote>
      ) : (
        <ul className="flex flex-col gap-4">
          {threads.map((thread) => (
            <Thread key={thread.root.id} thread={thread} onReply={startReply} />
          ))}
        </ul>
      )}

      <div className="sticky bottom-0 mt-2 bg-surface-base/95 pt-2.5 shadow-[0_-10px_28px_-14px_var(--shadow-color)] backdrop-blur-[12px]">
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
          {replyTo ? `Reply to ${replyTo.label}` : `Share your read on ${symbol}`}
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
                  : `Your thesis on ${symbol}…`
                : "Sign in to post"
            }
            className="max-h-[64px] min-h-[38px] flex-1 resize-none rounded-2xl bg-[var(--bg-input)] px-3 py-2.5 text-[13px] leading-[1.4] text-ink shadow-inset-soft outline-none transition-[box-shadow,background-color] placeholder:text-faint focus:shadow-inset-focus disabled:cursor-not-allowed disabled:opacity-55"
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
            className={
              remaining <= 0
                ? "mt-1.5 text-right text-[11px] font-semibold text-error"
                : "mt-1.5 text-right text-[11px] font-semibold text-faint"
            }
          >
            {remaining}
          </p>
        ) : null}
        <p className="mt-1.5 text-[11px] font-medium leading-[1.45] text-faint">
          Posts are saved in this browser until the comment database is connected.
        </p>
      </div>
    </div>
  );
}

function Thread({
  thread,
  onReply,
}: {
  thread: CommentThread;
  onReply: (comment: AssetComment, rootId: string) => void;
}) {
  return (
    <li>
      <CommentRow
        comment={thread.root}
        onReply={(comment) => onReply(comment, thread.root.id)}
      />
      {thread.replies.length > 0 ? (
        <ul className="ml-[15px] mt-3 flex flex-col gap-3 border-l-2 border-[var(--overlay-wash-hover)] pl-[15px]">
          {thread.replies.map((reply) => (
            <li key={reply.id}>
              <CommentRow
                comment={reply}
                compact
                onReply={(comment) => onReply(comment, thread.root.id)}
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
  compact,
  onReply,
}: {
  comment: AssetComment;
  compact?: boolean;
  onReply: (comment: AssetComment) => void;
}) {
  return (
    <div className="flex gap-2.5">
      <Link href={profilePath(comment.author.handle)} className="shrink-0">
        <Avatar
          name={comment.author.displayName}
          src={comment.author.pfpUrl}
          size={compact ? 24 : 30}
          className="mt-0.5"
        />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <Link
            href={profilePath(comment.author.handle)}
            className="text-[13px] font-extrabold tracking-[-0.01em] transition-colors hover:text-accent-link"
          >
            @{comment.author.handle}
          </Link>
          <time
            dateTime={comment.createdAt}
            className="text-[11px] font-medium text-faint"
          >
            {stamp(comment.createdAt)}
          </time>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-[1.5] text-muted">
          {comment.body}
        </p>
        <button
          type="button"
          onClick={() => onReply(comment)}
          className="mt-1 text-[11.5px] font-bold text-faint transition-colors hover:text-accent-link"
        >
          Reply
        </button>
      </div>
    </div>
  );
}
