"use client";

import React from "react";
import { Brain } from "lucide-react";
import FormattedResponse from "./FormattedResponse";
import TavilyCollapsible from "./TavilyCollapsible";
import RetrievedVersesCollapsible from "./RetrievedVersesCollapsible";
import FollowUpChips from "./FollowUpChips";
import type { ChatMessage as ChatMessageType } from "./useChat";

interface ChatMessageProps {
	message: ChatMessageType;
	onFollowUp?: (question: string) => void;
}

const ChatMessage: React.FC<ChatMessageProps> = ({ message, onFollowUp }) => {
	if (message.role === "user") {
		return (
			<div className="flex justify-end mb-4 animate-message-in">
				<div className="max-w-[80%] sm:max-w-[70%] bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.08] rounded-2xl rounded-br-sm px-4 py-3">
					<p className="text-neutral-800 dark:text-neutral-200 whitespace-pre-wrap">{message.content}</p>
				</div>
			</div>
		);
	}

	const doneStreaming = !message.isStreaming;

	return (
		<div className="flex gap-3 mb-4 animate-message-in">
			<div className="flex-shrink-0 mt-1">
				<div className="w-8 h-8 rounded-full bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.08] dark:border-white/[0.08] flex items-center justify-center">
					<Brain className="w-4 h-4 text-amber-600 dark:text-amber-400" />
				</div>
			</div>
			<div className="flex-1 min-w-0">
				{message.content ? (
					<FormattedResponse response={message.content} />
				) : message.isStreaming ? (
					<div className="flex items-center gap-1 py-2">
						<span className="w-2 h-2 rounded-full bg-neutral-500 animate-bounce" />
						<span className="w-2 h-2 rounded-full bg-neutral-500 animate-bounce animation-delay-200" />
						<span className="w-2 h-2 rounded-full bg-neutral-500 animate-bounce animation-delay-500" />
					</div>
				) : null}
				{message.isStreaming && message.content && (
					<span className="inline-block w-2 h-4 bg-neutral-500 dark:bg-neutral-400 animate-pulse ml-0.5 align-text-bottom" />
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
