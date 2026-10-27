import type { Metadata } from "next";
import { redirect } from "next/navigation";
import JoinRoom from "@/components/beta/rooms/JoinRoom";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { previewInvite } from "@/lib/beta/rooms/rooms";

/**
 * Where an invite link lands (docs/beta/rooms.md). Only BETA_USER_IDS get this
 * far; a link that was turned off or replaced says so instead of joining.
 */
type Props = { params: Promise<{ token: string }> };

export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Join a Study Room", robots: { index: false, follow: false, nocache: true } });
}

export default async function BetaJoinRoomPage({ params }: Props) {
	const userId = await requireBetaPage();
	const { token } = await params;
	const invite = await previewInvite(userId, token);
	if (invite?.memberOfRoomId) redirect(`/beta/study/rooms/${invite.memberOfRoomId}`);
	return <JoinRoom token={token} invite={invite} />;
}
