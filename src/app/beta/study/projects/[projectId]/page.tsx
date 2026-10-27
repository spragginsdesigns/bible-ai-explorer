import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ProjectWorkspace from "@/components/beta/projects/ProjectWorkspace";
import { betaMetadata, currentBetaUserId, requireBetaPage } from "@/lib/beta/access";
import { loadProject, projectView } from "@/lib/beta/projects/projects";

type Props = { params: Promise<{ projectId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const { projectId } = await params;
	const userId = await currentBetaUserId();
	const project = userId ? await loadProject(userId, projectId) : null;
	return betaMetadata({ title: project?.item.title ?? "Study Projects" });
}

/** One study project's workspace. Someone else's project, or no project, is the ordinary 404. */
export default async function BetaStudyProjectPage({ params }: Props) {
	const userId = await requireBetaPage();
	const { projectId } = await params;
	const project = await projectView(userId, projectId);
	if (!project) notFound();
	return <ProjectWorkspace initial={project} />;
}
