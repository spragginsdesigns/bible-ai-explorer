"use client";

import type { RoomView } from "@/lib/beta/rooms/rooms";

export type RoomResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; body: Record<string, unknown> };

/** One call to /api/beta/rooms/**, never throwing: a failure comes back as its message. */
export async function roomFetch<T = { room: RoomView }>(path: string, init?: { method?: string; body?: unknown }): Promise<RoomResult<T>> {
	try {
		const res = await fetch(path, {
			method: init?.method ?? "GET",
			cache: "no-store",
			headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" },
			body: init?.body === undefined ? undefined : JSON.stringify(init.body),
		});
		const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
		if (res.ok) return { ok: true, data: body as T };
		const error = typeof body.error === "string" && body.error !== "Not found" ? body.error : res.status === 404 ? "This room is no longer available to you." : "Something went wrong. Try again.";
		return { ok: false, status: res.status, error, body };
	} catch {
		return { ok: false, status: 0, error: "You look to be offline. Try again in a moment.", body: {} };
	}
}
