import { getAuthUser } from "@/lib/auth";
import { betaNotFound, requireBetaApi } from "@/lib/beta/access";
import { extractUpload, UPLOAD_MAX_BYTES, UploadError } from "@/lib/beta/projects/extract";
import { projectError, projectJson } from "@/lib/beta/projects/http";
import { assertRoom, createSourceText, loadProject, touchProject } from "@/lib/beta/projects/projects";

export const maxDuration = 60;

type Context = { params: Promise<{ projectId: string }> };

/**
 * Upload a PDF or a .txt/.md file as a source (multipart form, field "file").
 * Its text is extracted here on the server and kept as the source; the file
 * itself is not stored.
 */
export async function POST(req: Request, { params }: Context) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		await getAuthUser();
		const { projectId } = await params;
		const project = await loadProject(gate.userId, projectId);
		if (!project) return betaNotFound();
		await assertRoom(gate.userId, projectId);
		const declared = Number(req.headers.get("content-length") ?? "0");
		if (declared > UPLOAD_MAX_BYTES + 64 * 1024) throw new UploadError("Upload a file up to 4 MB.");
		const form = await req.formData().catch(() => null);
		const file = form?.get("file");
		if (!file || typeof file === "string") throw new UploadError("Choose a file to upload.");
		const bytes = new Uint8Array(await file.arrayBuffer());
		const extracted = await extractUpload({ name: file.name, type: file.type, size: file.size, bytes });
		const item = await createSourceText(gate.userId, projectId, {
			title: extracted.title,
			text: extracted.text,
			truncated: extracted.truncated,
			type: "upload",
			fileName: file.name.slice(0, 200),
			mediaType: file.type || undefined,
			size: file.size,
			pages: extracted.pages,
		}, project.item.topics);
		await touchProject(gate.userId, projectId);
		return projectJson({ id: item.id, title: extracted.title, chars: extracted.text.length, pages: extracted.pages, truncated: extracted.truncated }, 201);
	} catch (error) {
		return projectError(error, "upload");
	}
}
