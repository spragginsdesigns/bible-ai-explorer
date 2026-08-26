"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat as useAIChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { SureWordUIMessage } from "@/lib/ai-tools";
import {
	AttachmentValidationError,
	type ChatAttachmentDescriptor,
	validateAttachmentBatch,
} from "@/lib/chat-attachment-types";
import { completedHistory } from "@/lib/chat/answerRecovery";
import {
	classifyChatError,
	conversationStartError,
	recoveryExhaustedError,
	type ClassifiedChatError,
} from "@/lib/chat/chatErrors";
import {
	composeMessageWithAttachment,
	type VerseAttachment,
} from "@/lib/chat/verseActions";
import { readEffortPref, readModelPref, readTranslationPref } from "@/lib/preferences";
import { toolActivityLabel } from "@/lib/tool-activity-labels";
import { joinAssistantTextParts, stripFollowUpMarkers } from "@/utils/assistantMarkdown";

export interface RetrievedVerse {
	reference: string;
	similarity: number;
	text?: string;
}

export interface TavilyResult {
	title: string;
	content: string;
	url: string;
	favicon?: string;
}

export interface NoteAction {
	noteId: string;
	noteTitle: string;
	created: boolean;
}

/** Receipt for a "Pick Up Your Cross" the assistant replaced this turn. */
export interface CrossAction {
	reference: string;
	text: string;
	reason: string;
	previousReference: string | null;
}

export interface ChatMessage {
	id: string;
	role: "user" | "assistant";
	content: string;
	tavilyResults?: TavilyResult[];
	retrievedVerses?: RetrievedVerse[];
	averageSimilarity?: number;
	followUps?: string[];
	noteActions?: NoteAction[];
	crossActions?: CrossAction[];
	attachments?: ChatAttachmentDescriptor[];
	/** Human-readable label for the tool currently running, e.g. "Searching the Scriptures". */
	activity?: string;
	isStreaming?: boolean;
	timestamp: number;
}

export interface Conversation {
	id: string;
	title: string;
	createdAt: string;
}

const HISTORY_LOAD_ERROR =
	"We couldn't load this conversation. Retry to restore its context, or start a new chat.";

/** How often the recovery poll asks the server whether the answer has landed. */
const RECOVERY_POLL_INTERVAL_MS = 3_000;
/**
 * How long to keep collecting. The route's own budget is 120s (maxDuration),
 * so this outlasts the slowest possible answer plus its persistence.
 */
const RECOVERY_MAX_MS = 150_000;
/**
 * Grace period after the tab becomes visible again. A stream that merely
 * stalled while hidden often resumes on its own, and tearing it down to poll
 * instead would throw away a live answer.
 */
const RESUME_GRACE_MS = 4_000;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function visibleResponseContent(content: string, isStreaming: boolean): string {
	return stripFollowUpMarkers(content, { streaming: isStreaming });
}

function parseFollowUps(content: string): string[] {
	const followUps: string[] = [];
	const seen = new Set<string>();
	// Line-anchored, and [ \t]* rather than \s* so extraction and stripping agree
	// that the question lives on the marker's own line. With \s* a marker alone
	// on its line captured the NEXT line, which then rendered as both body text
	// and a chip. Keep this identical to mobile/src/lib/chatView.ts and to the
	// server's copy in src/app/api/ask-question/route.ts.
	const followUpRegex = /^[ \t]*\[FOLLOWUP\][ \t]*([^\r\n]+)/gm;
	let match: RegExpExecArray | null;

	while ((match = followUpRegex.exec(content)) !== null && followUps.length < 2) {
		const question = match[1].trim();
		const normalized = question.toLowerCase();
		if (question && !seen.has(normalized)) {
			seen.add(normalized);
			followUps.push(question);
		}
	}

	return followUps;
}

function parseVerses(value: unknown): RetrievedVerse[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((verse): RetrievedVerse[] => {
		if (
			!isRecord(verse) ||
			typeof verse.reference !== "string" ||
			typeof verse.similarity !== "number"
		) {
			return [];
		}
		return [{
			reference: verse.reference,
			similarity: verse.similarity,
			...(typeof verse.text === "string" ? { text: verse.text } : {}),
		}];
	});
}

