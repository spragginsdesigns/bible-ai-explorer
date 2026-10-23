import { auth, clerkClient } from "@clerk/nextjs/server";
import { del, list } from "@vercel/blob";
import { NextResponse } from "next/server";
import {
	accountBlobPrefixes,
	isDeletionConfirmed,
	runAccountDeletion,
	uniquePathnames,
	type AccountDeletionDeps,
} from "@/lib/account-deletion";
import { decryptSecret } from "@/lib/ai/crypto";
import { forgetConfirmedUser } from "@/lib/auth";
import { cancelSubscriptionRenewal, readSubscriptionState } from "@/lib/billing/google-play";
import { stopPlayRenewal } from "@/lib/billing/store-cancellation";
import { billingAvailable, stripeClient } from "@/lib/billing/stripe";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const json = (body: Record<string, unknown>, status: number) => NextResponse.json(body, { status });

async function listPrefix(prefix: string): Promise<string[]> {
	const found: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await list({ prefix, cursor, limit: 1000 });
		for (const blob of page.blobs) found.push(blob.pathname);
		cursor = page.hasMore ? page.cursor : undefined;
	} while (cursor);
	return found;
}

const deps: AccountDeletionDeps = {
	// Reads the row whether or not Play billing is switched on: a row means a
	// real purchase, and it can outlive the flag.
	async stopGooglePlayRenewal(userId) {
		const row = await prisma.googlePlaySubscription.findUnique({
			where: { userId },
			select: { encryptedPurchaseToken: true, productId: true },
		});
		if (!row) return;
		await stopPlayRenewal(decryptSecret(row.encryptedPurchaseToken), {
			readState: readSubscriptionState,
			cancel: (purchaseToken) => cancelSubscriptionRenewal(row.productId, purchaseToken),
		});
	},
	async cancelBilling(userId) {
		if (!billingAvailable()) return;
		const row = await prisma.billingSubscription.findUnique({
			where: { userId },
			select: { stripeSubscriptionId: true },
		});
		if (!row?.stripeSubscriptionId) return;
		try {
			await stripeClient().subscriptions.cancel(row.stripeSubscriptionId);
		} catch (error) {
			// An already-cancelled or missing subscription is the desired end state.
			if ((error as { statusCode?: number }).statusCode === 404) return;
			throw error;
		}
	},
	async collectBlobPathnames(userId) {
		const [attachments, audio] = await Promise.all([
			prisma.chatAttachment.findMany({ where: { userId }, select: { pathname: true } }),
			prisma.verseOfDay.findMany({ where: { userId, audioPathname: { not: null } }, select: { audioPathname: true } }),
		]);
		const swept = await Promise.all(accountBlobPrefixes(userId).map(listPrefix)).catch(() => []);
		return uniquePathnames(
			attachments.map((a) => a.pathname),
			audio.map((a) => a.audioPathname),
			...swept,
		);
	},
	async deleteDatabaseRows(userId) {
		await prisma.$transaction(async (tx) => {
			const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
			// Note-derived rows follow Note's FK cascade. Their copied userId can
			// lag behind account rekeying and must never authorize deletion.
			await tx.guestTurn.deleteMany({ where: { claimedByUserId: userId } });
			await tx.legacyClerkAccount.deleteMany({
				where: {
					OR: [
						{ legacyUserId: userId },
						{ claimedByUserId: userId },
						...(user?.email ? [{ email: user.email.toLowerCase() }] : []),
					],
				},
			});
			// Every other user-owned table is ON DELETE CASCADE from User.
			await tx.user.deleteMany({ where: { id: userId } });
		});
		forgetConfirmedUser(userId);
	},
	async deleteBlobs(pathnames) {
		for (let i = 0; i < pathnames.length; i += 500) await del(pathnames.slice(i, i + 500));
	},
	async deleteClerkUser(userId) {
		const clerk = await clerkClient();
		await clerk.users.deleteUser(userId);
	},
	log: (message) => console.error(`[api/account] ${message}`),
};

/**
 * Permanently delete the signed-in account. `auth()` (not getAuthUser) on
 * purpose: getAuthUser re-creates a missing User row, which would resurrect an
 * account on a repeated call. Android sends a Clerk bearer token and web a
 * session cookie; `auth()` accepts both.
 */
export async function DELETE(request: Request) {
	const { userId } = await auth();
	if (!userId) return json({ error: "Unauthorized", code: "unauthorized" }, 401);

	const body = await request.json().catch(() => null);
	if (!isDeletionConfirmed(body)) {
		return json({ error: 'Send { "confirm": "DELETE" } to delete your account.', code: "confirmation_required" }, 400);
	}

	const result = await runAccountDeletion(userId, deps);
	if (result.ok) return json({ success: true, deleted: true }, 200);
	if (result.stage === "google_play") {
		// 503, not 502: every client reads 502 as "the data may already be
		// gone" and then treats a later 401 as a finished deletion. Here
		// nothing was deleted, and any other 5xx reads "Nothing was removed".
		return json(
			{
				error: "Couldn't cancel your Google Play subscription, so your account was not deleted. Nothing was removed; try again.",
				code: "google_play_cancel_failed",
				stage: result.stage,
				databaseDeleted: false,
			},
			503,
		);
	}
	return json(
		{
			error: "Account deletion did not finish. Nothing was lost; try again.",
			code: "deletion_incomplete",
			stage: result.stage,
			databaseDeleted: result.databaseDeleted,
		},
		result.stage === "clerk" ? 502 : 500,
	);
}
