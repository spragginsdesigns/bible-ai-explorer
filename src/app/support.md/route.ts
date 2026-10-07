import { buildSupportMarkdown } from "@/lib/marketing/markdown-pages";

// Markdown twin of /support, rendered from the same legal-content.ts source.
export const revalidate = 3600;

export function GET(): Response {
	return new Response(buildSupportMarkdown(), {
		headers: { "Content-Type": "text/markdown; charset=utf-8" },
	});
}
