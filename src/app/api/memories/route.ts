import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, getAuthUserId } from "@/lib/auth";
import {
	MAX_MEMORIES_PER_USER,
	MAX_MEMORY_CONTENT_LENGTH,
	MEMORY_CATEGORIES,
	type MemoryCategory,
} from "@/lib/memory";

const MEMORY_SELECT = { id: true, content: true, category: true, updatedAt: true } as const;

/**
 * Memory management for the Settings → Memory screens on both clients.
 * Listing works regardless of the enable toggle (users can always see and
 * delete what is stored); the toggle only gates prompt injection/extraction,
 * which lives in src/lib/memory.ts.
 */
export async function GET() {
	try {
		const userId = await getAuthUserId();
		const [user, memories] = await Promise.all([
			prisma.user.findUnique({ where: { id: userId }, select: { memoryEnabled: true } }),
			prisma.userMemory.findMany({
				where: { userId },
				orderBy: { updatedAt: "desc" },
				take: MAX_MEMORIES_PER_USER,
				select: MEMORY_SELECT,
			}),
		]);
		return NextResponse.json({ enabled: user?.memoryEnabled ?? true, memories });
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("[api/memories] GET failed", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/** Toggle memory on/off. Existing memories are kept while disabled. */
export async function PATCH(req: Request) {
	try {
		const userId = await getAuthUser();
		const body = await req.json().catch(() => null);
		if (typeof body?.enabled !== "boolean") {
			return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
		}
		await prisma.user.update({ where: { id: userId }, data: { memoryEnabled: body.enabled } });
		return NextResponse.json({ enabled: body.enabled });
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("[api/memories] PATCH failed", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/** Manually add a memory ("Remember that…" from the manage screen). */
export async function POST(req: Request) {
	try {
		const userId = await getAuthUser();
		const body = await req.json().catch(() => null);
		const content = typeof body?.content === "string" ? body.content.trim() : "";
		if (!content) {
			return NextResponse.json({ error: "content is required" }, { status: 400 });
		}
		if (content.length > MAX_MEMORY_CONTENT_LENGTH) {
			return NextResponse.json(
				{ error: `content must be ${MAX_MEMORY_CONTENT_LENGTH} characters or fewer` },
				{ status: 400 }
			);
		}
		let category: MemoryCategory = "general";
		if (body?.category !== undefined) {
			if (!MEMORY_CATEGORIES.includes(body.category)) {
				return NextResponse.json({ error: "unknown category" }, { status: 400 });
			}
			category = body.category;
		}

		const count = await prisma.userMemory.count({ where: { userId } });
		if (count >= MAX_MEMORIES_PER_USER) {
			return NextResponse.json(
				{ error: "Memory is full. Delete some saved memories first." },
				{ status: 400 }
			);
		}

		const memory = await prisma.userMemory.create({
			data: {
				userId,
				content,
				category,
			},
			select: MEMORY_SELECT,
		});
		return NextResponse.json(memory, { status: 201 });
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("[api/memories] POST failed", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/** Clear every saved memory. The enable toggle is untouched. */
export async function DELETE() {
	try {
		const userId = await getAuthUser();
		await prisma.userMemory.deleteMany({ where: { userId } });
		return NextResponse.json({ success: true });
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("[api/memories] DELETE failed", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
