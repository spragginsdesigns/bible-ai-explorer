import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type TurnStage = "request" | "validation" | "context" | "tools" | "tool" | "answer-shape" |
	"generation" | "generation-step" | "verification" | "verification-request" | "verification-budget" | "canonical" | "source-loading" | "review" | "repair" |
	"evidence-completion" | "certification-prepare" | "certification-review" |
	"certification-revision" | "certification-revision-hydrate" | "certification-proof" |
	"certification-commit" | "certification-release" | "persistence" | "stream" | "turn";
export type TurnPhase = "started" | "completed" | "failed" | "skipped";
export type TurnOutcome = "answered" | "withheld" | "incomplete" | "failed" | "cancelled";
export type TurnErrorClass = "Error" | "NonError" | "AbortError" | "TimeoutError" |
	"ProviderError" | "QuotaError" | "ValidationError" | "HistoryError" | "PersistenceError" | "TypeError" | "RangeError" |
	"canonical-unavailable" | "schema-error";
export interface TurnTraceFields {
	durationMs?: number; remainingBudgetMs?: number; remainingStageBudgetMs?: number;
	verificationCalls?: number; verificationCallLimit?: number;
	timeToFirstOutputMs?: number; responseTimeMs?: number; outputTokensPerSecond?: number;
	inputChars?: number; outputChars?: number; promptChars?: number; estimatedTokens?: number;
	inputTokens?: number; outputTokens?: number; reasoningTokens?: number; totalTokens?: number;
	cacheReadTokens?: number; cacheWriteTokens?: number; tokenBudget?: number;
	contextWindow?: number; maxOutputTokens?: number; stepCount?: number; toolCount?: number;
	memoryCount?: number; messageCount?: number; referenceCount?: number; attempt?: number;
	revisionCount?: number; issueCount?: number; round?: number; chunkCount?: number;
	textBlockCount?: number; actionCount?: number;
	resultCount?: number;
	timeoutMs?: number; contextLimitChars?: number; requestLimitChars?: number;
	sourceVerseCount?: number; requestedReferenceCount?: number; retrievedReferenceCount?: number;
	checkedReferenceCount?: number; expectedReferenceCount?: number; originalSourceCount?: number;
	checkedOriginalSourceCount?: number; blockIndex?: number;
	fallback?: boolean; certified?: boolean; persisted?: boolean; aborted?: boolean;
	hasAttachments?: boolean; verified?: boolean; complete?: boolean;
	toolSucceeded?: boolean; toolErrorReported?: boolean; truncated?: boolean;
	coverageMatches?: boolean; allScriptureQuotationsVerified?: boolean; allCitationsSupportTheirClaims?: boolean;
	faithfulToFoundation?: boolean; answersRequestedQuestion?: boolean; repaired?: boolean;
	verifyOnly?: boolean; finalReviewRevision?: boolean;
	purpose?: "answer" | "artifact"; canonicalCheckKind?: "block" | "question" | "context" | "completion" | "repair";
	issueCodes?: readonly string[];
	plan?: "free" | "pro"; surface?: "ask-question" | "note-ai";
	contextKind?: "memory" | "church" | "day" | "legend" | "profile" | "actions" | "attachments" | "history" | "prompt" | "request" | "model";
	persistenceKind?: "user" | "assistant" | "memory" | "preferences";
	effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
	finishReason?: "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other";
	model?: string; toolName?: string; outcome?: TurnOutcome;
	reason?: "approved" | "withheld" | "provider-error" | "context-budget" | "validation" |
		"aborted" | "disconnect" | "empty" | "persisted" | "persistence-error" |
		"unavailable" | "skipped" | "tool-error" | "truncated" | "review-rejected";
	errorClass?: TurnErrorClass; httpStatus?: number;
}

interface TurnTraceContext {
	id: string; startedAt: number; sequence: number; terminal: boolean;
	models: Set<string>; tools: Set<string>; cleanup?: () => void;
}
const traces = new AsyncLocalStorage<TurnTraceContext>();

