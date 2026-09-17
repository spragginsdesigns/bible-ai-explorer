"use client";

import React, { useEffect, useState } from "react";
import { Check, Copy, Loader2, NotebookPen, Share2, ThumbsDown, ThumbsUp } from "lucide-react";
import FormattedResponse from "./FormattedResponse";
import TavilyCollapsible from "./TavilyCollapsible";
import RetrievedVersesCollapsible from "./RetrievedVersesCollapsible";
import FollowUpChips from "./FollowUpChips";
import AddToNoteDialog from "./AddToNoteDialog";
import type { ChatMessage as ChatMessageType } from "./useChat";
import ChatFileAttachments from "./ChatFileAttachments";
import VersePopover from "./VersePopover";
import { parseVerseReferences } from "@/utils/verseParser";
import { normalizeAssistantMarkdown } from "@/utils/assistantMarkdown";
import WorkActivity from "./WorkActivity";
import SureWordGuideAvatar from "./SureWordGuideAvatar";
import ReceiptLine from "./chat/ReceiptLine";
import { FEEDBACK_TAGS, type FeedbackTagId } from "@/lib/chat/answer-feedback";
import {
	FEEDBACK_REASON_MAX_LENGTH,
	copyableAnswerText,
	setAnswerFeedback,
	type AnswerFeedback,
	type AnswerFeedbackDetails,
} from "@/lib/chat/feedback-client";
import { presentShareLink, shareAnswer, shareSheetText } from "@/lib/chat/share-client";

interface ChatMessageProps {
	message: ChatMessageType;
	onFollowUp?: (question: string) => void;
	/** Active conversation title, used as the default title for new notes. */
	conversationTitle?: string;
}

/**
 * Quiet chrome under a settled answer. The row is glyphs only - copy, notes,
 * the two thumbs, share - so the answer keeps the reader's eye and the actions
 * stay within reach; every glyph carries its own label for anyone who is not
 * reading by sight.
 */
const ACTION_CLASS =
	"flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-500 hover:text-amber-600 dark:hover:text-amber-400 transition-colors";
/** A chosen thumb, or a just-copied answer, wears the accent hover promises. */
const ACTION_CHOSEN_CLASS =
	"flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 transition-colors";
/** A glyph is the whole target, so every icon button carries the 44px minimum. */
const ICON_TAP_CLASS = "min-h-11 min-w-11 justify-center sm:min-h-0 sm:min-w-0";
/** Chips are their own row, and a pill is a smaller target than a bare glyph. */
const CHIP_CLASS = "min-h-9 rounded-full border px-3 py-1.5 text-xs transition-colors";
/** The share sheet's heading. The answer itself travels as the descriptive line. */
const SHARE_TITLE = "An answer from SureWord";
/** How long "Link copied" stays up before the row goes quiet again. */
const SHARE_COPIED_MS = 2000;
/** How long the Copy glyph holds its check before returning to the clipboard. */
const COPIED_MS = 1500;

