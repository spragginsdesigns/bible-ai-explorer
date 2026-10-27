"use client";

import { aiConsentGate, CONSENT_DECLINED_NOTICE } from "@/lib/ai-consent-gate";
import type { ProjectSummary, ProjectView } from "@/lib/beta/projects/projects";

/** Study Projects' calls to its own routes (/api/beta/projects), with the server's message on failure. */

export class ProjectRequestError extends Error {
	constructor(message: string, public status: number) {
		super(message);
	}
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
	let response: Response;
	try {
		response = await fetch(path, { cache: "no-store", ...init, headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init?.headers } });
	} catch {
		throw new ProjectRequestError("You appear to be offline. Try again.", 0);
	}
	const data = (await response.json().catch(() => ({}))) as { error?: string };
	if (!response.ok) {
		const fallback = response.status === 404 ? "That is no longer in this project." : "Something went wrong. Try again.";
		throw new ProjectRequestError(data.error ?? fallback, response.status);
	}
	return data as T;
}

const base = "/api/beta/projects";
const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

/** AI calls ask for SureWord's AI consent first, exactly like chat; a declined account gets the same notice. */
async function withConsent<T>(run: () => Promise<T>): Promise<T> {
	if (!(await aiConsentGate.ensure(true))) throw new ProjectRequestError(CONSENT_DECLINED_NOTICE, 403);
	return run();
}

export const projectsApi = {
	list: () => call<{ projects: ProjectSummary[] }>(base),
	create: (body: Record<string, unknown>) => call<{ project: ProjectSummary }>(base, json("POST", body)),
	get: (id: string) => call<{ project: ProjectView }>(`${base}/${id}`),
	update: (id: string, body: Record<string, unknown>) => call<{ project: ProjectSummary }>(`${base}/${id}`, json("PATCH", body)),
	remove: (id: string) => call<{ deleted: true }>(`${base}/${id}`, json("DELETE")),
	add: (id: string, body: Record<string, unknown>) => call<{ id: string; duplicate: boolean }>(`${base}/${id}/items`, json("POST", body)),
	updateItem: (id: string, itemId: string, body: Record<string, unknown>) => call<{ updated: true }>(`${base}/${id}/items/${itemId}`, json("PATCH", body)),
	removeItem: (id: string, itemId: string) => call<{ deleted: true }>(`${base}/${id}/items/${itemId}`, json("DELETE")),
	upload: (id: string, file: File) => {
		const form = new FormData();
		form.append("file", file);
		return call<{ id: string; title: string; chars: number; pages: number | null; truncated: boolean }>(`${base}/${id}/upload`, { method: "POST", body: form });
	},
	ask: (id: string, question: string) => withConsent(() => call<{ answer: { id: string } }>(`${base}/${id}/ask`, json("POST", { question }))),
	overview: (id: string) => withConsent(() => call<{ overview: { id: string } }>(`${base}/${id}/overview`, json("POST", {}))),
	study: (id: string, mode: "outline" | "study") => withConsent(() => call<{ study: { id: string } }>(`${base}/${id}/study`, json("POST", { mode }))),
	saveNote: (id: string, studyId: string) => call<{ noteId: string; noteTitle: string; created: boolean }>(`${base}/${id}/study/${studyId}/note`, json("POST")),
	notes: (q: string) => call<{ notes: { id: string; title: string; preview: string; updatedAt: string }[] }>(`${base}/library?type=notes&q=${encodeURIComponent(q)}`),
	highlights: (book: number | null) =>
		call<{ highlights: { book: number; chapter: number; verse: number; translation: string; reference: string; text: string; color: string; colorName: string | null }[] }>(
			`${base}/library?type=highlights${book ? `&book=${book}` : ""}`,
		),
};

export { projectHref, readHref } from "@/lib/beta/projects/projects-rules";
