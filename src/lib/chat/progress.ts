/** Public activity only. Keep the mobile copy identical; tested in chat-progress.test.mjs. */
export interface ProgressEntry {
	id: string;
	kind: "tool" | "summary" | "status";
	state: "running" | "complete" | "error" | "interrupted";
	label: string;
	detail?: string;
	sources?: { title: string; url: string }[];
}

export interface ChatProgress {
	version: 1;
	runId: string;
	sequence: number;
	elapsedMs: number;
	lastActivityMs: number;
	state: "running" | "complete" | "error";
	phase: "preparing" | "thinking" | "tool" | "answering";
	label: string;
	entries: ProgressEntry[];
}

const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
export function parseProgress(value: unknown): ChatProgress | undefined {
	if (!record(value) || value.version !== 1 || typeof value.runId !== "string" ||
		!Number.isFinite(value.sequence) || !Number.isFinite(value.elapsedMs) ||
		!Number.isFinite(value.lastActivityMs) || typeof value.label !== "string" ||
		!["running", "complete", "error"].includes(String(value.state)) ||
		!["preparing", "thinking", "tool", "answering"].includes(String(value.phase)) || !Array.isArray(value.entries)) return;
	const entries: ProgressEntry[] = value.entries.slice(-48).flatMap((entry) => {
		if (!record(entry) || typeof entry.id !== "string" || typeof entry.label !== "string" ||
			!["tool", "summary", "status"].includes(String(entry.kind)) ||
			!["running", "complete", "error", "interrupted"].includes(String(entry.state))) return [];
		const sources = Array.isArray(entry.sources) ? entry.sources.slice(0, 6).flatMap((source) => {
			if (!record(source) || typeof source.url !== "string" || typeof source.title !== "string") return [];
			try {
				const url = new URL(source.url);
				if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return [];
				return [{ title: source.title.slice(0, 100), url: url.href }];
			} catch { return []; }
		}) : undefined;
		return [{ id: entry.id.slice(0, 120), kind: entry.kind as ProgressEntry["kind"], state: entry.state as ProgressEntry["state"],
			label: entry.label.slice(0, 180), ...(typeof entry.detail === "string" ? { detail: entry.detail.slice(0, 2400) } : {}), ...(sources?.length ? { sources } : {}) }];
	});
	return { version: 1, runId: value.runId, sequence: Math.max(0, Number(value.sequence)),
		elapsedMs: Math.max(0, Number(value.elapsedMs)), lastActivityMs: Math.max(0, Number(value.lastActivityMs)),
		state: value.state as ChatProgress["state"], phase: value.phase as ChatProgress["phase"], label: value.label.slice(0, 180), entries };
}

export function progressFromParts(parts: readonly { type: string; data?: unknown }[]): ChatProgress | undefined {
	let latest: ChatProgress | undefined;
	for (const part of parts) {
		if (part.type !== "data-progress") continue;
		const parsed = parseProgress(part.data);
		if (parsed && (!latest || parsed.sequence >= latest.sequence)) latest = parsed;
	}
	return latest;
}

export function formatWorkDuration(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}
