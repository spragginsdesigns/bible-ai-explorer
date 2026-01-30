"use client";

import React, { useRef, useEffect } from "react";
import ChatMessage from "./ChatMessage";
import type { ChatMessage as ChatMessageType } from "./useChat";

interface MessageListProps {
	messages: ChatMessageType[];
	onFollowUp?: (question: string) => void;
}

const MessageList: React.FC<MessageListProps> = ({ messages, onFollowUp }) => {
	const bottomRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	return (
		<div className="flex-1 overflow-y-auto custom-scrollbar">
			<div className="max-w-3xl mx-auto px-4 py-6">
				{messages.map((msg) => (
					<ChatMessage key={msg.id} message={msg} onFollowUp={onFollowUp} />
				))}
				<div ref={bottomRef} />
			</div>
		</div>
	);
};

export default MessageList;
