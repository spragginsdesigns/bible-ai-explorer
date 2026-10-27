import { getAuthUser } from "@/lib/auth";
import { betaNotFound, requireBetaApi } from "@/lib/beta/access";
import { projectError, projectJson, readJson } from "@/lib/beta/projects/http";
import { addToProject, type AddInput } from "@/lib/beta/projects/projects";

type Context = { params: Promise<{ projectId: string }> };

/**
 * Gather something into a project. Body, by kind:
 * - { kind: "passage", reference: "Romans 5:1-11", origin? }
 * - { kind: "note", noteId }            (a pointer to one of the founder's notes)
 * - { kind: "highlight", book, chapter, verse, translation? }   (a pointer to a highlight)
 * - { kind: "pasted", title, text }
 * - { kind: "question", text, origin?, topics? }
 * 201 { id, duplicate: false }, or 200 { id, duplicate: true } when it was already there.
 */
export async function POST(req: Request, { params }: Context) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		await getAuthUser();
		const { projectId } = await params;
		const body = await readJson(req);
		const kind = body.kind;
		let input: AddInput;
		switch (kind) {
			case "passage":
				input = { kind, reference: String(body.reference ?? ""), origin: typeof body.origin === "string" ? body.origin : undefined };
				break;
			case "note":
				input = { kind, noteId: String(body.noteId ?? "") };
				break;
			case "highlight":
				input = { kind, book: Number(body.book), chapter: Number(body.chapter), verse: Number(body.verse), translation: typeof body.translation === "string" ? body.translation : undefined };
				break;
			case "pasted":
				input = { kind, title: String(body.title ?? ""), text: String(body.text ?? "") };
				break;
			case "question":
				input = {
					kind,
					text: String(body.text ?? ""),
					origin: typeof body.origin === "string" ? body.origin : undefined,
					topics: Array.isArray(body.topics) ? body.topics.filter((topic): topic is string => typeof topic === "string") : undefined,
				};
				break;
			default:
				return projectJson({ error: "Unknown kind of item." }, 400);
		}
		const result = await addToProject(gate.userId, projectId, input);
		if (!result) return betaNotFound();
		return projectJson(result, result.duplicate ? 200 : 201);
	} catch (error) {
		return projectError(error, "add");
	}
}