const ChatMessage: React.FC<ChatMessageProps> = ({ message, onFollowUp, conversationTitle }) => {
	const [addToNoteOpen, setAddToNoteOpen] = useState(false);
	/**
	 * `undefined` means "nobody has touched this yet", so the value the server
	 * replayed still stands. Anything else is this reader's own choice and wins
	 * until the conversation is reloaded.
	 */
	const [chosenFeedback, setChosenFeedback] = useState<AnswerFeedback | null | undefined>(undefined);
	const [reasonOpen, setReasonOpen] = useState(false);
	const [reason, setReason] = useState("");
	const [reasonTags, setReasonTags] = useState<FeedbackTagId[]>([]);
	const [feedbackPending, setFeedbackPending] = useState(false);
	const [feedbackError, setFeedbackError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [copyError, setCopyError] = useState<string | null>(null);
	const [sharePending, setSharePending] = useState(false);
	const [shareCopied, setShareCopied] = useState(false);
	const [shareError, setShareError] = useState<string | null>(null);

	const conversationId = message.conversationId;
	const feedback = chosenFeedback === undefined ? message.feedback ?? null : chosenFeedback;

	/**
	 * Write the thumb, optimistically. The chosen glyph fills immediately and
	 * reverts to whatever it was if the route refuses, which is the same
	 * pattern the receipt line's Undo uses.
	 */
	const saveFeedback = async (next: AnswerFeedback | null, details?: AnswerFeedbackDetails) => {
		if (!conversationId || feedbackPending) return;
		const previous = feedback;
		setChosenFeedback(next);
		setFeedbackPending(true);
		setFeedbackError(null);
		try {
			const saved = await setAnswerFeedback(conversationId, message.id, next, details);
			setChosenFeedback(saved.feedback);
		} catch (error) {
			setChosenFeedback(previous);
			setFeedbackError(
				error instanceof Error ? error.message : "Could not save that rating."
			);
		} finally {
			setFeedbackPending(false);
		}
	};

	// Every entry point checks `feedbackPending` itself: saveFeedback's own guard
	// would otherwise let a click that lands mid-request move the panel without
	// writing anything.
	const rateUp = () => {
		if (feedbackPending) return;
		setReasonOpen(false);
		void saveFeedback(feedback === "up" ? null : "up");
	};

	/**
	 * Thumbs down records the judgment straight away and then asks why. The
	 * chips and the reason are genuinely optional, so a reader who walks away
	 * from the panel has still been heard. Both are reset on every open: the
	 * panel asks about this answer, not the last one.
	 */
	const rateDown = () => {
		if (feedbackPending) return;
		if (feedback === "down") {
			setReasonOpen(false);
			void saveFeedback(null);
			return;
		}
		setReason("");
		setReasonTags([]);
		setReasonOpen(true);
		void saveFeedback("down");
	};

	const toggleReasonTag = (tag: FeedbackTagId) => {
		setReasonTags((current) =>
			current.includes(tag) ? current.filter((chosen) => chosen !== tag) : [...current, tag]
		);
	};

	// A chip on its own is a complete answer to "what went wrong", so Send needs
	// either a chip or some typed text, not both.
	const canSendReason = reasonTags.length > 0 || reason.trim().length > 0;

	const sendReason = () => {
		if (feedbackPending || !canSendReason) return;
		setReasonOpen(false);
		void saveFeedback("down", { reason: reason.trim(), tags: reasonTags });
	};

	/**
	 * Hand the answer to the clipboard as the reader would paste it: the
	 * markdown they can see, with the [FOLLOWUP] chip markers taken out. The
	 * clipboard is a permission, not a certainty, so a refusal becomes a line
	 * under the row rather than a glyph that silently did nothing. The browser's
	 * own wording ("NotAllowedError", "Document is not focused") explains
	 * nothing to a reader, so the line is ours.
	 */
	const copy = async () => {
		setCopyError(null);
		try {
			await navigator.clipboard.writeText(copyableAnswerText(message.content));
			setCopied(true);
		} catch {
			setCopyError("Could not copy that answer.");
		}
	};

	// The check is a confirmation, not a state: it says its piece and goes. The
	// cleanup also covers an unmount mid-countdown.
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), COPIED_MS);
		return () => clearTimeout(timer);
	}, [copied]);

	// "Link copied" is a confirmation, not a state: it says its piece and goes.
	useEffect(() => {
		if (!shareCopied) return;
		const timer = setTimeout(() => setShareCopied(false), SHARE_COPIED_MS);
		return () => clearTimeout(timer);
	}, [shareCopied]);

	/**
	 * Mint (or reuse) the public link for this answer, then hand it over. The
	 * route is idempotent on the message, so a second tap shares the same link
	 * rather than minting a second capability for text that is already out
	 * there. A dismissed share sheet leaves the row silent - the reader changed
	 * their mind, and a copied-link toast for that would be a surprise.
	 */
	const share = async () => {
		if (!conversationId || sharePending) return;
		setSharePending(true);
		setShareError(null);
		setShareCopied(false);
		try {
			const link = await shareAnswer(conversationId, message.id);
			const outcome = await presentShareLink({
				title: SHARE_TITLE,
				text: shareSheetText(message.content),
				url: link.url,
			});
			if (outcome === "copied") setShareCopied(true);
		} catch (error) {
			setShareError(error instanceof Error ? error.message : "Could not share that answer.");
		} finally {
			setSharePending(false);
		}
	};

	if (message.role === "user") {
		return (
			<div className="flex justify-end mb-4 animate-message-in">
				<div className="max-w-[80%] sm:max-w-[70%] bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.08] rounded-2xl rounded-br-sm px-4 py-3">
					{message.attachments && message.attachments.length > 0 && (
						<div className={message.content ? "mb-2" : ""}>
							<ChatFileAttachments attachments={message.attachments} />
						</div>
					)}
					{message.content && (
						<p className="text-chat text-neutral-800 dark:text-neutral-200 whitespace-pre-wrap">
							{/* Verse references the user typed get the same popover the
							    assistant's references do (Android MessageBubble parity);
							    everything else stays plain text. */}
							{parseVerseReferences(message.content).map((segment, index) =>
								segment.type === "verse-ref" ? (
									<VersePopover key={index} reference={segment.value}>
										{segment.value}
									</VersePopover>
								) : (
									<React.Fragment key={index}>{segment.value}</React.Fragment>
								)
							)}
						</p>
					)}
				</div>
			</div>
		);
	}

	const doneStreaming = !message.isStreaming;

	return (
		<div className="flex gap-3 mb-4 animate-message-in">
			<div className="mt-1 flex-shrink-0">
				<SureWordGuideAvatar active={Boolean(message.isStreaming)} />
			</div>
			<div className="flex-1 min-w-0">
				{message.progress && <WorkActivity progress={message.progress} isStreaming={Boolean(message.isStreaming)} />}
				{message.content ? (
					<FormattedResponse
						response={normalizeAssistantMarkdown(message.content, {
							streaming: Boolean(message.isStreaming),
						})}
					/>
				) : message.isStreaming && !message.activity && !message.progress ? (
					<div className="flex items-center gap-1 py-2">
						<span className="w-2 h-2 rounded-full bg-neutral-500 animate-bounce" />
						<span className="w-2 h-2 rounded-full bg-neutral-500 animate-bounce animation-delay-200" />
						<span className="w-2 h-2 rounded-full bg-neutral-500 animate-bounce animation-delay-500" />
					</div>
				) : null}
				{message.isStreaming && message.activity && !message.progress && (
					<div className="flex items-center gap-2 py-2 text-support text-neutral-500 dark:text-neutral-400">
						<Loader2 className="w-3.5 h-3.5 animate-spin" />
						<span className="animate-pulse">{message.activity}...</span>
					</div>
				)}
				{message.isStreaming && message.content && !message.activity && (
					<span className="inline-block w-2 h-4 bg-neutral-500 dark:bg-neutral-400 animate-pulse ml-0.5 align-text-bottom" />
				)}
				{doneStreaming && message.content && (
					<div className="mt-2 flex flex-wrap items-center gap-1">
						{/* Copy asks nothing of the server, so it is offered on the note
						    panel's answers too, where the rest of the row is not. */}
						<button
							type="button"
							onClick={() => void copy()}
							aria-label={copied ? "Copied" : "Copy answer"}
							title={copied ? "Copied" : "Copy"}
							className={`${copied ? ACTION_CHOSEN_CLASS : ACTION_CLASS} ${ICON_TAP_CLASS}`}
						>
							{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
						</button>
						<button
							type="button"
							onClick={() => setAddToNoteOpen(true)}
							aria-label="Add to notes"
							title="Add to notes"
							className={`${ACTION_CLASS} ${ICON_TAP_CLASS}`}
						>
							<NotebookPen className="w-4 h-4" />
						</button>
						{/* A rating needs a persisted row to land on, so the note panel's
						    answers show no thumbs. */}
						{conversationId && (
							<div className="flex items-center gap-1">
								<button
									type="button"
									onClick={rateUp}
									disabled={feedbackPending}
									aria-pressed={feedback === "up"}
									aria-label="Helpful"
									title="Helpful"
									className={`${feedback === "up" ? ACTION_CHOSEN_CLASS : ACTION_CLASS} ${ICON_TAP_CLASS} disabled:opacity-60`}
								>
									<ThumbsUp className={`w-4 h-4 ${feedback === "up" ? "fill-current" : ""}`} />
								</button>
								<button
									type="button"
									onClick={rateDown}
									disabled={feedbackPending}
									aria-pressed={feedback === "down"}
									aria-label="Not helpful"
									title="Not helpful"
									className={`${feedback === "down" ? ACTION_CHOSEN_CLASS : ACTION_CLASS} ${ICON_TAP_CLASS} disabled:opacity-60`}
								>
									<ThumbsDown
										className={`w-4 h-4 ${feedback === "down" ? "fill-current" : ""}`}
									/>
								</button>
							</div>
						)}
						{/* Sharing snapshots a persisted row, so the note panel's answers
						    have nothing to share either. */}
						{conversationId && (
							<>
								<button
									type="button"
									onClick={() => void share()}
									disabled={sharePending}
									aria-label={sharePending ? "Sharing" : "Share answer"}
									title={sharePending ? "Sharing" : "Share"}
									className={`${ACTION_CLASS} ${ICON_TAP_CLASS} disabled:opacity-60`}
								>
									{sharePending ? (
										<Loader2 className="w-4 h-4 animate-spin" />
									) : (
										<Share2 className="w-4 h-4" />
									)}
								</button>
								<span
									aria-live="polite"
									className="text-xs text-amber-600 dark:text-amber-400"
								>
									{shareCopied ? "Link copied" : ""}
								</span>
							</>
						)}
					</div>
				)}
				{reasonOpen && conversationId && (
					<div className="mt-2 space-y-2">
						{/* Five named failures, because a tap is a far likelier answer than
						    a sentence, and each one is something a reviewer can act on. */}
						<div className="flex flex-wrap gap-1.5">
							{FEEDBACK_TAGS.map((tag) => {
								const chosen = reasonTags.includes(tag.id);
								return (
									<button
										key={tag.id}
										type="button"
										onClick={() => toggleReasonTag(tag.id)}
										aria-pressed={chosen}
										className={`${CHIP_CLASS} ${
											chosen
												? "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400"
												: "border-black/[0.08] dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.04] text-neutral-600 dark:text-neutral-400 hover:text-amber-600 dark:hover:text-amber-400"
										}`}
									>
										{tag.label}
									</button>
								);
							})}
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<input
								type="text"
								value={reason}
								onChange={(event) => setReason(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										sendReason();
									}
								}}
								maxLength={FEEDBACK_REASON_MAX_LENGTH}
								placeholder="Anything else? (optional)"
								aria-label="Anything else? (optional)"
								className="min-h-11 sm:min-h-0 flex-1 min-w-0 rounded-lg border border-black/[0.08] dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.04] px-3 py-2 text-xs text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-amber-500/50"
							/>
							<button
								type="button"
								onClick={() => setReasonOpen(false)}
								className={`${ACTION_CLASS} min-h-11 sm:min-h-0`}
							>
								Skip
							</button>
							<button
								type="button"
								onClick={sendReason}
								disabled={feedbackPending || !canSendReason}
								className={`${ACTION_CLASS} min-h-11 sm:min-h-0 disabled:opacity-60`}
							>
								Send
							</button>
						</div>
					</div>
				)}
				{copyError && (
					<p role="alert" className="mt-1.5 text-xs text-red-600 dark:text-red-400">
						{copyError}
					</p>
				)}
				{feedbackError && (
					<p role="alert" className="mt-1.5 text-xs text-red-600 dark:text-red-400">
						{feedbackError}
					</p>
				)}
				{shareError && (
					<p role="alert" className="mt-1.5 text-xs text-red-600 dark:text-red-400">
						{shareError}
					</p>
				)}
				{addToNoteOpen && (
					<AddToNoteDialog
						markdown={message.content}
						conversationTitle={conversationTitle}
						onClose={() => setAddToNoteOpen(false)}
					/>
				)}
				{message.receipts && <ReceiptLine receipts={message.receipts} />}
				{/* The cross receipt keeps its verse preview below the line, because a
				    verse is content rather than chrome. The "Pick Up Your Cross
				    updated" banner and its link are gone: the receipt fragment
				    already says that and already goes there. */}
				{message.crossActions && message.crossActions.length > 0 && (
					<div className="mt-1.5 space-y-2">
						{message.crossActions.map((action, index) => (
							<div key={`${action.reference}-${index}`} className="flex flex-col gap-1">
								<span className="text-control font-medium text-neutral-800 dark:text-neutral-200">
									{action.reference}
									{action.previousReference && (
										<span className="font-normal text-neutral-500 dark:text-neutral-400">
											{" "}
											· replaced {action.previousReference}
										</span>
									)}
								</span>
								<span className="line-clamp-2 text-support italic text-neutral-600 dark:text-neutral-400">
									{action.text}
								</span>
							</div>
						))}
					</div>
				)}
				{doneStreaming && message.retrievedVerses && message.retrievedVerses.length > 0 && (
					<RetrievedVersesCollapsible
						verses={message.retrievedVerses}
						averageSimilarity={message.averageSimilarity ?? 0}
					/>
				)}
				{doneStreaming && message.tavilyResults && message.tavilyResults.length > 0 && (
					<TavilyCollapsible results={message.tavilyResults} />
				)}
				{doneStreaming && message.followUps && message.followUps.length > 0 && onFollowUp && (
					<FollowUpChips questions={message.followUps} onSelect={onFollowUp} />
				)}
			</div>
		</div>
	);
};

export default ChatMessage;
