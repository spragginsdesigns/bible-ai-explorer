"use client";

import React, { useState } from "react";
import { Loader2, NotebookPen } from "lucide-react";
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

interface ChatMessageProps {
	message: ChatMessageType;
	onFollowUp?: (question: string) => void;
	/** Active conversation title, used as the default title for new notes. */
	conversationTitle?: string;
}

const ChatMessage: React.FC<ChatMessageProps> = ({ message, onFollowUp, conversationTitle }) => {
	const [addToNoteOpen, setAddToNoteOpen] = useState(false);
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
					<button
						type="button"
						onClick={() => setAddToNoteOpen(true)}
						className="mt-2 flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-500 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
					>
						<NotebookPen className="w-3.5 h-3.5" />
						Add to notes
					</button>
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
