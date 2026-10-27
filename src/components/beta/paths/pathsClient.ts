"use client";

import { CONSENT_DECLINED_NOTICE, aiConsentGate } from "@/lib/ai-consent-gate";
import type { AnswerResult, SessionView } from "@/lib/beta/paths/view-types";
import type { SessionKind } from "@/lib/beta/paths/paths-types";

/**
 * The browser's half of Learning Paths' API (LC-17648). Calls that run the
 * model ask for AI consent first through the app's own consent sheet.
 */

export class PathsRequestError extends Error {
	constructor(message: string, readonly status: number) {
		super(message);
	}
}

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
	const { json, ...rest } = init;
	let response: Response;
	try {
		response = await fetch(path, {
			...rest,
			headers: json === undefined ? rest.headers : { "Content-Type": "application/json", ...rest.headers },
			body: json === undefined ? rest.body : JSON.stringify(json),
			cache: "no-store",
		});
	} catch {
		throw new PathsRequestError("You seem to be offline. Check your connection and try again.", 0);
	}
	const body = (await response.json().catch(() => null)) as { error?: string } | null;
	if (!response.ok) throw new PathsRequestError(body?.error ?? "Something went wrong. Please try again.", response.status);
	return body as T;
}

export function startSession(pathId: string, kind: SessionKind, target: string, restart = false): Promise<SessionView> {
	return request<SessionView>("/api/beta/paths/session", { method: "POST", json: { pathId, kind, target, restart } });
}

export function postAnswer(pathId: string, sessionId: string, exerciseId: string, response: unknown): Promise<AnswerResult> {
	return request<AnswerResult>("/api/beta/paths/answer", { method: "POST", json: { pathId, sessionId, exerciseId, response } });
}

/**
 * The root AIConsentPresenter configures the consent gate for the signed-in
 * account in an effect, after a page's own components have mounted. A lesson
 * that writes itself on open would otherwise ask before the gate knows the
 * account and be refused locally (the same race useSuggestedQuestions waits
 * out), so wait, briefly, for the gate to hold this account.
 */
function gateReady(timeoutMs = 10_000): Promise<void> {
	if (aiConsentGate.isCurrentAccount()) return Promise.resolve();
	return new Promise((resolve) => {
		const finish = () => {
			unsubscribe();
			clearTimeout(timer);
			resolve();
		};
		const unsubscribe = aiConsentGate.subscribe(() => {
			if (aiConsentGate.isCurrentAccount()) finish();
		});
		const timer = setTimeout(finish, timeoutMs);
	});
}

async function requireAi(): Promise<void> {
	await gateReady();
	if (!(await aiConsentGate.ensure(true))) throw new PathsRequestError(CONSENT_DECLINED_NOTICE, 403);
}

export async function createCurriculum(topic: string): Promise<{ pathId: string }> {
	await requireAi();
	return request<{ pathId: string }>("/api/beta/paths/curriculum", { method: "POST", json: { topic } });
}

export async function writeCurriculumLesson(pathId: string, lessonId: string): Promise<{ written: boolean }> {
	await requireAi();
	return request<{ written: boolean }>(`/api/beta/paths/curriculum/${encodeURIComponent(pathId)}/lessons/${encodeURIComponent(lessonId)}`, { method: "POST" });
}

export function restartPath(pathId: string): Promise<{ restarted: boolean }> {
	return request<{ restarted: boolean }>(`/api/beta/paths/enrollment?pathId=${encodeURIComponent(pathId)}`, { method: "DELETE" });
}

export function deleteCurriculum(pathId: string): Promise<{ deleted: boolean }> {
	return request<{ deleted: boolean }>(`/api/beta/paths/curriculum/${encodeURIComponent(pathId)}`, { method: "DELETE" });
}