/** Bind stream entry points whose consumer may invoke them outside the request's async chain. */
export function captureTurnTrace(): <T>(operation: () => T) => T {
	const scope = traces.getStore();
	return <T>(operation: () => T): T => scope ? traces.run(scope, operation) : operation();
}
const stages = new Set<TurnStage>(["request", "validation", "context", "tools", "tool", "answer-shape", "generation", "generation-step", "verification", "verification-request", "verification-budget", "canonical", "source-loading", "review", "repair", "evidence-completion", "certification-prepare", "certification-review", "certification-revision", "certification-revision-hydrate", "certification-proof", "certification-commit", "certification-release", "persistence", "stream", "turn"]);
const phases = new Set<TurnPhase>(["started", "completed", "failed", "skipped"]);
const numeric = new Set(["durationMs", "remainingBudgetMs", "inputChars", "outputChars", "promptChars", "estimatedTokens", "inputTokens", "outputTokens", "reasoningTokens", "totalTokens", "cacheReadTokens", "cacheWriteTokens", "tokenBudget", "contextWindow", "maxOutputTokens", "stepCount", "toolCount", "memoryCount", "messageCount", "referenceCount", "attempt", "revisionCount", "issueCount", "round", "chunkCount", "textBlockCount", "actionCount", "timeoutMs", "contextLimitChars", "requestLimitChars", "sourceVerseCount", "requestedReferenceCount", "retrievedReferenceCount", "checkedReferenceCount", "expectedReferenceCount", "originalSourceCount", "checkedOriginalSourceCount", "blockIndex"]);
const booleans = new Set(["fallback", "certified", "persisted", "aborted", "hasAttachments", "verified", "complete", "coverageMatches", "allScriptureQuotationsVerified", "allCitationsSupportTheirClaims", "faithfulToFoundation", "answersRequestedQuestion", "repaired", "verifyOnly", "finalReviewRevision"]);
for (const key of ["toolSucceeded", "toolErrorReported", "truncated"]) booleans.add(key);
numeric.add("resultCount");
for (const key of ["timeToFirstOutputMs", "responseTimeMs", "outputTokensPerSecond"]) numeric.add(key);
numeric.add("remainingStageBudgetMs");
numeric.add("verificationCalls");
numeric.add("verificationCallLimit");
const outcomes = new Set<TurnOutcome>(["answered", "withheld", "incomplete", "failed", "cancelled"]);
const reasons = new Set(["approved", "withheld", "provider-error", "context-budget", "validation", "aborted", "disconnect", "empty", "persisted", "persistence-error", "unavailable", "skipped", "tool-error", "truncated", "review-rejected"]);
const errorClasses = new Set<TurnErrorClass>(["Error", "NonError", "AbortError", "TimeoutError", "ProviderError", "QuotaError", "ValidationError", "HistoryError", "PersistenceError", "TypeError", "RangeError", "canonical-unavailable", "schema-error"]);
const issueCodes = new Set(["answer_limit", "repair_not_allowed", "repair_shape", "verification_unavailable", "verification_timeout", "verification_context_limit", "review_rejected", "invalid_reference", "unknown_book", "verification_limit", "source_unavailable", "malformed_placeholder", "ambiguous_quote", "quote_mismatch", "unattributed_quote", "noncanonical_quote", "unsupported_translation", "translation_mismatch"]);
for (const code of ["not_found", "not_assistant", "source_changed", "context_changed", "policy_changed", "consent_required", "pending", "account_busy", "lease_expired", "retry_later", "source_limit", "context_limit", "context_incomplete", "context_ambiguous", "missing_question", "unknown_translation", "unsupported_attachment_context", "projection_refused", "notice_has_unreviewed_extras", "action_proof_missing", "canonical_rejected", "semantic_rejected", "review_changed_text", "reviewer_changed", "quota_exhausted", "stale_lease", "original_limit", "review_required", "unversioned_corpus"]) issueCodes.add(code);
issueCodes.add("verification_call_limit");
const enumFields: Record<string, ReadonlySet<string>> = {
	purpose: new Set(["answer", "artifact"]), canonicalCheckKind: new Set(["block", "question", "context", "completion", "repair"]),
	plan: new Set(["free", "pro"]), surface: new Set(["ask-question", "note-ai"]),
	effort: new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]),
	finishReason: new Set(["stop", "length", "content-filter", "tool-calls", "error", "other"]),
	contextKind: new Set(["memory", "church", "day", "legend", "profile", "actions", "attachments", "history", "prompt", "request", "model"]),
	persistenceKind: new Set(["user", "assistant", "memory", "preferences"]),
};

