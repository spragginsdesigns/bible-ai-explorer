import React from "react";
import { PersonalTextSection } from "./PersonalTextSection";
import { saveTestimony } from "./preferencesSync";
import { spacing, typography } from "@/theme";

/** About eight lines plus the input's vertical padding: a story needs more room than About me. */
const TESTIMONY_INPUT_MIN_HEIGHT = typography.control.lineHeight * 8 + spacing.sm * 2;

/**
 * "My testimony": how the user came to faith, in their own words. Private: the
 * assistant reads it so its answers can connect to the user's own story, and it
 * is never shown to anyone else.
 */
export function TestimonySection() {
	return (
		<PersonalTextSection
			field="testimony"
			title="My testimony"
			hint="How you came to faith, in your own words. Private: only SureWord reads it, so its answers can connect to what God has done in your life. It is never shown to anyone or shared."
			placeholder="Where you were, how the Lord reached you, and what has changed since"
			accessibilityLabel="My testimony"
			loadingLabel="Loading your testimony…"
			loadFailedLabel="Couldn't load your testimony."
			save={saveTestimony}
			inputMinHeight={TESTIMONY_INPUT_MIN_HEIGHT}
		/>
	);
}
