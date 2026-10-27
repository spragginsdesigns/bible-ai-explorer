import { getAuthUser } from "@/lib/auth";
import { requireBetaApi } from "@/lib/beta/access";
import { projectError, projectJson, readJson } from "@/lib/beta/projects/http";
import { createProject, listProjects } from "@/lib/beta/projects/projects";

/**
 * Study Projects (docs/beta/projects.md): the founder's projects, and a new one.
 * POST body: { title?, description?, cover?, scope: { type: "book", book } | { type: "topic" }, sections?: string[] }
 */
export async function GET() {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		return projectJson({ projects: await listProjects(gate.userId) });
	} catch (error) {
		return projectError(error, "list");
	}
}

export async function POST(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		// The store's rows belong to a User row; a founder's first write creates it like any first write.
		await getAuthUser();
		const project = await createProject(gate.userId, await readJson(req));
		return projectJson({ project }, 201);
	} catch (error) {
		return projectError(error, "create");
	}
}
