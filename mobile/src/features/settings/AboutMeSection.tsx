import React from "react";
import { PersonalTextSection } from "./PersonalTextSection";
import { saveAboutMe } from "./preferencesSync";

/**
 * "About me": the paragraph the user writes about themselves, which the
 * assistant reads on every conversation.
 */
export function AboutMeSection() {
	return (
		<PersonalTextSection
			field="aboutMe"
			title="About me"
			hint="Tell SureWord about yourself in your own words: where you are in your walk with the Lord, your church background, what you are studying, what you want from this app. The assistant reads this on every conversation. Leave it blank and it learns only from what you say in chat."
			placeholder="Saved in 2019, studying Romans with my church, and I want help understanding what I read."
			accessibilityLabel="About me"
			loadingLabel="Loading About me…"
			loadFailedLabel="Couldn't load your About me."
			save={saveAboutMe}
		/>
	);
}
