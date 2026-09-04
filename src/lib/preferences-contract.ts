/**
 * Pure rules for the account preferences document that every client syncs
 * against (`GET`/`PATCH /api/preferences`).
 *
 * It lives apart from the route for the same reason `entitlements-rules.ts`
 * lives apart from `entitlements.ts`: the route needs Prisma and Clerk, while
 * the part worth testing directly is the validation - one bad field in a PATCH
 * body must write nothing, and a stale value in the database must degrade to
 * "never chosen" rather than reach a provider.
 *
 * The module holds no runtime imports so `tests/preferences-contract.test.mjs`
 * can load it under `node --test` (every module the logic suite loads is
 * import-free; Node's ESM resolver has no extensionless or `@/` resolution).
 * The chat vocabularies therefore arrive as a `ModelVocabulary` the caller
 * builds from `src/lib/ai/models.ts` - injected rather than copied, so the
 * lists cannot drift from the registry the chat routes validate against.
 */
import type { UserPlan } from "./entitlements-rules";
import type { TranslationId } from "./bible/translations";
import type { ReasoningEffort, ReasoningMode, Speed, Verbosity } from "./ai/models";

/** The translations the reader can be set to. Mirrors `TRANSLATIONS`. */
export const TRANSLATION_IDS: readonly TranslationId[] = ["KJV", "NKJV"];

export const DEFAULT_TRANSLATION: TranslationId = "KJV";

/**
 * Playback speeds the Listen card offers, duplicated from
 * `src/components/cross/listen.ts` (`LISTEN_RATES`). A server module must not
 * import from `src/components`, and the two lists have to agree: a rate the
 * card can select but this rejects would fail every write, so the test asserts
 * they are identical.
 */
export const LISTEN_RATES: readonly number[] = [0.75, 1, 1.25, 1.5, 2];

export const DEFAULT_LISTEN_RATE = 1;

/**
 * What the model registry says is valid, handed in by the caller. `knowsModel`
 * is `resolveDefinition()` reduced to a yes/no; the four lists are the exported
 * vocabularies the `isReasoningEffort`/`isSpeed`/`isVerbosity`/`isReasoningMode`
 * guards test against, and they double as the allowed values an error names.
 */
export interface ModelVocabulary {
	knowsModel(modelId: string): boolean;
	efforts: readonly string[];
	speeds: readonly string[];
	verbosities: readonly string[];
	modes: readonly string[];
}

/** The chat picker's stored pick, exactly as the columns hold it. */
export interface PreferencesChatDocument {
	modelId: string | null;
	effort: ReasoningEffort | null;
	speed: Speed | null;
	verbosity: Verbosity | null;
	mode: ReasoningMode | null;
}

/** The full document `GET` returns and `PATCH` echoes back. */
export interface PreferencesDocument {
	plan: UserPlan;
	webSearchEnabled: boolean;
	memoryEnabled: boolean;
	translation: TranslationId;
	parchment: boolean;
	listenRate: number;
	chat: PreferencesChatDocument;
}

/** The `User` columns the document is built from. */
export interface PreferencesUserRow {
	webSearchEnabled: boolean;
	memoryEnabled: boolean;
	translation: string;
	parchment: boolean;
	listenRate: number;
	defaultModelId: string | null;
	defaultEffort: string | null;
	defaultSpeed: string | null;
	defaultVerbosity: string | null;
	defaultMode: string | null;
}

/**
 * A validated patch, keyed by Prisma column name so the route can hand it
 * straight to `user.update({ data })`.
 */
export interface PreferencesPatchData {
	webSearchEnabled?: boolean;
	memoryEnabled?: boolean;
	translation?: TranslationId;
	parchment?: boolean;
	listenRate?: number;
	defaultModelId?: string | null;
	defaultEffort?: string | null;
	defaultSpeed?: string | null;
	defaultVerbosity?: string | null;
	defaultMode?: string | null;
}

export type PreferencesPatchResult =
	| { ok: true; data: PreferencesPatchData }
	| { ok: false; error: string };

function isTranslationId(value: unknown): value is TranslationId {
	return typeof value === "string" && (TRANSLATION_IDS as readonly string[]).includes(value);
}

