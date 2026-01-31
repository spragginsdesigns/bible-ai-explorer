"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import ChatSidebar from "./ChatSidebar";
import ChatTopBar from "./ChatTopBar";
import MessageList from "./MessageList";
import ChatInput from "./ChatInput";
import WelcomeScreen from "./WelcomeScreen";
import { useChat } from "./useChat";

const SWIPE_THRESHOLD = 50;
const EDGE_ZONE = 30;

const BibleAIExplorer: React.FC = () => {
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const touchStartX = useRef(0);
	const touchStartY = useRef(0);
	const isSwiping = useRef(false);

	const handleTouchStart = useCallback((e: React.TouchEvent) => {
		const touch = e.touches[0];
		touchStartX.current = touch.clientX;
		touchStartY.current = touch.clientY;
		isSwiping.current = touch.clientX < EDGE_ZONE || sidebarOpen;
	}, [sidebarOpen]);

	const handleTouchEnd = useCallback((e: React.TouchEvent) => {
		if (!isSwiping.current) return;
		const touch = e.changedTouches[0];
		const dx = touch.clientX - touchStartX.current;
		const dy = Math.abs(touch.clientY - touchStartY.current);
		if (dy > Math.abs(dx)) return; // vertical scroll, ignore

		if (dx > SWIPE_THRESHOLD && !sidebarOpen) {
			setSidebarOpen(true);
		} else if (dx < -SWIPE_THRESHOLD && sidebarOpen) {
			setSidebarOpen(false);
		}
	}, [sidebarOpen]);

	const {
		messages,
		conversations,
		activeConversationId,
		activeConversation,
		isStreaming,
		loading,
		sendMessage,
		newConversation,
		switchConversation,
		deleteConversation,
		clearAllConversations,
	} = useChat();

	const handleSend = (text: string) => {
		sendMessage(text);
	};

	const title = activeConversation?.title ?? "New Chat";

	return (
		<div
			className="flex h-[100dvh] bg-black overflow-hidden"
			onTouchStart={handleTouchStart}
			onTouchEnd={handleTouchEnd}
		>
			<ChatSidebar
				open={sidebarOpen}
				onClose={() => setSidebarOpen(false)}
				conversations={conversations}
				activeConversationId={activeConversationId}
				onNewChat={() => {
					newConversation();
					setSidebarOpen(false);
				}}
				onSelectConversation={switchConversation}
				onDeleteConversation={deleteConversation}
				onClearAll={clearAllConversations}
			/>

			<div className="flex-1 flex flex-col min-w-0">
				<ChatTopBar
					title={title}
					onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
				/>

				{messages.length === 0 ? (
					<WelcomeScreen onSelectQuestion={handleSend} />
				) : (
					<MessageList messages={messages} onFollowUp={handleSend} />
				)}

				<ChatInput
					onSend={handleSend}
					loading={loading}
					isStreaming={isStreaming}
				/>
			</div>
		</div>
	);
};

export default BibleAIExplorer;
