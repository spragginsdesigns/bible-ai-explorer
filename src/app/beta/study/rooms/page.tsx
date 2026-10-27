import type { Metadata } from "next";
import RoomsHome from "@/components/beta/rooms/RoomsHome";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { listRooms } from "@/lib/beta/rooms/rooms";

/** Study Rooms (LC-17647, docs/beta/rooms.md): the rooms you are in, and a new one. */
export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Study Rooms" });
}

export default async function BetaStudyRoomsPage() {
	const userId = await requireBetaPage();
	return <RoomsHome initialRooms={await listRooms(userId)} />;
}
