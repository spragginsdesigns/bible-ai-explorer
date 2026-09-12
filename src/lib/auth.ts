import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { prisma } from "./prisma";

export interface StoredProfile {
	name: string | null;
	email: string | null;
}

/**
 * How long one instance waits before asking Clerk again about an account whose
 * profile could not be completed (no first name in Clerk, or the call failed).
 * Without it, such an account would cost a Clerk call on every chat turn.
 */
const PROFILE_SYNC_RETRY_MS = 6 * 60 * 60 * 1000;
const PROFILE_SYNC_MEMO_LIMIT = 1_000;
const profileSyncAttempts = new Map<string, number>();

/**
 * Fill `User.name` and `User.email` from Clerk where they are still empty.
 *
 * Most rows were created by `ensureUserRecord`, which knows only the Clerk id,
 * so the columns are blank for almost every account even though Clerk has the
 * name Google gave it. This is the guarded form of the Listen devotional's own
 * sync, not `getAuthUserWithProfile`: it never overwrites a stored value, never
 * writes null, and the conditional `updateMany` keeps a concurrent write that
 * landed first. The name uses the same "First Last" shape as that sync. Only a
 * verified primary address is stored as the email, the same rule the legacy
 * account claim above applies.
 *
 * Returns the profile as it now stands. Never throws.
 */
export async function syncProfileFromClerk(
	userId: string,
	stored: StoredProfile,
): Promise<StoredProfile> {
	if (stored.name && stored.email) return stored;
	const lastAttempt = profileSyncAttempts.get(userId);
	if (lastAttempt !== undefined && Date.now() - lastAttempt < PROFILE_SYNC_RETRY_MS) return stored;
	if (profileSyncAttempts.size >= PROFILE_SYNC_MEMO_LIMIT) profileSyncAttempts.clear();
	profileSyncAttempts.set(userId, Date.now());

	try {
		const clerk = await clerkClient();
		const profile = await clerk.users.getUser(userId);
		const name = profile.firstName
			? `${profile.firstName}${profile.lastName ? ` ${profile.lastName}` : ""}`
			: null;
		const primary =
			profile.emailAddresses.find((address) => address.id === profile.primaryEmailAddressId) ??
			profile.emailAddresses[0];
		const email =
			primary && primary.verification?.status === "verified"
				? primary.emailAddress.toLowerCase()
				: null;

		const writes: Promise<unknown>[] = [];
		if (!stored.name && name) {
			writes.push(prisma.user.updateMany({ where: { id: userId, name: null }, data: { name } }));
		}
		if (!stored.email && email) {
			writes.push(prisma.user.updateMany({ where: { id: userId, email: null }, data: { email } }));
		}
		await Promise.all(writes);

		const synced = { name: stored.name ?? name, email: stored.email ?? email };
		if (synced.name && synced.email) profileSyncAttempts.delete(userId);
		return synced;
	} catch (error) {
		console.error("Clerk profile sync failed:", error);
		return stored;
	}
}

/**
 * Re-attach a returning user's data after the move from the development Clerk
 * instance to the production one.
 *
 * The two instances have separate user pools and User.id IS the Clerk id, so a
 * pre-existing user signing in to production arrives with a brand new id and no
 * data. LegacyClerkAccount maps their verified email to the id they had before;
 * re-keying User.id carries every conversation, note, tag and memory across,
 * because all foreign keys to User are ON UPDATE CASCADE.
 *
 * Matching is only ever done on a VERIFIED email. An unverified match would let
 * anyone claim another person's account by signing up with their address.
 *
 * Returns true if a legacy account was adopted.
 */
async function claimLegacyAccount(newUserId: string): Promise<boolean> {
	try {
		const user = await currentUser();
		const primary =
			user?.emailAddresses?.find((e) => e.id === user.primaryEmailAddressId) ??
			user?.emailAddresses?.[0];
		if (!primary || primary.verification?.status !== "verified") return false;

		const email = primary.emailAddress.toLowerCase();
		const legacy = await prisma.legacyClerkAccount.findUnique({ where: { email } });
		if (!legacy || legacy.claimedAt) return false;

		await prisma.$transaction(async (tx) => {
			// Conditional update first: if a concurrent request already claimed this
			// mapping, count is 0 and we leave without touching anything. A failure
			// in the re-key below rolls the claim back with it, so the mapping is
			// never consumed without the data actually moving.
			const claimed = await tx.legacyClerkAccount.updateMany({
				where: { email, claimedAt: null },
				data: { claimedAt: new Date(), claimedByUserId: newUserId },
			});
			if (claimed.count === 0) return;

			await tx.user.update({
				where: { id: legacy.legacyUserId },
				data: { id: newUserId, email },
			});
		});

		return true;
	} catch (error) {
		// Never block sign-in on this. Worst case the user starts fresh and the
		// mapping stays unclaimed, so the next request retries.
		console.error("Legacy account claim failed:", error);
		return false;
	}
}

/**
 * Ensure the User row for this Clerk id exists, adopting a pre-migration
 * account first if one matches. Returns without a query beyond the existence
 * check for everybody who already has a row, which is the steady state.
 */
async function ensureUserRecord(userId: string): Promise<void> {
	const existing = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
	if (existing) return;

	if (await claimLegacyAccount(userId)) return;

	await prisma.user.upsert({
		where: { id: userId },
		update: {},
		create: { id: userId, email: null, name: null },
	});
}

/**
 * Auth-only check for read routes: verifies the session and returns the Clerk
 * userId. Reads still run the account-adoption check, because on the first
 * production sign-in the very first request is usually a GET (loading
 * conversations or notes) - skipping it there would show a returning user an
 * empty app until they happened to write something.
 *
 * Steady state is one indexed primary-key lookup; the Clerk profile fetch and
 * the mapping query only happen when no User row exists yet.
 */
export async function getAuthUserId(): Promise<string> {
	const { userId } = await auth();

	if (!userId) {
		throw new Response(JSON.stringify({ error: "Unauthorized", code: "unauthorized" }), {
			status: 401,
			headers: { "Content-Type": "application/json" },
		});
	}

	await ensureUserRecord(userId);

	return userId;
}

/**
 * Get the authenticated user's ID and lazily upsert their User record.
 * Call this at the top of every mutating API route that needs auth.
 * Returns the Clerk userId string, or throws a Response with 401.
 */
export async function getAuthUser(): Promise<string> {
	const { userId } = await auth();

	if (!userId) {
		throw new Response(JSON.stringify({ error: "Unauthorized", code: "unauthorized" }), {
			status: 401,
			headers: { "Content-Type": "application/json" },
		});
	}

	await ensureUserRecord(userId);

	return userId;
}

/**
 * Same as getAuthUser but also fetches and syncs email/name from Clerk.
 * Use this on first sign-in or when you need profile data.
 */
export async function getAuthUserWithProfile(): Promise<string> {
	const { userId } = await auth();

	if (!userId) {
		throw new Response(JSON.stringify({ error: "Unauthorized", code: "unauthorized" }), {
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
