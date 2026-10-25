import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ChurchSaveRateLimitError, setUserChurch } from "@/lib/church";
import { PlaceNotFoundError, PlacesNotConfiguredError, searchChurches } from "@/lib/google-places";
import { MAX_ABOUT_ME_LENGTH, MAX_TESTIMONY_LENGTH } from "@/lib/preferences-contract";
import { AgentActionError, executeApprovedAction, type AgentActionContext } from "@/lib/agent-actions";
import { isInitialProfileSaveRequest } from "@/lib/agent-intent";
import {
	APP_TARGETS,
	APP_TARGET_KEYS,
	ONBOARDING_STEPS,
	STEP_CARDS,
	TOUR_STOPS,
	resolveChoiceCard,
	type AppTarget,
} from "@/lib/onboarding-rules";

const targetList = APP_TARGET_KEYS.map((key) => `${key}: ${APP_TARGETS[key]}`).join(" ");

/**
 * The tools behind "Getting to know you", the in-chat onboarding interview
 * (docs/FEATURES.md). Everything they write lands somewhere the person can
 * already see and edit in Settings on every client: About me, My testimony and
 * My church. Facts that fit none of those go through saveMemory.
 *
 * The owner comes only from authenticated server context, never model input.
 */
export function buildOnboardingTools(userId: string, context: AgentActionContext = { userId }) {
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
			if (existing === text.trim()) return { success: true as const };
			const save = async () => {
				const result = await prisma.user.updateMany({ where: { id: userId, [field]: existing || null }, data: { [field]: text } });
				if (result.count !== 1) return { success: false as const, error: "Your profile changed. Read it and prepare the replacement again." };
				return { success: true as const };
			};
			const userText = context.userText?.() ?? "";
			// Tapping "Yes, save it" on the About me card answers that card's own
			// question, so it counts as the explicit ask; no second confirmation.
			const tappedSave = field === "aboutMe" && userText.trim() === STEP_CARDS.aboutMe.options?.[0];
			const explicitInitialSave = !existing && (tappedSave || isInitialProfileSaveRequest(userText, field));
			return await (explicitInitialSave ? save() : executeApprovedAction(context, field === "testimony" ? "saveTestimony" : "saveAboutMe", { text }, save));
		} catch (error) {
			if (error instanceof AgentActionError) return { success: false as const, error: error.message };
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
					if (error instanceof AgentActionError) return { success: false as const, error: error.message };
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
					const church = await executeApprovedAction(context, "setChurch", { placeId }, target => setUserChurch(userId, placeId, { expectedPlaceId: (target as { placeId: string } | null)?.placeId ?? null }));
					return { success: true as const, church: { name: church.name, address: church.address } };
				} catch (error) {
					if (error instanceof AgentActionError) return { success: false as const, error: error.message };
					if (error instanceof PlaceNotFoundError) {
						return { success: false as const, error: "That church id is not valid. Search again with findChurch." };
					}
					if (error instanceof ChurchSaveRateLimitError) return { success: false as const, error: error.message };
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
				"Save the user's testimony (Settings → My testimony) in their own first-person words. An explicit direct request to save their first testimony authorizes that initial save. Otherwise prepare requestActionApproval with this exact text and wait for a clear yes in a later turn. For an EXISTING testimony, always use that exact proposal before replacement and then set replaceExisting: true. Never save a disclosure silently or invent spiritual experiences.",
			inputSchema: z.object({
				text: z.string().trim().min(1).max(MAX_TESTIMONY_LENGTH),
				replaceExisting: z.boolean(),
			}),
			execute: async ({ text, replaceExisting }) => savePersonalText("testimony", text, replaceExisting),
		}),
		saveAboutMe: tool({
			description:
				"Save the user's About me (Settings → About me) in their own first-person words. A direct request to save their first About me authorizes that initial save. For an EXISTING profile, or when agreement is missing, prepare requestActionApproval with the exact text and wait for a clear yes in a later turn. Only then set replaceExisting: true. A how-to question or a wish is not permission to save.",
			inputSchema: z.object({
				text: z.string().trim().min(1).max(MAX_ABOUT_ME_LENGTH),
				replaceExisting: z.boolean(),
			}),
			execute: async ({ text, replaceExisting }) => savePersonalText("aboutMe", text, replaceExisting),
		}),
		presentChoices: tool({
			description:
				"Put big tap-to-answer buttons under your message, so they can answer with one tap instead of typing. Use it for every getting-to-know-you question, naming the step; the app fills in the scripted question and the fixed answers for each step, so keep your own text to a sentence or two and do not repeat the question in it. Step \"name\": options is one prefilled answer such as \"Call me Kim\" from the first name you know (or none). Step \"other\": any other question with two to six short answers you write. The tapped answer comes back to you as their next message. At most one per message, and always last.",
			inputSchema: z.object({
				step: z.enum(ONBOARDING_STEPS),
				question: z.string().trim().max(300).nullable(),
				options: z.array(z.string().trim().min(1).max(80)).max(6).nullable(),
				allowOther: z.boolean().nullable(),
			}),
			execute: async (input) => resolveChoiceCard(input),
		}),
		showInApp: tool({
			description: `Light up a part of the app on their screen: a "Show me" card under your message that takes them there and spotlights it with your caption. Use it whenever they ask how to do something or where something is, and when the welcome reaches a feature. One short caption in your own voice, under 140 characters. Targets: ${targetList}`,
			inputSchema: z.object({
				target: z.enum(APP_TARGET_KEYS as [AppTarget, ...AppTarget[]]),
				caption: z.string().trim().min(1).max(200),
			}),
			execute: async ({ target, caption }) => ({
				target,
				caption,
				...(target === "tour" ? { stops: TOUR_STOPS.map((stop) => ({ ...stop })) } : {}),
			}),
		}),
		finishOnboarding: tool({
			description:
				"End the getting-to-know-you welcome: outcome \"completed\" once you have covered the steps and saved what they shared, or \"skipped\" when they say they would rather not do it now (or skipped every step). Afterwards the welcome no longer runs in their chats; they can pick it up again from Settings with Walk me through SureWord.",
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
