import { apiJson, type GetToken } from "@/lib/api";

export type MemoryCategory = "profile" | "prayer" | "study" | "preference" | "general";

export interface MemoryRecord {
	id: string;
	content: string;
	category: string;
	updatedAt: string;
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
