import type { Metadata } from "next";
import { redirect } from "next/navigation";
import JoinRoom from "@/components/beta/rooms/JoinRoom";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { previewInvite } from "@/lib/beta/rooms/rooms";
import { FAMILY_PURPOSE } from "@/lib/beta/family/family";

/**
 * Where a family's invite link lands: Study Rooms' own join page, for a family
 * (docs/beta/family.md). Only BETA_USER_IDS get this far.
 */
type Props = { params: Promise<{ token: string }> };

export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Join a family on SureWord", robots: { index: false, follow: false, nocache: true } });
}

export default async function BetaJoinFamilyPage({ params }: Props) {
	const userId = await requireBetaPage();
	const { token } = await params;
	const invite = await previewInvite(userId, token, new Date(), FAMILY_PURPOSE);
	if (invite?.memberOfRoomId) redirect(`/beta/together/family/${invite.memberOfRoomId}`);
	return <JoinRoom token={token} invite={invite} purpose={FAMILY_PURPOSE} />;
}
