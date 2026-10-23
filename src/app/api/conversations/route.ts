import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET() {
	try {
		const userId = await getAuthUser();
		const conversations = await prisma.conversation.findMany({
			where: { userId },
			orderBy: { updatedAt: "desc" },
			select: { id: true, title: true, createdAt: true, updatedAt: true },
		});
		return NextResponse.json(conversations);
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/**
 * Longest title stored. Every client sends the first 60 characters of the
 * opening message (Apple counts graphemes, so an emoji-heavy one can run past
 * 60 UTF-16 units); this is headroom for that, not a second limit to design to.
 */
const MAX_TITLE_LENGTH = 120;
const DEFAULT_TITLE = "New Conversation";

/**
 * The title to store, or null when the body is unusable. A missing, null or
 * blank title takes the default, as it always has; anything that is not a
 * string is a 400 rather than a Prisma type error surfacing as a 500. An
 * overlong title is clipped by code point, so it never splits an emoji, and
 * not refused, because refusing it would fail the chat it was meant to name.
 */
function parseTitle(body: unknown): string | null {
	if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
	const raw = (body as { title?: unknown }).title;
	if (raw === undefined || raw === null) return DEFAULT_TITLE;
	if (typeof raw !== "string") return null;
	const trimmed = Array.from(raw.trim()).slice(0, MAX_TITLE_LENGTH).join("").trim();
	return trimmed || DEFAULT_TITLE;
}

export async function POST(req: Request) {
	try {
		const userId = await getAuthUser();
		const title = parseTitle(await req.json().catch(() => null));
		if (title === null) {
			return NextResponse.json({ error: "title must be a string" }, { status: 400 });
		}
		const conversation = await prisma.conversation.create({
			data: { title, userId },
		});
		return NextResponse.json(conversation, { status: 201 });
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
