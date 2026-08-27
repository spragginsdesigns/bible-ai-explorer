import "server-only";

import { isPlacesConfigured } from "@/lib/church-rules";

/**
 * The Google Places API (New) calls behind "My church".
 *
 * Only three things are ever asked of Google: search churches by text, read one
 * place, and turn a photo resource name into a URL we can fetch. The API key
 * never leaves this module - photo bytes are proxied through our own origin
 * (`/api/church/photo`) rather than handing a keyed URL to a client.
 */

const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const PLACES_DETAILS_URL = "https://places.googleapis.com/v1/places";
const PLACES_MEDIA_URL = "https://places.googleapis.com/v1";

/** A user is waiting on every one of these calls, so none of them may hang. */
const PLACES_TIMEOUT_MS = 8_000;
const MAX_SEARCH_RESULTS = 8;

const SEARCH_FIELD_MASK = [
	"places.id",
	"places.displayName",
	"places.formattedAddress",
	"places.websiteUri",
	"places.nationalPhoneNumber",
	"places.googleMapsUri",
	"places.photos",
	"places.primaryType",
].join(",");

/** Details take the same fields without the `places.` prefix. */
const DETAILS_FIELD_MASK = SEARCH_FIELD_MASK.replace(/places\./g, "");

export interface PlaceSummary {
	placeId: string;
	name: string;
	address: string;
	/** Lets the picker show a thumbnail slot without a second round trip. */
	hasPhoto: boolean;
}

export interface PlaceDetails {
	placeId: string;
	name: string;
	address: string;
	phone: string | null;
	website: string | null;
	mapsUrl: string | null;
	/** Places photo resource name, e.g. `places/<id>/photos/<ref>`. */
	photoName: string | null;
}

/** Thrown when the deployment has no key. Callers gate with `isPlacesConfigured`. */
export class PlacesNotConfiguredError extends Error {
	constructor() {
		super("GOOGLE_PLACES_API_KEY is not configured.");
		this.name = "PlacesNotConfiguredError";
	}
}

/** Thrown for a place id Google does not recognize, so routes can answer 404. */
export class PlaceNotFoundError extends Error {
	constructor(placeId: string) {
		super(`Google Places has no place ${placeId}.`);
		this.name = "PlaceNotFoundError";
	}
}

function requireApiKey(): string {
	const apiKey = process.env.GOOGLE_PLACES_API_KEY;
	if (!isPlacesConfigured(apiKey)) throw new PlacesNotConfiguredError();
	return apiKey.trim();
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** `displayName` is `{ text, languageCode }` in the New API, a string in none. */
function displayName(value: unknown): string | null {
	return asString(asRecord(value).text);
}

function firstPhotoName(value: unknown): string | null {
	if (!Array.isArray(value)) return null;
	for (const photo of value) {
		const name = asString(asRecord(photo).name);
		if (name) return name;
	}
	return null;
}

export async function searchChurches(query: string): Promise<PlaceSummary[]> {
	const apiKey = requireApiKey();

	const response = await fetch(PLACES_SEARCH_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Goog-Api-Key": apiKey,
			"X-Goog-FieldMask": SEARCH_FIELD_MASK,
		},
		body: JSON.stringify({
			textQuery: query,
			includedType: "church",
			maxResultCount: MAX_SEARCH_RESULTS,
		}),
		signal: AbortSignal.timeout(PLACES_TIMEOUT_MS),
	});

	if (!response.ok) {
		throw new Error(`Google Places search failed (${response.status}): ${await response.text()}`);
	}

	const places = asRecord(await response.json()).places;
	if (!Array.isArray(places)) return [];

	return places.flatMap((place): PlaceSummary[] => {
		const record = asRecord(place);
		const placeId = asString(record.id);
		const name = displayName(record.displayName);
		const address = asString(record.formattedAddress);
		if (!placeId || !name) return [];
		return [
			{
				placeId,
				name,
				address: address ?? "",
				hasPhoto: firstPhotoName(record.photos) !== null,
			},
		];
	});
}

export async function getPlaceDetails(placeId: string): Promise<PlaceDetails> {
	const apiKey = requireApiKey();

	const response = await fetch(`${PLACES_DETAILS_URL}/${encodeURIComponent(placeId)}`, {
		headers: {
			"X-Goog-Api-Key": apiKey,
			"X-Goog-FieldMask": DETAILS_FIELD_MASK,
		},
		signal: AbortSignal.timeout(PLACES_TIMEOUT_MS),
	});

	// Google answers 400 for a malformed id and 404 for a well-formed one it does
	// not have; both mean the same thing to a caller: that church is not there.
	if (response.status === 404 || response.status === 400) {
		throw new PlaceNotFoundError(placeId);
	}
	if (!response.ok) {
		throw new Error(`Google Places details failed (${response.status}): ${await response.text()}`);
	}

	const record = asRecord(await response.json());
	const name = displayName(record.displayName);
	if (!name) throw new PlaceNotFoundError(placeId);

	return {
		placeId: asString(record.id) ?? placeId,
		name,
		address: asString(record.formattedAddress) ?? "",
		phone: asString(record.nationalPhoneNumber),
		website: asString(record.websiteUri),
		mapsUrl: asString(record.googleMapsUri),
		photoName: firstPhotoName(record.photos),
	};
}

/**
 * Turn a photo resource name into a fetchable URL.
 *
 * `skipHttpRedirect` asks Google for the JSON `photoUri` instead of a 302, so
 * the keyed request and the redirect target stay on the server: the caller
 * fetches the returned URL itself and streams the bytes on.
 */
export async function resolvePlacePhotoUri(
	photoName: string,
	maxWidthPx: number
): Promise<string | null> {
	const apiKey = requireApiKey();

	const url = new URL(`${PLACES_MEDIA_URL}/${photoName}/media`);
	url.searchParams.set("maxWidthPx", String(maxWidthPx));
	url.searchParams.set("skipHttpRedirect", "true");
	url.searchParams.set("key", apiKey);

	const response = await fetch(url, { signal: AbortSignal.timeout(PLACES_TIMEOUT_MS) });
	if (!response.ok) return null;

	return asString(asRecord(await response.json()).photoUri);
}
