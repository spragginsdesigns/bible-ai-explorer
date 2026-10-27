import "server-only";

import { NextResponse } from "next/server";
import { BETA_PRIVATE_HEADERS, betaNotFound } from "@/lib/beta/access";
import { RoomError, getRoomView } from "@/lib/beta/rooms/rooms";

/** JSON with the beta's private, no-store headers. */
export function roomJson(body: unknown, status = 200): NextResponse {
	return NextResponse.json(body, { status, headers: BETA_PRIVATE_HEADERS });
}

/**
 * A room error as its status; a missing or foreign room as the beta's
 * ordinary 404 (the same body as a path that does not exist).
 */
export function roomErrorResponse(error: unknown, where: string): Response {
	if (error instanceof Response) return error;
	if (error instanceof RoomError) return error.status === 404 ? betaNotFound() : roomJson({ error: error.message, ...error.detail }, error.status);
	console.error(`[api/beta/rooms] ${where} failed`, error);
	return roomJson({ error: "Internal server error" }, 500);
}

/** After a change, the room as the caller now sees it (404 once they have left). */
export async function roomViewResponse(userId: string, roomId: string): Promise<Response> {
	const room = await getRoomView(userId, roomId);
	return room ? roomJson({ room }) : betaNotFound();
}

export function readJson(req: Request): Promise<unknown> {
	return req.json().catch(() => null);
}
