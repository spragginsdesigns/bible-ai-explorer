import type { AcademyMilestoneView } from "@/lib/beta/academy/academy-types";

/**
 * The browser's half of SureWord Academy's own routes (LC-17660). A lesson's
 * tutor and memory parts go through those modules' own transports
 * (`tutor-api.ts`, `memoryClient.ts`), never through these.
 */
async function request<T>(path: string, init: { method: "POST" | "DELETE"; json?: unknown }): Promise<T> {
	let response: Response;
	try {
		response = await fetch(path, {
			method: init.method,
			cache: "no-store",
			headers: init.json === undefined ? undefined : { "Content-Type": "application/json" },
			body: init.json === undefined ? undefined : JSON.stringify(init.json),
		});
	} catch {
		throw new Error("You seem to be offline. Check your connection and try again.");
	}
	const body = (await response.json().catch(() => null)) as (T & { error?: unknown }) | null;
	if (!response.ok || !body) throw new Error(typeof body?.error === "string" ? body.error : "Something went wrong. Please try again.");
	return body;
}

export const enrollInCourse = (courseId: string) => request<{ enrolled: true; created: boolean }>("/api/beta/academy/enrollment", { method: "POST", json: { courseId } });

export const leaveCourse = (courseId: string) => request<{ left: boolean }>(`/api/beta/academy/enrollment?courseId=${encodeURIComponent(courseId)}`, { method: "DELETE" });

export const recordMilestones = (courseId: string) =>
	request<{ added: AcademyMilestoneView[]; recordId: string | null }>("/api/beta/academy/milestones", { method: "POST", json: { courseId } });
