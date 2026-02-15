"use client";

import React from "react";
import { Plus, Trash2, MessageSquare, X } from "lucide-react";
import type { Conversation } from "./useChat";

interface ChatSidebarProps {
	open: boolean;
	onClose: () => void;
	conversations: Conversation[];
	activeConversationId: string | null;
	onNewChat: () => void;
	onSelectConversation: (id: string) => void;
	onDeleteConversation: (id: string) => void;
	onClearAll: () => void;
}

const ChatSidebar: React.FC<ChatSidebarProps> = ({
	open,
	onClose,
	conversations,
	activeConversationId,
	onNewChat,
	onSelectConversation,
	onDeleteConversation,
	onClearAll,
}) => {
	return (
		<>
			{/* Mobile backdrop */}
			{open && (
				<div
					className="fixed inset-0 bg-black/80 backdrop-blur-sm z-40 lg:hidden"
					onClick={onClose}
				/>
			)}

			{/* Sidebar */}
			<aside
				className={`
					fixed lg:relative z-50 top-0 left-0 h-full w-[85vw] max-w-72
					glass border-r border-black/[0.08] dark:border-white/[0.06]
					flex flex-col
					transition-transform duration-200 ease-in-out
					${open ? "translate-x-0" : "-translate-x-full lg:translate-x-0 lg:hidden"}
				`}
			>
				{/* Header */}
				<div className="flex items-center justify-between p-4 border-b border-black/[0.08] dark:border-white/[0.06]">
					<span className="text-amber-600 dark:text-amber-400 font-bold text-lg font-[family-name:var(--font-pirata)] drop-shadow-[0_0_8px_rgba(200,160,40,0.3)]">VerseMind</span>
					<button onClick={onClose} className="lg:hidden text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors">
						<X className="w-5 h-5" />
					</button>
				</div>

				{/* New chat */}
				<div className="p-3">
					<button
						onClick={() => {
							onNewChat();
							onClose();
						}}
						className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl gradient-border bg-black/[0.03] dark:bg-white/[0.03] text-neutral-600 dark:text-neutral-400 hover:bg-black/[0.06] dark:hover:bg-white/[0.06] hover:text-neutral-900 dark:hover:text-neutral-200 transition-colors text-sm"
					>
						<Plus className="w-4 h-4 text-amber-600 dark:text-amber-400" />
						New Chat
					</button>
				</div>

				{/* Conversation list */}
				<div className="flex-1 overflow-y-auto custom-scrollbar px-2">
					{conversations.map((convo) => (
						<div
							key={convo.id}
							className={`
								group flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer text-sm mb-0.5 transition-all duration-150
								${convo.id === activeConversationId
									? "bg-black/[0.05] dark:bg-white/[0.06] text-neutral-900 dark:text-neutral-200 border border-black/[0.1] dark:border-white/[0.1] glow-white-sm"
									: "text-neutral-600 dark:text-neutral-500 hover:bg-black/[0.03] dark:hover:bg-white/[0.03] hover:text-neutral-800 dark:hover:text-neutral-300 border border-transparent"
								}
							`}
							onClick={() => {
								onSelectConversation(convo.id);
								onClose();
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
				</div>

				{/* Clear all */}
				{conversations.length > 0 && (
					<div className="p-3 border-t border-black/[0.08] dark:border-white/[0.06]">
						<button
							onClick={onClearAll}
							className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-neutral-500 dark:text-neutral-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-500/10 dark:hover:bg-red-400/10 transition-colors text-xs"
						>
							<Trash2 className="w-3.5 h-3.5" />
							Clear all conversations
						</button>
					</div>
				)}
			</aside>
		</>
	);
};

export default ChatSidebar;
