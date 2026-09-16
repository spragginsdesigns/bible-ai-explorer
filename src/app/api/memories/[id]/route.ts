import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { asPrayerStatus, MAX_MEMORY_CONTENT_LENGTH, prayerStatusUpdate } from "@/lib/memory";

/**
 * Single-memory operations. Both mutations are userId-scoped in the query
 * itself (deleteMany/updateMany), so an id can never write across users.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const { id } = await params;
		const { count } = await prisma.$transaction(async (tx) => {
			await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
			return tx.userMemory.deleteMany({ where: { id, userId } });
		});
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

/**
 * Edit one memory's wording, its prayer status, or both. The status half is the
 * one-tap "Answered" / "Close" / "Reopen" on the Settings → Memory rows, so it
 * has to work on its own without the screen resending the content.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const { id } = await params;
		const body = await req.json().catch(() => null);
		const contentGiven = body?.content !== undefined;
		const content = typeof body?.content === "string" ? body.content.trim() : "";
		const statusGiven = body?.status !== undefined;
		const status = typeof body?.status === "string" ? asPrayerStatus(body.status) : null;
		if (!contentGiven && !statusGiven) {
			return NextResponse.json({ error: "content or status is required" }, { status: 400 });
		}
		if (contentGiven && !content) {
			return NextResponse.json({ error: "content is required" }, { status: 400 });
		}
		if (content.length > MAX_MEMORY_CONTENT_LENGTH) {
			return NextResponse.json(
				{ error: `content must be ${MAX_MEMORY_CONTENT_LENGTH} characters or fewer` },
				{ status: 400 }
			);
		}
		if (statusGiven && !status) {
			return NextResponse.json({ error: "status must be open, answered or closed" }, { status: 400 });
		}

		const outcome = await prisma.$transaction(async (tx) => {
			await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
			const existing = await tx.userMemory.findFirst({
				where: { id, userId },
				select: { category: true, askedAt: true },
			});
			if (!existing) return "missing" as const;
			if (status && existing.category !== "prayer") return "notPrayer" as const;
			const now = new Date();
			await tx.userMemory.updateMany({
				where: { id, userId },
				data: {
					...(contentGiven ? { content } : {}),
					...(status
						? {
								...prayerStatusUpdate(status, now),
								// A prayer row from before this feature may have no day
								// recorded; the first status change is where it gets one.
								...(existing.askedAt ? {} : { askedAt: now }),
							}
						: {}),
				},
			});
			return "updated" as const;
		});
		if (outcome === "missing") {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}
		if (outcome === "notPrayer") {
			return NextResponse.json({ error: "Only prayer requests have a status." }, { status: 400 });
		}
		return NextResponse.json({ success: true });
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("[api/memories/:id] PATCH failed", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
