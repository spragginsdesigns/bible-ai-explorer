import type { Metadata } from "next";
import { redirect } from "next/navigation";
import JoinRoom from "@/components/beta/rooms/JoinRoom";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { previewInvite } from "@/lib/beta/rooms/rooms";
import { GROUP_PURPOSE } from "@/lib/beta/groups/groups";

/**
 * Where a group's invite link lands: Study Rooms' own join page, for a group
 * (docs/beta/groups.md). Only BETA_USER_IDS get this far.
 */
type Props = { params: Promise<{ token: string }> };

export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Join a SureWord Group", robots: { index: false, follow: false, nocache: true } });
}

export default async function BetaJoinGroupPage({ params }: Props) {
	const userId = await requireBetaPage();
	const { token } = await params;
	const invite = await previewInvite(userId, token, new Date(), GROUP_PURPOSE);
	if (invite?.memberOfRoomId) redirect(`/beta/together/groups/${invite.memberOfRoomId}`);
	return <JoinRoom token={token} invite={invite} purpose={GROUP_PURPOSE} />;
}
