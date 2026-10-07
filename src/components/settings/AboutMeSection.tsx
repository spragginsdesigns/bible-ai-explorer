"use client";

import { MAX_ABOUT_ME_LENGTH, readAboutMePref } from "@/lib/preferences";
import { useAboutMePreference } from "@/lib/preferencesSync";
import PersonalTextSection from "./PersonalTextSection";

/** "About me": what the user wants every conversation to start from. */
export default function AboutMeSection() {
	const aboutMe = useAboutMePreference();
	return (
		<PersonalTextSection
			field="aboutMe"
			id="about-me"
			title="ABOUT ME"
			description="Tell SureWord about yourself in your own words: where you are in your walk with the Lord, your church background, what you are studying, what you want from this app. The assistant reads this on every conversation. Leave it blank and it learns only from what you say in chat."
			placeholder="I came to the Lord two years ago and I am reading through the Gospels…"
			name="About me"
			label="About me"
			maxLength={MAX_ABOUT_ME_LENGTH}
			rows={5}
			value={aboutMe}
			readCached={readAboutMePref}
		/>
	);
}
