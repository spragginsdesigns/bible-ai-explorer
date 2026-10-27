import { betaNotFound, requireBetaApi } from "@/lib/beta/access";
import { projectError, projectJson, readJson } from "@/lib/beta/projects/http";
import { deleteProject, projectView, updateProject, type ProjectPatch } from "@/lib/beta/projects/projects";
import type { SectionChange } from "@/lib/beta/projects/projects-rules";

type Context = { params: Promise<{ projectId: string }> };

/** One project with everything gathered in it. */
export async function GET(_req: Request, { params }: Context) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { projectId } = await params;
		const project = await projectView(gate.userId, projectId);
		return project ? projectJson({ project }) : betaNotFound();
	} catch (error) {
		return projectError(error, "read");
	}
}

function sectionChange(raw: unknown): SectionChange | undefined {
	if (typeof raw !== "object" || raw === null) return undefined;
	const value = raw as Record<string, unknown>;
	switch (value.op) {
		case "done":
			return { op: "done", id: String(value.id ?? ""), done: value.done === true };
		case "add":
			return { op: "add", title: String(value.title ?? ""), ref: typeof value.ref === "string" ? value.ref : null };
		case "rename":
			return { op: "rename", id: String(value.id ?? ""), title: String(value.title ?? "") };
		case "remove":
			return { op: "remove", id: String(value.id ?? "") };
		default:
			return undefined;
	}
}

/**
 * Rename, describe, change the cover, archive or restore, or change one
 * section. Body: { title?, description?, cover?, archived?, section?: { op, ... } }
 */
export async function PATCH(req: Request, { params }: Context) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { projectId } = await params;
		const body = await readJson(req);
		const patch: ProjectPatch = {
			...(body.title !== undefined && { title: body.title }),
			...(body.description !== undefined && { description: body.description }),
			...(body.cover !== undefined && { cover: body.cover }),
			...(body.archived !== undefined && { archived: body.archived }),
		};
		if (body.section !== undefined) {
			const change = sectionChange(body.section);
			if (!change) return projectJson({ error: "Unknown section change." }, 400);
			patch.section = change;
		}
		const project = await updateProject(gate.userId, projectId, patch);
		return project ? projectJson({ project }) : betaNotFound();
	} catch (error) {
		return projectError(error, "update");
	}
}

/** Deletes the project and everything gathered in it; the notes it pointed at stay in Notes. */
export async function DELETE(_req: Request, { params }: Context) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { projectId } = await params;
		return (await deleteProject(gate.userId, projectId)) ? projectJson({ deleted: true }) : betaNotFound();
	} catch (error) {
		return projectError(error, "delete");
	}
}
