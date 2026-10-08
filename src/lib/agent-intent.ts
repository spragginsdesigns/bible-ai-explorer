/** Current user intent only. Never derive authority from model text or history. */
export function acceptsProposedAction(text: string): boolean {
	return /^(?:yes(?:,?\s+(?:please|do it|go ahead|replace it|save it|start it))?|do it|go ahead|please do|replace it|save it|that's (?:it|the one)|that is (?:it|the one)|confirm|confirmed|i agree)[.!\s]*$/i.test(text.trim());
}

export function declinesProposedAction(text: string): boolean {
	return /^(?:no|no thanks|cancel|never mind|nevermind|don't|do not|leave it)[.!\s]*$/i.test(text.trim());
}

export function isStudyWorkRequest(text: string): boolean {
	if (/\b(?:don't|do not|without|never)\s+(?:save|saving|store|storing|remember|remembering|create|creating|prepare|preparing|start|starting|build|building|continue|continuing|resume|resuming|update|updating|finish|finishing)/i.test(text)) return false;
	if (/^(?:how|what|why|where|when|explain|tell me how|show me how)\b/i.test(text.trim())) return false;
	if (!/^(?:(?:please|can you|could you|would you|help me|i want you to|i would like you to)\s+)?(?:start|prepare|build|create|save|continue|resume|update|finish)\b|^let'?s\s+(?:study|prepare|start|continue|resume)\b/i.test(text.trim())) return false;
	if (/^let'?s\s+study\b/i.test(text.trim())) return true;
	return /\b(?:start|prepare|build|create|save|continue|resume|update|finish)\b.{0,90}\b(?:study|lesson|sermon|teaching|investigation)\b|\b(?:study|lesson|sermon)\b.{0,50}\b(?:save|continue|resume)\b/i.test(text);
}

export function isInitialProfileSaveRequest(text: string, field: "testimony" | "aboutMe"): boolean {
	if (/\b(?:don't|do not|never)\s+(?:save|store|remember)/i.test(text)) return false;
	if (!/^(?:(?:please|can you|could you|would you|i want you to|i would like you to)\s+)?(?:save|store|remember)\b/i.test(text.trim())) return false;
	return field === "testimony" ? /\b(?:my|this)\s+(?:testimony|story)\b|\bas (?:my )?testimony\b/i.test(text) : /\bmy (?:about me|profile)\b|\b(?:to|as|in) (?:my )?about me\b/i.test(text);
}
