import { buildPrivacyMarkdown } from "@/lib/marketing/markdown-pages";

// Markdown twin of /privacy, rendered from the same legal-content.ts source.
export const revalidate = 3600;

export function GET(): Response {
	return new Response(buildPrivacyMarkdown(), {
		headers: { "Content-Type": "text/markdown; charset=utf-8" },
	});
}