function parseTavilyResults(value: unknown): TavilyResult[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((result): TavilyResult[] => {
		if (
			!isRecord(result) ||
			typeof result.title !== "string" ||
			typeof result.content !== "string" ||
			typeof result.url !== "string"
		) {
			return [];
		}
		return [{
			title: result.title,
			content: result.content,
			url: result.url,
			...(typeof result.favicon === "string" ? { favicon: result.favicon } : {}),
		}];
	});
}

interface LegacyMessageMetadata {
	retrievedVerses?: unknown;
	averageSimilarity?: unknown;
	tavilyResults?: unknown;
	followUps?: unknown;
}

/**
 * Convert an AI SDK UIMessage (live or restored) into the view model the chat
 * components render. Tool results become verse/web/note cards; [FOLLOWUP]
 * marker lines become chips.
 */
export function toViewMessage(
	message: SureWordUIMessage,
	options: { isStreaming: boolean }
): ChatMessage {
	const legacy = isRecord(message.metadata)
		? (message.metadata as LegacyMessageMetadata)
		: {};

	const textParts: string[] = [];
	const retrievedVerses: RetrievedVerse[] = parseVerses(legacy.retrievedVerses);
	const similarities: number[] = [];
	const tavilyResults: TavilyResult[] = parseTavilyResults(legacy.tavilyResults);
	const noteActions: NoteAction[] = [];
	const crossActions: CrossAction[] = [];
	const fileParts = message.parts.filter((part) => part.type === "file");
	const fileIds = Array.isArray(message.metadata?.attachmentIds)
		? message.metadata.attachmentIds
		: [];
	const attachments: ChatAttachmentDescriptor[] = fileParts.map((part, index) => ({
		id: fileIds[index] ?? `${message.id}-file-${index}`,
		filename: part.filename ?? `Attachment ${index + 1}`,
		mediaType: part.mediaType as ChatAttachmentDescriptor["mediaType"],
		size: 0,
		previewUrl: part.url,
		previewExpiresAt: "",
	}));
	let statusActivity: string | undefined;
	let toolActivity: string | undefined;

	for (const part of message.parts) {
		if (part.type === "text") {
			textParts.push(part.text);
			continue;
		}

		if (part.type === "data-status") {
			const data: unknown = part.data;
			if (isRecord(data) && typeof data.label === "string") {
				statusActivity = data.label;
			}
			continue;
		}

		if (!part.type.startsWith("tool-")) continue;
		const toolPart = part as {
			type: string;
			state: string;
			output?: unknown;
		};

		if (toolPart.state === "input-streaming" || toolPart.state === "input-available") {
			toolActivity = toolActivityLabel(toolPart.type.slice(5));
			continue;
		}
		if (toolPart.state !== "output-available" || !isRecord(toolPart.output)) continue;

		const output = toolPart.output;
		if (part.type === "tool-searchScripture") {
			const verses = parseVerses(output.verses);
			retrievedVerses.push(...verses);
			similarities.push(...verses.map((verse) => verse.similarity));
		} else if (part.type === "tool-getPassage") {
			retrievedVerses.push(...parseVerses(output.verses));
		} else if (part.type === "tool-webSearch") {
			tavilyResults.push(...parseTavilyResults(output.results));
		} else if (part.type === "tool-addToNote") {
			if (typeof output.noteId === "string" && typeof output.noteTitle === "string") {
				noteActions.push({
					noteId: output.noteId,
					noteTitle: output.noteTitle,
					created: output.created === true,
				});
			}
		} else if (part.type === "tool-setDailyCross") {
			// Only the write shows a receipt; reading the day is silent.
			if (typeof output.reference === "string" && typeof output.text === "string") {
				crossActions.push({
					reference: output.reference,
					text: output.text,
					reason: typeof output.reason === "string" ? output.reason : "",
					previousReference:
						typeof output.previousReference === "string" ? output.previousReference : null,
				});
			}
		}
	}

	// Text parts split around tool calls need a blank line between them, or a
	// part that opens a list/heading/quote glues onto the previous line and the
	// markdown never parses.
	const text = joinAssistantTextParts(textParts);
	const content = visibleResponseContent(text, options.isStreaming);

	// Server status lines narrate the wait; once the answer itself is on screen
	// they are stale. A tool running mid-answer still says what it is doing.
	const activity = toolActivity ?? (content.trim() ? undefined : statusActivity);

	const followUps = options.isStreaming
		? parseFollowUps(text)
		: [
				...new Set([
					...parseFollowUps(text),
					...(Array.isArray(legacy.followUps)
						? legacy.followUps.filter((f): f is string => typeof f === "string")
						: []),
				]),
			].slice(0, 2);

	const averageSimilarity =
		typeof legacy.averageSimilarity === "number"
			? legacy.averageSimilarity
			: similarities.length > 0
				? similarities.reduce((sum, s) => sum + s, 0) / similarities.length
				: undefined;

	return {
		id: message.id,
		role: message.role === "user" ? "user" : "assistant",
		content,
		...(retrievedVerses.length > 0 ? { retrievedVerses } : {}),
		...(averageSimilarity !== undefined ? { averageSimilarity } : {}),
		...(tavilyResults.length > 0 ? { tavilyResults } : {}),
		...(followUps.length > 0 ? { followUps } : {}),
		...(noteActions.length > 0 ? { noteActions } : {}),
		...(crossActions.length > 0 ? { crossActions } : {}),
		...(attachments.length > 0 ? { attachments } : {}),
		...(activity && options.isStreaming ? { activity } : {}),
		...(options.isStreaming ? { isStreaming: true } : {}),
		timestamp: Date.now(),
	};
}

