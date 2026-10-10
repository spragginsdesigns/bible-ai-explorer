import "server-only";

import type { UserPlan } from "@/lib/entitlements-rules";
import { type AudioQuotaDecision, audioQuotaDecision } from "@/lib/audio-transcription-rules";
import { prisma } from "@/lib/prisma";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Reserve a voice message's seconds against the user's rolling daily
 * allowance, before any paid transcription. Counted from the
 * AudioTranscriptionUsage ledger, which deleting an attachment or a
 * conversation never touches, and serialized per user by an advisory lock so
 * parallel uploads cannot all spend against the same total.
 *
 * Idempotent per attachment: an attachment that already holds a reservation (a
 * retry after a crash) keeps it and is not counted twice.
 */
export async function reserveAudioSeconds(input: {
	userId: string;
	attachmentId: string;
	seconds: number;
	plan: UserPlan;
	capSeconds: number;
	mentionPro: boolean;
}): Promise<AudioQuotaDecision> {
	return prisma.$transaction(async (tx) => {
		await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.userId}), 8204)`;
		const existing = await tx.audioTranscriptionUsage.findFirst({
			where: { attachmentId: input.attachmentId, userId: input.userId },
			select: { id: true },
		});
		if (existing) return { ok: true };
		const used = await tx.audioTranscriptionUsage.aggregate({
			where: { userId: input.userId, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
			_sum: { seconds: true },
		});
		const decision = audioQuotaDecision({
			plan: input.plan,
			usedSeconds: used._sum.seconds ?? 0,
			newSeconds: input.seconds,
			capSeconds: input.capSeconds,
			mentionPro: input.mentionPro,
		});
		if (decision.ok) {
			await tx.audioTranscriptionUsage.create({
				data: { userId: input.userId, attachmentId: input.attachmentId, seconds: input.seconds },
			});
		}
		return decision;
	});
}

/** Give a reservation back when the paid call failed and nothing was transcribed. */
export async function releaseAudioReservation(userId: string, attachmentId: string): Promise<void> {
	await prisma.audioTranscriptionUsage.deleteMany({ where: { userId, attachmentId } });
}
