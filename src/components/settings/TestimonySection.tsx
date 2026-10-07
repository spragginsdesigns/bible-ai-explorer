"use client";

import { MAX_TESTIMONY_LENGTH, readTestimonyPref } from "@/lib/preferences";
import { useTestimonyPreference } from "@/lib/preferencesSync";
import PersonalTextSection from "./PersonalTextSection";

/**
 * "My testimony": how the user came to faith. Private: the assistant reads it so
 * its answers can connect to what God has done in their life; nobody else sees it.
 */
export default function TestimonySection() {
	const testimony = useTestimonyPreference();
	return (
		<PersonalTextSection
			field="testimony"
			id="testimony"
			title="MY TESTIMONY"
			description="How you came to faith, in your own words. Private: only SureWord reads it, so its answers can connect to what God has done in your life. It is never shown to anyone or shared."
			placeholder="Where you were, how the Lord reached you, and what has changed since"
			name="your testimony"
			label="My testimony"
			maxLength={MAX_TESTIMONY_LENGTH}
			rows={8}
			value={testimony}
			readCached={readTestimonyPref}
		/>
	);
}
