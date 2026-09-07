import type { StyleProp, ViewStyle } from "react-native";

type ColorPickerModule = typeof import("reanimated-color-picker");

let loaded: ColorPickerModule | null = null;

/**
 * reanimated-color-picker pulls in a worklet-backed component tree that the
 * reader only needs when someone taps the custom swatch. Metro runs with
 * `inlineRequires: false`, so a static import would evaluate that tree on every
 * chapter open; requiring it here defers the cost to the first open and the
 * module cache keeps later opens free.
 */
function loadColorPicker(): ColorPickerModule {
	loaded ??= require("reanimated-color-picker") as ColorPickerModule;
	return loaded;
}

interface HighlightColorPickerProps {
	value: string;
	onComplete: (hex: string) => void;
	style?: StyleProp<ViewStyle>;
}

export function HighlightColorPicker({ value, onComplete, style }: HighlightColorPickerProps) {
	const { default: ColorPicker, HueSlider, Panel1, Preview } = loadColorPicker();
	return (
		<ColorPicker value={value} onCompleteJS={(result) => onComplete(result.hex)} style={style}>
			<Preview hideInitialColor />
			<Panel1 />
			<HueSlider />
		</ColorPicker>
	);
}
