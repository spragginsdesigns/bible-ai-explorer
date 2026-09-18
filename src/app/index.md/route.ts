import { buildIndexMarkdown } from "@/lib/marketing/markdown-pages";

// Markdown twin of the landing page (llmstxt.org: the root's twin is /index.md).
export const revalidate = 3600;

export function GET(): Response {
	return new Response(buildIndexMarkdown(), {
		headers: { "Content-Type": "text/markdown; charset=utf-8" },
	});
}