/** Map a stored DB message row to a UIMessage for the AI SDK chat state. */
export function dbMessageToUIMessage(value: unknown): SureWordUIMessage {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		(value.role !== "user" && value.role !== "assistant") ||
		typeof value.content !== "string"
	) {
		throw new Error("Conversation history response contained an invalid message.");
	}

	const metadata = isRecord(value.metadata) ? value.metadata : {};
	const restoredParts = Array.isArray(metadata.parts)
		? (metadata.parts as SureWordUIMessage["parts"]).filter(
			(part) => !part.type.startsWith("data-"),
		)
		: [{ type: "text" as const, text: value.content }];
	const storedAttachments = Array.isArray(value.attachments)
		? value.attachments.filter(isRecord)
		: [];
	const attachmentParts = storedAttachments.flatMap((attachment) =>
		typeof attachment.id === "string" &&
		typeof attachment.filename === "string" &&
		typeof attachment.mediaType === "string" &&
		typeof attachment.previewUrl === "string"
			? [{
				type: "file" as const,
				filename: attachment.filename,
				mediaType: attachment.mediaType,
				url: attachment.previewUrl,
			}]
			: [],
	);
	const parts = attachmentParts.length > 0
		? [...attachmentParts, ...restoredParts.filter((part) => part.type !== "file")]
		: restoredParts;
	const attachmentIds = storedAttachments.flatMap((attachment) =>
		typeof attachment.id === "string" ? [attachment.id] : [],
	);

	const { parts: _ignored, ...legacyMetadata } = metadata;

	return {
		id: value.id,
		role: value.role,
		parts,
		...(
			Object.keys(legacyMetadata).length > 0 || attachmentIds.length > 0
				? { metadata: { ...legacyMetadata, ...(attachmentIds.length > 0 ? { attachmentIds } : {}) } }
				: {}
		),
	};
}

