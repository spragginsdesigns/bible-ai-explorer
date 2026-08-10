"use client";

import React, { Suspense, useState, useRef, useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import ChatSidebar from "./ChatSidebar";
import ChatTopBar from "./ChatTopBar";
import MessageList from "./MessageList";
import ChatInput from "./ChatInput";
import WelcomeScreen from "./WelcomeScreen";
import { useChat } from "./useChat";
import { CHAT_SLASH_COMMANDS, type LocalCommandAction } from "@/lib/chat/slashCommands";
import { TRANSLATIONS, type TranslationId } from "@/lib/bible/translations";
import { Loader2, Plus, RefreshCw } from "lucide-react";

const SWIPE_THRESHOLD = 50;
const EDGE_ZONE = 30;

const BibleAIExplorerInner: React.FC = () => {
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
		if (dy > Math.abs(dx)) return;

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
		historyLoading,
		historyError,
		input,
		setInput,
		attachment,
		setAttachment,
		clearAttachment,
		sendMessage,
		newConversation,
		switchConversation,
		retryHistory,
		deleteConversation,
		clearAllConversations,
	} = useChat();

	// Deep links from the Bible reader (/bible): ?prompt= prefills the input,
	// ?attachRef/&attachText=/&attachTranslation= pins a passage above it.
	const searchParams = useSearchParams();
	const promptParam = searchParams.get("prompt") ?? "";
	const attachRefParam = searchParams.get("attachRef") ?? "";
	const attachTextParam = searchParams.get("attachText") ?? "";
	const attachTranslationParam = searchParams.get("attachTranslation") ?? "";
	const [focusSignal, setFocusSignal] = useState(0);
	const lastSeededPrompt = useRef("");
	const lastSeededAttachment = useRef("");

	// ?prompt= — prefill the input and focus it, but leave sending to the user.
	useEffect(() => {
		if (!promptParam || promptParam === lastSeededPrompt.current) return;
		lastSeededPrompt.current = promptParam;
		setInput(promptParam);
		setFocusSignal((signal) => signal + 1);
	}, [promptParam, setInput]);

	// ?attachRef= etc. — pin the passage above the input and focus so the user
	// can type their own question; any draft they already typed stays untouched.
	useEffect(() => {
		if (!attachRefParam) return;
		const key = `${attachRefParam} ${attachTranslationParam} ${attachTextParam}`;
		if (key === lastSeededAttachment.current) return;
		lastSeededAttachment.current = key;
		const translation: TranslationId =
			attachTranslationParam in TRANSLATIONS
				? (attachTranslationParam as TranslationId)
				: "KJV";
		setAttachment({ reference: attachRefParam, text: attachTextParam, translation });
		setFocusSignal((signal) => signal + 1);
	}, [attachRefParam, attachTextParam, attachTranslationParam, setAttachment]);

	const handleSend = (text: string) => {
		sendMessage(text);
	};

	const onLocalCommand = useCallback(
		(action: LocalCommandAction) => {
			if (action === "new") {
				newConversation();
				setSidebarOpen(false);
			} else if (action === "history") {
				setSidebarOpen(true);
			} else if (action === "clear") {
				if (!activeConversationId) {
					newConversation();
					return;
				}
				const confirmed = window.confirm(
					"Delete this conversation?\n\nThe conversation and its messages will be removed."
				);
				if (confirmed) void deleteConversation(activeConversationId);
			}
		},
		[activeConversationId, newConversation, deleteConversation]
	);

	const title = activeConversation?.title ?? "New Chat";

	return (
		<div
			className="flex h-[100dvh] gradient-mesh overflow-hidden"
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
					onNewChat={newConversation}
				/>

				{historyLoading ? (
					<div
						role="status"
						aria-live="polite"
						className="flex-1 flex items-center justify-center gap-2 text-sm text-neutral-500 dark:text-neutral-400"
					>
						<Loader2 className="h-4 w-4 animate-spin" />
						Loading conversation...
					</div>
				) : historyError ? (
					<div
						role="alert"
						aria-live="assertive"
						className="flex-1 flex items-center justify-center px-4 py-8"
					>
						<div className="w-full max-w-md rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-5 text-center">
							<h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
								Couldn&apos;t load this conversation
							</h2>
							<p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-400">
								{historyError}
							</p>
							<div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
								<button
									type="button"
									onClick={retryHistory}
									className="min-h-[44px] rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200 flex items-center justify-center gap-2"
								>
									<RefreshCw className="h-4 w-4" />
									Retry
								</button>
								<button
									type="button"
									onClick={newConversation}
									className="min-h-[44px] rounded-xl border border-black/10 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-black/[0.04] dark:border-white/10 dark:text-neutral-300 dark:hover:bg-white/[0.05] flex items-center justify-center gap-2"
								>
									<Plus className="h-4 w-4" />
									Start new chat
								</button>
							</div>
						</div>
					</div>
				) : messages.length === 0 ? (
					<WelcomeScreen onSelectQuestion={handleSend} />
				) : (
					<MessageList messages={messages} onFollowUp={handleSend} />
				)}

				<ChatInput
					onSend={handleSend}
					loading={loading}
					isStreaming={isStreaming}
					disabled={historyLoading || Boolean(historyError)}
					commands={CHAT_SLASH_COMMANDS}
					onLocalCommand={onLocalCommand}
					value={input}
					onChangeText={setInput}
					attachment={attachment}
					onClearAttachment={clearAttachment}
					focusSignal={focusSignal}
				/>
			</div>
		</div>
	);
};

const BibleAIExplorer: React.FC = () => (
	<Suspense fallback={null}>
		<BibleAIExplorerInner />
	</Suspense>
);

export default BibleAIExplorer;
