import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendExpoPushMessages, type PendingPush } from "@/lib/push";
import { distinctRecipients } from "@/lib/push-audience";

/**
 * Tells you when a sermon study did not arrive.
 *
 * The pipeline that builds studies runs on a machine outside Vercel, because
 * YouTube refuses datacenter ranges and transcription wants a GPU. Anything
 * running somewhere else can stop running without saying so: the PC is off,
 * yt-dlp broke on a YouTube change, the scheduled task was disabled. Without
 * this you would find out in March that it stopped in January.
 *
 * So this does not build anything. It checks that a study exists for the most
 * recent expected service and pushes a notification when one does not, which
 * turns a silent failure into a loud one.
 */

export const maxDuration = 60;

/**
 * How long after a service we still consider a missing study "not late yet".
 * FMBC streams Sunday and Wednesday, so anything older than four days means a
 * service has been missed rather than merely not processed yet.
 */
const STALE_DAYS = 4;
const SERMON_CHANNEL_ID = "sermon-studies";

export async function GET(request: Request) {
	const expected = process.env.CRON_SECRET;
	if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const churches = await prisma.userChurch.findMany({
		where: { youtubeChannelId: { not: null } },
		select: { userId: true, name: true, youtubeChannelId: true },
	});
	if (churches.length === 0) {
		return NextResponse.json({ checked: 0, stale: 0, pushed: 0 });
	}

	const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);
	const messages: PendingPush[] = [];
	const stale: string[] = [];

	for (const church of churches) {
		const channelId = church.youtubeChannelId;
		if (!channelId) continue;

		const newest = await prisma.sermonStudy.findFirst({
			where: { channelId },
			orderBy: [{ serviceDate: "desc" }, { createdAt: "desc" }],
			select: { serviceDate: true, createdAt: true },
		});
		// A church that has never had a study is not late, it is simply not set
		// up yet. Only a channel that used to work and then went quiet is news.
		if (!newest) continue;
		const last = newest.serviceDate ?? newest.createdAt;
		if (last >= cutoff) continue;

		stale.push(channelId);

		const tokens = await prisma.pushToken.findMany({
			where: { userId: church.userId },
			select: { id: true, token: true },
		});
		const recipients = distinctRecipients(tokens.map((t) => ({ tokenId: t.id, to: t.token })));
		if (recipients.length === 0) continue;

		const days = Math.floor((Date.now() - last.getTime()) / (24 * 60 * 60 * 1000));
		messages.push({
			recipients,
			title: "No sermon study yet",
			body: `The last study from ${church.name} was ${days} days ago. The service may not have been processed.`,
			data: { type: "sermon-watchdog", channelId },
			channelId: SERMON_CHANNEL_ID,
		});
	}

	if (messages.length > 0) {
		await sendExpoPushMessages(messages, "sermon-watchdog");
	}

	return NextResponse.json({
		checked: churches.length,
		stale: stale.length,
		pushed: messages.length,
	});
}
