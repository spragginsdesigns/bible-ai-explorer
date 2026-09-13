import type { ChatProgress, ProgressEntry } from "@/lib/chat/progress";
import type { JSONValue } from "ai";

type ToolCall = { toolCallId: string; toolName: string; input: unknown };
export type NarrationFacts = { question: string; phase: ChatProgress["phase"]; activity: string;
	publicSummary?: string;
	activities: Array<Pick<ProgressEntry, "kind" | "state" | "label" | "detail">> };
type Narrator = (facts: NarrationFacts, signal: AbortSignal) => Promise<string | null>;
const object = (v: unknown): Record<string, unknown> => typeof v === "object" && v !== null ? v as Record<string, unknown> : {};
const short = (v: unknown, max = 160): string => typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "";

/** Opt in on chat surfaces only, without changing effort or utility-model calls. */
export function progressProviderOptions(provider: string, modelId: string, options: Record<string, Record<string, JSONValue>>) {
	if (provider === "openai" && options.openai?.reasoningEffort && options.openai.reasoningEffort !== "none") {
		return { ...options, openai: { ...options.openai, reasoningSummary: "auto" } };
	}
	// The installed Anthropic adapter supports summarized adaptive thinking, not the newer updates beta.
	if (provider === "anthropic" && /claude-(?:(?:opus|sonnet)-(?:4-[6-9]|5)|(?:fable|mythos)-5)/.test(modelId)) {
		return { ...options, anthropic: { ...options.anthropic, thinking: { type: "adaptive", display: "summarized" } } };
	}
	return options;
}

