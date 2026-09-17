import React from "react";
import { useUser } from "@clerk/expo";
import { spacing } from "@/theme";
import { SettingsSubScreen } from "@/features/settings/SettingsChrome";
import { HighlightLabelsSection } from "@/features/settings/HighlightLabelsSection";

/** The first card carries no label, so it needs the label's own top offset. */
const contentStyle = { paddingTop: spacing.xl };

/**
 * Settings -> Highlight labels: name each highlight colour and say what it
 * means to you. Keyed on the account so a new sign-in never inherits the
 * previous user's draft.
 */
export default function HighlightLabelsScreen() {
	const { user } = useUser();
	return (
		<SettingsSubScreen title="Highlight labels" contentStyle={contentStyle}>
			<HighlightLabelsSection key={user?.id ?? "signed-out"} hideHeading />
		</SettingsSubScreen>
	);
}
