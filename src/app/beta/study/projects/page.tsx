import type { Metadata } from "next";
import ProjectsHome from "@/components/beta/projects/ProjectsHome";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { listProjects } from "@/lib/beta/projects/projects";

/** Study Projects (LC-17642, docs/beta/projects.md): the founder's study workspaces. */
export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Study Projects" });
}

export default async function BetaStudyProjectsPage() {
	const userId = await requireBetaPage();
	return <ProjectsHome initial={await listProjects(userId)} />;
}