/** Compared numerically, so 1 and 1.0 are the same rate. */
function isListenRate(value: unknown): value is number {
	return typeof value === "number" && LISTEN_RATES.some((rate) => rate === value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A value that is in `allowed`, else null. The cast is safe by construction:
 * every list in a `ModelVocabulary` is the const array of exactly the union
 * being narrowed to, and the test pins each one to its registry export.
 */
function pickFromVocabulary<T extends string>(value: unknown, allowed: readonly string[]): T | null {
	return typeof value === "string" && allowed.includes(value) ? (value as T) : null;
}

/**
 * The document for a user row.
 *
 * `null` stands for an account with no row yet (a signed-in user whose first
 * request raced the lazy upsert): everyone starts on the defaults rather than
 * on an error. Every `chat.*` value is validated on read and anything the
 * registry no longer recognises reads as `null`, "never chosen" - except
 * `modelId`, which is returned verbatim, because whether a stored pick is still
 * runnable for this account is the picker's decision against `/api/ai/models`,
 * not this route's.
 */
export function toPreferencesDocument(
	user: PreferencesUserRow | null | undefined,
	plan: UserPlan,
	models: ModelVocabulary
): PreferencesDocument {
	const translation = user?.translation;
	const listenRate = user?.listenRate;

	return {
		plan,
		webSearchEnabled: user?.webSearchEnabled ?? true,
		memoryEnabled: user?.memoryEnabled ?? true,
		translation: isTranslationId(translation) ? translation : DEFAULT_TRANSLATION,
		parchment: user?.parchment ?? true,
		listenRate: isListenRate(listenRate) ? listenRate : DEFAULT_LISTEN_RATE,
		chat: {
			modelId: user?.defaultModelId ?? null,
			effort: pickFromVocabulary<ReasoningEffort>(user?.defaultEffort, models.efforts),
			speed: pickFromVocabulary<Speed>(user?.defaultSpeed, models.speeds),
			verbosity: pickFromVocabulary<Verbosity>(user?.defaultVerbosity, models.verbosities),
			mode: pickFromVocabulary<ReasoningMode>(user?.defaultMode, models.modes),
		},
	};
}

/** One `chat.*` field: a value from `allowed`, or `null` to clear the column. */
function readNullableChoice(
	value: unknown,
	allowed: readonly string[],
	field: string
): { ok: true; value: string | null } | { ok: false; error: string } {
	if (value === null) return { ok: true, value: null };
	const picked = pickFromVocabulary<string>(value, allowed);
	if (picked !== null) return { ok: true, value: picked };
	return { ok: false, error: `${field} must be null or one of: ${allowed.join(", ")}` };
}

/**
 * Validate a PATCH body into Prisma-ready columns.
 *
 * Strict on purpose. An unknown key is a client bug or a typo, and silently
 * dropping it would leave a setting that appears to save and never does; a
 * rejected body writes nothing at all, so a mixed patch can never half-apply.
 */
export function parsePreferencesPatch(body: unknown, models: ModelVocabulary): PreferencesPatchResult {
	if (!isPlainObject(body)) {
		return { ok: false, error: "Body must be a JSON object" };
	}

	const data: PreferencesPatchData = {};

	for (const [key, value] of Object.entries(body)) {
		switch (key) {
			case "webSearchEnabled":
			case "memoryEnabled":
			case "parchment": {
				if (typeof value !== "boolean") {
					return { ok: false, error: `${key} must be a boolean` };
				}
				data[key] = value;
				break;
			}
			case "translation": {
				if (!isTranslationId(value)) {
					return {
						ok: false,
						error: `translation must be one of: ${TRANSLATION_IDS.join(", ")}`,
					};
				}
				data.translation = value;
				break;
			}
			case "listenRate": {
				if (!isListenRate(value)) {
					return {
						ok: false,
						error: `listenRate must be one of: ${LISTEN_RATES.join(", ")}`,
					};
				}
				data.listenRate = value;
				break;
			}
			case "chat": {
				const error = readChat(value, data, models);
				if (error) return { ok: false, error };
				break;
			}
			default:
				return { ok: false, error: `Unknown preference: ${key}` };
		}
	}

	if (Object.keys(data).length === 0) {
		return { ok: false, error: "No preferences to update" };
	}

	return { ok: true, data };
}

/**
 * Fold a `chat` sub-object into `data`. Returns an error message, or undefined
 * when every field it carried was valid. Mutating `data` in place keeps the
 * column mapping in one place; the caller discards it whole on any error.
 */
function readChat(
	value: unknown,
	data: PreferencesPatchData,
	models: ModelVocabulary
): string | undefined {
	if (!isPlainObject(value)) return "chat must be a JSON object";

	for (const [field, raw] of Object.entries(value)) {
		switch (field) {
			case "modelId": {
				if (raw === null) {
					data.defaultModelId = null;
					break;
				}
				if (typeof raw !== "string" || !models.knowsModel(raw)) {
					return "chat.modelId must be null or a known model id";
				}
				data.defaultModelId = raw;
				break;
			}
			case "effort": {
				const parsed = readNullableChoice(raw, models.efforts, "chat.effort");
				if (!parsed.ok) return parsed.error;
				data.defaultEffort = parsed.value;
				break;
			}
			case "speed": {
				const parsed = readNullableChoice(raw, models.speeds, "chat.speed");
				if (!parsed.ok) return parsed.error;
				data.defaultSpeed = parsed.value;
				break;
			}
			case "verbosity": {
				const parsed = readNullableChoice(raw, models.verbosities, "chat.verbosity");
				if (!parsed.ok) return parsed.error;
				data.defaultVerbosity = parsed.value;
				break;
			}
			case "mode": {
				const parsed = readNullableChoice(raw, models.modes, "chat.mode");
				if (!parsed.ok) return parsed.error;
				data.defaultMode = parsed.value;
				break;
			}
			default:
				return `Unknown preference: chat.${field}`;
		}
	}

	return undefined;
}
