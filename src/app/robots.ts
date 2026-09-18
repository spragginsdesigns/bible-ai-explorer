import type { MetadataRoute } from "next";

const SITE_URL = "https://sureword.app";

export default function robots(): MetadataRoute.Robots {
	return {
		rules: [
			{
				userAgent: "*",
				// Only the signed-out routes in src/middleware.ts are crawlable.
				// Everything else redirects to sign-in, so crawling it wastes budget.
				// The AI summary and markdown twins are listed explicitly so no
				// crawler has to infer them from "/".
				allow: [
					"/",
					"/privacy",
					"/terms",
					"/sign-in",
					"/sign-up",
					"/llms.txt",
					"/index.md",
					"/privacy.md",
					"/terms.md",
				],
				disallow: [
					"/api/",
					"/settings",
					"/notes",
					"/bible",
					"/cross",
					"/membership",
					"/shared/",
				],
			},
		],
		sitemap: `${SITE_URL}/sitemap.xml`,
		host: SITE_URL,
	};
}
