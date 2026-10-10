import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ANALYTICS_EVENTS, platformFromHeaders } from "@/lib/analytics/events";
import { captureServerEvent } from "@/lib/analytics/server";
import { z } from "zod";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { webPushConfig } from "@/lib/push";
import { isAllowedWebPushEndpoint, mayRegisterExistingPushToken } from "@/lib/push-routing";
import {
	createPushTokenNonce,
	isValidPushTokenProof,
	pushTokenProof,
	pushTokenProofSecret,
} from "@/lib/push-token-proof";

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
	/**
	 * The device proof this token was given at an earlier registration
	 * (push-token-proof.ts). Native rows only; builds before 2026-10-09 omit it.
	 */
	proof: z.string().max(200).optional(),
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
 * A token another account holds moves only under mayRegisterExistingPushToken:
 * a browser subscription needs its own keys, and a device-bound Expo token
 * needs its device proof, so knowing a token is not enough to take it.
 *
 * Answers `{ id }`, plus `proof` for a native token while the proof feature is
 * on (PUSH_TOKEN_PROOF_SECRET set). The device keeps it and sends it back on
 * every later registration; the first one that does binds the row.
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
		const { token, platform, keys, timezone, notifyHour, enabled, chatReplies, proof } = parsed.data;
		const invalidSubscription = () =>
			NextResponse.json(
				{ error: "Invalid input: a web subscription needs a push service endpoint and its keys." },
				{ status: 400 }
			);
		if (platform === "web" && (!keys || !isAllowedWebPushEndpoint(token))) {
			return invalidSubscription();
		}
		// A browser proves itself with its keys; the device proof is for native
		// tokens only. Null means the feature is off: no proof, no binding, and
		// the nonce is left alone.
		const proofSecret = platform === "web" ? null : pushTokenProofSecret();
		// Expo rows carry no keys; a browser re-subscribing refreshes its own.
		const webKeys =
			platform === "web" && keys
				? { webP256dh: keys.p256dh, webAuth: keys.auth }
				: { webP256dh: null, webAuth: null };
		const settings = {
			platform,
			...webKeys,
			timezone,
			...(notifyHour !== undefined ? { notifyHour } : {}),
			...(chatReplies !== undefined ? { chatReplies } : {}),
		};

		// The decision is made against one read of the row, and the write only
		// lands if the row is still exactly that: a conditional update, or a
		// create that the unique token refuses if someone registered first. An
		// owner binding the row between the read and the write therefore makes
		// a proof-less move miss instead of acting on a stale decision. A miss
		// re-reads and decides again once; a second miss is refused.
		let saved: { id: string; proofNonce: string | null } | null = null;
		for (let attempt = 0; attempt < 2 && !saved; attempt += 1) {
			const stored = await prisma.pushToken.findUnique({
				where: { token },
				select: {
					id: true,
					userId: true,
					platform: true,
					webP256dh: true,
					webAuth: true,
					deviceBound: true,
					proofNonce: true,
				},
			});
			const proofValid = proofSecret
				? isValidPushTokenProof(proofSecret, token, stored?.proofNonce, proof)
				: null;
			// Same answer as a malformed subscription, so a refusal does not confirm
			// that somebody else has registered this token.
			if (stored && !mayRegisterExistingPushToken(stored, { userId, platform, keys, proofValid })) {
				return invalidSubscription();
			}

			if (!stored) {
				const proofNonce = proofSecret ? createPushTokenNonce() : null;
				try {
					const created = await prisma.pushToken.create({
						data: {
							userId,
							token,
							...settings,
							...(enabled !== undefined ? { enabled } : {}),
							deviceBound: false,
							proofNonce,
						},
						select: { id: true },
					});
					saved = { id: created.id, proofNonce };
				} catch (error) {
					// Registered by someone else since the read: decide again.
					if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
						throw error;
					}
				}
				continue;
			}

			// Bound once the device sends its proof back, and never unbound by a
			// registration without it: an old build refreshing its own row must
			// not reopen the row to anyone who knows the token.
			const bindDevice = proofValid === true;
			// A row changing owner without a valid proof gets a new nonce, so
			// every proof handed out for it before stops working. The owner
			// refreshing, or a move that brought the current proof, keeps it, so
			// the device's stored proof stays good.
			const proofNonce =
				stored.userId !== userId && !bindDevice
					? createPushTokenNonce()
					: (stored.proofNonce ?? createPushTokenNonce());
			const updated = await prisma.pushToken.updateMany({
				where: {
					id: stored.id,
					token,
					userId: stored.userId,
					platform: stored.platform,
					webP256dh: stored.webP256dh,
					webAuth: stored.webAuth,
					deviceBound: stored.deviceBound,
					proofNonce: stored.proofNonce,
				},
				data: {
					userId,
					...settings,
					// Registration used to force `enabled: true`, because the only way
					// to turn the morning verse off was to delete the token. The device
					// now stays registered so chat-reply pushes keep working, and the
					// caller says which streams it wants.
					enabled: enabled ?? true,
					...(bindDevice ? { deviceBound: true } : {}),
					...(proofSecret ? { proofNonce } : {}),
				},
			});
			if (updated.count === 1) {
				saved = { id: stored.id, proofNonce: proofSecret ? proofNonce : stored.proofNonce };
			}
		}
		if (!saved) {
			// Two misses in a row are almost always the caller's own concurrent
			// registrations (a launch and a settings change racing). If the row
			// is theirs now, there is nothing to refuse: answer with it as it is.
			const current = await prisma.pushToken.findUnique({
				where: { token },
				select: { id: true, userId: true, proofNonce: true },
			});
			if (current?.userId !== userId) return invalidSubscription();
			saved = { id: current.id, proofNonce: current.proofNonce };
		}

		// Notification opt-in rate, which nothing could report before: the
		// daily verse is the app's only reason to come back on its own, and
		// whether anyone lets it was unmeasured.
		captureServerEvent({
			userId,
			event: ANALYTICS_EVENTS.pushRegistrationChanged,
			platform: platformFromHeaders(req.headers),
			properties: { registered: true, enabled: enabled !== false },
		});
		return NextResponse.json(
			proofSecret && saved.proofNonce
				? { id: saved.id, proof: pushTokenProof(proofSecret, token, saved.proofNonce) }
				: { id: saved.id },
		);
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
