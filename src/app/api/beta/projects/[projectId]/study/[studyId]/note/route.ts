import { betaNotFound, requireBetaApi } from "@/lib/beta/access";
import { projectError, projectJson } from "@/lib/beta/projects/http";
import { saveStudyAsNote } from "@/lib/beta/projects/projects";

type Context = { params: Promise<{ projectId: string; studyId: string }> };

/**
 * Keep an assembled study as a Note, through the same pipe as "Add to notes"
 * (appendMarkdownToNote), stored exactly as assembled. Saving twice opens the
 * same note instead of making a second one.
 */
export async function POST(_req: Request, { params }: Context) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { projectId, studyId } = await params;
		const saved = await saveStudyAsNote(gate.userId, projectId, studyId);
		return saved ? projectJson(saved, saved.created ? 201 : 200) : betaNotFound();
	} catch (error) {
		return projectError(error, "save note");
	}
}
