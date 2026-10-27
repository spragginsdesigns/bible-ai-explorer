import type { Metadata } from "next";
import { notFound } from "next/navigation";
import RoomScreen from "@/components/beta/rooms/RoomScreen";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { getRoomView } from "@/lib/beta/rooms/rooms";

/**
 * One Study Room, for its members (docs/beta/rooms.md). A room you are not in
 * is the same 404 as a room that does not exist.
 */
type Props = { params: Promise<{ id: string }> };

export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Study Room" });
}

export default async function BetaStudyRoomPage({ params }: Props) {
	const userId = await requireBetaPage();
	const room = await getRoomView(userId, (await params).id);
	if (!room) notFound();
	return <RoomScreen initialRoom={room} />;
}
