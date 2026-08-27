import { Output, ToolLoopAgent, isStepCount, tool, type LanguageModel } from "ai";
import { z } from "zod";
import { builtInDailyCrossModel } from "@/lib/ai/built-in-openai";
import {
	dailyCrossSelectionSchema,
	isDailyCrossSelectionAllowed,
	MAX_EVIDENCE_ITEMS,
	MAX_EVIDENCE_SUMMARY_LENGTH,
	validateDailyCrossSelection,
	type DailyCrossMode,
	type DailyCrossSelection,
	type PrimaryThemeKey,
	type RecentDailyCross,
	type SelectionEvidence,
} from "./daily-cross-selection";

const MAX_CONTEXT_ITEMS = 8;
const MAX_CONTEXT_SUMMARY_LENGTH = MAX_EVIDENCE_SUMMARY_LENGTH;

export interface DailyCrossSelectorInput {
	userId: string;
	mode?: DailyCrossMode;
	focus?: string;
	recentSelections?: readonly RecentDailyCross[];
	now?: Date | string | number;
	abortSignal?: AbortSignal;
	/** Why the previous attempt was rejected, supplied only for the single retry. */
	retryFeedback?: string;
}

export interface DailyCrossContextRequest {
	userId: string;
	mode: DailyCrossMode;
	focus?: string;
}

export interface ScriptureContextResult {
	reference?: string;
	text?: string;
	summary?: string;
	similarity?: number;
}

export interface DailyCrossSelectorDependencies {
	/** Read-only activity/context records. Results are bounded before model use. */
	loadPersonalContext?: (request: DailyCrossContextRequest) => Promise<readonly SelectionEvidence[]>;
	/** Read-only memories. Results are bounded before model use. */
	loadUserMemories?: (userId: string) => Promise<readonly SelectionEvidence[]>;
	/** Read-only Scripture search. */
	searchScripture?: (query: string, limit: number) => Promise<readonly ScriptureContextResult[]>;
	/** Inject a model in tests or when the app owns model construction. */
	model?: LanguageModel;
	/** Kept injectable for hermetic tests; production uses the SDK ToolLoopAgent. */
	createAgent?: (settings: Record<string, unknown>) => DailyCrossAgent;
}

interface DailyCrossAgent {
	generate(options: { prompt: string; abortSignal?: AbortSignal }): Promise<{
		output: unknown;
		steps?: Array<{ toolCalls?: Array<{ toolName?: string }> }>;
	}>;
}

export class DailyCrossSelectorError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DailyCrossSelectorError";
	}
}

export class DailyCrossSelectionValidationError extends DailyCrossSelectorError {
	constructor(public readonly errors: string[]) {
		super(`The selector returned a disallowed Daily Cross selection: ${errors.join(" ")}`);
		this.name = "DailyCrossSelectionValidationError";
	}
}

