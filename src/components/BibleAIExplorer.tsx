"use client";

import React, { useState } from "react";
import ChatSidebar from "./ChatSidebar";
import ChatTopBar from "./ChatTopBar";
import MessageList from "./MessageList";
import ChatInput from "./ChatInput";
import WelcomeScreen from "./WelcomeScreen";
import { useChat } from "./useChat";

const BibleAIExplorer: React.FC = () => {
	const [sidebarOpen, setSidebarOpen] = useState(false);

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
		<div className="flex h-screen bg-black overflow-hidden">
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
