"use client";

import React, { useRef, useEffect, useCallback } from "react";
import ChatMessage from "./ChatMessage";
import type { ChatMessage as ChatMessageType } from "./useChat";

interface MessageListProps {
	messages: ChatMessageType[];
	onFollowUp?: (question: string) => void;
	/** Active conversation title, used as the default title for new notes. */
	conversationTitle?: string;
}

const SCROLL_THRESHOLD = 100; // px from bottom to count as "at bottom"

const MessageList: React.FC<MessageListProps> = ({ messages, onFollowUp, conversationTitle }) => {
	const bottomRef = useRef<HTMLDivElement>(null);
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const isNearBottomRef = useRef(true);
	const latestAssistantId = [...messages]
		.reverse()
		.find((message) => message.role === "assistant")?.id;

	const checkIfNearBottom = useCallback(() => {
		const el = scrollContainerRef.current;
		if (!el) return;
		const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
		isNearBottomRef.current = distanceFromBottom <= SCROLL_THRESHOLD;
	}, []);

	// Auto-scroll only when user is near the bottom
	useEffect(() => {
		if (isNearBottomRef.current) {
			bottomRef.current?.scrollIntoView({ behavior: "smooth" });
		}
	}, [messages]);

	// Always scroll to bottom when a new user message is sent (new message count increases)
	const messageCountRef = useRef(messages.length);
	useEffect(() => {
		const lastMsg = messages[messages.length - 1];
		if (messages.length > messageCountRef.current && lastMsg?.role === "user") {
			isNearBottomRef.current = true;
			bottomRef.current?.scrollIntoView({ behavior: "smooth" });
		}
		messageCountRef.current = messages.length;
	}, [messages]);

	return (
		<div
			ref={scrollContainerRef}
			onScroll={checkIfNearBottom}
			className="flex-1 overflow-y-auto custom-scrollbar"
		>
			{/* Extra top padding on desktop: there is no top bar above the chat
			    at lg, so at py-6 the first bubble sat 28px off the viewport. */}
			<div className="max-w-3xl mx-auto px-4 py-6 lg:pt-12">
				{messages.map((msg) => (
					<ChatMessage
						key={msg.id}
						message={msg}
						onFollowUp={msg.id === latestAssistantId ? onFollowUp : undefined}
						conversationTitle={conversationTitle}
					/>
				))}
				<div ref={bottomRef} />
			</div>
		</div>
	);
};

export default MessageList;
