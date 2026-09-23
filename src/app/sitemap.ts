import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { sharedAnswerUrl } from "@/lib/shared-answer";

const SITE_URL = "https://sureword.app";

// Fixed so the sitemap is byte-identical between builds. Bump it by hand when
// the public marketing copy actually changes; a build-time `new Date()` would
// tell crawlers every page changed on every deploy.
const LAST_MODIFIED = new Date("2026-09-17T00:00:00.000Z");

// Regenerated at most hourly: a newly listed answer does not need to reach
// crawlers faster than that, and the query should not run per crawler hit.
export const revalidate = 3600;

// Search engines cap a sitemap at 50,000 URLs; far past anything real here.
const MAX_LISTED_ANSWERS = 45000;

/**
 * Shared answers whose owner turned on "Show in search". A database failure
 * drops them from this one response rather than failing the whole sitemap,
 * because the marketing pages must stay listed either way.
 */
async function listedSharedAnswers(): Promise<MetadataRoute.Sitemap> {
	try {
		const rows = await prisma.sharedAnswer.findMany({
			where: { listedAt: { not: null }, revokedAt: null },
			orderBy: { listedAt: "desc" },
			take: MAX_LISTED_ANSWERS,
			select: { id: true, listedAt: true },
		});
		return rows.map((row) => ({
			url: sharedAnswerUrl(row.id, SITE_URL),
			lastModified: row.listedAt ?? undefined,
			changeFrequency: "yearly" as const,
			priority: 0.5,
		}));
	} catch (error) {
		console.error("Sitemap shared answers failed:", error);
		return [];
	}
}

// Only pages that are indexable and canonical to themselves belong here.
// /sign-in and /sign-up are noindex, so listing them would be a contradiction
// Search Console reports as an error. Unlisted shared answers are noindex for
// the same reason, so only listed ones appear.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
	return [
		{
			url: SITE_URL,
			lastModified: LAST_MODIFIED,
			changeFrequency: "weekly",
			priority: 1,
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
		...(await listedSharedAnswers()),
	];
}
