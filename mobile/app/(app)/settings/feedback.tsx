import React from "react";
import { spacing } from "@/theme";
import { SettingsSubScreen } from "@/features/settings/SettingsChrome";
import { FeedbackSection } from "@/features/settings/FeedbackSection";
import { useStableGetToken } from "@/features/notes/useStableGetToken";

/** The first card carries no label, so it needs the label's own top offset. */
const contentStyle = { paddingTop: spacing.xl };

/** Settings -> Send feedback: the one place a person can answer back in words. */
export default function FeedbackScreen() {
	const getToken = useStableGetToken();
	return (
		<SettingsSubScreen title="Send feedback" contentStyle={contentStyle}>
			<FeedbackSection getToken={getToken} />
		</SettingsSubScreen>
	);
}
