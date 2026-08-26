import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, getAuthUserId } from "@/lib/auth";
import { parseUserIdAllowlist, resolvePlan } from "@/lib/entitlements-rules";

/**
 * Per-user feature preferences (Settings). The Web Search toggle plus the
 * read-only subscription tier; the Memory toggle has its own route at
 * /api/memories because it ships together with the memory list. Server-side
 * enforcement of the toggle lives in the chat routes (ask-question, note-ai).
 *
 * `plan` is here so any future Pro-gated UI can decide what to render from the
 * call it already makes. It is read-only - nothing a client sends can change a
 * tier.
 */
export async function GET() {
	try {
		const userId = await getAuthUserId();
		const user = await prisma.user.findUnique({
			where: { id: userId },
			select: { webSearchEnabled: true, plan: true },
		});
		return NextResponse.json({
			webSearchEnabled: user?.webSearchEnabled ?? true,
			plan: resolvePlan({
				plan: user?.plan ?? null,
				userId,
				allowlist: parseUserIdAllowlist(process.env.PRO_USER_IDS),
			}),
		});
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("[api/preferences] GET failed", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/** Toggle web search on/off. */
export async function PATCH(req: Request) {
	try {
		const userId = await getAuthUser();
		const body = await req.json().catch(() => null);
		if (typeof body?.webSearchEnabled !== "boolean") {
			return NextResponse.json({ error: "webSearchEnabled must be a boolean" }, { status: 400 });
		}
		await prisma.user.update({
			where: { id: userId },
			data: { webSearchEnabled: body.webSearchEnabled },
		});
		return NextResponse.json({ webSearchEnabled: body.webSearchEnabled });
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("[api/preferences] PATCH failed", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