function clip(value: unknown, max = MAX_CONTEXT_SUMMARY_LENGTH): string {
	return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function boundEvidence(items: readonly SelectionEvidence[] | undefined): SelectionEvidence[] {
	return normalizeEvidence(items).slice(0, MAX_CONTEXT_ITEMS);
}

function normalizeEvidence(items: readonly SelectionEvidence[] | undefined): SelectionEvidence[] {
	return (items ?? [])
		.filter((item) => item && clip(item.summary).length > 0)
		.map((item) => ({
			kind: clip(item.kind, 60),
			...(item.id ? { id: clip(item.id, 120) } : {}),
			summary: clip(item.summary),
			...(item.origin ? { origin: clip(item.origin, 80) } : {}),
		}));
}

function searchEvidence(items: readonly SelectionEvidence[], query: string): SelectionEvidence[] {
	const terms = query
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((term) => term.length >= 3);
	const scored = normalizeEvidence(items).map((item, index) => {
		const haystack = `${item.kind} ${item.origin ?? ""} ${item.summary}`.toLowerCase();
		const matches = terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
		return { item, matches, score: matches * 100 - index };
	});
	const matching = scored.filter((entry) => entry.matches > 0).sort((a, b) => b.score - a.score);
	return (matching.length ? matching : scored).slice(0, MAX_CONTEXT_ITEMS).map((entry) => entry.item);
}

function formatEvidence(items: readonly SelectionEvidence[]): string {
	if (items.length === 0) return "No personal context was available.";
	return items
		.map((item) => `[${item.origin ?? item.kind}] ${item.summary}${item.id ? ` (${item.id})` : ""}`)
		.join("\n");
}

async function defaultMemories(userId: string): Promise<SelectionEvidence[]> {
	const { loadUserMemories } = await import("@/lib/memory");
	return (await loadUserMemories(userId)).map((memory) => ({
		kind: memory.category || "memory",
		id: memory.id,
		summary: memory.content,
		origin: "user-memory",
	}));
}

async function defaultContext(request: DailyCrossContextRequest): Promise<SelectionEvidence[]> {
	const [{ prisma }, { getTodayPlanReading }, { loadUserChurch }, { isDailyCrossMessageOrigin }] =
		await Promise.all([
			import("@/lib/prisma"),
			import("@/lib/reading-plans"),
			import("@/lib/church"),
			import("@/lib/chat-attachment-types"),
		]);
	const readingSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
	const [messages, notes, readings, plan, church] = await Promise.all([
		prisma.message.findMany({
			where: { role: "user", conversation: { userId: request.userId } },
			orderBy: { createdAt: "desc" },
			take: 30,
			select: { id: true, content: true, createdAt: true, metadata: true },
		}),
		prisma.note.findMany({
			where: { userId: request.userId },
			orderBy: { updatedAt: "desc" },
			take: 15,
			select: { id: true, title: true, plainText: true, updatedAt: true },
		}),
		prisma.readingEvent.findMany({
			where: { userId: request.userId, readAt: { gte: readingSince } },
			orderBy: { readAt: "desc" },
			take: 60,
			select: { book: true, chapter: true, readAt: true },
		}),
		getTodayPlanReading(request.userId).catch(() => null),
		loadUserChurch(request.userId),
	]);

	const evidence: SelectionEvidence[] = messages.map((message) => {
		const candidate =
			message.metadata && typeof message.metadata === "object"
				? (message.metadata as Record<string, unknown>).origin
				: undefined;
		const origin = isDailyCrossMessageOrigin(candidate)
			? `daily-cross-followup:${candidate.reference}`
			: "organic-question";
		return {
			kind: "message",
			id: message.id,
			summary: `${message.createdAt.toISOString()}: ${message.content}`,
			origin,
		};
	});
	evidence.push(
		...notes.map((note) => ({
			kind: "note",
			id: note.id,
			summary: `${note.updatedAt.toISOString()} — ${note.title}: ${note.plainText}`,
			origin: "user-note",
		}))
	);
	const readingCounts = new Map<string, number>();
	for (const reading of readings) {
		const reference = `${reading.book} ${reading.chapter}`;
		readingCounts.set(reference, (readingCounts.get(reference) ?? 0) + 1);
	}
	for (const [reference, count] of Array.from(readingCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
		evidence.push({ kind: "reading", summary: `${reference} read ${count}x in the last 30 days`, origin: "reading-history" });
	}
	if (plan) {
		evidence.push({
			kind: "plan",
			summary: `${plan.planTitle}, day ${plan.day} of ${plan.dayCount}: ${plan.reference}${plan.focus ? ` — ${plan.focus}` : ""}`,
			origin: "reading-plan",
		});
	}
	if (church) {
		evidence.push({
			kind: "church",
			summary: `${church.name}, ${church.address}${church.mission ? ` — ${church.mission}` : ""}`,
			origin: "user-chosen-church",
		});
	}
	return evidence;
}

async function defaultScripture(query: string, limit: number): Promise<ScriptureContextResult[]> {
	const { searchScripture } = await import("@/lib/scripture-search");
	const result = await searchScripture(query, limit, "KJV");
	return result.verses.map((verse) => ({
		reference: verse.reference,
		text: verse.text,
		summary: verse.text ? `${verse.reference}: ${verse.text}` : verse.reference,
		similarity: verse.similarity,
	}));
}

function recentPrompt(recent: readonly RecentDailyCross[]): string {
	if (recent.length === 0) return "No recent Daily Cross selections are recorded.";
	return recent
		.slice(0, 30)
		.map(
			(entry) =>
				`${entry.book} ${entry.chapter}:${entry.verse}` +
				`${entry.primaryThemeKey ? ` [${entry.primaryThemeKey}]` : ""}` +
				`${entry.primaryTheme ? ` — ${clip(entry.primaryTheme, 100)}` : ""}` +
				`${entry.selectionReason ? ` (${clip(entry.selectionReason, 140)})` : ""}`
		)
		.join(", ");
}

const SELECTOR_INSTRUCTIONS = `You select one Daily Cross KJV verse for SureWord. You are selecting the reference and a concise explanation, not writing the devotional.

Rules:
- Call both get_personal_context and get_scripture_context before selecting. This is a research task, not a guess from the prompt alone.
- Use only evidence returned by those read-only tools. Never invent personal history.
- Choose one canonical Bible reference and one fixed primaryThemeKey from the schema. primaryTheme is a human-readable label.
- Add no more than three secondaryThemeKeys, and keep evidence bounded and specific.
- Respect the recent-selection exclusions in the prompt. The caller will apply a deterministic final policy gate.
- Older history may have prose but no stored theme key. Treat repeated meaning in that prose as recently covered even when the deterministic theme key is unavailable.
- If mode is focus, honor the user's focus without pretending it overrides Scripture. Focus bypasses only the recent-theme exclusion; recent exact verses remain excluded.
- Return only the structured selection object.`;

function buildAgent(
	input: DailyCrossSelectorInput,
	dependencies: DailyCrossSelectorDependencies,
	context: readonly SelectionEvidence[],
	memory: readonly SelectionEvidence[],
	scripture: (query: string, limit: number) => Promise<readonly ScriptureContextResult[]>,
): DailyCrossAgent {
	const mode = input.mode ?? (input.focus?.trim() ? "focus" : "theme");
	const model = dependencies.model ?? builtInDailyCrossModel();

	const contextTool = tool({
		description: "Search read-only recent Bible activity and personal context. Daily Cross follow-ups are labelled separately from organic questions. Returns short source ids/snippets; no writes are possible.",
		inputSchema: z.object({ query: z.string().trim().min(1).max(240) }),
		execute: async ({ query }) => searchEvidence([...context, ...memory], query),
	});
	const scriptureTool = tool({
		description: "Read-only KJV Scripture search. Use this to ground the candidate verse.",
		inputSchema: z.object({ query: z.string().trim().min(1).max(240), limit: z.number().int().min(1).max(5).optional() }),
		execute: async ({ query, limit }) => {
			const result = await scripture(query, limit ?? 4);
			return result.slice(0, 5).map((item) => ({
				reference: clip(item.reference, 100),
				text: item.text ? clip(item.text, MAX_CONTEXT_SUMMARY_LENGTH) : undefined,
				summary: clip(item.summary ?? item.text ?? item.reference, MAX_CONTEXT_SUMMARY_LENGTH),
				...(typeof item.similarity === "number" ? { similarity: item.similarity } : {}),
			}));
		},
	});

	const settings = {
		model,
		instructions: SELECTOR_INSTRUCTIONS,
		reasoning: "xhigh" as const,
		stopWhen: isStepCount(6),
		tools: { get_personal_context: contextTool, get_scripture_context: scriptureTool },
		output: Output.object({ schema: dailyCrossSelectionSchema }),
	};
	return dependencies.createAgent
		? dependencies.createAgent(settings)
		: (new ToolLoopAgent(settings) as unknown as DailyCrossAgent);
}

/** Run one model selection. Retry policy deliberately belongs to the lead. */
export async function selectDailyCross(
	input: DailyCrossSelectorInput,
	dependencies: DailyCrossSelectorDependencies = {},
): Promise<DailyCrossSelection> {
	if (!input.userId.trim()) throw new DailyCrossSelectorError("userId is required for Daily Cross selection.");
	const mode = input.mode ?? (input.focus?.trim() ? "focus" : "theme");
	const contextLoader = dependencies.loadPersonalContext ?? defaultContext;
	const memoriesLoader = dependencies.loadUserMemories ?? defaultMemories;
	const scripture = dependencies.searchScripture ?? defaultScripture;
	const [context, memories] = await Promise.all([
		contextLoader({ userId: input.userId, mode, ...(input.focus?.trim() ? { focus: input.focus.trim().slice(0, 240) } : {}) }),
		memoriesLoader(input.userId),
	]);
	const normalizedContext = normalizeEvidence(context);
	const normalizedMemories = normalizeEvidence(memories);
	const agent = buildAgent(input, dependencies, normalizedContext, normalizedMemories, scripture);
	const prompt = [
		`Selection mode: ${mode}`,
		input.focus?.trim() ? `User focus: ${clip(input.focus, 240)}` : null,
		input.retryFeedback?.trim()
			? `The previous selection was rejected by deterministic policy. Correct every issue on this attempt:\n${clip(input.retryFeedback, 600)}`
			: null,
		`Recent selections (exact verses are excluded for 30 days; primary themes are excluded for 3 days unless mode is focus): ${recentPrompt(input.recentSelections ?? [])}`,
		`Available personal evidence index (use the tool to search it):\n${formatEvidence(boundEvidence([...normalizedContext, ...normalizedMemories]).map((item) => ({ ...item, summary: clip(item.summary, 100) })))}`,
	].filter((part): part is string => Boolean(part)).join("\n\n");
	const result = await agent.generate({
		prompt,
		...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
	});
	const calledTools = new Set(
		(result.steps ?? []).flatMap((step) => step.toolCalls ?? []).flatMap((call) =>
			typeof call.toolName === "string" ? [call.toolName] : []
		)
	);
	if (!dependencies.createAgent) {
		for (const required of ["get_personal_context", "get_scripture_context"]) {
			if (!calledTools.has(required)) {
				throw new DailyCrossSelectorError(`The selector did not use required research tool ${required}.`);
			}
		}
	}
	const parsed = dailyCrossSelectionSchema.safeParse(result.output);
	if (!parsed.success) throw new DailyCrossSelectorError("The model returned no valid Daily Cross selection object.");
	const selection = parsed.data as DailyCrossSelection;
	if (selection.mode !== mode) {
		throw new DailyCrossSelectorError(`The model changed the requested selection mode from ${mode} to ${selection.mode}.`);
	}
	const validation = isDailyCrossSelectionAllowed(selection, {
		recentSelections: input.recentSelections ?? [],
		now: input.now,
	});
	if (!validation) {
		throw new DailyCrossSelectionValidationError(validateDailyCrossSelection(selection, {
			recentSelections: input.recentSelections ?? [],
			now: input.now,
		}).errors);
	}
	return {
		...selection,
		secondaryThemeKeys: [...new Set(selection.secondaryThemeKeys)].slice(0, 3) as PrimaryThemeKey[],
		evidence: boundEvidence(selection.evidence).slice(0, MAX_EVIDENCE_ITEMS),
	};
}

export const generateDailyCrossSelection = selectDailyCross;

/** Bind stable dependencies once, while retaining per-call input and history. */
export function createDailyCrossSelector(defaultDependencies: DailyCrossSelectorDependencies = {}) {
	return (input: DailyCrossSelectorInput, dependencies: DailyCrossSelectorDependencies = {}) =>
		selectDailyCross(input, { ...defaultDependencies, ...dependencies });
}
