import type { LanguageModelUsage, StepResultPerformance } from "ai";

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
	console.info("[ai.metrics]", JSON.stringify(buildChatStepMetric(context, event)));
}
