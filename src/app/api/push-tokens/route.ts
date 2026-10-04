import { NextResponse } from "next/server";
import { ANALYTICS_EVENTS, platformFromHeaders } from "@/lib/analytics/events";
import { captureServerEvent } from "@/lib/analytics/server";
import { z } from "zod";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { webPushConfig } from "@/lib/push";
import { isAllowedWebPushEndpoint } from "@/lib/push-routing";

/** Web Push endpoints are URLs from the browser's push service and run long. */
const MAX_TOKEN_LENGTH = 2048;

const registerSchema = z.object({
	/** Expo push token, or the Web Push subscription endpoint for "web". */
	token: z.string().min(1).max(MAX_TOKEN_LENGTH),
	platform: z.enum(["ios", "android", "web"]),
	/** Web Push subscription keys; required for "web", ignored otherwise. */
	keys: z
		.object({
			p256dh: z.string().min(1).max(512),
			auth: z.string().min(1).max(512),
		})
		.optional(),
	timezone: z.string().min(1).max(100),
	notifyHour: z.number().int().min(0).max(23).optional(),
	/** Verse-of-the-day pushes for this device. */
	enabled: z.boolean().optional(),
	/** "Your answer is ready" pushes when a chat answer lands while away. */
	chatReplies: z.boolean().optional(),
});

/**
 * Whether this deploy can send browser notifications, and the VAPID public key
 * a browser subscribes with. Without VAPID keys the web client hides the
 * subscribe controls and explains notifications are unavailable.
 *
 * `seed` is the caller's newest phone registration, so a browser's first
 * settings start from the same morning hour instead of the default. The cron
 * follows a person's newest device, and a browser registering at 8 AM would
 * otherwise move their phone's morning verse too.
 */
export async function GET() {
	const config = webPushConfig();
	if (!config) return NextResponse.json({ status: "unavailable" });

	let seed: { notifyHour: number; enabled: boolean; chatReplies: boolean; updatedAt: string } | null = null;
	try {
		const userId = await getAuthUser();
		const row = await prisma.pushToken.findFirst({
			where: { userId, platform: { not: "web" } },
			orderBy: { updatedAt: "desc" },
			select: { notifyHour: true, enabled: true, chatReplies: true, updatedAt: true },
		});
		// updatedAt lets the browser tell a phone change apart from its own.
		seed = row ? { ...row, updatedAt: row.updatedAt.toISOString() } : null;
	} catch {
		// The seed is a convenience; the key alone is enough to subscribe.
	}
	return NextResponse.json({ status: "ready", publicKey: config.publicKey, seed });
}

/**
 * Register (or refresh) the caller's Expo push token or browser subscription.
 * Upserts by token so a device that changes hands, or re-registers after the
 * app is reinstalled, ends up attached to the current user and re-enabled.
 */
export async function POST(req: Request) {
	try {
		const userId = await getAuthUser();

		const parsed = registerSchema.safeParse(await req.json().catch(() => null));
		if (!parsed.success) {
			return NextResponse.json(
				{ error: "Invalid input: 'token', 'platform' and 'timezone' are required." },
				{ status: 400 }
			);
		}
		const { token, platform, keys, timezone, notifyHour, enabled, chatReplies } = parsed.data;
		if (platform === "web" && (!keys || !isAllowedWebPushEndpoint(token))) {
			return NextResponse.json(
				{ error: "Invalid input: a web subscription needs a push service endpoint and its keys." },
				{ status: 400 }
			);
		}
		// Expo rows carry no keys; a browser re-subscribing refreshes its own.
		const webKeys =
			platform === "web" && keys
				? { webP256dh: keys.p256dh, webAuth: keys.auth }
				: { webP256dh: null, webAuth: null };

		const pushToken = await prisma.pushToken.upsert({
			where: { token },
			update: {
				userId,
				platform,
				...webKeys,
				timezone,
				...(notifyHour !== undefined ? { notifyHour } : {}),
				// Registration used to force `enabled: true`, because the only way
				// to turn the morning verse off was to delete the token. The device
				// now stays registered so chat-reply pushes keep working, and the
				// caller says which streams it wants.
				enabled: enabled ?? true,
				...(chatReplies !== undefined ? { chatReplies } : {}),
			},
			create: {
				userId,
				token,
				platform,
				...webKeys,
				timezone,
				...(notifyHour !== undefined ? { notifyHour } : {}),
				...(enabled !== undefined ? { enabled } : {}),
				...(chatReplies !== undefined ? { chatReplies } : {}),
			},
		});

		// Notification opt-in rate, which nothing could report before: the
		// daily verse is the app's only reason to come back on its own, and
		// whether anyone lets it was unmeasured.
		captureServerEvent({
			userId,
			event: ANALYTICS_EVENTS.pushRegistrationChanged,
			platform: platformFromHeaders(req.headers),
			properties: { registered: true, enabled: enabled !== false },
		});
		return NextResponse.json({ id: pushToken.id });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/push-tokens] POST failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

const unregisterSchema = z.object({
	token: z.string().min(1).max(MAX_TOKEN_LENGTH),
});

/** Unregister a token. deleteMany so a token owned by someone else is a no-op. */
export async function DELETE(req: Request) {
	try {
		const userId = await getAuthUser();

		const parsed = unregisterSchema.safeParse(await req.json().catch(() => null));
		if (!parsed.success) {
			return NextResponse.json({ error: "Invalid input: 'token' is required." }, { status: 400 });
		}

		await prisma.pushToken.deleteMany({ where: { token: parsed.data.token, userId } });

		captureServerEvent({
			userId,
			event: ANALYTICS_EVENTS.pushRegistrationChanged,
			platform: platformFromHeaders(req.headers),
			properties: { registered: false },
		});
		return NextResponse.json({ ok: true });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/push-tokens] DELETE failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
