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
/**
 * Show in search (docs/FEATURES.md, "Share an answer").
 *
 * `{ listed: true }` makes an unrevoked share indexable and puts it in the
 * sitemap; `{ listed: false }` takes it back out. Opt-in per answer, because
 * the question text can be personal and a search index is permanent in a way
 * a link someone forwarded is not. Revoking also unlists, so a revoked link
 * never lingers in the sitemap.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const { id } = await params;
		if (!isSharedAnswerId(id)) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}

		const body = (await req.json().catch(() => null)) as { listed?: unknown } | null;
		if (typeof body?.listed !== "boolean") {
			return NextResponse.json({ error: "listed must be true or false." }, { status: 400 });
		}

		const share = await prisma.sharedAnswer.findFirst({
			where: { id, userId },
			select: { id: true, revokedAt: true, listedAt: true },
		});
		if (!share) return NextResponse.json({ error: "Not found" }, { status: 404 });
		if (body.listed && share.revokedAt) {
			return NextResponse.json(
				{ error: "Share this answer again before showing it in search." },
				{ status: 409 },
			);
		}

		// Idempotent, and an already-listed row keeps its original timestamp.
		const listedAt = body.listed ? (share.listedAt ?? new Date()) : null;
		if (listedAt?.getTime() !== share.listedAt?.getTime()) {
			await prisma.sharedAnswer.update({ where: { id: share.id }, data: { listedAt } });
		}

		return NextResponse.json({ ok: true, listed: Boolean(listedAt) });
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("Share listing failed:", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

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
				data: { revokedAt: new Date(), listedAt: null },
			});
		}

		return NextResponse.json({ ok: true });
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("Share revoke failed:", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