/** Only call with names taken from server model definitions and registered tools. */
export function registerTurnTraceCatalog(catalog: { models?: readonly string[]; tools?: readonly string[] }): void {
	const scope = traces.getStore();
	if (!scope) return;
	for (const model of catalog.models ?? []) scope.models.add(model);
	for (const tool of catalog.tools ?? []) scope.tools.add(tool);
}

/** Shape observations only. Never serialize, invoke output accessors, or decide tool effects here. */
export function toolResultTraceFields(output: unknown, sdkSucceeded: boolean, serializedChars?: number): TurnTraceFields {
	const facts: TurnTraceFields = { toolSucceeded: sdkSucceeded, toolErrorReported: !sdkSucceeded };
	if (typeof serializedChars === "number" && Number.isFinite(serializedChars) && serializedChars >= 0) facts.outputChars = serializedChars;
	try {
		if (typeof output !== "object" || output === null) return facts;
		const ownData = (value: object, key: string): unknown => {
			const property = Object.getOwnPropertyDescriptor(value, key);
			return property && "value" in property ? property.value : undefined;
		};
		const success = ownData(output, "success"), ok = ownData(output, "ok"), error = ownData(output, "error"), status = ownData(output, "status");
		const reported = success === false || ok === false || (typeof error === "string" && error.length > 0) ||
			(typeof status === "string" && ["error", "failed", "failure", "unavailable", "not_found", "forbidden", "cancelled", "timeout"].includes(status));
		facts.toolErrorReported = !sdkSucceeded || reported;
		facts.toolSucceeded = sdkSucceeded && !reported;
		const rootTruncated = ownData(output, "truncated"), coverage = ownData(output, "coverage");
		const coverageTruncated = typeof coverage === "object" && coverage !== null ? ownData(coverage, "truncated") : undefined;
		if (typeof rootTruncated === "boolean") facts.truncated = rootTruncated;
		else if (typeof rootTruncated === "number" && Number.isFinite(rootTruncated) && rootTruncated >= 0) facts.truncated = rootTruncated > 0;
		else if (typeof coverageTruncated === "boolean") facts.truncated = coverageTruncated;
		else if (typeof coverageTruncated === "number" && Number.isFinite(coverageTruncated) && coverageTruncated >= 0) facts.truncated = coverageTruncated > 0;
		if (Array.isArray(output)) {
			const length = ownData(output, "length");
			if (typeof length === "number") facts.resultCount = length;
		}
		else {
			for (const key of ["verses", "results", "items", "result", "matches", "notes", "studies", "memories", "prayers", "events", "tasks", "references", "crossReferences"]) {
				const rows = ownData(output, key);
				if (!Array.isArray(rows)) continue;
				const length = ownData(rows, "length");
				if (typeof length !== "number") continue;
				if (facts.resultCount === undefined) facts.resultCount = length;
				if (key === "verses") facts.sourceVerseCount = length;
			}
		}
	} catch { /* A hostile getter or proxy must not affect execution or logging. */ }
	return facts;
}

/** A closed classification prevents writable Error.name values from becoming logged content. */
export function classifyTurnError(error: unknown): { errorClass: TurnErrorClass; httpStatus?: number } {
	try {
		if (!(error instanceof Error)) return { errorClass: "NonError" };
		const name = error.name === "Error" ? error.constructor?.name : error.name;
		const errorClass: TurnErrorClass = name === "AbortError" || name === "TimeoutError" || name === "TypeError" || name === "RangeError" ? name
			: name === "AI_APICallError" || name === "AI_RetryError" ? "ProviderError"
			: name === "AI_NoObjectGeneratedError" || name === "AI_NoOutputGeneratedError" ? "schema-error"
			: name === "VerificationCallLimitError" ? "QuotaError"
			: name === "ZodError" || name === "UserFacingError" || name === "AI_InvalidArgumentError" ? "ValidationError"
			: name === "HistoryError" ? "HistoryError"
			: name.startsWith("PrismaClient") ? "PersistenceError" : "Error";
		const status = (error as Error & { statusCode?: unknown }).statusCode;
		return { errorClass, ...(typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599 ? { httpStatus: status } : {}) };
	} catch { return { errorClass: "Error" }; }
}

