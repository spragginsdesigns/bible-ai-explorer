"use client";

import React from "react";
import { Plus, Trash2, MessageSquare } from "lucide-react";
import type { Conversation } from "./useChat";

interface ChatSidebarProps {
	conversations: Conversation[];
	activeConversationId: string | null;
	onNewChat: () => void;
	onSelectConversation: (id: string) => void;
	onDeleteConversation: (id: string) => void;
	onClearAll: () => void;
	/** Called after any navigation-like action so the mobile drawer can close. */
	onNavigate?: () => void;
}

/**
 * Chat history section rendered inside AppSidebar: new-chat button,
 * conversation list, and clear-all. The sidebar chrome (brand, nav,
 * account footer, mobile drawer behavior) lives in AppSidebar.
 */
const ChatSidebar: React.FC<ChatSidebarProps> = ({
	conversations,
	activeConversationId,
	onNewChat,
	onSelectConversation,
	onDeleteConversation,
	onClearAll,
	onNavigate,
}) => {
	return (
		<div className="flex flex-col pb-3">
			<button
				onClick={() => {
					onNewChat();
					onNavigate?.();
				}}
				className="sidebar-glass-button w-full flex items-center gap-2 px-3 py-2.5 rounded-[14px] text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white transition-[color,background-color,border-color,box-shadow,transform] duration-200 active:scale-[0.985] text-control"
			>
				<Plus className="w-4 h-4 text-amber-600 dark:text-amber-400" />
				New Chat
			</button>

			{conversations.length > 0 && (
				<p className="px-3 pt-4 pb-1.5 text-metadata font-bold uppercase tracking-[0.12em] text-neutral-400 dark:text-neutral-600">
					Chats
				</p>
			)}

			{conversations.map((convo) => (
				<div
					key={convo.id}
					className={`
						group flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer text-control mb-0.5 transition-all duration-150
						${convo.id === activeConversationId
							? "bg-black/[0.05] dark:bg-white/[0.06] text-neutral-900 dark:text-neutral-200 border border-black/[0.1] dark:border-white/[0.1] glow-white-sm"
							: "text-neutral-600 dark:text-neutral-500 hover:bg-black/[0.03] dark:hover:bg-white/[0.03] hover:text-neutral-800 dark:hover:text-neutral-300 border border-transparent"
						}
					`}
					onClick={() => {
						onSelectConversation(convo.id);
						onNavigate?.();
					}}
				>
					<MessageSquare className="w-4 h-4 flex-shrink-0" />
					<span className="flex-1 truncate">{convo.title}</span>
					<button
						onClick={(e) => {
							e.stopPropagation();
							onDeleteConversation(convo.id);
						}}
						className="opacity-0 group-hover:opacity-100 text-neutral-400 dark:text-neutral-600 hover:text-red-500 dark:hover:text-red-400 transition-opacity"
					>
						<Trash2 className="w-3.5 h-3.5" />
					</button>
				</div>
			))}

			{conversations.length > 0 && (
				<button
					onClick={onClearAll}
					className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-neutral-500 dark:text-neutral-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-500/10 dark:hover:bg-red-400/10 transition-colors text-metadata"
				>
					<Trash2 className="w-3.5 h-3.5" />
					Clear all conversations
				</button>
			)}
		</div>
	);
};

export default ChatSidebar;
