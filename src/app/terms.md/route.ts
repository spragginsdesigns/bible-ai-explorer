import { buildTermsMarkdown } from "@/lib/marketing/markdown-pages";

// Markdown twin of /terms, rendered from the same legal-content.ts source.
export const revalidate = 3600;

export function GET(): Response {
	return new Response(buildTermsMarkdown(), {
		headers: { "Content-Type": "text/markdown; charset=utf-8" },
	});
}
