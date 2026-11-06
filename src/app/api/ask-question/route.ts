import { readingTimezone } from "@/lib/reading-time";
import { readingRequestContext, type ReadingToolContext } from "@/lib/reading-tools";
import {
	convertToModelMessages,
	createIdGenerator,
	createUIMessageStream,
	createUIMessageStreamResponse,
	isStepCount,
	streamText,
	toUIMessageStream,
	validateUIMessages,
	type UIMessage,
	type UIMessageChunk,
	type FilePart,
	type ImagePart,
} from "ai";
import { plainDashes } from "@/lib/ai/plain-dashes";
import { waitUntil } from "@vercel/functions";
import { ChatAttachmentStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { getAuthUser, syncProfileFromClerk } from "@/lib/auth";
import {
	MAX_ATTACHMENTS_PER_MESSAGE,
	MAX_ATTACHMENT_MESSAGE_BYTES,
	isAudioMediaType,
	isDailyCrossMessageOrigin,
	sanitizeDailyCrossMessageOrigin,
	type DailyCrossMessageOrigin,
} from "@/lib/chat-attachment-types";
import { createAttachmentPreviewUrl } from "@/lib/chat-attachments.server";
import { audioTranscriptText } from "@/lib/audio-transcription-rules";
import { prisma } from "@/lib/prisma";
import { notifyChatAnswerReady } from "@/lib/push";
import { withChatClientConnection, type ChatClientConnection } from "@/lib/chat-client-connection";
import { notifyUnlessChatStopped, parseChatNotificationAttemptId } from "@/lib/chat-notification-stop";
import { buildSureWordTools, type SureWordTools, type SureWordUIMessage } from "@/lib/ai-tools";
import { linksInText } from "@/lib/chat/user-links";
import { resolveModel, resolveVerificationModel, aiAccessFor } from "@/lib/ai/provider";
import { UserFacingError, chatErrorPayload, codeForError, streamErrorText } from "@/lib/ai/errors";
import { askQuestionRateLimiter, rateLimitKey } from "@/lib/rateLimit";
import {
	createNarratedDownload,
	hasPersistableContent,
	persistableParts,
	startStatusNarration,
} from "@/lib/ai/status-narration";
import { createProgressNarration } from "@/lib/ai/progress-narration";
import { SCRIPTURE_OUTPUT_GUIDANCE, verifyGeneratedAnswer } from "@/lib/ai/verified-generation";
import { releaseVerifiedAnswer } from "@/lib/ai/verified-answer-stream";
import { releaseCertifiedFreshTurn,releaseFreshRequestRefusal,textBlocksOf,withTextBlocks } from "@/lib/ai/history/fresh-stream";
import { historyService,createCurrentRequestReview } from "@/lib/ai/history/runtime.server";
import {preparedRequestReviewContext} from "@/lib/ai/history/prepared-request.mjs";
import { reviewedAssistantTurns } from "@/lib/ai/history/model-context";
import type { PreparedAttachment,ExecutedHistoryAction } from "@/lib/ai/history/contracts";
import type { AnswerBlock } from "@/lib/ai/answer-gate";
import { gateWithRetries } from "@/lib/ai/answer-gate-retry";
import { readSavedNoteEvidence, successfulNoteWriteId } from "@/lib/ai/note-write-evidence";
import { withoutOrphanedOpenAIReferences } from "@/lib/chat/modelHistory";
import { assistantHistoryIds, HISTORY_EVIDENCE_GUIDANCE, trustedAssistantHistory } from "@/lib/chat/trusted-history";
import { toolActivityLabel } from "@/lib/tool-activity-labels";
import { actionDecisionBlock, recordDeliveredActionProposal } from "@/lib/agent-actions";
import { finishAgentWork, incompleteAgentNotice, mustReadStudy } from "@/lib/ai/agent-loop";
import { isStudyWorkRequest } from "@/lib/agent-intent";
import {
	isReasoningEffort,
	isReasoningMode,
	isSpeed,
	isVerbosity,
	MODELS,
	UTILITY_MODELS,
	type ReasoningMode,
	type Speed,
	type Verbosity,
} from "@/lib/ai/models";
import { extractAndStoreMemories, formatMemoryBlock, loadUserMemories } from "@/lib/memory";
import { usedMemoryTools } from "@/lib/memory-policy";
import { loadUserChurch } from "@/lib/church";
import { formatChurchBlock } from "@/lib/church-rules";
import {
	formatPrayerFollowUpBlock,
	formatTodayBlock,
	formatUserNameLine,
	loadChatDayContext,
	recordDeliveredPrayerFollowUps,
	type ChatDayContext,
} from "@/lib/chat-day-context";
import { turnShapeHint, type TurnShape } from "@/lib/turn-shape";
import { maybeTitleConversation } from "@/lib/conversation-title";
import { appKnowledge, chatSystemPrompt, isOnboardCommand, nextStepGuidance, onboardingGuidance, taskGuidance, textInterviewGuidance, welcomeConversationGuidance } from "@/utils/systemPrompt";
import { joinAssistantTextParts, stripFollowUpMarkers } from "@/utils/assistantMarkdown";
import {
	isAnswerLanguage,
	parseTranslationId,
	quotationTranslation,
	type AnswerLanguage,
	type TranslationId,
} from "@/lib/bible/translations";
import {
	readStoredAboutMe,
	readStoredHighlightLabels,
	readStoredHighlightMeanings,
	readStoredTestimony,
} from "@/lib/preferences-contract";
import { loadHighlightLegend } from "@/lib/highlight-legend";
import {
	formatAboutMeBlock,
	formatHighlightLegendBlock,
	formatTestimonyBlock,
} from "@/lib/highlight-legend-rules";
import { buildPromptCachePlan } from "@/lib/ai/prompt-cache";
import { TOOL_LOOP_BUDGET_MS, isOverTimeBudget } from "@/lib/ai/tool-loop-budget";
import { HISTORY_REVIEW_CONTEXT_CHARS, PREPARED_CONTEXT_CHARS } from "@/lib/ai/verification-limits.mjs";
import { captureTurnTrace, classifyTurnError, registerTurnTraceCatalog, toolResultTraceFields, traceTurn, withTurnTrace, type TurnTraceFields } from "@/lib/ai/turn-trace";
import {
	buildChatOutcomeMetric,
	logChatOutcomeMetric,
	logChatStepMetric,
	type ChatOutcomeExit,
} from "@/lib/ai/chat-metrics";
import { captureServerEvent, flushAnalytics } from "@/lib/analytics/server";
import { ANALYTICS_EVENTS, durationBucket, platformFromHeaders } from "@/lib/analytics/events";
// Matches vercel.json for this route. At 120 a slow BYOK provider taking four
// tool steps was killed mid-loop by the platform, which runs no callback: the
// user's question was saved and the answer was lost with nothing logged. See
// TOOL_LOOP_BUDGET_MS for the guard that stops the loop before that happens.
export const maxDuration = 300;

const MAX_REQUEST_MESSAGES = 24;
const MAX_CONTEXT_ATTACHMENTS = 5;
/**
 * The longest the prompt waits for a first-time Clerk profile read. The read
 * starts when the request arrives, so it has normally finished long before the
 * prompt is built; past this the turn goes out without the name, and the write
 * still lands (waitUntil) for the next turn.
 */
const PROFILE_SYNC_PROMPT_WAIT_MS = 800;

function settleWithin<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<T>((resolve) => {
		timer = setTimeout(() => resolve(fallback), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function tracedContext<T>(
	kind: NonNullable<TurnTraceFields["contextKind"]>,
	load: () => Promise<T>,
	shape?: (value: T) => TurnTraceFields,
): Promise<T> {
	const startedAt = performance.now();
	traceTurn("context", "started", { contextKind: kind });
	let result: T;
	try { result = await load(); } catch (error) {
		traceTurn("context", "failed", { contextKind: kind, durationMs: performance.now() - startedAt, ...classifyTurnError(error) });
		throw error;
	}
	try { traceTurn("context", "completed", { contextKind: kind, durationMs: performance.now() - startedAt, ...shape?.(result) }); } catch { /* Shape telemetry cannot change a loaded value. */ }
	return result;
}

// The assistant message id MUST be generated server-side: without it the UI
// message stream leaves responseMessage.id as "", and every exchange's
// persist upsert collides on the same empty primary key, overwriting one
// shared row (this bug wiped assistant messages from history on 2026-08-10).
const generateMessageId = createIdGenerator({ prefix: "msg", size: 24 });

// User turns are always a single text part, so plain concatenation is right
// for them. Assistant turns are not - see extractAssistantText.
function extractText(message: UIMessage): string {
	return message.parts
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("")
		.trim();
}

/**
 * Assistant text, joined the way both clients join it.
 *
 * The AI SDK splits one assistant turn into several text parts around tool
 * calls, so concatenating them with "" glues the next block onto the end of the
 * previous sentence ("Let me look that up.## Psalm 46:10") - and no normalizer
 * can repair that, because there is no newline left to insert a blank line
 * before. The clients hydrate `metadata.parts` through joinAssistantTextParts;
 * the persisted `content` (the only thing rows written before metadata.parts
 * have, and what push notifications and study context read) must agree with it.
 *
 * Empty parts are dropped: a model can open a turn with a zero-length text part
 * before its first tool call, and joining that would fabricate a leading
 * paragraph break the model never wrote.
 */
function extractAssistantText(message: UIMessage): string {
	const textParts: string[] = [];
	for (const part of message.parts) {
		if (part.type === "text" && part.text.trim()) textParts.push(part.text);
	}
	// Open question, instrumented rather than guessed at: a turn split
	// MID-paragraph would make this join invent a block boundary. Shape only -
	// never the text itself - so the logs can answer it without storing answers.
	//
	// Trailing whitespace is trimmed BEFORE the boundary test and \s is not in
	// the terminator class: "The word shalom means " ends in a space, which is
	// the middle of a sentence, not the end of one. Counting whitespace as a
	// boundary made the instrumentation blind to exactly the split it exists
	// to measure.
	if (textParts.length > 1) {
		const midParagraphSplits = textParts
			.slice(0, -1)
			.filter((part) => !/[.!?:;"')\]]$/.test(part.trimEnd())).length;
		if (midParagraphSplits > 0) {
			traceTurn("answer-shape", "completed", { textBlockCount: textParts.length, issueCount: midParagraphSplits });
		}
	}
	return joinAssistantTextParts(textParts).trim();
}

function attachmentIds(message: SureWordUIMessage): string[] {
	const ids = message.metadata?.attachmentIds;
	if (!Array.isArray(ids)) return [];
	return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

/**
 * Validate the client-provided Daily Cross marker before it can be persisted.
 * The shape check is shared with the web client; the row lookup is the trust
 * boundary and makes both the id and reference belong to this caller.
 */
async function validateDailyCrossOrigin(
	userId: string,
	message: SureWordUIMessage,
): Promise<DailyCrossMessageOrigin | null> {
	const metadata = message.metadata;
	if (!metadata || typeof metadata !== "object") return null;
	const candidate = (metadata as Record<string, unknown>).origin;
	if (candidate === undefined) return null;
	if (!isDailyCrossMessageOrigin(candidate)) {
		throw new UserFacingError("The Daily Cross study link is invalid.");
	}
	const origin = sanitizeDailyCrossMessageOrigin(candidate);
	if (!origin) throw new UserFacingError("The Daily Cross study link is invalid.");

	const row = await prisma.verseOfDay.findFirst({
		where: { id: origin.verseOfDayId, userId },
		select: { book: true, chapter: true, verse: true },
	});
	const expectedReference = row ? `${row.book} ${row.chapter}:${row.verse}` : null;
	if (!row || expectedReference !== origin.reference) {
		throw new UserFacingError("The Daily Cross study link is no longer available.");
	}
	return origin;
}

async function hydrateTrustedAttachments(
	messages: SureWordUIMessage[],
	userId: string,
): Promise<{messages:SureWordUIMessage[];attachments:PreparedAttachment[]}> {
	const lastMessage = messages.at(-1);
	if (!lastMessage) return {messages,attachments:[]};
	if (messages.some((message) => attachmentIds(message).length > MAX_ATTACHMENTS_PER_MESSAGE)) {
		throw new UserFacingError("A message cannot reference more than 5 attachments.");
	}
	const currentIds = attachmentIds(lastMessage);
	if (currentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) {
		throw new UserFacingError("You can attach up to 5 files per message.");
	}

	const requestedIds = [...new Set(messages.flatMap(attachmentIds))];
	const records = requestedIds.length > 0
		? await prisma.chatAttachment.findMany({
				where: { id: { in: requestedIds }, userId, status: ChatAttachmentStatus.READY },
			})
		: [];
	const byId = new Map(records.map((record) => [record.id, record]));
	const currentRecords = currentIds.map((id) => byId.get(id));
	if (
		currentRecords.some((record) => !record) ||
		currentRecords.some((record) => record?.messageId && record.messageId !== lastMessage.id) ||
		currentRecords.reduce((total, record) => total + (record?.size ?? 0), 0) > MAX_ATTACHMENT_MESSAGE_BYTES
	) {
		throw new UserFacingError("One or more attachments are invalid or no longer available.");
	}

	const selectedByMessage = new Map<string, typeof records>();
	let selectedCount = 0;
	let selectedBytes = 0;
	let omitted = false;
	for (const message of [...messages].reverse()) {
		const selected = [] as typeof records;
		for (const id of attachmentIds(message)) {
			const record = byId.get(id);
			if (!record) {
				omitted = true;
				continue;
			}
			const belongsToMessage = message.id === lastMessage.id
				? !record.messageId || record.messageId === message.id
				: record.messageId === message.id;
			if (!belongsToMessage) {
				omitted = true;
				continue;
			}
			if (
				selectedCount >= MAX_CONTEXT_ATTACHMENTS ||
				selectedBytes + record.size > MAX_ATTACHMENT_MESSAGE_BYTES
			) {
				omitted = true;
				continue;
			}
			selected.push(record);
			selectedCount += 1;
			selectedBytes += record.size;
		}
		selectedByMessage.set(message.id, selected);
	}

	const preparedAttachments:PreparedAttachment[]=[];
	const ownedDescriptor=(record:typeof records[number],messageId:string,previewUrl?:string):PreparedAttachment=>({id:record.id,userId:record.userId,messageId,pathname:record.pathname,filename:record.filename,mediaType:record.mediaType,size:record.size,etag:record.etag,status:record.status,transcript:record.transcript,durationSeconds:record.durationSeconds,...(previewUrl?{previewUrl}:{})});
	const hydrated = await Promise.all(messages.map(async (message) => {
		const selected = selectedByMessage.get(message.id) ?? [];
		for(const record of selected.filter(record=>isAudioMediaType(record.mediaType)))preparedAttachments.push(ownedDescriptor(record,message.id));
		// A voice message reaches the model as its stored transcript, never as
		// audio: every provider can read text, and it was paid for once already.
		const transcripts = selected
			.filter((record) => isAudioMediaType(record.mediaType))
			.map((record) => ({
				type: "text" as const,
				text: audioTranscriptText({
					filename: record.filename,
					durationSeconds: record.durationSeconds,
					transcript: record.transcript,
				}),
			}));
		const trustedFiles = await Promise.all(
			selected
				.filter((record) => !isAudioMediaType(record.mediaType))
				.map(async (record) => {
					const previewUrl=(await createAttachmentPreviewUrl(record.pathname)).previewUrl;
					preparedAttachments.push(ownedDescriptor(record,message.id,previewUrl));
					return{type:"file" as const,mediaType:record.mediaType,filename:record.filename,url:previewUrl};
				}),
		);
		return {
			...message,
			parts: [...trustedFiles, ...transcripts, ...message.parts.filter((part) => part.type !== "file")],
		};
	}));

	if (omitted) {
		const targetIndex = hydrated.findIndex((message) => message.role === "user");
		if (targetIndex >= 0) {
			const target = hydrated[targetIndex];
			hydrated[targetIndex] = {
				...target,
				parts: [
					...target.parts,
					{ type: "text", text: "\n\n[Some older attachments were omitted to stay within the context limit.]" },
				],
			};
		}
	}
	return {messages:hydrated,attachments:preparedAttachments};
}

/**
 * Drop file parts for a model that cannot read them, leaving a line that names
 * what was attached. Only reached when the user has no attachment-capable
 * provider unlocked at all - an answer that admits it cannot see the file beats
 * a provider 400 that kills the whole turn.
 */
function withoutFileParts(messages: SureWordUIMessage[]): SureWordUIMessage[] {
	return messages.map((message) => {
		const files = message.parts.filter((part) => part.type === "file");
		if (files.length === 0) return message;
		const names = files.map((file) => file.filename ?? file.mediaType).join(", ");
		return {
			...message,
			parts: [
				...message.parts.filter((part) => part.type !== "file"),
				{
					type: "text" as const,
					text:
						`\n\n[The user attached ${names}, but the AI model they selected cannot read files, ` +
						`so its contents are not available to you. Say so plainly and tell them that adding an ` +
						`OpenAI or Anthropic key in Settings → AI Providers lets you read attachments.]`,
				},
			],
		};
	});
}

function stripFollowUps(text: string): {
	cleanText: string;
	followUps: string[];
} {
	const followUps: string[] = [];
	// Anchored to a line start (^ with /m), and [ \t]* rather than \s*, so this
	// agrees exactly with the stripper in assistantMarkdown.ts and with both
	// client copies (src/components/useChat.ts, mobile/src/lib/chatView.ts).
	// Two failures are ruled out by the two halves:
	// - \s* crosses the newline, so a marker alone on its own line swallowed the
	//   NEXT line as the question, extracting it as a chip while the line-scoped
	//   stripper left it in the body - the user saw it twice.
	// - unanchored, "- [FOLLOWUP] What does grace mean?" was extracted as a chip
	//   but NOT stripped, because the stripper only removes a marker at the head
	//   of a line. Extraction and removal must agree: both, or neither, never one.
	const followUpRegex = /^[ \t]*\[FOLLOWUP\][ \t]*([^\r\n]+)/gm;
	let match: RegExpExecArray | null;
	while ((match = followUpRegex.exec(text)) !== null && followUps.length < 2) {
		const question = match[1].trim();
		if (question && !followUps.includes(question)) followUps.push(question);
	}
	return {
		// Same per-line semantics the clients apply before rendering, so the
		// persisted content matches what the user saw while streaming.
		cleanText: stripFollowUpMarkers(text, { streaming: false }),
		followUps,
	};
}

const STALE_THREAD_MESSAGE =
	"This conversation changed on another device. Reload it and try again.";

/**
 * The `replaces` body field: ids of the messages an edit or "Try again"
 * dropped. Null when absent or malformed, which makes a re-sent message delete
 * nothing (see persistUserMessage). Capped, since a thread holds far fewer.
 */
function replacedMessageIds(value: unknown): string[] | null {
	if (!Array.isArray(value)) return null;
	return value.filter((id): id is string => typeof id === "string" && id.length > 0).slice(0, 500);
}

/** The step of the most recent presentChoices card in the thread, if any. */
function lastPresentedStep(messages: SureWordUIMessage[]): OnboardingStep | null {
	for (let m = messages.length - 1; m >= 0; m--) {
		if (messages[m].role !== "assistant") continue;
		for (let p = messages[m].parts.length - 1; p >= 0; p--) {
			const part = messages[m].parts[p] as { type: string; input?: unknown };
			if (part.type !== "tool-presentChoices") continue;
			const step = (part.input as { step?: unknown } | undefined)?.step;
			if (isOnboardingStep(step)) return step;
		}
	}
	return null;
}

async function persistUserMessage(options: {
	userId: string;
	conversationId: string;
	userMessage: SureWordUIMessage;
	origin: DailyCrossMessageOrigin | null;
	readingReceivedAt: Date;
	readingContext: ReadingToolContext;
	/** Ids the client dropped after this message for an edit or "Try again"; null when it named none. */
	replaces: string[] | null;
}): Promise<Date> {
	const userText = extractText(options.userMessage);
	const ids = attachmentIds(options.userMessage);
	// The conversation's creation time is returned only so the outcome metric
	// can bucket first turns apart from returning threads.
	return prisma.$transaction(async (tx) => {
		const conversation = await tx.conversation.findFirst({
			where: { id: options.conversationId, userId: options.userId },
			select: { id: true, createdAt: true },
		});
		if (!conversation) throw new UserFacingError("Conversation not found.", "conversation_not_found");

		const existing = await tx.message.findUnique({
			where: { id: options.userMessage.id },
			select: { role: true, conversationId: true, metadata: true },
		});
		if (existing && (existing.role !== "user" || existing.conversationId !== conversation.id)) {
			throw new UserFacingError("Message ID is already in use.");
		}

		const metadata =
			options.userMessage.metadata && typeof options.userMessage.metadata === "object"
				? { ...(options.userMessage.metadata as Record<string, unknown>) }
				: {};
		// attachmentIds are rebuilt from the validated attachment records below;
		// origin is rebuilt from the ownership/reference check above. Every other
		// metadata key is carried through unchanged for backward compatibility.
		delete metadata.attachmentIds;
		delete metadata.origin;
		const previousMetadata = existing?.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata) ? existing.metadata : {};
		const originalTimezone = readingTimezone("readingTimezone" in previousMetadata ? previousMetadata.readingTimezone : options.readingContext.timezone);
		metadata.readingTimezone = originalTimezone;
		options.readingContext.timezone = originalTimezone;
		if (ids.length > 0) metadata.attachmentIds = ids;
		if (options.origin) metadata.origin = options.origin;
		const metadataJson = JSON.parse(JSON.stringify(metadata));

		const savedUserMessage = await tx.message.upsert({
			where: { id: options.userMessage.id },
			update: { content: userText, metadata: metadataJson },
			create: {
				id: options.userMessage.id,
				conversationId: conversation.id,
				role: "user",
				content: userText,
				createdAt: options.readingReceivedAt,
				metadata: metadataJson,
			},
		});

		// Preserve the original server receipt time on regenerate, including midnight retries.
		options.readingReceivedAt.setTime(savedUserMessage.createdAt.getTime());

		// A message sent again under its own id is an edit or a "Try again", and
		// the client names the rows it dropped after it. Those rows belonged to
		// the old version of the thread; left in place, the next history load
		// would show two answers, or an answer to the text before the edit.
		// Ratings on them go too. A row the client never saw (another device
		// kept talking) refuses the whole turn instead of deleting it, and a
		// client that names nothing (installed builds before 2026-10-08, which
		// only re-send after a failure) deletes nothing.
		if (existing && options.replaces) {
			const later = await tx.message.findMany({
				where: { conversationId: conversation.id, createdAt: { gt: savedUserMessage.createdAt } },
				select: { id: true },
			});
			const known = new Set(options.replaces);
			if (later.some((row) => !known.has(row.id))) {
				throw new UserFacingError(STALE_THREAD_MESSAGE, "stale_thread");
			}
			if (later.length > 0) {
				await tx.message.deleteMany({ where: { id: { in: later.map((row) => row.id) } } });
			}
		}

		for (const id of ids) {
			const linked = await tx.chatAttachment.updateMany({
				where: {
					id,
					userId: options.userId,
					status: ChatAttachmentStatus.READY,
					OR: [{ messageId: null }, { messageId: options.userMessage.id }],
				},
				data: { messageId: options.userMessage.id },
			});
			if (linked.count !== 1) {
				throw new UserFacingError("An attachment could not be linked to the message.");
			}
		}
		return conversation.createdAt;
	});
}

/**
 * Run options that actually shaped one turn, and only where they differed from
 * the model's ordinary behaviour. Recorded on the message so an answer can be
 * explained later: User.defaultSpeed and friends only say what the picker is
 * set to now.
 */
interface AppliedRunOptions {
	speed?: Speed;
	verbosity?: Verbosity;
	mode?: ReasoningMode;
	/**
	 * Set when the short follow-up prompt hint shaped this turn. Its own key,
	 * not `verbosity`: that one records a run option the provider received,
	 * and this is a sentence in the prompt.
	 */
	turnShape?: TurnShape;
}

async function persistAssistantResponse(options: {
	userId: string;
	conversationId: string;
	userMessage: SureWordUIMessage;
	responseMessage: UIMessage;
	/** Resolved provider/model id, or null when resolution never happened. */
	modelId: string | null;
	/** Non-default run options this turn ran with. Empty for an ordinary turn. */
	run: AppliedRunOptions;
	/** The translation the answer quoted, so a rated answer can be replayed against it. */
	translation: TranslationId;
	prayers?: ChatDayContext["prayers"];
	alreadyCertified?: boolean;
	onError?: (error: unknown) => void;
}): Promise<ChatOutcomeExit> {
	if (!hasPersistableContent(options.responseMessage)) return "empty_response";
	// Set once the assistant row is written, so a memory-extraction failure
	// afterwards is not miscounted as an unanswered turn.
	let persisted = false;
	try {
		const conversation = await prisma.conversation.findFirst({
			where: { id: options.conversationId, userId: options.userId },
			select: { id: true },
		});
		if (!conversation) return "conversation_missing";

		const userText = extractText(options.userMessage);
		const assistantText = extractAssistantText(options.responseMessage);
		const { cleanText, followUps } = stripFollowUps(assistantText);

		const metadata: Record<string, unknown> = {
			parts: persistableParts(options.responseMessage.parts),
		};
		if (followUps.length > 0) metadata.followUps = followUps;
		// Which model actually wrote this turn. User.defaultModelId only says
		// what the picker is set to NOW, so without this a formatting report
		// cannot be attributed to a provider. Metadata-only on purpose: no
		// schema change needed, and both clients already carry unknown metadata
		// keys through hydration untouched (SureWordMessageMetadata is indexed).
		if (options.modelId) metadata.modelId = options.modelId;
		if (options.run.speed) metadata.speed = options.run.speed;
		if (options.run.verbosity) metadata.verbosity = options.run.verbosity;
		if (options.run.mode) metadata.mode = options.run.mode;
		if (options.run.turnShape) metadata.turnShape = options.run.turnShape;
		// The translation the answer quoted. scripts/feedback-to-fixtures.mjs
		// reads it so a thumbs-down replays against the same Bible.
		metadata.translation = options.translation;
		const metadataJson = JSON.parse(JSON.stringify(metadata));

		// Belt-and-braces: never upsert with an empty id (see generateMessageId).
		const responseMessageId = options.responseMessage.id.trim()
			? options.responseMessage.id
			: generateMessageId();

		if (!options.alreadyCertified) await prisma.message.upsert({
			where: { id: responseMessageId },
			update: { content: cleanText, metadata: metadataJson },
			create: {
				id: responseMessageId,
				conversationId: conversation.id,
				role: "assistant",
				content: cleanText,
				metadata: metadataJson,
			},
		});
		persisted = true;
		await recordDeliveredActionProposal(options.userId, `chat:${options.conversationId}`, options.userMessage.id, cleanText, options.responseMessage.parts);
		await recordDeliveredPrayerFollowUps(options.userId, cleanText, options.prayers ?? []);
		// Replaces the "first 60 characters you typed" title once, after the
		// first answer; it never throws and never overwrites a user's rename.
		waitUntil(
			maybeTitleConversation({
				userId: options.userId,
				conversationId: conversation.id,
				userText,
				assistantText: cleanText,
			}),
		);

		// Its own waitUntil: an extra LLM call must not delay the outcome metric or the "answer ready" push.
		if (userText && !usedMemoryTools(options.responseMessage.parts)) {
			waitUntil(
				tracedContext("memory", () => extractAndStoreMemories({ userId: options.userId, userText })).catch(() => undefined),
			);
		}
	} catch (error) {
		traceTurn("persistence", "failed", { persistenceKind: "assistant", ...classifyTurnError(error), persisted });
		try { options.onError?.(error); } catch { /* Error telemetry cannot change persistence. */ }
	}
	return persisted ? "persisted" : "persist_error";
}

import { meterAsOnboarding, withIncludedAiRequest, reserveIncludedRequest } from "@/lib/billing/usage";
import { isOnboardingTurn, needsTextInterview } from "@/lib/onboarding";
import { CARDS_HEADER, CARDS_VERSION, cardEndsMessage, cardForLegacyClient, expectedStep, helpScreenForText, isOnboardingStep, owedStep, resolveChoiceCard, type OnboardingStep } from "@/lib/onboarding-rules";
import { withAppHelpGuidance } from "@/lib/app-help-guidance";
export const POST = withTurnTrace(withChatClientConnection(withIncludedAiRequest(handlePost, "ask-question")));

async function handlePost(req: Request, clientConnection: ChatClientConnection): Promise<Response> {
	const readingReceivedAt = new Date();
	const inTurnTrace = captureTurnTrace();
	traceTurn("validation", "started", { surface: "ask-question" });
	try {
		const userId = await getAuthUser();
		// Read once, here: `req.headers` is the only honest source for which app
		// asked, and the answer is wanted on every metric this turn emits.
		const platform = platformFromHeaders(req.headers);
		// Apple 1.26.0 drops a card whose step it does not know; newer Apple
		// builds say they draw the walk and testimony cards with this header.
		const legacyChoiceSteps = (platform === "ios" || platform === "macos") && req.headers.get(CARDS_HEADER) !== CARDS_VERSION;

		const rate = askQuestionRateLimiter.check(rateLimitKey(req, userId));
		if (!rate.allowed) {
			return NextResponse.json(
				chatErrorPayload(
					"rate_limited",
					"Slow down — you're asking questions faster than we can keep up. Try again in a moment."
				),
				{ status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
			);
		}

		const body: unknown = await req.json();
		const requestData =
			typeof body === "object" && body !== null
				? (body as Record<string, unknown>)
				: {};
		const notificationAttemptId = parseChatNotificationAttemptId(requestData.notificationAttemptId);
		if (notificationAttemptId === null) {
			return NextResponse.json(
				chatErrorPayload("invalid_input", "Invalid input: 'notificationAttemptId' must be a full UUID."),
				{ status: 400 },
			);
		}

		if (!Array.isArray(requestData.messages) || requestData.messages.length === 0) {
			return NextResponse.json(
				chatErrorPayload("invalid_input", "Invalid input: 'messages' must be a non-empty array."),
				{ status: 400 }
			);
		}

		const conversationId =
			typeof requestData.conversationId === "string" && requestData.conversationId
				? requestData.conversationId
				: null;
		const replaces = replacedMessageIds(requestData.replaces);

		const userPrefs = await tracedContext("profile", () => prisma.user.findUnique({
			where: { id: userId },
			select: {
				webSearchEnabled: true,
				memoryEnabled: true,
				name: true,
				email: true,
				highlightLabels: true,
				highlightMeanings: true,
				aboutMe: true,
				testimony: true,
				onboardedAt: true,
				onboardingConversationId: true,
				answerLanguage: true,
				createdAt: true,
			},
		}));
		// The answer language: the client sends the one it resolved (the explicit
		// setting, else the device language); an older build sends none, so the
		// account setting decides, else English. The Bible quoted is the reader's
		// own when it is in that language, otherwise that language's Bible, so a
		// Spanish answer quotes Reina-Valera rather than the KJV.
		const language: AnswerLanguage = isAnswerLanguage(requestData.language)
			? requestData.language
			: isAnswerLanguage(userPrefs?.answerLanguage)
				? userPrefs.answerLanguage
				: "en";
		const translation: TranslationId = quotationTranslation(parseTranslationId(requestData.translation), language);
		// A turn in the welcome conversation ("Walk with me") is free: it rides
		// the onboarding usage surface, with its own per-account ceiling.
		const welcomeTurn = isOnboardingTurn(userPrefs, conversationId);
		// A new sign-up on a build that cannot open the welcome still gets to
		// know SureWord, in words, in its ordinary chats.
		const textInterview = needsTextInterview(userPrefs, welcomeTurn);
		// Read leniently, the way the preferences document does: a label written
		// by a newer build degrades to the hue name, never to an error.
		const highlightLabels = readStoredHighlightLabels(userPrefs?.highlightLabels);
		const highlightMeanings = readStoredHighlightMeanings(userPrefs?.highlightMeanings);
		const aboutMe = readStoredAboutMe(userPrefs?.aboutMe);
		const testimony = readStoredTestimony(userPrefs?.testimony);
		// Started now, not when the prompt is built, so a first-time Clerk read
		// runs alongside validation and persistence instead of in front of the
		// first token. Once the name is stored this is a resolved promise.
		const storedName = userPrefs?.name ?? null;
		const namePromise: Promise<string | null> = storedName
			? Promise.resolve(storedName)
			: tracedContext("profile", () => syncProfileFromClerk(userId, { name: null, email: userPrefs?.email ?? null })).then(
					(profile) => profile.name,
				);
		if (!storedName) waitUntil(namePromise);
		const readingContext = {
			...readingRequestContext(requestData, readingReceivedAt),
			userId,
			translation,
			webSearchEnabled: userPrefs?.webSearchEnabled ?? true,
			highlightLabels,
		};
		// Filled once the messages are validated below; readLink opens only these.
		let userLinks: string[] = [];
		let currentUserText = "";
		let currentMessageId = "";
		let answeredWelcomeStep: OnboardingStep | null = null;
		const actionContext = { userId, actionScope: typeof requestData.conversationId === "string" ? `chat:${requestData.conversationId}` : undefined, userText: () => currentUserText, messageId: () => currentMessageId, messageReceivedAt: () => readingReceivedAt, welcomeStep: () => answeredWelcomeStep, legacyChoiceSteps };
		const knownStudyIds = new Set<string>();
		const readStudyIds = new Set<string>();
		let verifyToolContent: ((blocks: AnswerBlock[], purpose: string) => Promise<AnswerBlock[] | null>) | undefined;
		traceTurn("tools", "started");
		const tools = buildSureWordTools({ ...readingContext, ...actionContext, knownStudyIds, readStudyIds, userLinks: () => userLinks,
			verifyGeneratedContent: (blocks, purpose) => verifyToolContent?.(blocks, purpose) ?? Promise.resolve(null),
		});
		registerTurnTraceCatalog({ tools: Object.keys(tools), models: [...MODELS.map(definition => definition.providerModelId), ...Object.values(UTILITY_MODELS).map(definition => definition.providerModelId)] });
		traceTurn("tools", "completed", { toolCount: Object.keys(tools).length });

		const recentMessages = requestData.messages.slice(-MAX_REQUEST_MESSAGES);
		const requestMessageCount = requestData.messages.length;
		const assistantIds = assistantHistoryIds(recentMessages);
		const storedAssistantTurns = conversationId && assistantIds.length > 0
			? await prisma.message.findMany({
				where: {
					id: { in: assistantIds }, role: "assistant", conversationId,
					conversation: { userId },
				},
				select: { id: true, content: true, metadata: true,createdAt:true },
			})
			: [];
		const reviewedTurns = conversationId ? await tracedContext("history", () => reviewedAssistantTurns(historyService,userId,"chat",conversationId,storedAssistantTurns), value => ({ messageCount: value.length })) : [];
		const trustedMessages = trustedAssistantHistory(recentMessages, reviewedTurns);
		const allMessages = await validateUIMessages<SureWordUIMessage>({
			messages: trustedMessages.map((message: UIMessage) => ({
				...message, parts: Array.isArray(message?.parts) ? message.parts.filter((part) => !part.type?.startsWith("data-")) : message?.parts,
			})),
			tools,
		});

		// Answer the last thing the USER said. A retry can leave a half-finished
		// assistant turn on the end of the array (the AI SDK's regenerate slices
		// at the message it is replacing), and rejecting that outright is what
		// turned one failed answer into an unretryable conversation.
		const lastUserIndex = allMessages.findLastIndex((message) => message.role === "user");
		const lastMessage = lastUserIndex >= 0 ? allMessages[lastUserIndex] : undefined;
		userLinks = allMessages
			.filter((message) => message.role === "user")
			.flatMap((message) => linksInText(extractText(message)));
		if (
			!lastMessage ||
			(!extractText(lastMessage) && attachmentIds(lastMessage).length === 0)
		) {
			return NextResponse.json(
				chatErrorPayload("invalid_input", "Invalid input: the last message needs text or an attachment."),
				{ status: 400 }
			);
		}
		const validatedMessages = allMessages.slice(0, lastUserIndex + 1);
		// Reject malformed or cross-user Daily Cross markers before opening the
		// response stream. Organic messages have no origin and keep their existing
		// path unchanged.
		const dailyCrossOrigin = await validateDailyCrossOrigin(userId, lastMessage);
		const hasAttachments = attachmentIds(lastMessage).length > 0;
		if (hasAttachments && !conversationId) {
			return NextResponse.json(
				chatErrorPayload("invalid_input", "Create a conversation before sending an attachment."),
				{ status: 400 },
			);
		}
		traceTurn("validation", "completed", { messageCount: validatedMessages.length, hasAttachments });

		// Optional per-request picker values; anything invalid is ignored and
		// the user's stored default (then the app default) applies instead.
		const requestedModelId =
			typeof requestData.modelId === "string" ? requestData.modelId : null;
		const requestedEffort = isReasoningEffort(requestData.effort) ? requestData.effort : null;
		// An `effort` key carrying JSON null is the user tapping Auto, which must
		// clear the stored default rather than fall back to it. A missing key
		// (Apple omits nil) still means "no opinion".
		const explicitAutoEffort = "effort" in requestData && requestData.effort === null;
		const requestedSpeed = isSpeed(requestData.speed) ? requestData.speed : null;
		const requestedVerbosity = isVerbosity(requestData.verbosity)
			? requestData.verbosity
			: null;
		const requestedMode = isReasoningMode(requestData.mode) ? requestData.mode : null;
		const isOpeningQuestion =
			validatedMessages.filter((message) => message.role === "user").length === 1;

		// Set inside execute() once resolveModel has picked a head, read in
		// onEnd (which runs after execute finishes) so the persisted turn
		// records the model that actually wrote it, and the run options that
		// actually shaped it.
		let resolvedModelId: string | null = null;
		let resolvedRun: AppliedRunOptions = {};

		// Outcome metric state. A user turn can be saved and then never answered
		// (setup throw, provider error, empty output, persistence failure), and
		// nothing else records which exit it took. Filled in as the turn runs
		// and read once in onEnd; only set when persistUserMessage succeeded,
		// because a turn with no saved user message is not an unanswered one.
		const turnStartedAtMs = Date.now();
		let conversationCreatedAt: Date | null = null;
		let metricProvider: string | null = null;
		let metricModelId: string | null = null;
		let metricEffort: TurnTraceFields["effort"];
		let metricStepCount = 0;
		let metricLastStepFinishReason: string | null = null;
		let metricError: unknown = null;
		let answerDisposition: "answered" | "withheld" | "incomplete" = "answered";
		let certificationFailure: Pick<TurnTraceFields, "errorClass" | "httpStatus" | "issueCodes"> | undefined;
		let streamEnded = false;
		let terminalTrace: TurnTraceFields | undefined;
		const finishTrace = (): void => {
			if (streamEnded && terminalTrace) traceTurn("turn", terminalTrace.outcome === "failed" ? "failed" : "completed", terminalTrace);
		};
		const recordTurnError = (error: unknown): void => {
			// First error wins: a provider error reaches the stream-level onError
			// again as a plain Error rebuilt from its client text, which would
			// otherwise overwrite the real class name.
			if (metricError !== null) return;
			metricError = error;
			traceTurn("stream", "failed", classifyTurnError(error));

			// A turn that died because the provider refused is a different
			// problem from a turn that died in our own code, and only one of
			// them is fixable by the user (a spent key, the wrong model, a
			// limit). `chat_turn_completed` counts turns; this counts the
			// provider, so one exhausted BYOK key cannot read as the product
			// being broken for everybody.
			const code = codeForError(error);
			if (code === "provider_error" || code === "provider_key_missing" || code === "rate_limited") {
				captureServerEvent({
					userId,
					event: ANALYTICS_EVENTS.providerFailed,
					platform,
					properties: {
						code,
						provider: metricProvider,
						model: metricModelId,
						surface: "ask-question",
					},
				});
			}
		};

		const responseMessageId = generateMessageId();
		currentUserText = extractText(lastMessage);
		currentMessageId = lastMessage.id;
		// The step of the last card SureWord showed in the welcome, so this turn
		// can be told which card comes next and can add it if the model forgets.
		const lastWelcomeStep = welcomeTurn ? lastPresentedStep(validatedMessages) : null;
		answeredWelcomeStep = lastWelcomeStep;
		const knownProfile = { testimony: Boolean(testimony) };
		const nextWelcomeStep = expectedStep(lastWelcomeStep, currentUserText, knownProfile);
		const calledTools: string[] = [];
		const toolReceipts: { tool: string; success: boolean; result: string }[] = [];
		const noteWriteIds = new Set<string>();
		let duePrayers: ChatDayContext["prayers"] = [];
		if (process.env.SUREWORD_USAGE_ENABLED === "true" && await aiAccessFor(userId) === "house") {
			if (welcomeTurn) meterAsOnboarding();
			await reserveIncludedRequest(userId);
		}
		let freshCertified = false;
		const executedActions: ExecutedHistoryAction[] = [];
		traceTurn("stream", "started");
		const stream = createUIMessageStream<SureWordUIMessage>({
			originalMessages: validatedMessages,
			generateId: () => responseMessageId,
			onError: (error) => inTurnTrace(() => {
				recordTurnError(error);
				return streamErrorText(error);
			}),
			onEnd: ({ responseMessage, isAborted, finishReason }) => inTurnTrace(async () => {
				const userTurnSaved = conversationCreatedAt !== null;
				const emitOutcome = (exit: ChatOutcomeExit): void => {
					const outcomeEvent = {
						surface: "ask-question",
						provider: metricProvider,
						modelId: metricModelId,
						conversationCreatedAt,
						stepCount: metricStepCount,
						finishReason: finishReason ?? metricLastStepFinishReason,
						error: metricError,
						exit,
						answerDisposition,
						failureClass: certificationFailure?.errorClass,
						answerHasText: responseMessage.parts.some(
							(part) => part.type === "text" && part.text.trim().length > 0,
						),
					} as const;
					const metric = buildChatOutcomeMetric(outcomeEvent);
					terminalTrace = { outcome: metric.outcome, stepCount: metricStepCount, persisted: Boolean(conversationId) && exit === "persisted", certified: freshCertified, fallback: answerDisposition === "withheld", aborted: isAborted, ...(metricModelId ? { model: metricModelId } : {}), ...(metricEffort ? { effort: metricEffort } : {}), ...certificationFailure, ...(metricError ? classifyTurnError(metricError) : {}) };
					finishTrace();
					if (!userTurnSaved) return;
					logChatOutcomeMetric(outcomeEvent);
					// The same line, reported where it can be counted per client
					// and per user. `metric` is already content-free by
					// construction; only the turn's shape is added to it.
					const { metric: _name, ...outcome } = metric;
					captureServerEvent({
						userId,
						event: ANALYTICS_EVENTS.chatTurnCompleted,
						platform,
						properties: {
							...outcome,
							duration: durationBucket(Date.now() - turnStartedAtMs),
							openingQuestion: isOpeningQuestion,
							hadAttachments: hasAttachments,
						},
					});
					waitUntil(flushAnalytics());
				};
				if (isAborted) {
					traceTurn("persistence", "skipped", { aborted: true, reason: "aborted" });
					emitOutcome("aborted");
					return;
				}
				if (!conversationId) {
					traceTurn("persistence", "skipped", { reason: "skipped" });
					emitOutcome("persisted");
					return;
				}
				traceTurn("persistence", "started", { persistenceKind: "assistant" });
				const persistence = persistAssistantResponse({
						userId,
						conversationId,
						userMessage: lastMessage,
						responseMessage,
						modelId: resolvedModelId,
						run: resolvedRun,
						translation,
						prayers: duePrayers,
						alreadyCertified: freshCertified,
						onError: recordTurnError,
					});
				waitUntil(persistence.then((exit) => {
						traceTurn("persistence", exit === "persisted" ? "completed" : "failed", { persistenceKind: "assistant", persisted: exit === "persisted", reason: exit === "persisted" ? "persisted" : exit === "empty_response" ? "empty" : "persistence-error" });
						emitOutcome(exit);
						if (exit !== "persisted") return;
						// Keep this waitUntil alive if saving wins the race against
						// departure. A normal client EOF/error resolves without a push.
						return clientConnection.afterPersistence(async () => {
							await notifyUnlessChatStopped({ userId, conversationId, attemptId: notificationAttemptId }, {
								findStop: (attempt) => prisma.chatNotificationStop.findUnique({
									where: { userId_conversationId_attemptId: attempt }, select: { expiresAt: true },
								}),
								notify: () => notifyChatAnswerReady({
									userId,
									conversationId,
									answerText: stripFollowUps(extractAssistantText(responseMessage)).cleanText,
								}),
							});
						}).then(() => {
							traceTurn("stream", clientConnection.disconnected ? "skipped" : "completed", { aborted: clientConnection.disconnected, ...(clientConnection.disconnected ? { reason: "disconnect" as const } : {}) });
						});
					}));
				try { await persistence; } catch (error) {
					recordTurnError(error);
					traceTurn("persistence", "failed", { ...classifyTurnError(error), reason: "persistence-error" });
					emitOutcome("persist_error");
					throw error;
				}
			}),
			execute: ({ writer }) => inTurnTrace(async () => {
				traceTurn("context", "started");
				const finalChunks: UIMessageChunk[] = [];
				let preparedRequest:object|undefined;
				let reviewMediaParts:(FilePart|ImagePart)[]=[];
				let preparedContext="",canonicalPreparedContext="",reviewQuestion=currentUserText;
				const legacyStatus = startStatusNarration(writer, responseMessageId);
				let lastStatus = "Getting ready";
				const statusHeartbeat = setInterval(() => legacyStatus(lastStatus), 10_000);
				const progress = createProgressNarration(
					(data) => finalChunks.push({ type: "data-progress", id: "progress", data }), responseMessageId,
				);
				const writeStatus = (label: string) => { lastStatus=label;legacyStatus(label);progress.status(label); };
				try {
					writeStatus("Getting ready");

					// A video transcript the app fetched on the phone for "/verify";
					// say so, since a long one is the slow part.
					if (hasAttachments) {
						writeStatus(
							lastMessage.parts.some(
								(part) => part.type === "file" && Boolean(part.filename?.startsWith("YouTube-transcript-")),
							)
								? "Reading the video's transcript"
								: "Opening your attachments",
						);
					}
					const hydratedRequest = await tracedContext("attachments", () => hydrateTrustedAttachments(validatedMessages, userId), value => ({ messageCount: value.messages.length, referenceCount: value.attachments.length }));
					const messages=hydratedRequest.messages;
					// Older turns' files are re-hydrated into this request too, so the
					// model has to be able to read files for the whole thread. Voice
					// messages arrive as transcript text, so they never require it.
					const threadHasFiles = messages.some((message) =>
						message.parts.some((part) => part.type === "file"),
					);

					if (conversationId) {
						const persistenceStartedAt = performance.now();
						traceTurn("persistence", "started", { persistenceKind: "user" });
						try { conversationCreatedAt = await persistUserMessage({
							userId,
							conversationId,
							userMessage: lastMessage,
							origin: dailyCrossOrigin,
							readingReceivedAt,
							readingContext,
							replaces,
						}); } catch (error) {
							traceTurn("persistence", "failed", { persistenceKind: "user", ...classifyTurnError(error), durationMs: performance.now() - persistenceStartedAt });
							throw error;
						}
						traceTurn("persistence", "completed", { persistenceKind: "user", persisted: true, durationMs: performance.now() - persistenceStartedAt });
					}

					const [
						memories,
						church,
						dayContext,
						legend,
						userName,
						resolvedModelResult,
						actionDecision,
					] = await Promise.all([
						tracedContext("memory", () => loadUserMemories(userId), value => ({ memoryCount: value.length })),
						tracedContext("church", () => loadUserChurch(userId)),
						// Chat is the only surface allowed to reschedule prayer follow-ups:
						// reading the block here is what "raising it" means.
						tracedContext("day", () => loadChatDayContext(userId, highlightLabels, { memoryEnabled: userPrefs?.memoryEnabled === true })),
						tracedContext("legend", () => loadHighlightLegend(userId, highlightLabels, highlightMeanings)),
						tracedContext("profile", () => settleWithin(namePromise, PROFILE_SYNC_PROMPT_WAIT_MS, null)),
						tracedContext("model", () => resolveModel({
							userId,
							modelId: requestedModelId,
							effort: requestedEffort,
							ignoreStoredEffort: explicitAutoEffort,
							fallbackEffort: isOpeningQuestion ? "high" : "medium",
							attachments: true,
							requireAttachments: threadHasFiles,
							// Chat is the only surface with a picker, so it is the only caller
							// that opts into speed/verbosity/mode and their stored defaults.
							run: {
								speed: requestedSpeed,
								verbosity: requestedVerbosity,
								mode: requestedMode,
							},
						})),
						// Optional context, like every other loader here: a DB error must not fail the answer.
						tracedContext("actions", () => actionDecisionBlock(actionContext)).catch(() => ""),
					]);
					duePrayers = dayContext.prayers;
					const {
						model,
						providerOptions,
						definition,
						access,
						attachmentFallbackFrom,
						attachmentsUnsupported,
						speed: appliedSpeed,
						verbosity: appliedVerbosity,
						mode: appliedMode,
						promptHints,
					} = resolvedModelResult;
					resolvedModelId = definition.id;
					const verificationModel = await resolveVerificationModel(userId, definition);
					verifyToolContent = async (blocks, purpose) => {
						const checked = await verifyGeneratedAnswer(blocks, { model: verificationModel, providerOptions, translation, language,
							question: reviewQuestion, purpose, mediaParts:reviewMediaParts,maxContextChars:HISTORY_REVIEW_CONTEXT_CHARS,requireCompleteContext:true,context: `Generated content for ${purpose}. Preserve the user's material unless they requested changes.\n\n${preparedContext}`,
							canonicalContextForEvidence: `Generated content for ${purpose}. Preserve the user's material unless they requested changes.\n\n${canonicalPreparedContext}`,
							timeoutMs: Math.min(75_000, 225_000 - (Date.now() - turnStartedAtMs)),
						});
						return checked.verified ? checked.blocks : null;
					};
					metricProvider = definition.provider;
					metricModelId = definition.providerModelId;
					metricEffort = resolvedModelResult.effort ?? undefined;
					traceTurn("context", "completed", { memoryCount: memories.length, messageCount: messages.length, hasAttachments: threadHasFiles, model: definition.providerModelId, ...(resolvedModelResult.effort ? { effort: resolvedModelResult.effort } : {}) });
					if (attachmentFallbackFrom) {
						writeStatus(`${attachmentFallbackFrom.label} can't read files - using ${definition.label}`);
					}
					const modelMessages = attachmentsUnsupported ? withoutFileParts(messages) : messages;

					// The picker's last choice becomes the default for every client. An
					// invalid requested id resolves to a fallback model — don't record that
					// fallback as if the user picked it.
					// A house answer is the server's choice, not the user's: those accounts
					// have no picker, so recording their plan's model as a stored default
					// would invent a preference and outlive the day they add their own key.
					const houseAnswer = access === "house";
					const pickedModel =
						!houseAnswer && requestedModelId === definition.id ? definition.id : null;
					// The raw requested value is stored, not the clamped one: a choice the
					// current model cannot honour must survive switching to one that can.
					const pickedEffort = houseAnswer ? null : requestedEffort;
					// Auto is a choice, so it erases the stored effort. Nothing else
					// clears a default: for the other three, null means "no opinion".
					const clearEffort = !houseAnswer && !pickedEffort && explicitAutoEffort;
					const pickedSpeed = houseAnswer ? null : requestedSpeed;
					const pickedVerbosity = houseAnswer ? null : requestedVerbosity;
					const pickedMode = houseAnswer ? null : requestedMode;
					if (
						pickedModel ||
						pickedEffort ||
						clearEffort ||
						pickedSpeed ||
						pickedVerbosity ||
						pickedMode
					) {
						waitUntil(
							prisma.user
								.update({
									where: { id: userId },
									data: {
										...(pickedModel ? { defaultModelId: pickedModel } : {}),
										...(pickedEffort
											? { defaultEffort: pickedEffort }
											: clearEffort
												? { defaultEffort: null }
												: {}),
										...(pickedSpeed ? { defaultSpeed: pickedSpeed } : {}),
										...(pickedVerbosity ? { defaultVerbosity: pickedVerbosity } : {}),
										...(pickedMode ? { defaultMode: pickedMode } : {}),
									},
								})
								.catch((error) => traceTurn("persistence", "failed", { persistenceKind: "preferences", ...classifyTurnError(error) })),
						);
					}

					// Any verbosity the user chose, sent now or stored from the picker,
					// outranks the automatic short-follow-up shape.
					const shapeHint = turnShapeHint(validatedMessages, {
						verbosity: requestedVerbosity ?? appliedVerbosity,
					});

					// Only the non-default values are worth recording: they are what makes
					// this turn differ from the same model's ordinary answer.
					resolvedRun = {
						...(shapeHint ? { turnShape: "short" as const } : {}),
						...(appliedSpeed && appliedSpeed !== "standard" ? { speed: appliedSpeed } : {}),
						...(appliedVerbosity && appliedVerbosity !== "medium"
							? { verbosity: appliedVerbosity }
							: {}),
						...(appliedMode && appliedMode !== "standard" ? { mode: appliedMode } : {}),
					};

					writeStatus("Thinking");
					// The task blocks are chosen from this turn's wording, so they ride the
					// uncached half. Left in the stable half they split the cache key per
					// message, and almost no first step reused another turn's prefix.
					const stableSystem = chatSystemPrompt(translation, {}, language);
					const previousUserMessage = validatedMessages.filter(message => message.role === "user").at(-2);
					const turnGuidance = withAppHelpGuidance(taskGuidance({ userText: currentUserText, previousUserText: previousUserMessage ? extractText(previousUserMessage) : "", hasAttachment: threadHasFiles }), helpScreenForText(currentUserText), appKnowledge);
					// The getting-to-know-you interview runs only inside the welcome
					// conversation (Walk with me) until it is finished or skipped, and
					// on demand with /onboard. An older account that never finished it
					// is no longer interviewed in its ordinary chats (Austin, 2026-10-25).
					// A typed /onboard outside the welcome has no cards (presentChoices
					// is welcome-only), so it runs the interview in words too.
					const wordsInterview = textInterview || (!welcomeTurn && isOnboardCommand(extractText(lastMessage)));
					const onboarding = welcomeTurn || wordsInterview;
					// Per-user context only, all of it uncached. The onboarding block
					// follows the profile blocks it reads from, and the shape hint goes
					// last, nearest the answer.
					const volatileSystem = [
						`\n\n${HISTORY_EVIDENCE_GUIDANCE}`,
						`\n\n${SCRIPTURE_OUTPUT_GUIDANCE}`,
						...turnGuidance.map((block) => `\n\n${block}`),
						formatUserNameLine(userName),
						// Their own words come before what was inferred about them.
						formatAboutMeBlock(aboutMe),
						formatTestimonyBlock(testimony),
						formatMemoryBlock(memories),
						formatChurchBlock(church),
						// The legend precedes the day block, which names recent highlights
						// by these same colours.
						formatHighlightLegendBlock(legend),
						formatTodayBlock(dayContext),
						onboarding ? `\n\n${onboardingGuidance}` : "",
						wordsInterview ? `\n\n${textInterviewGuidance}` : "",
						welcomeTurn ? `\n\n${welcomeConversationGuidance}` : "",
						nextWelcomeStep ? `\n\nNEXT IN THE WELCOME: respond to what they just said, then end this message with presentChoices step "${nextWelcomeStep}".` : "",
						...promptHints.map((hint) => `\n\n${hint}`),
						shapeHint ? `\n\n${shapeHint}` : "",
						// Last on purpose: an instruction for this reply, nearest the answer.
						formatPrayerFollowUpBlock(dayContext),
						actionDecision,
						`\n\n${nextStepGuidance}`,
					].join("");
					const promptCache = buildPromptCachePlan({
						provider: definition.provider,
						modelId: definition.providerModelId,
						stableSystem,
						volatileSystem,
						providerOptions,
						cacheKey: `sureword:ask-question:v1:${definition.providerModelId}:${translation}:${language}:${userPrefs?.webSearchEnabled ?? true}`,
					});
					const providerMessages=withoutOrphanedOpenAIReferences(await convertToModelMessages(modelMessages));
					reviewMediaParts=providerMessages.flatMap(message=>message.role==="user"&&Array.isArray(message.content)?message.content.filter((part):part is FilePart|ImagePart=>part.type==="file"||part.type==="image"):[]);
					traceTurn("context", "started", { contextKind: "request", inputChars: JSON.stringify({ messages: modelMessages, systemContext: stableSystem + volatileSystem }).length, promptChars: stableSystem.length + volatileSystem.length, contextLimitChars: PREPARED_CONTEXT_CHARS, messageCount: modelMessages.length });
					if(conversationId){
						try {
							preparedRequest=await historyService.prepareRequest(userId,{surface:"chat",parentId:conversationId,messageId:responseMessageId},{
								messages:modelMessages,sources:modelMessages.map(message=>message.role==="user"?{id:message.id,role:message.role,content:extractText(validatedMessages.find(row=>row.id===message.id)!)}:{...storedAssistantTurns.find(row=>row.id===message.id)!,role:"assistant"}),
								attachments:hydratedRequest.attachments,systemContext:stableSystem+volatileSystem,sourceSystemContext:volatileSystem,mediaParts:reviewMediaParts,...createCurrentRequestReview(definition,verificationModel,providerOptions),
							});
							const evidence=preparedRequestReviewContext(preparedRequest);preparedContext=evidence.context;canonicalPreparedContext=evidence.canonicalContext;reviewQuestion=evidence.question;
						} catch(error) {
							let issueCodes: string[] = [];
							try { const code = (error as { code?: unknown } | null)?.code; if (typeof code === "string") issueCodes = [code]; } catch { /* Untrusted error properties are not diagnostics. */ }
							const classification = classifyTurnError(error);
							traceTurn("context", "failed", { ...classification, contextKind: "request", contextLimitChars: PREPARED_CONTEXT_CHARS, issueCodes, reason: issueCodes.includes("context_limit") ? "context-budget" : classification.errorClass === "HistoryError" || classification.errorClass === "ValidationError" ? "validation" : "unavailable" });
							recordTurnError(error);progress.finish(true);
							answerDisposition = "withheld";
							await releaseFreshRequestRefusal({ownerId:userId,locator:{surface:"chat",parentId:conversationId,messageId:responseMessageId},translation,language,service:historyService,write:chunk=>writer.write(chunk as Parameters<typeof writer.write>[0])});
							freshCertified=true;return;
						}
					}
					traceTurn("context", "completed", { contextKind: "request", inputChars: preparedContext.length, promptChars: stableSystem.length + volatileSystem.length, contextLimitChars: PREPARED_CONTEXT_CHARS, messageCount: modelMessages.length });
					traceTurn("generation", "started", { model: definition.providerModelId, toolCount: Object.keys(tools).length, messageCount: modelMessages.length });
					const toolStartedAt = new Map<string, number>();
					const result = streamText({
						model,
						system: promptCache.system,
						messages: providerMessages,
						tools,
						prepareStep: ({ stepNumber }) => {
							if (finishAgentWork(stepNumber, turnStartedAtMs)) return { toolChoice: "none" as const, activeTools: [], system: `${stableSystem}${volatileSystem}\n\nFinish now from the successful evidence already gathered. Verify the requested outcome, give the useful result, and state any remaining gap. No further tool calls.` };
							if (mustReadStudy(isStudyWorkRequest(currentUserText), knownStudyIds, readStudyIds)) return { activeTools: ["readStudy"], toolChoice: { type: "tool" as const, toolName: "readStudy" as const } };
							// A card outside the welcome has no one to answer it, and an older
							// build in the plain-words interview cannot draw either card.
							return { activeTools: Object.keys(tools).filter(name => (name !== "readStudy" || knownStudyIds.size > 0) && (name !== "presentChoices" || welcomeTurn) && (name !== "showInApp" || !textInterview)) as (keyof SureWordTools)[] };
						},
						// Either limit ends the loop cleanly, so the answer is streamed,
						// persisted and measured. Only the platform timeout loses a turn.
						// A welcome card ends the message (`cardEndsMessage`), unless a
						// tool beside it still needs telling about, such as today's cross.
						stopWhen: [
							isStepCount(8),
							isOverTimeBudget(turnStartedAtMs, TOOL_LOOP_BUDGET_MS),
							({ steps }) => cardEndsMessage(steps.at(-1)?.toolCalls.map((call) => call.toolName) ?? []),
						],
						// Runs on the text deltas before the UI stream and before onEnd
						// sees the final text, so the client and the persisted Message
						// row agree and neither carries an em dash.
						experimental_transform: plainDashes(),
						providerOptions: promptCache.providerOptions,
						// Finalize after consumption, including any incomplete-answer notice.
						onAbort: () => {
							traceTurn("generation", "failed", { aborted: true, reason: "aborted" });
							answerDisposition = "incomplete";
							progress.finish(true);
						},
						experimental_download: createNarratedDownload({ writeStatus, messages: modelMessages }),
						// Keep the safe provider classification before the UI stream flattens it.
						onError: ({ error }) => {
							traceTurn("generation", "failed", { ...classifyTurnError(error), reason: "provider-error" });
							recordTurnError(error);
							progress.finish(true);
						},
						onStepStart: ({ stepNumber }) => traceTurn("generation-step", "started", { stepCount: stepNumber + 1 }),
						onEnd: (event) => traceTurn("generation", "completed", { complete: metricError === null, stepCount: event.steps.length, inputTokens: event.totalUsage.inputTokens, outputTokens: event.totalUsage.outputTokens, totalTokens: event.totalUsage.totalTokens, finishReason: event.finishReason as TurnTraceFields["finishReason"] }),
						onStepEnd: (event) => {
							traceTurn("generation-step", "completed", { stepCount: event.stepNumber + 1, toolCount: event.toolCalls.length, inputTokens: event.usage.inputTokens, outputTokens: event.usage.outputTokens, reasoningTokens: event.usage.outputTokenDetails.reasoningTokens, totalTokens: event.usage.totalTokens, cacheReadTokens: event.usage.inputTokenDetails.cacheReadTokens, cacheWriteTokens: event.usage.inputTokenDetails.cacheWriteTokens, durationMs: event.performance.stepTimeMs, timeToFirstOutputMs: event.performance.timeToFirstOutputMs, responseTimeMs: event.performance.responseTimeMs, outputTokensPerSecond: event.performance.outputTokensPerSecond, finishReason: event.finishReason as TurnTraceFields["finishReason"] });
							metricStepCount = event.stepNumber + 1;
							metricLastStepFinishReason = event.finishReason;
							logChatStepMetric(
								{
									surface: "ask-question",
									provider: definition.provider,
									modelId: definition.providerModelId,
									translation,
									toolCount: Object.keys(tools).length,
									memoryCount: memories.length,
									historyMessages: modelMessages.length,
									historyTruncated: requestMessageCount > MAX_REQUEST_MESSAGES,
									maxHistoryMessages: MAX_REQUEST_MESSAGES,
									stepLimit: 8,
									stableSystemChars: stableSystem.length,
									volatileSystemChars: volatileSystem.length,
								},
								event,
							);
						},
						onToolExecutionStart: ({ toolCall }) => {
							toolStartedAt.set(toolCall.toolCallId, performance.now());
							traceTurn("tool", "started", { toolName: toolCall.toolName });
							legacyStatus(toolActivityLabel(toolCall.toolName));
							progress.toolStart({ ...toolCall, input: {} }, toolActivityLabel(toolCall.toolName));
						},
						onToolExecutionEnd: ({ toolCall, toolOutput }) => {
							calledTools.push(toolCall.toolName);
							legacyStatus("Thinking");
							const outcome = toolOutput.type === "tool-result" && typeof toolOutput.output === "object" && toolOutput.output !== null
								? toolOutput.output as { success?: unknown; error?: unknown } : undefined;
							const receiptSuccess = toolOutput.type !== "tool-error" && outcome?.success !== false && !outcome?.error;
							const serializedResult = toolOutput.type === "tool-result" ? (JSON.stringify(toolOutput.output) ?? "null") : undefined;
							const toolFacts = toolResultTraceFields(toolOutput.type === "tool-result" ? toolOutput.output : undefined, toolOutput.type !== "tool-error", serializedResult?.length);
							const startedAt = toolStartedAt.get(toolCall.toolCallId);
							toolStartedAt.delete(toolCall.toolCallId);
							traceTurn("tool", toolOutput.type === "tool-error" ? "failed" : "completed", { toolName: toolCall.toolName, ...toolFacts, ...(startedAt === undefined ? {} : { durationMs: performance.now() - startedAt }), ...(toolFacts.toolErrorReported ? { reason: "tool-error" as const } : {}) });
							toolReceipts.push({ tool: toolCall.toolName, success: receiptSuccess,
								result: serializedResult?.slice(0, 1800) ?? "Tool execution failed",
							});
							if (toolOutput.type === "tool-result") {
								if (outcome?.success !== false && !outcome?.error) executedActions.push({tool:toolCall.toolName,toolCallId:toolCall.toolCallId,success:true,output:JSON.parse(JSON.stringify(toolOutput.output) ?? "null")});
								const id = successfulNoteWriteId(toolCall.toolName, toolOutput.output);
								if (id) { noteWriteIds.delete(id); noteWriteIds.add(id); }
							}
							progress.toolEnd({ ...toolCall, input: {} }, { success: toolOutput.type !== "tool-error" && outcome?.success !== false && !outcome?.error }, toolOutput.type === "tool-error");
							// Name and outcome only. The arguments are somebody's
							// question and the output is the Scripture they were
							// reading, so neither may travel with this.
							captureServerEvent({
								userId,
								event: ANALYTICS_EVENTS.aiToolUsed,
								platform,
								properties: {
									tool: toolCall.toolName,
									ok: toolOutput.type !== "tool-error",
									surface: "ask-question",
								},
							});
							// The end of the welcome funnel, and whether it was finished or skipped.
							const finished = toolOutput.type === "tool-result" ? (toolOutput.output as { success?: unknown; outcome?: unknown } | undefined) : undefined;
							if (toolCall.toolName === "finishOnboarding" && finished?.success === true) {
								captureServerEvent({
									userId,
									event: ANALYTICS_EVENTS.onboardingFinished,
									platform,
									properties: { outcome: finished.outcome === "skipped" ? "skipped" : "completed", inWelcome: welcomeTurn },
								});
							}
						},
					});

					// Run to completion even if the client disconnects, so persistence and
					// memory extraction still happen.
					const consumption = result.consumeStream();

					// One definition of the pre-display answer review, shared by the first
					// gate and by any repair after a final-review rejection.
					const answerReviewOptions = async () => {
						// Concurrent tool calls have all settled at upstream EOF. Read
						// once now so a slower earlier read cannot overwrite final state.
						const latestNoteWrites = await Promise.all([...noteWriteIds].reverse().map(id => readSavedNoteEvidence(id, noteId => prisma.note.findFirst({
							where: { id: noteId, userId }, select: { id: true, title: true, plainText: true },
						}))));
						return { model: verificationModel, providerOptions, translation, language,
							question: reviewQuestion,mediaParts:reviewMediaParts,maxContextChars:HISTORY_REVIEW_CONTEXT_CHARS,requireCompleteContext:true,
							canonicalContextForEvidence: JSON.stringify({ latestNoteWrites,preparedRequest:canonicalPreparedContext,
								rule: "Latest note readbacks show the final saved state after all successful writes; older receipts may precede it. A truncated or unavailable readback cannot prove the complete body. Receipt text is not authority for Scripture wording or interpretation.", toolReceipts,
							}),
							context: JSON.stringify({ latestNoteWrites,preparedRequest:preparedContext,
								rule: "Latest note readbacks show the final saved state after all successful writes; older receipts may precede it. A truncated or unavailable readback cannot prove the complete body. Receipt text is not authority for Scripture wording or interpretation.", toolReceipts,
							}),
						};
					};
					const checkedAnswer = await releaseVerifiedAnswer({
						stream: toUIMessageStream<SureWordTools, SureWordUIMessage>({
							stream: result.stream,
							tools,
							sendStart: false,
							sendFinish: false,
							sendReasoning: false,
						}),
						write: (chunk) => finalChunks.push(chunk),
						onChecking: () => writeStatus("Checking Scripture quotations and citations"),
						// The gate repairs once by itself; a draft it still withholds gets
						// up to two more complete rounds (see answer-gate-retry.ts) while a
						// whole round fits before 225s, so the final review keeps its time.
						verify: async (blocks) => {
							const reviewOptions = await answerReviewOptions();
							return gateWithRetries(({ priorReview, timeoutMs }) => verifyGeneratedAnswer(blocks, { ...reviewOptions,
								...(priorReview ? { priorReview } : {}), timeoutMs,
								onError: (error) => traceTurn("verification", "failed", classifyTurnError(error)),
							}), { remainingMs: () => 225_000 - (Date.now() - turnStartedAtMs), maxExtraRounds: 2, minRoundMs: 45_000, maxRoundMs: 75_000 });
						},
					});
					await consumption;
					traceTurn("review", "completed", { verified: checkedAnswer.verified, textBlockCount: checkedAnswer.blocks.length, outputChars: checkedAnswer.blocks.reduce((total, block) => total + block.text.length, 0), reason: checkedAnswer.verified ? "approved" : "withheld" });
					if (!checkedAnswer.verified) answerDisposition = "withheld";
					// A welcome step answered with no card after it strands them with
					// nothing to tap, so the expected card is added here instead.
					const owed = welcomeTurn && metricError === null
						? owedStep({ lastStep: lastWelcomeStep, reply: currentUserText, calledTools, answerText: checkedAnswer.blocks.map(block => block.text).join("\n\n"), known: knownProfile })
						: null;
					if (owed) {
						const toolCallId = `${responseMessageId}-card`;
						const input = { step: owed, question: null, options: null, allowOther: null };
						finalChunks.push({ type: "start-step" });
						finalChunks.push({ type: "tool-input-available", toolCallId, toolName: "presentChoices", input });
						const card = resolveChoiceCard(input);
						finalChunks.push({ type: "tool-output-available", toolCallId, output: legacyChoiceSteps ? cardForLegacyClient(card) : card });
						finalChunks.push({ type: "finish-step" });
					}
					const notice = incompleteAgentNotice(metricLastStepFinishReason, Date.now() - turnStartedAtMs);
					if (notice) {
						if (answerDisposition !== "withheld") answerDisposition = "incomplete";
						const textId = `${responseMessageId}-limit`;
						finalChunks.push({ type: "text-start", id: textId });
						finalChunks.push({ type: "text-delta", id: textId, delta: `\n\n${notice}` });
						finalChunks.push({ type: "text-end", id: textId });
					}
					progress.finish(metricError !== null || notice !== null || !checkedAnswer.verified);
					if (conversationId) {
						const certification = await releaseCertifiedFreshTurn({ownerId:userId,locator:{surface:"chat",parentId:conversationId,messageId:responseMessageId},chunks:finalChunks,preparedRequest,translation,language,actions:executedActions,service:historyService,
							// Each final review keeps its own 60s bound; the whole release,
							// including repair rounds, ends by 270s so certification, the
							// NKJV capture, saving and the push still fit inside the 300s.
							signal:AbortSignal.timeout(Math.max(1,270_000-(Date.now()-turnStartedAtMs))),
							// A clean final-review rejection is repaired against its findings
							// and passes the full pre-display gate again before that same final
							// review sees it. Only an answer the first gate approved, with no
							// server-written notice in it (a withheld answer stays withheld),
							// and only while the repair, a fresh prepare (NKJV capture up to
							// 12s) and the 60s review all still fit.
							revise:checkedAnswer.verified&&notice===null?async(chunks,review)=>{
								const reviewOptions=await answerReviewOptions();
								const remaining=270_000-(Date.now()-turnStartedAtMs);
								if(remaining<115_000)return null;
								const blocks=textBlocksOf(chunks);
								if(!blocks.some(block=>block.text.trim()))return null;
								const revised=await verifyGeneratedAnswer(blocks,{...reviewOptions,priorReview:review,timeoutMs:Math.min(75_000,remaining-80_000)});
								return revised.verified?withTextBlocks(chunks,revised.blocks):null;
							}:undefined,
							metadata:{...(resolvedModelId?{modelId:resolvedModelId}:{}),...(resolvedRun.speed?{speed:resolvedRun.speed}:{}),...(resolvedRun.verbosity?{verbosity:resolvedRun.verbosity}:{}),...(resolvedRun.mode?{mode:resolvedRun.mode}:{}),...(resolvedRun.turnShape?{turnShape:resolvedRun.turnShape}:{})},
							write:chunk=>writer.write(chunk as Parameters<typeof writer.write>[0])});
						if (certification.fallback) {
							answerDisposition = "withheld";
							const failure = certification.failureClassification;
							if (failure) certificationFailure = { errorClass: failure.errorClass, ...(failure.httpStatus === undefined ? {} : { httpStatus: failure.httpStatus }), issueCodes: [failure.code] };
						}
						traceTurn("certification-release", "completed", { fallback: certification.fallback, certified: true, persisted: true, outcome: answerDisposition, ...certificationFailure });
						freshCertified=true;
					} else for (const chunk of finalChunks) writer.write(chunk as Parameters<typeof writer.write>[0]);
				} catch (error) {
					recordTurnError(error);
					progress.finish(true);
					throw error;
				} finally {
					clearInterval(statusHeartbeat);
				}
			}),
		});

		return createUIMessageStreamResponse({
			stream,
			// Tee the SSE stream and drain the copy server-side. Without this a
			// client disconnect cancels the response stream, which cancels the
			// pipeline and fires `onEnd` with whatever partial answer had been
			// written - backgrounding the Android app mid-answer persisted a
			// truncated reply and surfaced as a failed message. With a second
			// reader holding the stream open, generation runs to completion and
			// `onEnd` gets the whole message no matter when the client leaves.
			consumeSseStream: ({ stream: copy }) => inTurnTrace(() => {
				waitUntil(
					(async () => {
						const reader = copy.getReader();
						try {
							while (!(await reader.read()).done) {
								// Drain only; the persisted copy comes from onEnd.
							}
							traceTurn("stream", "completed", { complete: true });
						} catch (error) {
							recordTurnError(error);
							traceTurn("stream", "failed", classifyTurnError(error));
						} finally {
							reader.releaseLock();
							streamEnded = true;
							terminalTrace ??= { outcome: metricError ? "failed" : "incomplete", reason: "empty", persisted: false, ...(metricError ? classifyTurnError(metricError) : {}) };
							finishTrace();
						}
					})()
				);
			}),
		});
	} catch (error) {
		if (error instanceof Response) return error;
		traceTurn("validation", "failed", classifyTurnError(error));
		if (error instanceof UserFacingError) {
			return NextResponse.json(chatErrorPayload(error.code, error.message), { status: 400 });
		}
		// Never interpolate the exception message - it can carry provider or
		// database internals. The real error is in the server log above.
		return NextResponse.json(
			chatErrorPayload("internal", "Something went wrong on our end. Please try again."),
			{ status: 500 }
		);
	}
}
