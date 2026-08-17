import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const registerSchema = z.object({
	token: z.string().min(1).max(255),
	platform: z.enum(["ios", "android"]),
	timezone: z.string().min(1).max(100),
	notifyHour: z.number().int().min(0).max(23).optional(),
});

/**
 * Register (or refresh) the caller's Expo push token. Upserts by token so a
 * device that changes hands, or re-registers after the app is reinstalled,
 * ends up attached to the current user and re-enabled.
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
		const { token, platform, timezone, notifyHour } = parsed.data;

		const pushToken = await prisma.pushToken.upsert({
			where: { token },
			update: {
				userId,
				platform,
				timezone,
				...(notifyHour !== undefined ? { notifyHour } : {}),
				enabled: true,
			},
			create: {
				userId,
				token,
				platform,
				timezone,
				...(notifyHour !== undefined ? { notifyHour } : {}),
			},
		});

		return NextResponse.json({ id: pushToken.id });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/push-tokens] POST failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

const unregisterSchema = z.object({
	token: z.string().min(1).max(255),
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

		return NextResponse.json({ ok: true });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/push-tokens] DELETE failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
