"use client";

import React, { Suspense, useState, useRef, useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import AppSidebar from "./AppSidebar";
import ChatSidebar from "./ChatSidebar";
import ChatTopBar from "./ChatTopBar";
import MessageList from "./MessageList";
import ChatInput from "./ChatInput";
import chatHome from "./ChatHome.module.css";
import WelcomeScreen from "./WelcomeScreen";
import { useChat } from "./useChat";
import { CHAT_SLASH_COMMANDS, type LocalCommandAction } from "@/lib/chat/slashCommands";
import { TRANSLATIONS, type TranslationId } from "@/lib/bible/translations";
import { readTranslationPref, readVoiceModePref } from "@/lib/preferences";
import { usePreference } from "@/lib/preferencesSync";
import { HELP_SCREENS, type HelpScreen } from "@/lib/onboarding-rules";
import VoiceModeToggle from "./walk/VoiceModeToggle";
import { useWelcomeVoice } from "./walk/useWelcomeVoice";
import { claimGuestTurnsOnce, guestClaimOpened, markGuestClaimOpened } from "@/lib/guest-client";
import { OPEN_CONVERSATION_EVENT } from "@/lib/web-notifications";
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
		initialLoading,
		historyLoading,
		historyError,
		historyActionError,
		error,
		input,
		setInput,
		attachment,
		fileAttachments,
		uploadingAttachments,
		attachmentError,
		setAttachment,
		clearAttachment,
		addFileAttachments,
		removeFileAttachment,
		sendMessage,
		retrySend,
		editingMessageId,
		editingHasFiles,
		startEditing,
		cancelEditing,
		submitEdit,
		retryAnswer,
		abandonPendingAnswer,
		newConversation,
		switchConversation,
		refreshConversations,
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
	const verseOfDayIdParam = searchParams.get("verseOfDayId") ?? "";
	const conversationIdParam = searchParams.get("conversationId") ?? "";
	const helpParam = searchParams.get("help") ?? "";
	const [focusSignal, setFocusSignal] = useState(0);
	const lastSeededPrompt = useRef("");
	const lastSeededAttachment = useRef("");
	const lastOpenedConversation = useRef("");
	/** An id opened from the URL whose switch has not reached state yet. */
	const pendingUrlConversation = useRef("");

	// ?conversationId= opens that conversation: a shared or bookmarked link, or
	// a click on an "answer is ready" notification (Android parity,
	// app/(app)/index.tsx).
	useEffect(() => {
		if (!conversationIdParam || conversationIdParam === lastOpenedConversation.current) return;
		lastOpenedConversation.current = conversationIdParam;
		pendingUrlConversation.current = conversationIdParam;
		void switchConversation(conversationIdParam);
	}, [conversationIdParam, switchConversation]);

	// A click on the in-tab "answer is ready" notification switches here
	// instead of reloading the page; preventDefault tells the notification
	// module the click was handled.
	useEffect(() => {
		const onOpen = (event: Event) => {
			const id = (event as CustomEvent<{ conversationId?: unknown }>).detail?.conversationId;
			if (typeof id !== "string" || !id) return;
			event.preventDefault();
			void switchConversation(id);
		};
		window.addEventListener(OPEN_CONVERSATION_EVENT, onOpen);
		return () => window.removeEventListener(OPEN_CONVERSATION_EVENT, onOpen);
	}, [switchConversation]);

	// Keep the address bar on the open conversation, so reload, back/forward
	// and copying the URL all return to it. replaceState rather than a router
	// push: switching chats is not navigation, and every other param (?prompt=,
	// ?attachRef=, ...) is carried over untouched; their effects dedupe.
	useEffect(() => {
		const pending = pendingUrlConversation.current;
		if (pending) {
			// The URL already names the conversation being opened; leave it
			// alone until that switch lands in state.
			if (activeConversationId !== pending) return;
			pendingUrlConversation.current = "";
		}
		const url = new URL(window.location.href);
		const current = url.searchParams.get("conversationId") ?? "";
		const next = activeConversationId ?? "";
		if (current === next) return;
		if (next) url.searchParams.set("conversationId", next);
		else url.searchParams.delete("conversationId");
		// Recorded first so the param change this causes does not re-open it.
		lastOpenedConversation.current = next;
		window.history.replaceState(window.history.state, "", url.toString());
	}, [activeConversationId]);

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
		const key = `${attachRefParam} ${attachTranslationParam} ${attachTextParam} ${verseOfDayIdParam}`;
		if (key === lastSeededAttachment.current) return;
		lastSeededAttachment.current = key;
		const translation: TranslationId =
			attachTranslationParam in TRANSLATIONS
				? (attachTranslationParam as TranslationId)
				: readTranslationPref();
		setAttachment({
			reference: attachRefParam,
			text: attachTextParam,
			translation,
			...(verseOfDayIdParam
				? {
						origin: {
							surface: "daily-cross" as const,
							verseOfDayId: verseOfDayIdParam,
							reference: attachRefParam,
							action: "go-deeper" as const,
						},
				  }
				: {}),
		});
		setFocusSignal((signal) => signal + 1);
	}, [attachRefParam, attachTextParam, attachTranslationParam, setAttachment, verseOfDayIdParam]);

	// Guest turns asked on the landing page before sign-up (docs/FEATURES.md,
	// "Try before you sign up"). The httpOnly cookie is what the claim route
	// reads, so it can adopt nothing but this browser's own questions. The
	// request itself is shared across mounts (see claimGuestTurnsOnce); only
	// the effect run that is still current opens the conversation.
	useEffect(() => {
		let current = true;
		void claimGuestTurnsOnce().then(async (conversationId) => {
			if (!conversationId || !current || guestClaimOpened()) return;
			await refreshConversations().catch(() => undefined);
			if (!current || guestClaimOpened()) return;
			markGuestClaimOpened();
			await switchConversation(conversationId);
		});
		return () => {
			current = false;
		};
	}, [refreshConversations, switchConversation]);

	// Follow-up chips and suggested questions always start a new message, so an
	// edit in progress is set aside first (its earlier draft comes back).
	// Stable across keystrokes: the input lives in useChat, so every character
	// re-renders this component, and the memoized list, sidebar and welcome
	// screen below only skip that work while their props hold still.
	const handleSend = useCallback((text: string) => {
		cancelEditing();
		sendMessage(text);
	}, [cancelEditing, sendMessage]);

	// The composer's own send: while editing, it replaces the edited message.
	const handleComposerSend = (text: string) => {
		if (editingMessageId) submitEdit(text);
		else sendMessage(text);
	};

	// startEditing reads the draft, so it changes on every keystroke; the ref keeps this handler fixed.
	// A screen's "?" help button (docs/onboarding/PLAN.md) lands here with
	// ?help=<screen>. Only the fixed HELP_SCREENS sentences can be sent this
	// way, never text from the URL itself, and the param is dropped first so a
	// reload does not ask again.
	const lastHelp = useRef("");
	useEffect(() => {
		if (!helpParam || helpParam === lastHelp.current) return;
		lastHelp.current = helpParam;
		const url = new URL(window.location.href);
		url.searchParams.delete("help");
		window.history.replaceState(window.history.state, "", url.toString());
		if (!Object.prototype.hasOwnProperty.call(HELP_SCREENS, helpParam)) return;
		newConversation();
		handleSend(HELP_SCREENS[helpParam as HelpScreen]);
	}, [helpParam, newConversation, handleSend]);

	const askChatHelp = useCallback(() => {
		newConversation();
		handleSend(HELP_SCREENS.chat);
	}, [newConversation, handleSend]);

	const focusComposer = useCallback(() => setFocusSignal((signal) => signal + 1), []);

	// "Read it to me" belongs to the welcome conversation only, which its
	// seeded first message identifies.
	const isWelcome = messages[0]?.welcome === true;
	const voiceMode = usePreference(readVoiceModePref, false);
	useWelcomeVoice(isWelcome && voiceMode && !historyLoading, activeConversationId, messages);

	const startEditingRef = useRef(startEditing);
	startEditingRef.current = startEditing;
	const handleEditMessage = useCallback((messageId: string) => {
		startEditingRef.current(messageId);
		setFocusSignal((signal) => signal + 1);
	}, []);
	const closeSidebar = useCallback(() => setSidebarOpen(false), []);
	const toggleSidebar = useCallback(() => setSidebarOpen((open) => !open), []);

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

	// Keep one docked composer through welcome, history, and active chat states.
	const showWelcome =
		!historyLoading && !historyError && messages.length === 0;

	// The dock is outside the welcome scroller, so popovers remain visible.
	const renderChatInput = (pickerPlacement: "above" | "below") => (
		<ChatInput
			pickerPlacement={pickerPlacement}
			onSend={handleComposerSend}
			loading={loading}
			isStreaming={isStreaming}
			disabled={historyLoading || Boolean(historyError)}
			commands={CHAT_SLASH_COMMANDS}
			onLocalCommand={onLocalCommand}
			value={input}
			onChangeText={setInput}
			attachment={attachment}
			onClearAttachment={clearAttachment}
			fileAttachments={fileAttachments}
			uploadingAttachments={uploadingAttachments}
			attachmentError={attachmentError}
			error={error}
			onRetry={retrySend}
			onStop={abandonPendingAnswer}
			onFilesSelected={addFileAttachments}
			onRemoveFileAttachment={(id) => void removeFileAttachment(id)}
			focusSignal={focusSignal}
			editing={Boolean(editingMessageId)}
			editingHasFiles={editingHasFiles}
			onCancelEdit={cancelEditing}
		/>
	);

	return (
		<div
			className={`flex h-[100dvh] overflow-hidden ${chatHome.shell}`}
			onTouchStart={handleTouchStart}
			onTouchEnd={handleTouchEnd}
		>
			<AppSidebar
				active="chat"
				open={sidebarOpen}
				onClose={closeSidebar}
			>
				<ChatSidebar
					conversations={conversations}
					activeConversationId={activeConversationId}
					initialLoading={initialLoading}
					historyActionError={historyActionError}
					onNewChat={newConversation}
					onSelectConversation={switchConversation}
					onDeleteConversation={deleteConversation}
					onClearAll={clearAllConversations}
					onNavigate={closeSidebar}
				/>
			</AppSidebar>

			<main className="flex-1 flex flex-col min-w-0 min-h-0 pb-20 lg:pb-0">
				<ChatTopBar
					title={title}
					onToggleSidebar={toggleSidebar}
					onNewChat={newConversation}
					onHelp={askChatHelp}
				/>
				{historyActionError && (
					<p role="alert" className="mx-4 mt-2 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2 text-sm text-red-700 dark:text-red-400">
						{historyActionError}
					</p>
				)}

				{historyLoading ? (
					<div
						role="status"
						aria-live="polite"
						className="flex-1 flex items-center justify-center gap-2 text-support text-neutral-500 dark:text-neutral-400"
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
							<h2 className="text-section-title font-semibold text-neutral-900 dark:text-neutral-100">
								{historyError.title}
							</h2>
							<p className="mt-2 text-support text-neutral-600 dark:text-neutral-400">
								{historyError.message}
							</p>
							<p className="mt-1 text-xs leading-4 text-neutral-400 dark:text-neutral-600">
								ref: {historyError.code}
							</p>
							<div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
								<button
									type="button"
									onClick={retryHistory}
									className="min-h-[44px] rounded-xl bg-neutral-900 px-4 py-2 text-control font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200 flex items-center justify-center gap-2"
								>
									<RefreshCw className="h-4 w-4" />
									Retry
								</button>
								<button
									type="button"
									onClick={newConversation}
									className="min-h-[44px] rounded-xl border border-black/10 px-4 py-2 text-control font-medium text-neutral-700 transition-colors hover:bg-black/[0.04] dark:border-white/10 dark:text-neutral-300 dark:hover:bg-white/[0.05] flex items-center justify-center gap-2"
								>
									<Plus className="h-4 w-4" />
									Start new chat
								</button>
							</div>
						</div>
					</div>
				) : showWelcome ? (
					<WelcomeScreen
						onSelectQuestion={handleSend}
					/>
				) : (
					<>
					{isWelcome && <VoiceModeToggle />}
					<MessageList
						messages={messages}
						onFollowUp={handleSend}
						conversationTitle={activeConversation?.title}
						busy={isStreaming || loading}
						onEditMessage={handleEditMessage}
						onRetryAnswer={retryAnswer}
						onAnswerCard={handleSend}
						onTypeOwn={focusComposer}
					/>
					</>
				)}

				{renderChatInput("above")}
			</main>
		</div>
	);
};

const BibleAIExplorer: React.FC = () => (
	<Suspense fallback={<main className="flex min-h-dvh items-center justify-center" role="status" aria-label="Loading SureWord"><p className="text-sm text-neutral-600 dark:text-neutral-400">Opening SureWord...</p></main>}>
		<BibleAIExplorerInner />
	</Suspense>
);

export default BibleAIExplorer;
