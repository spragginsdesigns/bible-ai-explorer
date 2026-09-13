/** Recover a dropped connection; an explicit server failure has no answer to collect. */
export function shouldRecoverChatStream(error: unknown): boolean {
	const value = typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
	const message = typeof error === "string" ? error : typeof value.message === "string" ? value.message : "";
	if (typeof value.status === "number" && value.status > 0) return false;
	if (/^\[(?:unauthorized|invalid_input|conversation_not_found|provider_key_missing|provider_error|rate_limited|internal)\]/.test(message.trim())) return false;
	try {
		const body = JSON.parse(message);
		if (body && (typeof body.code === "string" || typeof body.error === "string")) return false;
	} catch { /* A connection error is usually plain text. */ }
	if (value.name === "AbortError") return false;
	if (value.isNetworkError === true || value.isTimeout === true) return true;
	return /^(?:failed to fetch\.?|load failed\.?|terminated)$|network ?error|network request failed|connection (?:abort(?:ed)?|lost|reset|closed)|socket|premature close|stream (?:closed|ended) unexpectedly|unexpected end of (?:json|stream)|timed? ?out|timeout/i.test(message);
}
