"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, MessageSquare, Search, Pencil, Check, X } from "lucide-react";
import type { Conversation } from "./useChat";
import { useGlobalShortcuts } from "@/lib/shortcuts";

/**
 * The server list payload already carries updatedAt (ordered by it), but the
 * hook maps it down to createdAt for now; read it when present so the stamp
 * tracks last activity once the mapping lands.
 */
type SidebarConversation = Conversation & { updatedAt?: string };

interface ChatSidebarProps {
	conversations: SidebarConversation[];
	activeConversationId: string | null;
	onNewChat: () => void;
	onSelectConversation: (id: string) => void;
	onDeleteConversation: (id: string) => void;
	onClearAll: () => void;
	/** Called after any navigation-like action so the mobile drawer can close. */
	onNavigate?: () => void;
}

/** "just now" / "5m" / "3h" / "Tue" style stamp for a conversation row. */
function formatLastActivity(iso: string): string {
	const at = new Date(iso).getTime();
	if (Number.isNaN(at)) return "";
	const diffMs = Date.now() - at;
	const minutes = Math.floor(diffMs / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d`;
	return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Chat history section rendered inside AppSidebar: new-chat button, search,
 * conversation list with rename + confirmed delete, and clear-all. The
 * sidebar chrome (brand, nav, account footer, mobile drawer behavior) lives
 * in AppSidebar.
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
	const [query, setQuery] = useState("");
	// Titles renamed this session, until the next server fetch confirms them.
	const [renames, setRenames] = useState<Record<string, string>>({});
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editValue, setEditValue] = useState("");
	const [renameError, setRenameError] = useState<string | null>(null);
	const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
	const [confirmClear, setConfirmClear] = useState(false);
	const editInputRef = useRef<HTMLInputElement>(null);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	// B9 bindings on the chat surface: `n` new chat, `h` focuses history
	// search; `/` (composer) and `[`/`]` (chapters) are handled by the hook.
	useGlobalShortcuts({
		onNewChat,
		onOpenHistory: () => searchInputRef.current?.focus(),
	});

	useEffect(() => {
		if (editingId) editInputRef.current?.focus();
	}, [editingId]);

	useEffect(() => () => {
		if (confirmTimer.current) clearTimeout(confirmTimer.current);
	}, []);

	const armTimer = (clear: () => void) => {
		if (confirmTimer.current) clearTimeout(confirmTimer.current);
		confirmTimer.current = setTimeout(clear, 3000);
	};

	const titleOf = (convo: SidebarConversation) => renames[convo.id] ?? convo.title;

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return conversations;
		return conversations.filter((convo) => titleOf(convo).toLowerCase().includes(q));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [conversations, query, renames]);

	const startRename = (convo: SidebarConversation) => {
		setConfirmDeleteId(null);
		setRenameError(null);
		setEditingId(convo.id);
		setEditValue(titleOf(convo));
	};

	const commitRename = async (convo: SidebarConversation) => {
		const title = editValue.trim();
		setEditingId(null);
		if (!title || title === titleOf(convo)) return;
		try {
			const res = await fetch(`/api/conversations/${convo.id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title }),
			});
			if (!res.ok) throw new Error(String(res.status));
			setRenames((prev) => ({ ...prev, [convo.id]: title }));
		} catch {
			setRenameError("Couldn't rename. Try again.");
			setTimeout(() => setRenameError(null), 3000);
		}
	};

	const handleDelete = (id: string) => {
		if (confirmDeleteId !== id) {
			setConfirmDeleteId(id);
			armTimer(() => setConfirmDeleteId(null));
			return;
		}
		setConfirmDeleteId(null);
		onDeleteConversation(id);
	};

	const handleClearAll = () => {
		if (!confirmClear) {
			setConfirmClear(true);
			armTimer(() => setConfirmClear(false));
			return;
		}
		setConfirmClear(false);
		onClearAll();
	};

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
				<>
					<p className="px-3 pt-4 pb-1.5 text-metadata font-bold uppercase tracking-[0.12em] text-neutral-400 dark:text-neutral-600">
						Chats
					</p>

					<div className="mx-1 mb-1.5 flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-black/[0.06] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.02] focus-within:border-amber-600/40 dark:focus-within:border-amber-400/40 transition-colors">
						<Search className="w-3.5 h-3.5 flex-shrink-0 text-neutral-400 dark:text-neutral-600" />
						<input
							ref={searchInputRef}
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Search chats"
							aria-label="Search chats"
							className="w-full bg-transparent outline-none text-metadata text-neutral-700 dark:text-neutral-300 placeholder:text-neutral-400 dark:placeholder:text-neutral-600"
						/>
						{query && (
							<button
								onClick={() => setQuery("")}
								aria-label="Clear search"
								className="text-neutral-400 dark:text-neutral-600 hover:text-neutral-600 dark:hover:text-neutral-400"
							>
								<X className="w-3.5 h-3.5" />
							</button>
						)}
					</div>
				</>
			)}

			{renameError && (
				<p role="alert" className="px-3 pb-1 text-metadata text-red-500 dark:text-red-400">
					{renameError}
				</p>
			)}

			{filtered.length === 0 && conversations.length > 0 && (
				<p className="px-3 py-2 text-metadata text-neutral-400 dark:text-neutral-600">
					No chats match “{query.trim()}”.
				</p>
			)}

			{filtered.map((convo) => {
				const editing = editingId === convo.id;
				const confirming = confirmDeleteId === convo.id;
				return (
					<div
						key={convo.id}
						className={`
							group flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer text-control mb-0.5 transition-all duration-150
							${convo.id === activeConversationId
								? "bg-black/[0.05] dark:bg-white/[0.06] text-neutral-900 dark:text-neutral-200 border border-black/[0.1] dark:border-white/[0.1] glow-white-sm"
								: "text-neutral-600 dark:text-neutral-500 hover:bg-black/[0.03] dark:hover:bg-white/[0.03] hover:text-neutral-800 dark:hover:text-neutral-300 border border-transparent"
							}
						`}
						onClick={() => {
							if (editing) return;
							onSelectConversation(convo.id);
							onNavigate?.();
						}}
					>
						<MessageSquare className="w-4 h-4 flex-shrink-0 self-start mt-0.5" />
						{editing ? (
							<div className="flex-1 flex items-center gap-1 min-w-0">
								<input
									ref={editInputRef}
									value={editValue}
									onChange={(e) => setEditValue(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") void commitRename(convo);
										if (e.key === "Escape") setEditingId(null);
									}}
									onBlur={() => void commitRename(convo)}
									onClick={(e) => e.stopPropagation()}
									aria-label="Rename chat"
									className="flex-1 min-w-0 bg-transparent outline-none border-b border-amber-600/50 dark:border-amber-400/50 text-control text-neutral-900 dark:text-neutral-100"
								/>
								<button
									onClick={(e) => {
										e.stopPropagation();
										void commitRename(convo);
									}}
									aria-label="Save name"
									className="text-amber-600 dark:text-amber-400"
								>
									<Check className="w-3.5 h-3.5" />
								</button>
								<button
									onClick={(e) => {
										e.stopPropagation();
										setEditingId(null);
									}}
									aria-label="Cancel rename"
									className="text-neutral-400 dark:text-neutral-600"
								>
									<X className="w-3.5 h-3.5" />
								</button>
							</div>
						) : (
							<>
								<span className="flex-1 min-w-0">
									<span className="block truncate">{titleOf(convo)}</span>
									<span className="block text-metadata text-neutral-400 dark:text-neutral-600">
										{formatLastActivity(convo.updatedAt ?? convo.createdAt)}
									</span>
								</span>
								<button
									onClick={(e) => {
										e.stopPropagation();
										startRename(convo);
									}}
									aria-label={`Rename ${titleOf(convo)}`}
									className="opacity-0 group-hover:opacity-100 text-neutral-400 dark:text-neutral-600 hover:text-neutral-700 dark:hover:text-neutral-300 transition-opacity"
								>
									<Pencil className="w-3.5 h-3.5" />
								</button>
								<button
									onClick={(e) => {
										e.stopPropagation();
										handleDelete(convo.id);
									}}
									aria-label={confirming ? `Confirm delete ${titleOf(convo)}` : `Delete ${titleOf(convo)}`}
									className={`transition-opacity ${
										confirming
											? "text-red-500 dark:text-red-400 text-metadata font-semibold opacity-100"
											: "opacity-0 group-hover:opacity-100 text-neutral-400 dark:text-neutral-600 hover:text-red-500 dark:hover:text-red-400"
									}`}
								>
									{confirming ? "Sure?" : <Trash2 className="w-3.5 h-3.5" />}
								</button>
							</>
						)}
					</div>
				);
			})}

			{conversations.length > 0 && (
				<button
					onClick={handleClearAll}
					className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-neutral-500 dark:text-neutral-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-500/10 dark:hover:bg-red-400/10 transition-colors text-metadata"
				>
					<Trash2 className="w-3.5 h-3.5" />
					{confirmClear ? "Tap again to delete every conversation" : "Clear all conversations"}
				</button>
			)}
		</div>
	);
};

export default ChatSidebar;
