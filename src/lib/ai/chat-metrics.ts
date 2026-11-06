import type { LanguageModelUsage, StepResultPerformance } from "ai";
import type { TurnErrorClass } from "./turn-trace";

export interface ChatMetricsContext {
	surface: "ask-question" | "note-ai";
	provider: string;
	modelId: string;
	translation?: string;
	toolCount: number;
	memoryCount: number;
	historyMessages: number;
	historyTruncated: boolean;
	maxHistoryMessages: number;
	stepLimit: number;
	stableSystemChars: number;
	volatileSystemChars: number;
}

export interface ChatStepMetric {
	surface: ChatMetricsContext["surface"];
	provider: string;
	modelId: string;
	translation: string | null;
	toolCount: number;
	memoryCount: number;
	historyMessages: number;
	historyTruncated: boolean;
	maxHistoryMessages: number;
	stepLimit: number;
	stepNumber: number;
	finishReason: string;
	inputTokens: number | null;
	outputTokens: number | null;
	totalTokens: number | null;
	cacheReadTokens: number | null;
	cacheWriteTokens: number | null;
	timeToFirstOutputMs: number | null;
	outputTokensPerSecond: number | null;
	stepTimeMs: number | null;
	responseTimeMs: number | null;
	stableSystemChars: number;
	volatileSystemChars: number;
	toolCalls: number;
	stepLimitReached: boolean;
}

export interface ChatStepEvent {
	stepNumber: number;
	finishReason: string;
	usage: LanguageModelUsage;
	performance: Pick<
		StepResultPerformance,
		"timeToFirstOutputMs" | "outputTokensPerSecond" | "stepTimeMs" | "responseTimeMs"
	>;
	toolCalls?: readonly unknown[];
}

function finiteOrNull(value: number | undefined): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildChatStepMetric(
	context: ChatMetricsContext,
	event: ChatStepEvent,
): ChatStepMetric {
	return {
		surface: context.surface,
		provider: context.provider,
		modelId: context.modelId,
		translation: context.translation ?? null,
		toolCount: context.toolCount,
		memoryCount: context.memoryCount,
		historyMessages: context.historyMessages,
		historyTruncated: context.historyTruncated,
		maxHistoryMessages: context.maxHistoryMessages,
		stepLimit: context.stepLimit,
		stepNumber: event.stepNumber,
		finishReason: event.finishReason,
		inputTokens: finiteOrNull(event.usage.inputTokens),
		outputTokens: finiteOrNull(event.usage.outputTokens),
		totalTokens: finiteOrNull(event.usage.totalTokens),
		cacheReadTokens: finiteOrNull(event.usage.inputTokenDetails.cacheReadTokens),
		cacheWriteTokens: finiteOrNull(event.usage.inputTokenDetails.cacheWriteTokens),
		timeToFirstOutputMs: finiteOrNull(event.performance.timeToFirstOutputMs),
		outputTokensPerSecond: finiteOrNull(event.performance.outputTokensPerSecond),
		stepTimeMs: finiteOrNull(event.performance.stepTimeMs),
		responseTimeMs: finiteOrNull(event.performance.responseTimeMs),
		stableSystemChars: context.stableSystemChars,
		volatileSystemChars: context.volatileSystemChars,
		toolCalls: event.toolCalls?.length ?? 0,
		stepLimitReached:
			event.stepNumber + 1 >= context.stepLimit && event.finishReason === "tool-calls",
	};
}

/** Emit shape-only metrics. Prompt text, answers, ids, and tool arguments stay out of logs. */
export function logChatStepMetric(
	context: ChatMetricsContext,
	event: ChatStepEvent,
): void {
	try { console.info("[ai.metrics]", JSON.stringify(buildChatStepMetric(context, event))); } catch { /* Logging cannot fail a turn. */ }
}

/**
 * Where a turn that already persisted its user message ended up. Everything
 * except "persisted" leaves a user message with no assistant reply in the
 * database, which is the state this metric exists to count.
 */
export type ChatOutcomeExit =
	| "persisted"
	| "aborted"
	| "empty_response"
	| "conversation_missing"
	| "persist_error";

export type ChatOutcome = "answered" | "withheld" | "incomplete" | "failed" | "cancelled";

export type ConversationAgeBucket =
	| "under_1m"
	| "under_1h"
	| "under_1d"
	| "under_7d"
	| "7d_plus"
	| "unknown";

