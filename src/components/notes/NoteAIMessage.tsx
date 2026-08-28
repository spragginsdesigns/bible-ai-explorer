"use client";

import React from "react";
import { Loader2, NotebookPen } from "lucide-react";
import FormattedResponse from "../FormattedResponse";
import type { ChatMessage } from "../useChat";
import { normalizeAssistantMarkdown } from "@/utils/assistantMarkdown";
import SureWordGuideAvatar from "../SureWordGuideAvatar";

interface NoteAIMessageProps {
	message: ChatMessage;
}

const NoteAIMessage: React.FC<NoteAIMessageProps> = ({ message }) => {
	if (message.role === "user") {
		return (
			<div className="flex justify-end mb-3 animate-message-in">
				<div className="max-w-[85%] bg-white/[0.06] border border-white/[0.08] rounded-2xl rounded-br-sm px-3 py-2">
					<p className="text-neutral-200 text-sm whitespace-pre-wrap">
						{message.content}
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex gap-2 mb-3 animate-message-in">
			<div className="mt-1 flex-shrink-0">
				<SureWordGuideAvatar size={24} active={Boolean(message.isStreaming)} />
			</div>
			<div className="flex-1 min-w-0">
				{message.content ? (
					<div className="text-sm">
						<FormattedResponse
							response={normalizeAssistantMarkdown(message.content, {
								streaming: Boolean(message.isStreaming),
							})}
						/>
					</div>
				) : message.isStreaming && !message.activity ? (
					<div className="flex items-center gap-1 py-2">
						<span className="w-1.5 h-1.5 rounded-full bg-neutral-500 animate-bounce" />
						<span className="w-1.5 h-1.5 rounded-full bg-neutral-500 animate-bounce animation-delay-200" />
						<span className="w-1.5 h-1.5 rounded-full bg-neutral-500 animate-bounce animation-delay-500" />
					</div>
				) : null}
				{message.isStreaming && message.activity && (
					<div className="flex items-center gap-1.5 py-1.5 text-xs text-neutral-500">
						<Loader2 className="w-3 h-3 animate-spin" />
						<span className="animate-pulse">{message.activity}...</span>
					</div>
				)}
				{message.isStreaming && message.content && !message.activity && (
					<span className="inline-block w-1.5 h-3 bg-neutral-400 animate-pulse ml-0.5 align-text-bottom" />
				)}
				{message.noteActions && message.noteActions.length > 0 && (
					<div className="mt-2 space-y-1.5">
						{message.noteActions.map((action, index) => (
							<div
								key={`${action.noteId}-${index}`}
								className="flex items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-2.5 py-1.5"
							>
								<NotebookPen className="w-3 h-3 flex-shrink-0 text-amber-400" />
								<span className="text-xs text-neutral-300 truncate">
									{action.created ? "Created note" : "Added to note"}{" "}
									<span className="font-medium text-amber-400">{action.noteTitle}</span>
								</span>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
};

export default NoteAIMessage;
