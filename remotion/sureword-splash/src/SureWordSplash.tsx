import { loadFont } from "@remotion/fonts";
import {
	AbsoluteFill,
	CanvasImage,
	Easing,
	Interactive,
	interpolate,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
} from "remotion";

await Promise.all([
	loadFont({
		family: "Pirata One",
		url: staticFile("PirataOne-Regular.ttf"),
		weight: "400",
	}),
	loadFont({
		family: "Cormorant Garamond",
		url: staticFile("CormorantGaramond-Medium.ttf"),
		weight: "500",
	}),
]);

const GOLD = "#fbbf24";

export const SureWordSplash = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	return (
		<AbsoluteFill style={{ backgroundColor: "#030303", overflow: "hidden" }}>
			<Interactive.Div
				name="Warm ambient glow"
				style={{
					position: "absolute",
					inset: 0,
					background:
						"radial-gradient(circle at 50% 40%, rgba(251, 191, 36, 0.13) 0%, rgba(120, 73, 16, 0.055) 22%, transparent 48%), linear-gradient(180deg, #030303 0%, #060504 52%, #030303 100%)",
					opacity: interpolate(frame, [0, 0.85 * fps], [0.15, 1], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
						easing: Easing.bezier(0.16, 1, 0.3, 1),
					}),
				}}
			/>

			<Interactive.Div
				name="Logo halo"
				style={{
					position: "absolute",
					left: 340,
					top: 588,
					width: 400,
					height: 400,
					borderRadius: 200,
					background:
						"radial-gradient(circle, rgba(251, 191, 36, 0.16) 0%, rgba(251, 191, 36, 0.055) 34%, transparent 68%)",
					filter: "blur(12px)",
					opacity: interpolate(frame, [0, 0.7 * fps], [0, 1], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
						easing: Easing.bezier(0.16, 1, 0.3, 1),
					}),
					scale: interpolate(frame, [0, 1.25 * fps], [0.82, 1.04], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
						easing: Easing.bezier(0.16, 1, 0.3, 1),
						output: "perceptual-scale",
					}),
				}}
			/>

			<Interactive.Div
				name="Logo ring"
				style={{
					position: "absolute",
					left: 408,
					top: 656,
					width: 264,
					height: 264,
					borderRadius: 132,
					border: "1px solid rgba(251, 191, 36, 0.18)",
					opacity: interpolate(frame, [0.08 * fps, 0.66 * fps], [0, 1], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
						easing: Easing.bezier(0.16, 1, 0.3, 1),
					}),
					scale: interpolate(frame, [0.08 * fps, 0.78 * fps], [0.9, 1], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
						easing: Easing.bezier(0.16, 1, 0.3, 1),
						output: "perceptual-scale",
					}),
				}}
			/>

			<CanvasImage
				name="SureWord mark"
				src={staticFile("sureword-icon.png")}
				style={{
					position: "absolute",
					left: 426,
					top: 674,
					width: 228,
					height: 228,
					borderRadius: 114,
					opacity: interpolate(frame, [0.04 * fps, 0.58 * fps], [0, 1], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
						easing: Easing.bezier(0.16, 1, 0.3, 1),
					}),
					scale: interpolate(frame, [0.04 * fps, 0.72 * fps], [0.92, 1], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
						easing: Easing.bezier(0.16, 1, 0.3, 1),
						output: "perceptual-scale",
					}),
					filter: "drop-shadow(0 0 26px rgba(251, 191, 36, 0.16))",
				}}
			/>

			<Interactive.Div
				name="SureWord label"
				style={{
					position: "absolute",
					left: 110,
					right: 110,
					top: 978,
					textAlign: "center",
					fontFamily: "Arial, sans-serif",
					fontSize: 27,
					fontWeight: 700,
					letterSpacing: 8,
					color: GOLD,
					opacity: interpolate(frame, [0.28 * fps, 0.82 * fps], [0, 1], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
						easing: Easing.bezier(0.16, 1, 0.3, 1),
					}),
					translate: interpolate(frame, [0.28 * fps, 0.82 * fps], ["0px 12px", "0px 0px"], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
						easing: Easing.bezier(0.16, 1, 0.3, 1),
					}),
				}}
			>
				SUREWORD
			</Interactive.Div>

			<Interactive.Div
				name="Headline"
				style={{
					position: "absolute",
					left: 82,
					right: 82,
					top: 1106,
					textAlign: "center",
					fontFamily: "Pirata One",
					fontSize: 122,
					lineHeight: 0.98,
					color: "#f5f5f5",
					textShadow: "0 8px 30px rgba(0, 0, 0, 0.5)",
					opacity: interpolate(frame, [0.42 * fps, 1.1 * fps], [0, 1], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
						easing: Easing.bezier(0.16, 1, 0.3, 1),
					}),
					translate: interpolate(frame, [0.42 * fps, 1.1 * fps], ["0px 24px", "0px 0px"], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
						easing: Easing.bezier(0.16, 1, 0.3, 1),
					}),
				}}
			>
				Come hungry for the Word.
			</Interactive.Div>

			<Interactive.Div
				name="Trust statement"
				style={{
					position: "absolute",
					left: 124,
					right: 124,
					top: 1470,
					textAlign: "center",
					fontFamily: "Cormorant Garamond",
					fontSize: 47,
					lineHeight: 1.3,
					color: "#d8d3c8",
					opacity: interpolate(frame, [0.88 * fps, 1.5 * fps], [0, 1], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
						easing: Easing.bezier(0.16, 1, 0.3, 1),
					}),
					translate: interpolate(frame, [0.88 * fps, 1.5 * fps], ["0px 18px", "0px 0px"], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
						easing: Easing.bezier(0.16, 1, 0.3, 1),
					}),
				}}
			>
				Scripture comes first.
			</Interactive.Div>

			<Interactive.Div
				name="Closing rule"
				style={{
					position: "absolute",
					left: 310,
					right: 310,
					top: 1638,
					height: 1,
					background:
						"linear-gradient(90deg, transparent, rgba(251, 191, 36, 0.55), transparent)",
					opacity: interpolate(frame, [1.08 * fps, 1.62 * fps], [0, 1], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
						easing: Easing.bezier(0.16, 1, 0.3, 1),
					}),
					scale: interpolate(frame, [1.08 * fps, 1.62 * fps], [0.2, 1], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
						easing: Easing.bezier(0.16, 1, 0.3, 1),
						output: "perceptual-scale",
					}),
				}}
			/>

			<Interactive.Div
				name="Vignette"
				style={{
					position: "absolute",
					inset: 0,
					background: "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.38) 100%)",
					pointerEvents: "none",
				}}
			/>
		</AbsoluteFill>
	);
};
