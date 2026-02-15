import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "./prisma";

/**
 * Get the authenticated user's ID and lazily upsert their User record.
 * Call this at the top of every API route that needs auth.
 * Returns the Clerk userId string, or throws a Response with 401.
 */
export async function getAuthUser(): Promise<string> {
	const { userId } = await auth();

	if (!userId) {
		throw new Response(JSON.stringify({ error: "Unauthorized" }), {
			status: 401,
			headers: { "Content-Type": "application/json" },
		});
	}

	// Lazy upsert: create User record if it doesn't exist
	await prisma.user.upsert({
		where: { id: userId },
		update: {},
		create: {
			id: userId,
			email: null,
			name: null,
		},
	});

	return userId;
}

/**
 * Same as getAuthUser but also fetches and syncs email/name from Clerk.
 * Use this on first sign-in or when you need profile data.
 */
export async function getAuthUserWithProfile(): Promise<string> {
	const { userId } = await auth();

	if (!userId) {
		throw new Response(JSON.stringify({ error: "Unauthorized" }), {
			status: 401,
			headers: { "Content-Type": "application/json" },
		});
	}

	const user = await currentUser();

	await prisma.user.upsert({
		where: { id: userId },
		update: {
			email: user?.emailAddresses?.[0]?.emailAddress ?? null,
			name: user?.firstName
				? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ""}`
				: null,
		},
		create: {
			id: userId,
			email: user?.emailAddresses?.[0]?.emailAddress ?? null,
			name: user?.firstName
				? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ""}`
				: null,
		},
	});

	return userId;
}