export interface ChatOutcomeEvent {
	surface: ChatMetricsContext["surface"];
	/** Null when the turn failed before a model was resolved. */
	provider: string | null;
	modelId: string | null;
	conversationCreatedAt: Date | null;
	/** Steps the model completed (onStepEnd count), 0 when it never ran. */
	stepCount: number;
	finishReason: string | null | undefined;
	/** The first error the turn raised, if any. Only its class name is kept. */
	error: unknown;
	exit: ChatOutcomeExit;
	answerHasText: boolean;
	/** Authoritative gate/certification result, never inferred from notice text. */
	answerDisposition?: "answered" | "withheld" | "incomplete";
	/** Closed classification preserved when final certification returns its safe fallback. */
	failureClass?: TurnErrorClass;
}

export interface ChatOutcomeMetric {
	metric: "chat_outcome";
	surface: ChatMetricsContext["surface"];
	outcome: ChatOutcome;
	exit: ChatOutcomeExit;
	conversationAge: ConversationAgeBucket;
	provider: string | null;
	modelId: string | null;
	stepCount: number;
	finishReason: string | null;
	errorClass: string | null;
	answerHasText: boolean;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// Buckets rather than a timestamp: a raw creation time plus a model id is close
// enough to fingerprint one conversation, and the question is only "first turn
// or a returning thread".
export function conversationAgeBucket(
	createdAt: Date | null,
	now: Date = new Date(),
): ConversationAgeBucket {
	if (!createdAt || Number.isNaN(createdAt.getTime())) return "unknown";
	const ageMs = Math.max(0, now.getTime() - createdAt.getTime());
	if (ageMs < MINUTE_MS) return "under_1m";
	if (ageMs < HOUR_MS) return "under_1h";
	if (ageMs < DAY_MS) return "under_1d";
	if (ageMs < 7 * DAY_MS) return "under_7d";
	return "7d_plus";
}

// Both `name` and constructor names can carry caller-controlled strings.
// Only known infrastructure classes are retained, including identifier-shaped names.
const SAFE_ERROR_NAMES = new Set(["Error", "TypeError", "RangeError", "AbortError", "TimeoutError", "AI_APICallError", "AI_RetryError", "AI_NoObjectGeneratedError", "AI_NoOutputGeneratedError", "AI_InvalidArgumentError", "ZodError", "UserFacingError", "HistoryError", "PrismaClientKnownRequestError", "PrismaClientUnknownRequestError", "PrismaClientInitializationError", "PrismaClientValidationError"]);
const SAFE_FAILURE_CLASSES = new Set(["Error", "NonError", "TypeError", "RangeError", "AbortError", "TimeoutError", "ProviderError", "ValidationError", "HistoryError", "PersistenceError", "canonical-unavailable", "schema-error"]);

export function errorClassName(error: unknown): string | null {
	if (error === undefined || error === null) return null;
	try {
		if (!(error instanceof Error)) return "NonError";
		if (SAFE_ERROR_NAMES.has(error.name) && error.name !== "Error") return error.name;
		const constructorName = error.constructor?.name;
		return SAFE_ERROR_NAMES.has(constructorName) ? constructorName : "Error";
	} catch { return "Error"; }
}

export function classifyChatOutcome(event: Pick<ChatOutcomeEvent, "exit" | "answerDisposition" | "error" | "answerHasText">): ChatOutcome {
	if (event.exit === "aborted") return "cancelled";
	if (event.exit === "persist_error" || event.exit === "conversation_missing") return "failed";
	if (event.exit === "empty_response") return event.error ? "failed" : "incomplete";
	if (event.answerDisposition === "withheld") return "withheld";
	if (event.answerDisposition === "incomplete" || event.error) return "incomplete";
	return "answered";
}

export function buildChatOutcomeMetric(
	event: ChatOutcomeEvent,
	now: Date = new Date(),
): ChatOutcomeMetric {
	return {
		metric: "chat_outcome",
		surface: event.surface,
		outcome: classifyChatOutcome(event),
		exit: event.exit,
		conversationAge: conversationAgeBucket(event.conversationCreatedAt, now),
		provider: event.provider,
		modelId: event.modelId,
		stepCount: Number.isFinite(event.stepCount) ? Math.max(0, Math.trunc(event.stepCount)) : 0,
		finishReason: event.finishReason ?? null,
		errorClass: errorClassName(event.error) ?? (event.failureClass && SAFE_FAILURE_CLASSES.has(event.failureClass) ? event.failureClass : null),
		answerHasText: event.answerHasText,
	};
}

/**
 * Emit one shape-only line per persisted user turn: answered or unanswered,
 * and why. The built metric is returned so a caller that also reports the turn
 * to product analytics sends exactly the line that was logged, rather than a
 * second shape that can drift from it.
 */
export function logChatOutcomeMetric(event: ChatOutcomeEvent): ChatOutcomeMetric {
	const metric = buildChatOutcomeMetric(event);
	try { console.info("[ai.metrics]", JSON.stringify(metric)); } catch { /* Logging cannot fail a turn. */ }
	return metric;
}
