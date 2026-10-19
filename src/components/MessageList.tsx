"use client";

import React, { useRef, useEffect, useCallback, useMemo, useState } from "react";
import { ArrowDown } from "lucide-react";
import ChatMessage from "./ChatMessage";
import type { ChatMessage as ChatMessageType } from "./useChat";
import { retryableAnswerId } from "@/lib/chat/message-edit";
import { latestMessageIds } from "@/lib/chat/message-view-cache";

interface MessageListProps {
	messages: ChatMessageType[];
	onFollowUp?: (question: string) => void;
	/** Active conversation title, used as the default title for new notes. */
	conversationTitle?: string;
	/** An answer is being written or collected: no edits or retries until it lands. */
	busy?: boolean;
	/** Rewrite one of the user's messages in the composer. */
	onEditMessage?: (messageId: string) => void;
	/** Replace the newest answer with a fresh one. */
	onRetryAnswer?: () => void;
}

const SCROLL_THRESHOLD = 100; // px from bottom to count as "at bottom"

const MessageRow = React.memo(function MessageRow({ message, onFollowUp, conversationTitle, editable, onEditMessage, onRetry, userActionsVisible }: {
	message: ChatMessageType; onFollowUp?: (question: string) => void; conversationTitle?: string;
	editable: boolean; onEditMessage: (id: string) => void; onRetry?: () => void; userActionsVisible: boolean;
}) {
	const edit = useCallback(() => onEditMessage(message.id), [onEditMessage, message.id]);
	return <ChatMessage message={message} onFollowUp={onFollowUp} conversationTitle={conversationTitle}
		onEdit={editable ? edit : undefined} onRetry={onRetry} userActionsVisible={userActionsVisible} />;
});

const MessageList: React.FC<MessageListProps> = ({
	messages,
	onFollowUp,
	conversationTitle,
	busy = false,
	onEditMessage,
	onRetryAnswer,
}) => {
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const isNearBottomRef = useRef(true);
	const scrollFrame = useRef<number | null>(null);
	const editRef = useRef(onEditMessage);
	editRef.current = onEditMessage;
	const editMessage = useCallback((id: string) => editRef.current?.(id), []);
	const [showJump, setShowJump] = useState(false);
	const { assistant: latestAssistantId, user: latestUserId } = useMemo(() => latestMessageIds(messages), [messages]);
	const retryId = onRetryAnswer ? retryableAnswerId(messages, busy) : null;

	const checkIfNearBottom = useCallback(() => {
		if (scrollFrame.current !== null) return;
		scrollFrame.current = requestAnimationFrame(() => {
			scrollFrame.current = null;
			const el = scrollContainerRef.current;
			if (!el) return;
			isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_THRESHOLD;
			setShowJump(!isNearBottomRef.current);
		});
	}, []);
	useEffect(() => () => { if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current); }, []);
	const scrollToBottom = useCallback((animate: boolean) => {
		const el = scrollContainerRef.current;
		if (el) el.scrollTo({ top: el.scrollHeight, behavior: animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto" });
	}, []);

	// Auto-scroll only when user is near the bottom
	useEffect(() => {
		if (isNearBottomRef.current && scrollFrame.current === null) {
			scrollToBottom(false);
		}
	}, [messages, scrollToBottom]);

	// A pending assistant row can arrive in the same render as the new question.
	const previousUserId = useRef(latestUserId);
	useEffect(() => {
		if (latestUserId && latestUserId !== previousUserId.current) {
			isNearBottomRef.current = true;
			setShowJump(false);
			scrollToBottom(true);
		}
		previousUserId.current = latestUserId;
	}, [latestUserId, scrollToBottom]);

	return (
		<div className="relative flex-1 min-h-0">
		<div
			ref={scrollContainerRef}
			onScroll={checkIfNearBottom}
			className="h-full overflow-y-auto custom-scrollbar"
		>
			{/* Extra top padding on desktop: there is no top bar above the chat
			    at lg, so at py-6 the first bubble sat 28px off the viewport. */}
			<div className="max-w-3xl mx-auto px-4 py-6 lg:pt-12">
				{messages.map((msg) => (
					<MessageRow
						key={msg.id}
						message={msg}
						onFollowUp={msg.id === latestAssistantId ? onFollowUp : undefined}
						conversationTitle={conversationTitle}
						editable={msg.role === "user" && !busy && Boolean(onEditMessage)}
						onEditMessage={editMessage}
						onRetry={msg.id === retryId ? onRetryAnswer : undefined}
						userActionsVisible={msg.id === latestUserId}
					/>
				))}
			</div>
		</div>
		{showJump && (
			<button
				type="button"
				onClick={() => {
					isNearBottomRef.current = true;
					setShowJump(false);
					scrollToBottom(true);
				}}
				className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 py-2 text-sm shadow-lg dark:border-white/10 dark:bg-neutral-900"
			>
				<ArrowDown className="h-4 w-4" /> Latest
			</button>
		)}
		</div>
	);
};

export default React.memo(MessageList);
