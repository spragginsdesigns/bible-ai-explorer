import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { MAX_MEMORY_CONTENT_LENGTH } from "@/lib/memory";

/**
 * Single-memory operations. Both mutations are userId-scoped in the query
 * itself (deleteMany/updateMany), so an id can never write across users.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const { id } = await params;
		const { count } = await prisma.userMemory.deleteMany({ where: { id, userId } });
		if (count === 0) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}
		return NextResponse.json({ success: true });
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("[api/memories/:id] DELETE failed", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const { id } = await params;
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
		const { count } = await prisma.userMemory.updateMany({
			where: { id, userId },
			data: { content },
		});
		if (count === 0) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}
		return NextResponse.json({ success: true });
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("[api/memories/:id] PATCH failed", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
