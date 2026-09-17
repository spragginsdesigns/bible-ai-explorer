import React from "react";
import { spacing } from "@/theme";
import { SettingsSubScreen } from "@/features/settings/SettingsChrome";
import { SharedAnswersSection } from "@/features/chat/SharedAnswersSection";
import { useStableGetToken } from "@/features/notes/useStableGetToken";

/** The first card carries no label, so it needs the label's own top offset. */
const contentStyle = { paddingTop: spacing.xl };

/** Settings -> Shared answers: every public link this account has minted, and Revoke. */
export default function SharedAnswersScreen() {
	const getToken = useStableGetToken();
	return (
		<SettingsSubScreen title="Shared answers" contentStyle={contentStyle}>
			<SharedAnswersSection getToken={getToken} hideHeading />
		</SettingsSubScreen>
	);
}
