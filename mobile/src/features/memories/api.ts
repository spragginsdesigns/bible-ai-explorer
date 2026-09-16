import { apiJson, type GetToken } from "@/lib/api";

export type MemoryCategory = "profile" | "prayer" | "study" | "preference" | "general";

/** The life of a prayer request: asked, then answered or laid down. */
export type PrayerStatus = "open" | "answered" | "closed";

export interface MemoryRecord {
	id: string;
	content: string;
	category: string;
	updatedAt: string;
	/**
	 * The three prayer columns. Null on every non-prayer row, and optional
	 * because an app build can reach a server that predates them.
	 */
	status?: PrayerStatus | null;
	askedAt?: string | null;
	followUpAfter?: string | null;
}

export interface MemorySummarySection {
	title: string;
	content: string;
}

export interface MemorySummary {
	overview: string;
	sections: MemorySummarySection[];
}

export interface MemoriesResponse {
	enabled: boolean;
	memories: MemoryRecord[];
}

export function fetchMemories(getToken: GetToken) {
	return apiJson<MemoriesResponse>(getToken, "/api/memories");
}

export function setMemoryEnabled(getToken: GetToken, enabled: boolean) {
	return apiJson<{ enabled: boolean }>(getToken, "/api/memories", {
		method: "PATCH",
		body: { enabled },
	});
}

/** The server picks the category when none is supplied. */
export function addMemory(getToken: GetToken, content: string) {
	return apiJson<MemoryRecord>(getToken, "/api/memories", {
		method: "POST",
		body: { content },
	});
}

/**
 * Resolves or re-opens a prayer request. The same route also takes `{ content }`
 * for an edit; the server accepts either or both.
 */
export function setMemoryStatus(getToken: GetToken, id: string, status: PrayerStatus) {
	return apiJson<{ success: boolean }>(getToken, `/api/memories/${id}`, {
		method: "PATCH",
		body: { status },
	});
}

export function deleteMemory(getToken: GetToken, id: string) {
	return apiJson<{ success: boolean }>(getToken, `/api/memories/${id}`, { method: "DELETE" });
}

export function clearMemories(getToken: GetToken) {
	return apiJson<{ success: boolean }>(getToken, "/api/memories", { method: "DELETE" });
}

/** LLM-backed: expect this to take several seconds. */
export function generateMemorySummary(getToken: GetToken) {
	return apiJson<{ summary: MemorySummary | null; generatedAt: string | null }>(
		getToken,
		"/api/memories/summary",
		{ method: "POST" }
	);
}
