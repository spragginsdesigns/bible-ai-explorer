import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { isSharedAnswerId } from "@/lib/shared-answer";

/**
 * Revoke a share link (docs/FEATURES.md, "Share an answer").
 *
 * The row is kept and stamped rather than deleted, so the owner's list can
 * still show what was shared and when it was taken back, and so re-sharing the
 * same answer reuses the id instead of minting a second capability for text
 * that is already out there. The public page and the card both refuse a row
 * with `revokedAt` set.
 *
 * Idempotent: revoking an already-revoked link answers `{ ok: true }` without
 * moving the timestamp. Owner-only, and a link belonging to somebody else is a
 * 404 rather than a 403 - a 403 would confirm the id exists.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const { id } = await params;
		if (!isSharedAnswerId(id)) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}

		const share = await prisma.sharedAnswer.findFirst({
			where: { id, userId },
			select: { id: true, revokedAt: true },
		});
		if (!share) return NextResponse.json({ error: "Not found" }, { status: 404 });

		if (!share.revokedAt) {
			await prisma.sharedAnswer.updateMany({
				where: { id: share.id, userId, revokedAt: null },
				data: { revokedAt: new Date() },
			});
		}

		return NextResponse.json({ ok: true });
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("Share revoke failed:", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
