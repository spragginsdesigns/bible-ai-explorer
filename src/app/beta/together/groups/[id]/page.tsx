import type { Metadata } from "next";
import { notFound } from "next/navigation";
import GroupScreen from "@/components/beta/groups/GroupScreen";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { getGroupView } from "@/lib/beta/groups/groups";

/**
 * One SureWord Group, for its members (docs/beta/groups.md). A group you are
 * not in is the same 404 as a group that does not exist.
 */
type Props = { params: Promise<{ id: string }> };

export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "SureWord Group" });
}

export default async function BetaGroupPage({ params }: Props) {
	const userId = await requireBetaPage();
	const group = await getGroupView(userId, (await params).id);
	if (!group) notFound();
	return <GroupScreen initialGroup={group} />;
}
