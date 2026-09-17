import type { MetadataRoute } from "next";

const SITE_URL = "https://sureword.app";

export default function robots(): MetadataRoute.Robots {
	return {
		rules: [
			{
				userAgent: "*",
				// Only the signed-out routes in src/middleware.ts are crawlable.
				// Everything else redirects to sign-in, so crawling it wastes budget.
				allow: ["/", "/privacy", "/terms", "/sign-in", "/sign-up"],
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
