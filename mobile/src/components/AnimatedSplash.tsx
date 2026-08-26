import React, { useCallback, useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, StyleSheet } from "react-native";
import { useEventListener } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";

const FADE_MS = 260;
const FAILSAFE_MS = 4_500;

export function AnimatedSplash({ onFinish }: { onFinish: () => void }) {
	const opacity = useRef(new Animated.Value(1)).current;
	const finishing = useRef(false);
	const player = useVideoPlayer(require("../../assets/sureword-splash.mp4"), (instance) => {
		instance.loop = false;
		instance.muted = true;
	});

	const finish = useCallback(() => {
		if (finishing.current) return;
		finishing.current = true;
		Animated.timing(opacity, {
			toValue: 0,
			duration: FADE_MS,
			useNativeDriver: true,
		}).start();

		// VideoView owns a native rendering surface on Android. Remove that
		// surface after the fade even if the animation callback is interrupted.
		setTimeout(onFinish, FADE_MS);
	}, [onFinish, opacity]);

	useEventListener(player, "playToEnd", finish);
	useEventListener(player, "statusChange", ({ status }) => {
		if (status === "error") finish();
	});

	useEffect(() => {
		let active = true;
		const failsafe = setTimeout(finish, FAILSAFE_MS);
		void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
			if (!active) return;
			if (reduceMotion) finish();
			else player.play();
		});
		return () => {
			active = false;
			clearTimeout(failsafe);
		};
	}, [finish, player]);

	return (
		<Animated.View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			pointerEvents="auto"
			style={[StyleSheet.absoluteFill, styles.overlay, { opacity }]}
		>
			<VideoView
				player={player}
				style={StyleSheet.absoluteFill}
				contentFit="cover"
				nativeControls={false}
				surfaceType="textureView"
				useExoShutter={false}
			/>
		</Animated.View>
	);
}

const styles = StyleSheet.create({
	overlay: { backgroundColor: "#000000", zIndex: 1000 },
});