export const useChat = () => {
	const [conversations, setConversations] = useState<Conversation[]>([]);
	const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
	const [initialLoading, setInitialLoading] = useState(true);
	const [historyLoading, setHistoryLoading] = useState(false);
	const [historyError, setHistoryError] = useState<string | null>(null);
	const [sendError, setSendError] = useState<ClassifiedChatError | null>(null);
	const [input, setInput] = useState("");
	const [attachment, setAttachmentState] = useState<VerseAttachment | null>(null);
	const [fileAttachments, setFileAttachments] = useState<ChatAttachmentDescriptor[]>([]);
	const [uploadingAttachments, setUploadingAttachments] = useState(false);
	const [attachmentError, setAttachmentError] = useState<string | null>(null);
	const attachmentDraftVersionRef = useRef(0);
	const setAttachment = useCallback(
		(next: VerseAttachment) => setAttachmentState(next),
		[]
	);
	const clearAttachment = useCallback(() => setAttachmentState(null), []);
	const discardFileAttachments = useCallback((attachments: ChatAttachmentDescriptor[]) => {
		for (const item of attachments) {
			void fetch(`/api/chat/attachments/${item.id}`, { method: "DELETE" });
		}
	}, []);

	const addFileAttachments = useCallback(async (files: File[]) => {
		if (files.length === 0 || uploadingAttachments) return;
		const draftVersion = attachmentDraftVersionRef.current;
		setAttachmentError(null);
		let initializedIds: string[] = [];
		try {
			validateAttachmentBatch([
				...fileAttachments.map((item) => ({
					filename: item.filename,
					mediaType: item.mediaType,
					size: item.size,
				})),
				...files.map((file) => ({
					filename: file.name,
					mediaType: file.type,
					size: file.size,
				})),
			]);
			setUploadingAttachments(true);
			const initResponse = await fetch("/api/chat/attachments", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					files: files.map((file) => ({
						filename: file.name,
						mediaType: file.type,
						size: file.size,
					})),
				}),
			});
			const initialized = await initResponse.json();
			if (!initResponse.ok || !Array.isArray(initialized.uploads)) {
				throw new Error(initialized.error ?? "Could not prepare the upload.");
			}
			initializedIds = initialized.uploads.map((upload: { id: string }) => upload.id);

			const completed = await Promise.all(initialized.uploads.map(async (
				upload: { id: string; uploadUrl: string; mediaType: string },
				index: number,
			) => {
				const putResponse = await fetch(upload.uploadUrl, {
					method: "PUT",
					headers: { "Content-Type": upload.mediaType },
					body: files[index],
				});
				if (!putResponse.ok) throw new Error(`Could not upload ${files[index].name}.`);
				const completeResponse = await fetch(`/api/chat/attachments/${upload.id}/complete`, {
					method: "POST",
				});
				const result = await completeResponse.json();
				if (!completeResponse.ok || !result.attachment) {
					throw new Error(result.error ?? `Could not verify ${files[index].name}.`);
				}
				return result.attachment as ChatAttachmentDescriptor;
			}));
			if (draftVersion !== attachmentDraftVersionRef.current) {
				discardFileAttachments(completed);
			} else {
				setFileAttachments((current) => [...current, ...completed]);
			}
		} catch (error) {
			for (const id of initializedIds) {
				void fetch(`/api/chat/attachments/${id}`, { method: "DELETE" });
			}
			setAttachmentError(
				error instanceof AttachmentValidationError || error instanceof Error
					? error.message
					: "Could not upload the selected files.",
			);
		} finally {
			setUploadingAttachments(false);
		}
	}, [discardFileAttachments, fileAttachments, uploadingAttachments]);

	const removeFileAttachment = useCallback(async (id: string) => {
		const response = await fetch(`/api/chat/attachments/${id}`, { method: "DELETE" });
		if (!response.ok) {
			const body = await response.json().catch(() => ({}));
			setAttachmentError(body.error ?? "Could not remove the attachment.");
			return;
		}
		setFileAttachments((current) => current.filter((item) => item.id !== id));
	}, []);
	const initialized = useRef(false);
	const conversationIdRef = useRef<string | null>(null);
	/** Text of a send that never left the device, so "Try again" can re-fire it. */
	const lastFailedSendRef = useRef<string | null>(null);
	const historyLoadVersionRef = useRef(0);
	const historyLoadingRef = useRef(false);
	const historyErrorRef = useRef(false);

	const transport = useMemo(
		() =>
			new DefaultChatTransport<SureWordUIMessage>({
				api: "/api/ask-question",
				prepareSendMessagesRequest: ({ messages }) => ({
					body: {
						messages,
						conversationId: conversationIdRef.current,
						// Read per request so a settings change applies to the next
						// message without remounting the hook.
						translation: readTranslationPref(),
						modelId: readModelPref(),
						effort: readEffortPref(),
					},
				}),
			}),
		[]
	);

	const {
		messages: uiMessages,
		sendMessage: sendUIMessage,
		setMessages: setUIMessages,
		clearError,
		stop,
		regenerate,
		status,
		error: chatError,
	} = useAIChat<SureWordUIMessage>({ transport, throttle: 50 });

	// --- Never lose an answer to a broken connection ------------------------
	//
	// A backgrounded phone, a sleeping laptop or a network change kills the
	// streaming fetch mid-answer. The server keeps going and persists the
	// finished answer (see the consumeSseStream drain in /api/ask-question), so
	// the answer is waiting in the conversation - collect it instead of
	// reporting a failure. Mirrors the Android client's recovery.
	const pendingAnswerRef = useRef<string | null>(null);
	const [recovering, setRecovering] = useState(false);
	const recoveringRef = useRef(false);
	const recoverVersionRef = useRef(0);
	/** When the stream last produced anything - a stalled stream shows as old. */
	const lastStreamActivityRef = useRef(0);
	const statusRef = useRef(status);

	useEffect(() => {
		statusRef.current = status;
	}, [status]);

	useEffect(() => {
		lastStreamActivityRef.current = Date.now();
	}, [uiMessages]);

	// A stream that finished on its own owes nothing.
	useEffect(() => {
		if (status === "ready" && !recoveringRef.current) pendingAnswerRef.current = null;
	}, [status]);

	const cancelRecovery = useCallback(() => {
		recoverVersionRef.current += 1;
		recoveringRef.current = false;
		pendingAnswerRef.current = null;
		setRecovering(false);
	}, []);

	/**
	 * Poll the conversation until the finished answer appears, then swap it in
	 * as if the stream had never broken. Only gives up once the server's own
	 * budget has run out, at which point asking again is the honest option.
	 */
	const collectPendingAnswer = useCallback(
		async (conversationId: string) => {
			if (recoveringRef.current) return;
			recoveringRef.current = true;
			const version = ++recoverVersionRef.current;
			setRecovering(true);

			const deadline = Date.now() + RECOVERY_MAX_MS;
			try {
				while (Date.now() < deadline) {
					if (version !== recoverVersionRef.current) return;
					if (conversationIdRef.current !== conversationId) return;
					try {
						const res = await fetch(`/api/conversations/${conversationId}`);
						if (version !== recoverVersionRef.current) return;
						if (res.ok) {
							const restored = completedHistory(await res.json());
							if (restored) {
								setUIMessages(restored.map(dbMessageToUIMessage));
								pendingAnswerRef.current = null;
								setSendError(null);
								clearError();
								return;
							}
						}
					} catch {
						// Offline or a transient failure - the answer is still being
						// written server-side, so keep asking until the deadline.
					}
					await delay(RECOVERY_POLL_INTERVAL_MS);
				}
				if (version !== recoverVersionRef.current) return;
				pendingAnswerRef.current = null;
				setSendError(recoveryExhaustedError());
			} finally {
				if (version === recoverVersionRef.current) {
					recoveringRef.current = false;
					setRecovering(false);
				}
			}
		},
		[clearError, setUIMessages]
	);

	// A broken stream is a collection job, not a failure to show the user.
	useEffect(() => {
		if (!chatError) return;
		const conversationId = pendingAnswerRef.current;
		if (!conversationId) return;
		void collectPendingAnswer(conversationId);
	}, [chatError, collectPendingAnswer]);

	// Coming back to the tab: give a stalled stream a moment to resume, and
	// collect from the server only once it is clear nothing is arriving.
	useEffect(() => {
		const onVisible = () => {
			if (document.visibilityState !== "visible") return;
			const conversationId = pendingAnswerRef.current;
			if (!conversationId || recoveringRef.current) return;

			void (async () => {
				await delay(RESUME_GRACE_MS);
				if (pendingAnswerRef.current !== conversationId || recoveringRef.current) return;
				if (statusRef.current === "ready") return;
				if (Date.now() - lastStreamActivityRef.current < RESUME_GRACE_MS) return;
				stop();
				void collectPendingAnswer(conversationId);
			})();
		};

		document.addEventListener("visibilitychange", onVisible);
		return () => document.removeEventListener("visibilitychange", onVisible);
	}, [collectPendingAnswer, stop]);

	// Load conversation list on mount
	useEffect(() => {
		if (initialized.current) return;
		initialized.current = true;

		(async () => {
			try {
				const res = await fetch("/api/conversations");
				if (res.ok) {
					const data = await res.json();
					setConversations(
						data.map((c: { id: string; title: string; createdAt: string }) => ({
							id: c.id,
							title: c.title,
							createdAt: c.createdAt,
						}))
					);
				}
			} catch {
				// Silent fail on initial load
			} finally {
				setInitialLoading(false);
			}
		})();
	}, []);

	const switchConversation = useCallback(
		async (id: string) => {
			if (id === conversationIdRef.current) return;
			const loadVersion = ++historyLoadVersionRef.current;
			attachmentDraftVersionRef.current += 1;

			discardFileAttachments(fileAttachments);
			setFileAttachments([]);
			cancelRecovery();
			stop();
			setActiveConversationId(id);
			conversationIdRef.current = id;
			setSendError(null);
			setHistoryError(null);
			historyErrorRef.current = false;
			historyLoadingRef.current = true;
			setHistoryLoading(true);
			setUIMessages([]);

			try {
				const res = await fetch(`/api/conversations/${id}`);
				if (!res.ok) throw new Error("Conversation history request failed.");

				const data: unknown = await res.json();
				if (loadVersion !== historyLoadVersionRef.current) return;
				if (!isRecord(data) || !Array.isArray(data.messages)) {
					throw new Error("Conversation history response was invalid.");
				}

				setUIMessages(data.messages.map(dbMessageToUIMessage));
			} catch {
				if (loadVersion === historyLoadVersionRef.current) {
					historyErrorRef.current = true;
					setHistoryError(HISTORY_LOAD_ERROR);
				}
			} finally {
				if (loadVersion === historyLoadVersionRef.current) {
					historyLoadingRef.current = false;
					setHistoryLoading(false);
				}
			}
		},
		[cancelRecovery, discardFileAttachments, fileAttachments, stop, setUIMessages]
	);

	const retryHistory = useCallback(() => {
		const id = conversationIdRef.current;
		if (id) {
			conversationIdRef.current = null;
			void switchConversation(id);
		}
	}, [switchConversation]);

	const newConversation = useCallback(() => {
		historyLoadVersionRef.current += 1;
		attachmentDraftVersionRef.current += 1;
		historyLoadingRef.current = false;
		historyErrorRef.current = false;
		discardFileAttachments(fileAttachments);
		setFileAttachments([]);
		cancelRecovery();
		stop();
		setHistoryLoading(false);
		setHistoryError(null);
		setActiveConversationId(null);
		conversationIdRef.current = null;
		setSendError(null);
		setUIMessages([]);
	}, [cancelRecovery, discardFileAttachments, fileAttachments, stop, setUIMessages]);

	const deleteConversation = useCallback(
		async (id: string) => {
			setConversations((prev) => prev.filter((c) => c.id !== id));
			if (conversationIdRef.current === id) {
				newConversation();
			}
			try {
				await fetch(`/api/conversations/${id}`, { method: "DELETE" });
			} catch {
				// Silent fail
			}
		},
		[newConversation]
	);

	const clearAllConversations = useCallback(async () => {
		const ids = conversations.map((c) => c.id);
		setConversations([]);
		newConversation();
		for (const id of ids) {
			try {
				await fetch(`/api/conversations/${id}`, { method: "DELETE" });
			} catch {
				// Continue
			}
		}
	}, [conversations, newConversation]);

	const sendMessage = useCallback(
		async (text: string) => {
			const composed = composeMessageWithAttachment(text, attachment);
			if (
				(!composed && fileAttachments.length === 0) ||
				uploadingAttachments ||
				historyLoadingRef.current ||
				historyErrorRef.current ||
				status === "submitted" ||
				status === "streaming"
			) {
				return;
			}

			setSendError(null);

			// Create the conversation first so the server can persist the exchange.
			// If it fails, do NOT send: without a conversation the answer cannot be
			// recovered if the stream breaks, so a silent null-id send turns one
			// hiccup into a lost answer. Surface a retryable error instead.
			if (!conversationIdRef.current) {
				const failCreate = (classified: ClassifiedChatError) => {
					setSendError(classified.code === "internal" ? conversationStartError() : classified);
					lastFailedSendRef.current = text;
				};
				try {
					const title = composed || `Attachment: ${fileAttachments[0]?.filename ?? "New chat"}`;
					const res = await fetch("/api/conversations", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ title: title.slice(0, 60) }),
					});
					if (!res.ok) {
						const bodyText = await res.text().catch(() => undefined);
						failCreate(classifyChatError({ status: res.status, bodyText }));
						return;
					}
					const created = await res.json();
					conversationIdRef.current = created.id;
					setActiveConversationId(created.id);
					setConversations((prev) => [
						{
							id: created.id,
							title: title.slice(0, 60),
							createdAt: new Date().toISOString(),
						},
						...prev,
					]);
				} catch {
					failCreate(classifyChatError({ isNetworkError: true }));
					return;
				}
			}

			setAttachmentState(null);
			const sendingAttachments = fileAttachments;
			setFileAttachments([]);
			// From here the server owns the answer: if this client's stream dies
			// the answer is still written and persisted, and the recovery poll
			// collects it. Without a conversation there is nothing to collect.
			pendingAnswerRef.current = conversationIdRef.current;
			lastStreamActivityRef.current = Date.now();
			void sendUIMessage({
				metadata: sendingAttachments.length > 0
					? { attachmentIds: sendingAttachments.map((item) => item.id) }
					: {},
				parts: [
					...sendingAttachments.map((item) => ({
						type: "file" as const,
						filename: item.filename,
						mediaType: item.mediaType,
						url: item.previewUrl,
					})),
					...(composed ? [{ type: "text" as const, text: composed }] : []),
				],
			});
		},
		[attachment, fileAttachments, sendUIMessage, status, uploadingAttachments]
	);

	/**
	 * Re-fire the last failed send. If the message never left the device
	 * (conversation creation failed) send the stored text again; otherwise the
	 * message reached the server and a regenerate replays the last exchange.
	 */
	const retrySend = useCallback(() => {
		const failedText = lastFailedSendRef.current;
		lastFailedSendRef.current = null;
		if (failedText) {
			void sendMessage(failedText);
			return;
		}
		setSendError(null);
		clearError();
		void regenerate();
	}, [sendMessage, clearError, regenerate]);

	const isStreaming = status === "streaming";
	// Collecting a finished answer from the server reads as "still working" -
	// the user asked a question and one is on its way, same as a live stream.
	const loading = status === "submitted" || recovering;

	const messages = useMemo(() => {
		const lastAssistantId = [...uiMessages]
			.reverse()
			.find((message) => message.role === "assistant")?.id;

		const viewMessages = uiMessages.map((message) =>
			toViewMessage(message, {
				isStreaming:
					(isStreaming || loading) &&
					message.role === "assistant" &&
					message.id === lastAssistantId,
			})
		);

		// While waiting for the stream to start there is no assistant message
		// yet; show a typing indicator in its place.
		if (loading && viewMessages.at(-1)?.role === "user") {
			viewMessages.push({
				id: "pending-assistant",
				role: "assistant",
				content: "",
				isStreaming: true,
				timestamp: Date.now(),
			});
		}

		return viewMessages;
	}, [uiMessages, isStreaming, loading]);

	const activeConversation =
		conversations.find((c) => c.id === activeConversationId) ?? null;

	// A broken stream while an answer is being collected is not the user's
	// problem to see - it resolves itself.
	const error = useMemo<ClassifiedChatError | null>(() => {
		if (recovering) return null;
		if (sendError) return sendError;
		// The transport throws pre-stream HTTP failures with the raw response
		// body as the message and mid-stream chunks as "[code] message" - the
		// classifier unpacks both shapes.
		return chatError ? classifyChatError({ message: chatError.message }) : null;
	}, [recovering, sendError, chatError]);

	return {
		messages,
		conversations,
		activeConversationId,
		activeConversation,
		isStreaming,
		loading,
		initialLoading,
		historyLoading,
		historyError,
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
		newConversation,
		switchConversation,
		retryHistory,
		deleteConversation,
		clearAllConversations,
	};
};