/** One bounded snapshot, updated by facts rather than a rotating timer script. */
export function createProgressNarration(write: (progress: ChatProgress) => void, runId: string, now = Date.now) {
	const started = now();
	let terminal = false;
	let lastSummaryWrite = -Infinity;
	let narrator: Narrator | undefined;
	let question = "";
	let narrationCalls = 0;
	let narrationRevision = 0;
	let narrationTimer: ReturnType<typeof setTimeout> | undefined;
	let narrationController: AbortController | undefined;
	let narrationDeadline: ReturnType<typeof setTimeout> | undefined;
	const summaryBuffers = new Map<string, string>();
	const snapshot: ChatProgress = { version: 1, runId, sequence: 0, elapsedMs: 0, lastActivityMs: 0,
		state: "running", phase: "preparing", label: "Preparing your answer", entries: [] };
	const elapsed = () => Math.max(0, now() - started);
	function emit(activity = true) {
		if (terminal) return;
		snapshot.elapsedMs = elapsed();
		if (activity) snapshot.lastActivityMs = snapshot.elapsedMs;
		snapshot.sequence += 1;
		write(structuredClone(snapshot));
	}
	function activeTool() { return snapshot.entries.findLast(e => e.kind === "tool" && e.state === "running"); }
	function cancelNarration() {
		narrationRevision += 1;
		clearTimeout(narrationTimer);
		clearTimeout(narrationDeadline);
		narrationController?.abort();
	}
	function requestNarration() {
		cancelNarration();
		if (!narrator || terminal || narrationCalls >= 6) return;
		const revision = narrationRevision;
		// Coalesce tools that finish together, and never hold up the answer stream.
		narrationTimer = setTimeout(() => {
			if (terminal || revision !== narrationRevision || snapshot.phase === "answering") return;
			const controller = new AbortController();
			narrationController = controller;
			narrationCalls += 1;
			const timeout = setTimeout(() => controller.abort(), 4000);
			narrationDeadline = timeout;
			timeout.unref?.();
			const facts: NarrationFacts = { question, phase: snapshot.phase, activity: snapshot.label,
				publicSummary: short(snapshot.entries.findLast(e => e.id.startsWith("summary-"))?.detail, 600) || undefined,
				activities: snapshot.entries.filter(e => e.kind !== "summary").slice(-8)
					.map(({ kind, state, label, detail }) => ({ kind, state, label, ...(detail ? { detail: short(detail, 180) } : {}) })) };
			void Promise.resolve().then(() => narrator!(facts, controller.signal)).then(text => {
				if (!text || terminal || controller.signal.aborted || revision !== narrationRevision) return;
				const label = short(text, 220).replace(/^["“]|["”]$/g, "");
				if (!label || label.length > 180 || label.split(/\s+/).length > 30 || /https?:|[{}<>]/.test(label)) return;
				add({ id: `narration-${revision}`, kind: "summary", state: "complete", label });
				snapshot.label = label;
				emit();
			}).catch(() => { /* The factual activity line remains available. */ }).finally(() => clearTimeout(timeout));
		}, 200);
		narrationTimer.unref?.();
	}
	function add(entry: ProgressEntry) {
		const index = snapshot.entries.findIndex(e => e.id === entry.id);
		if (index >= 0) snapshot.entries[index] = entry;
		else snapshot.entries.push(entry);
		if (snapshot.entries.length > 48) {
			const removable = snapshot.entries.findIndex(e => e.state !== "running");
			if (removable >= 0) snapshot.entries.splice(removable, 1);
		}
	}
	function flushSummary(id: string) {
		const text = summaryBuffers.get(id)?.trim();
		if (!text || terminal || snapshot.entries.find(e => e.id === `summary-${id}`)?.detail === text.slice(0, 2400)) return;
		cancelNarration();
		const heading = text.match(/^\*\*([^*\n]+)\*\*/)?.[1];
		const label = short(heading || text.replace(/[*#_`]/g, "").split(/[\n.!?]/)[0], 120) || "Considering your question";
		add({ id: `summary-${id}`, kind: "summary", state: "complete", label, detail: text.slice(0, 2400) });
		if (!activeTool()) { snapshot.phase = "thinking"; snapshot.label = label; }
		lastSummaryWrite = now();
		emit();
		requestNarration();
	}
	const timer = setInterval(() => emit(false), 10_000);
	timer.unref?.();
	emit();
	return {
		enableNarrator(generate: Narrator, userQuestion: string) {
			if (terminal) return;
			narrator = generate;
			question = short(userQuestion, 600);
			requestNarration();
		},
		status(label: string) {
			if (terminal || activeTool()) return;
			snapshot.label = label === "Thinking" ? "Preparing your answer" : label;
			snapshot.phase = label === "Thinking" ? "thinking" : "preparing";
			if (label !== "Thinking" && label !== "Getting ready") add({ id: `status-${snapshot.sequence}`, kind: "status", state: "complete", label });
			emit();
			requestNarration();
		},
		toolStart(call: ToolCall, fallback: string) {
			if (terminal) return;
			cancelNarration();
			const input = object(call.input);
			const reference = short(input.reference) || (short(input.book) && typeof input.chapter === "number" ? `${short(input.book)} ${input.chapter}${typeof input.verseStart === "number" ? `:${input.verseStart}${typeof input.verseEnd === "number" && input.verseEnd !== input.verseStart ? `–${input.verseEnd}` : ""}` : ""}` : "");
			const label = call.toolName === "getPassage" && reference ? `Opening ${reference}` : fallback;
			// Only useful lookup arguments; never copy notes, memory contents, credentials or raw result objects.
			const detail = /^(searchScripture|findVerses|webSearch|searchOriginalLanguage)$/.test(call.toolName) ? short(input.query) : reference;
			add({ id: call.toolCallId, kind: "tool", state: "running", label, ...(detail ? { detail } : {}) });
			snapshot.phase = "tool"; snapshot.label = label; emit();
			requestNarration();
		},
		toolEnd(call: ToolCall, output: unknown, failed: boolean) {
			if (terminal) return;
			const entry = snapshot.entries.find(e => e.id === call.toolCallId);
			if (!entry) return;
			const result = object(output);
			const error = failed || result.success === false || Boolean(result.error);
			entry.state = error ? "error" : "complete";
			if (error) entry.label = `${entry.label} · unsuccessful`;
			else if (call.toolName === "getPassage") entry.label = `Read ${short(result.reference) || short(object(call.input).reference) || "the passage"}`;
			else if (call.toolName === "webSearch") {
				const sources = (Array.isArray(result.results) ? result.results : []).flatMap(value => {
					const item = object(value);
					try {
						const url = new URL(String(item.url));
						if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return [];
						return [{ title: short(item.title, 100) || url.hostname, url: url.href }];
					} catch { return []; }
				});
				const count = new Set(sources.map(s => new URL(s.url).hostname)).size;
				entry.label = count ? `Found sources on ${count} website${count === 1 ? "" : "s"}` : "Web search returned no sources";
				entry.sources = [...new Map(sources.map(source => [source.url, source])).values()].slice(0, 6);
			} else {
				const completed: Record<string, string> = { Searching: "Searched", Opening: "Opened", Reading: "Read", Writing: "Wrote", Rewriting: "Rewrote", Looking: "Looked", Saving: "Saved", Updating: "Updated", Deleting: "Deleted", Tracing: "Traced", Studying: "Studied", Walking: "Checked", Preparing: "Prepared", Marking: "Marked", Filing: "Filed", Checking: "Checked", Correcting: "Corrected", Removing: "Removed", Setting: "Set" };
				entry.label = entry.label.replace(/^\w+/, word => completed[word] ?? word);
				if (Array.isArray(result.verses)) entry.detail = `${result.verses.length} verse${result.verses.length === 1 ? "" : "s"} found${entry.detail ? ` · ${entry.detail}` : ""}`;
			}
			const active = activeTool();
			snapshot.phase = active ? "tool" : "thinking";
			snapshot.label = active?.label ?? `${short(entry.label, 150)}. Preparing your answer`; emit();
			if (!active) requestNarration();
		},
		summary(id: string, text: string, done = false) {
			if (terminal) return;
			if (!summaryBuffers.has(id) && summaryBuffers.size >= 16) return;
			summaryBuffers.set(id, ((summaryBuffers.get(id) ?? "") + text).slice(0, 2400));
			const buffered = summaryBuffers.get(id) ?? "";
			if (done || (buffered.length >= 80 && now() - lastSummaryWrite >= 1200)) flushSummary(id);
		},
		answer() {
			if (terminal || activeTool() || snapshot.phase === "answering") return;
			cancelNarration();
			snapshot.phase = "answering"; snapshot.label = "Writing your answer"; emit();
		},
		finish(error = false) {
			if (terminal) return;
			cancelNarration();
			clearInterval(timer);
			for (const id of summaryBuffers.keys()) flushSummary(id);
			for (const entry of snapshot.entries) if (entry.state === "running") entry.state = "interrupted";
			snapshot.state = error ? "error" : "complete";
			snapshot.label = error ? "Response interrupted" : "Work completed";
			emit(); terminal = true;
		},
	};
}
