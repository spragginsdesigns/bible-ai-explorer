import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { colors } from "@/theme";

const DELAYS = [0, 160, 320];

/** Three pulsing dots shown while the assistant is thinking. */
export function TypingDots() {
	const values = useRef(DELAYS.map(() => new Animated.Value(0.3))).current;

	useEffect(() => {
		const animations = values.map((value, index) =>
			Animated.loop(
				Animated.sequence([
					Animated.delay(DELAYS[index]),
					Animated.timing(value, {
						toValue: 1,
						duration: 380,
						easing: Easing.inOut(Easing.quad),
						useNativeDriver: true,
					}),
					Animated.timing(value, {
						toValue: 0.3,
						duration: 380,
						easing: Easing.inOut(Easing.quad),
						useNativeDriver: true,
					}),
				])
			)
		);
		animations.forEach((animation) => animation.start());
		return () => animations.forEach((animation) => animation.stop());
	}, [values]);

	return (
		<View style={styles.row}>
			{values.map((value, index) => (
				<Animated.View key={index} style={[styles.dot, { opacity: value }]} />
			))}
		</View>
	);
}

const styles = StyleSheet.create({
	row: { flexDirection: "row", gap: 5, paddingVertical: 8 },
	dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.textFaint },
});