/** No arbitrary strings, ids, error messages, tool payloads, or nested data enter this event. */
export function traceTurn(stage: TurnStage, phase: TurnPhase, fields: TurnTraceFields = {}): void {
	try {
		const scope = traces.getStore();
		if (!scope || !stages.has(stage) || !phases.has(phase)) return;
		if (stage === "turn" && phase !== "started") {
			if (scope.terminal) return;
			scope.terminal = true;
			scope.cleanup?.();
		}
		const elapsedMs = Math.max(0, Math.round(performance.now() - scope.startedAt));
		const safe: Record<string, string | number | boolean | string[]> = {};
		// Enumerating known keys avoids reading an untrusted getter on an unknown key.
		for (const key of numeric) {
			const value = fields[key as keyof TurnTraceFields];
			if (typeof value === "number" && Number.isFinite(value) && value >= 0) safe[key] = Math.min(1_000_000_000, Math.round(value * 100) / 100);
		}
		for (const key of booleans) {
			const value = fields[key as keyof TurnTraceFields];
			if (typeof value === "boolean") safe[key] = value;
		}
		if (fields.model && scope.models.has(fields.model)) safe.model = fields.model;
		if (fields.toolName && scope.tools.has(fields.toolName)) safe.toolName = fields.toolName;
		if (fields.outcome && outcomes.has(fields.outcome)) safe.outcome = fields.outcome;
		if (fields.reason && reasons.has(fields.reason)) safe.reason = fields.reason;
		if (fields.errorClass && errorClasses.has(fields.errorClass)) safe.errorClass = fields.errorClass;
		for (const [key, allowed] of Object.entries(enumFields)) {
			const value = fields[key as keyof TurnTraceFields];
			if (typeof value === "string" && allowed.has(value)) safe[key] = value;
		}
		if (Array.isArray(fields.issueCodes)) safe.issueCodes = [...new Set(fields.issueCodes.slice(0, 64).filter(code => typeof code === "string" && issueCodes.has(code)))].slice(0, 12);
		if (Number.isInteger(fields.httpStatus) && fields.httpStatus! >= 100 && fields.httpStatus! <= 599) safe.httpStatus = fields.httpStatus!;
		console.info("[ai.turn]", JSON.stringify({ traceId: scope.id, sequence: ++scope.sequence, elapsedMs, remainingRequestBudgetMs: Math.max(0, 300_000 - elapsedMs), remainingBudgetMs: Math.max(0, 300_000 - elapsedMs), stage, phase, ...safe }));
	} catch { /* Telemetry must never change the answer or certification decision. */ }
}

/** Response creation is only a request event. The stream owner records the terminal turn. */
export function withTurnTrace(handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
	return (req) => traces.run({ id: randomUUID(), startedAt: performance.now(), sequence: 0, terminal: false, models: new Set(), tools: new Set() }, async () => {
		const scope = traces.getStore()!;
		const disconnected = () => traces.run(scope, () => traceTurn("stream", "skipped", { reason: "disconnect", aborted: true }));
		req.signal.addEventListener("abort", disconnected, { once: true });
		scope.cleanup = () => req.signal.removeEventListener("abort", disconnected);
		traceTurn("request", "started");
		if (req.signal.aborted) disconnected();
		try {
			const response = await handler(req);
			traceTurn("request", "completed", { httpStatus: response.status });
			if (response.status >= 400) {
				traceTurn("validation", "failed", { httpStatus: response.status, reason: response.status < 500 ? "validation" : "unavailable" });
				traceTurn("turn", "failed", { outcome: "failed", httpStatus: response.status, reason: response.status < 500 ? "validation" : "unavailable" });
			}
			const headers = new Headers(response.headers);
			headers.set("x-sureword-trace-id", scope.id);
			return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
		} catch (error) {
			traceTurn("request", "failed", classifyTurnError(error));
			traceTurn("turn", "failed", { ...classifyTurnError(error), outcome: "failed" });
			throw error;
		}
	});
}
