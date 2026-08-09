import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { colors, spacing } from "@/theme";

const DOTS = [0, 1, 2];

/** Three-dot "thinking" indicator shown before the first token arrives. */
export function TypingDots() {
	const progress = useRef(new Animated.Value(0)).current;

	useEffect(() => {
		const loop = Animated.loop(
			Animated.timing(progress, {
				toValue: 3,
				duration: 1200,
				easing: Easing.linear,
				useNativeDriver: true,
			})
		);
		loop.start();
		return () => loop.stop();
	}, [progress]);

	return (
		<View style={styles.row}>
			{DOTS.map((index) => (
				<Animated.View
					key={index}
					style={[
						styles.dot,
						{
							opacity: progress.interpolate({
								inputRange: [index - 0.6, index, index + 0.6, index + 2.4, index + 3],
								outputRange: [0.25, 1, 0.25, 0.25, 1],
								extrapolate: "clamp",
							}),
						},
					]}
				/>
			))}
		</View>
	);
}

const styles = StyleSheet.create({
	row: { flexDirection: "row", gap: spacing.xs, paddingVertical: spacing.sm },
	dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.textFaint },
});
