import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ErrorBoundaryProps } from "expo-router";
import { darkColors as colors } from "@/theme";
import { track } from "@/lib/analytics";

/**
 * What a render crash shows instead of a blank screen or a closed app.
 *
 * Exported as `ErrorBoundary` from the route layouts, so expo-router catches
 * the throw and `retry` re-renders the route in place. It reads the fixed dark
 * palette and plain Text on purpose: the settings store and the bundled fonts
 * are among the things that could have thrown.
 */
export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
	useEffect(() => {
		// The error's name only. A message can quote whatever was being rendered,
		// and study content never goes to analytics.
		track("app_render_error", { error_name: error?.name ?? "Error" });
	}, [error]);

	return (
		<View style={styles.root} accessibilityRole="alert">
			<Text style={styles.title}>Something went wrong</Text>
			<Text style={styles.body}>
				This screen hit a problem. Your notes and conversations are safe. Try again, and if it keeps happening,
				restart SureWord.
			</Text>
			<Pressable
				accessibilityRole="button"
				onPress={() => void retry()}
				style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
			>
				<Text style={styles.buttonText}>Try again</Text>
			</Pressable>
		</View>
	);
}

const styles = StyleSheet.create({
	root: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		paddingHorizontal: 32,
		backgroundColor: colors.bg,
	},
	title: { color: colors.text, fontSize: 20, fontWeight: "700", marginBottom: 12, textAlign: "center" },
	body: { color: colors.textMuted, fontSize: 15, lineHeight: 22, textAlign: "center", marginBottom: 28 },
	button: {
		paddingHorizontal: 28,
		paddingVertical: 12,
		borderRadius: 999,
		borderWidth: 1,
		borderColor: colors.accentBorder,
		backgroundColor: colors.accentSoft,
	},
	buttonPressed: { backgroundColor: colors.accentPressed },
	buttonText: { color: colors.accent, fontSize: 15, fontWeight: "600" },
});
