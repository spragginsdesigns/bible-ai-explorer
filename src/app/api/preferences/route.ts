import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, getAuthUserId } from "@/lib/auth";
import { parseUserIdAllowlist, resolvePlan } from "@/lib/entitlements-rules";
import { parsePreferencesPatch, toPreferencesDocument } from "@/lib/preferences-contract";
import type { ModelVocabulary } from "@/lib/preferences-contract";
import {
	REASONING_EFFORTS,
	REASONING_MODES,
	resolveDefinition,
	SPEEDS,
	VERBOSITIES,
} from "@/lib/ai/models";

/**
 * The account preferences document, and the single place any client writes to
 * it: the Bible translation, the parchment page style, the Listen playback
 * speed, the Web Search and Memory toggles, and the chat picker's stored model
 * and run options. The server row is the source of truth; every client keeps
 * its local store only as a first-paint cache and re-hydrates from here.
 *
 * PATCH takes any subset and returns the whole document, so a client never has
 * to guess what the write produced. Validation is pure and lives in
 * src/lib/preferences-contract.ts; it runs before any write, so a body with one
 * bad field changes nothing.
 *
 * Two things deliberately stay where they are: PATCH /api/memories still
 * toggles memory (it ships with the memory list), and the chat route still
 * persists the model pick on send. Both write the same columns.
 *
 * `plan` is read-only - nothing a client sends can change a tier.
 */
/**
 * The registry, in the shape the pure validator takes. It is passed in rather
 * than imported there so the validator stays loadable by the logic test suite.
 */
const MODEL_VOCABULARY: ModelVocabulary = {
	knowsModel: (modelId) => resolveDefinition(modelId) !== undefined,
	efforts: REASONING_EFFORTS,
	speeds: SPEEDS,
	verbosities: VERBOSITIES,
	modes: REASONING_MODES,
};

const PREFERENCE_SELECT = {
	webSearchEnabled: true,
	memoryEnabled: true,
	translation: true,
	parchment: true,
	listenRate: true,
	defaultModelId: true,
	defaultEffort: true,
	defaultSpeed: true,
	defaultVerbosity: true,
	defaultMode: true,
	plan: true,
} as const;

export async function GET() {
	try {
		const userId = await getAuthUserId();
		const user = await prisma.user.findUnique({
			where: { id: userId },
			select: PREFERENCE_SELECT,
		});
		const plan = resolvePlan({
			plan: user?.plan ?? null,
			userId,
			allowlist: parseUserIdAllowlist(process.env.PRO_USER_IDS),
		});
		return NextResponse.json(toPreferencesDocument(user, plan, MODEL_VOCABULARY));
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("[api/preferences] GET failed", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/** Write any subset of the document; the response is the whole thing. */
export async function PATCH(req: Request) {
	try {
		const userId = await getAuthUser();
		const body: unknown = await req.json().catch(() => null);
		const parsed = parsePreferencesPatch(body, MODEL_VOCABULARY);
		if (!parsed.ok) {
			return NextResponse.json({ error: parsed.error }, { status: 400 });
		}
		const user = await prisma.user.update({
			where: { id: userId },
			data: parsed.data,
			select: PREFERENCE_SELECT,
		});
		const plan = resolvePlan({
			plan: user.plan,
			userId,
			allowlist: parseUserIdAllowlist(process.env.PRO_USER_IDS),
		});
		return NextResponse.json(toPreferencesDocument(user, plan, MODEL_VOCABULARY));
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("[api/preferences] PATCH failed", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
