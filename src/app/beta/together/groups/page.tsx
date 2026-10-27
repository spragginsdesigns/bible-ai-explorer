import type { Metadata } from "next";
import { redirect } from "next/navigation";
import GroupsHome from "@/components/beta/groups/GroupsHome";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { listRooms } from "@/lib/beta/rooms/rooms";
import { GROUP_PURPOSE, resolveStudyItem } from "@/lib/beta/groups/groups";
import { isGroupId } from "@/lib/beta/groups/groups-rules";

/**
 * SureWord Groups (LC-17656, docs/beta/groups.md): the groups you are in, and
 * a new one. `?item=<id>` is a Knowledge Vault link to your own copy of
 * something you wrote in a group: it opens the group while you are in it.
 */
type Props = { searchParams: Promise<{ item?: string | string[] }> };

export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "SureWord Groups" });
}

export default async function BetaGroupsPage({ searchParams }: Props) {
	const userId = await requireBetaPage();
	const { item } = await searchParams;
	const fromStudy = isGroupId(item) ? await resolveStudyItem(userId, item) : null;
	if (fromStudy && "href" in fromStudy) redirect(fromStudy.href);
	return <GroupsHome initialGroups={await listRooms(userId, GROUP_PURPOSE)} fromStudy={fromStudy} />;
}
