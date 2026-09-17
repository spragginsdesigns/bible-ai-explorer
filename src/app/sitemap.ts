import type { MetadataRoute } from "next";

const SITE_URL = "https://sureword.app";

// Fixed so the sitemap is byte-identical between builds. Bump it by hand when
// the public marketing copy actually changes; a build-time `new Date()` would
// tell crawlers every page changed on every deploy.
const LAST_MODIFIED = new Date("2026-09-17T00:00:00.000Z");

export default function sitemap(): MetadataRoute.Sitemap {
	return [
		{
			url: SITE_URL,
			lastModified: LAST_MODIFIED,
			changeFrequency: "weekly",
			priority: 1,
		},
		{
			url: `${SITE_URL}/sign-up`,
			lastModified: LAST_MODIFIED,
			changeFrequency: "monthly",
			priority: 0.5,
		},
		{
			url: `${SITE_URL}/sign-in`,
			lastModified: LAST_MODIFIED,
			changeFrequency: "monthly",
			priority: 0.5,
		},
		{
			url: `${SITE_URL}/privacy`,
			lastModified: LAST_MODIFIED,
			changeFrequency: "monthly",
			priority: 0.3,
		},
		{
			url: `${SITE_URL}/terms`,
			lastModified: LAST_MODIFIED,
			changeFrequency: "monthly",
			priority: 0.3,
		},
	];
}
