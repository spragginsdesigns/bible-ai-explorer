"use client";

import React, { useRef, useEffect, useCallback } from "react";
import ChatMessage from "./ChatMessage";
import type { ChatMessage as ChatMessageType } from "./useChat";

interface MessageListProps {
	messages: ChatMessageType[];
	onFollowUp?: (question: string) => void;
}

const SCROLL_THRESHOLD = 100; // px from bottom to count as "at bottom"

const MessageList: React.FC<MessageListProps> = ({ messages, onFollowUp }) => {
	const bottomRef = useRef<HTMLDivElement>(null);
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const isNearBottomRef = useRef(true);

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
