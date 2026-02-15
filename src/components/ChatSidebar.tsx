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
					className="fixed inset-0 bg-black/60 z-40 lg:hidden"
					onClick={onClose}
				/>
			)}

			{/* Sidebar */}
			<aside
				className={`
					fixed lg:relative z-50 top-0 left-0 h-full w-[85vw] max-w-72
					bg-gray-950 border-r border-amber-700/20
					flex flex-col
					transition-transform duration-200 ease-in-out
					${open ? "translate-x-0" : "-translate-x-full lg:translate-x-0 lg:hidden"}
				`}
			>
				{/* Header */}
				<div className="flex items-center justify-between p-4 border-b border-amber-700/20">
					<span className="text-amber-500 font-bold text-lg font-[family-name:var(--font-orbitron)]">VerseMind</span>
					<button onClick={onClose} className="lg:hidden text-amber-100/60 hover:text-amber-100">
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
						className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-amber-700/30 text-amber-100/80 hover:bg-amber-600/10 transition-colors text-sm"
					>
						<Plus className="w-4 h-4" />
						New Chat
					</button>
				</div>

				{/* Conversation list */}
				<div className="flex-1 overflow-y-auto custom-scrollbar px-2">
					{conversations.map((convo) => (
						<div
							key={convo.id}
							className={`
								group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer text-sm mb-0.5
								${convo.id === activeConversationId
									? "bg-amber-600/15 text-amber-100"
									: "text-amber-100/60 hover:bg-amber-600/10 hover:text-amber-100/80"
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
								className="opacity-0 group-hover:opacity-100 text-amber-100/40 hover:text-red-400 transition-opacity"
							>
								<Trash2 className="w-3.5 h-3.5" />
							</button>
						</div>
					))}
				</div>

				{/* Clear all */}
				{conversations.length > 0 && (
					<div className="p-3 border-t border-amber-700/20">
						<button
							onClick={onClearAll}
							className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-amber-100/40 hover:text-red-400 hover:bg-red-400/10 transition-colors text-xs"
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
