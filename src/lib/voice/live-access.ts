import "server-only";
import { clerkClient } from "@clerk/nextjs/server";

interface VoiceAccount {
	id: string;
	primaryEmailAddressId: string | null;
	emailAddresses: readonly {
		id: string;
		emailAddress: string;
		verification?: { status: string } | null;
	}[];
}

/** Austin's account only. A stored app email or a client claim cannot grant access. */
export function isLiveVoiceOwner(profile: VoiceAccount | null | undefined, userId: string): boolean {
	if (!userId || !profile || profile.id !== userId || !profile.primaryEmailAddressId) return false;
	const primary = profile.emailAddresses.find(address => address.id === profile.primaryEmailAddressId);
	return primary?.verification?.status === "verified"
		&& primary.emailAddress.trim().toLowerCase() === "atmosphere9999@gmail.com";
}

export async function canUseLiveVoice(userId: string): Promise<boolean> {
	if (!userId) return false;
	try {
		const client = await clerkClient();
		return isLiveVoiceOwner(await client.users.getUser(userId), userId);
	} catch {
		// An identity-service failure must never widen a paid feature's access.
		return false;
	}
}
