"use client";

import React from "react";
import { Brain, User } from "lucide-react";
import FormattedResponse from "../FormattedResponse";
import type { NoteAIMessage as NoteAIMessageType } from "@/types/notes";

interface NoteAIMessageProps {
	message: NoteAIMessageType;
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
			<div className="flex-shrink-0 mt-1">
				<div className="w-6 h-6 rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
					<Brain className="w-3 h-3 text-amber-400" />
				</div>
			</div>
			<div className="flex-1 min-w-0">
				{message.content ? (
					<div className="text-sm">
						<FormattedResponse response={message.content} />
					</div>
				) : message.isStreaming ? (
					<div className="flex items-center gap-1 py-2">
						<span className="w-1.5 h-1.5 rounded-full bg-neutral-500 animate-bounce" />
						<span className="w-1.5 h-1.5 rounded-full bg-neutral-500 animate-bounce animation-delay-200" />
						<span className="w-1.5 h-1.5 rounded-full bg-neutral-500 animate-bounce animation-delay-500" />
					</div>
				) : null}
				{message.isStreaming && message.content && (
					<span className="inline-block w-1.5 h-3 bg-neutral-400 animate-pulse ml-0.5 align-text-bottom" />
				)}
			</div>
		</div>
	);
};

export default NoteAIMessage;
