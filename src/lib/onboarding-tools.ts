import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { setUserChurch } from "@/lib/church";
import { PlaceNotFoundError, PlacesNotConfiguredError, searchChurches } from "@/lib/google-places";
import { MAX_ABOUT_ME_LENGTH, MAX_TESTIMONY_LENGTH } from "@/lib/preferences-contract";

/**
 * The tools behind "Getting to know you", the in-chat onboarding interview
 * (docs/FEATURES.md). Everything they write lands somewhere the person can
 * already see and edit in Settings on every client: About me, My testimony and
 * My church. Facts that fit none of those go through saveMemory.
 *
 * The owner comes only from authenticated server context, never model input.
 */
export function buildOnboardingTools(userId: string) {
	/** About me and testimony are the person's own words: never overwrite silently. */
	async function savePersonalText(
		field: "aboutMe" | "testimony",
		text: string,
		replaceExisting: boolean,
	) {
		try {
			const user = await prisma.user.findUnique({ where: { id: userId }, select: { [field]: true } });
			const existing = typeof user?.[field] === "string" ? (user[field] as string).trim() : "";
			if (existing && !replaceExisting) {
				return {
					success: false as const,
					error: "They already wrote one. Show it to them and save only if they ask you to replace it.",
					existing,
				};
			}
			await prisma.user.update({ where: { id: userId }, data: { [field]: text } });
			return { success: true as const };
		} catch (error) {
			console.error(`[onboarding] saving ${field} failed:`, error);
			return { success: false as const, error: "Saving failed. Nothing was changed. Try again." };
		}
	}

	return {
		findChurch: tool({
			description:
				"Search Google Places for the user's home church by name and city. Use it when they tell you where they worship, then show them the matches and ask which one is theirs. Never save a church from this alone.",
			inputSchema: z.object({ query: z.string().trim().min(2).max(120) }),
			execute: async ({ query }) => {
				try {
					const churches = await searchChurches(query);
					return {
						success: true as const,
						churches: churches.map(({ placeId, name, address }) => ({ placeId, name, address })),
					};
				} catch (error) {
					if (error instanceof PlacesNotConfiguredError) {
						return { success: false as const, error: "Church lookup is unavailable right now. Save the church they named as a profile memory instead." };
					}
					console.error("[onboarding] findChurch failed:", error);
					return { success: false as const, error: "Church lookup failed. Try a different name or city." };
				}
			},
		}),
		setChurch: tool({
			description:
				"Save the user's home church (Settings → My church) from a placeId that findChurch returned, only after they have confirmed which result is theirs. Replaces any church already saved.",
			inputSchema: z.object({ placeId: z.string().trim().min(1).max(300) }),
			execute: async ({ placeId }) => {
				try {
					const church = await setUserChurch(userId, placeId);
					return { success: true as const, church: { name: church.name, address: church.address } };
				} catch (error) {
					if (error instanceof PlaceNotFoundError) {
						return { success: false as const, error: "That church id is not valid. Search again with findChurch." };
					}
					if (error instanceof PlacesNotConfiguredError) {
						return { success: false as const, error: "Church lookup is unavailable right now. Save the church they named as a profile memory instead." };
					}
					console.error("[onboarding] setChurch failed:", error);
					return { success: false as const, error: "Saving the church failed. Nothing was changed." };
				}
			},
		}),
		saveTestimony: tool({
			description:
				"Save the user's testimony (Settings → My testimony): how they came to faith in Jesus Christ, written in the first person from what they told you, keeping their own words. Only after they agree to it being saved. Set replaceExisting only when they asked to replace the one already there.",
			inputSchema: z.object({
				text: z.string().trim().min(1).max(MAX_TESTIMONY_LENGTH),
				replaceExisting: z.boolean(),
			}),
			execute: async ({ text, replaceExisting }) => savePersonalText("testimony", text, replaceExisting),
		}),
		saveAboutMe: tool({
			description:
				"Save the user's About me (Settings → About me): a short first-person portrait built from what they told you, which they can edit later. Only after they agree to it. Set replaceExisting only when they asked to replace the one already there.",
			inputSchema: z.object({
				text: z.string().trim().min(1).max(MAX_ABOUT_ME_LENGTH),
				replaceExisting: z.boolean(),
			}),
			execute: async ({ text, replaceExisting }) => savePersonalText("aboutMe", text, replaceExisting),
		}),
		finishOnboarding: tool({
			description:
				"End the getting-to-know-you interview: outcome \"completed\" once you have covered the topics and saved what they shared, or \"skipped\" when they say they would rather not do it now. Afterwards the interview no longer runs in their chats.",
			inputSchema: z.object({ outcome: z.enum(["completed", "skipped"]) }),
			execute: async ({ outcome }) => {
				try {
					await prisma.user.update({ where: { id: userId }, data: { onboardedAt: new Date() } });
					return { success: true as const, outcome };
				} catch (error) {
					console.error("[onboarding] finishOnboarding failed:", error);
					return { success: false as const, error: "Could not record that. Try again." };
				}
			},
		}),
	};
}
