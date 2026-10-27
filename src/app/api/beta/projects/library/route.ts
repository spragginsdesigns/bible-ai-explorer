import { requireBetaApi } from "@/lib/beta/access";
import { projectError, projectJson } from "@/lib/beta/projects/http";
import { highlightChoices, noteChoices } from "@/lib/beta/projects/projects";

/**
 * What a founder can point a project at: their notes (?type=notes&q=) and
 * their highlights (?type=highlights&book=, that book's first). Read only.
 */
export async function GET(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const { searchParams } = new URL(req.url);
		const type = searchParams.get("type");
		if (type === "notes") return projectJson({ notes: await noteChoices(gate.userId, searchParams.get("q") ?? "") });
		if (type === "highlights") {
			const book = Number(searchParams.get("book"));
			return projectJson({ highlights: await highlightChoices(gate.userId, Number.isInteger(book) && book >= 1 && book <= 66 ? book : null) });
		}
		return projectJson({ error: "type must be notes or highlights" }, 400);
	} catch (error) {
		return projectError(error, "library");
	}
}
