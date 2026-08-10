import { useEffect, useState } from "react";
import { Keyboard } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { spacing } from "@/theme";

/**
 * Height of the glass tab bar rendered by app/(app)/_layout.tsx, excluding the
 * safe-area padding beneath it. The bar is absolutely positioned, so screens
 * have to reserve this space themselves.
 */
const TAB_BAR_HEIGHT = 52;

/** Vertical space the floating tab bar occupies at the bottom of a screen. */
export function useTabBarSpace(): number {
	const insets = useSafeAreaInsets();
	const keyboardVisible = useKeyboardVisible();
	// The keyboard covers the tab bar, so its clearance is not needed while
	// typing - otherwise the input would float above a dead gap.
	return keyboardVisible ? 0 : TAB_BAR_HEIGHT + Math.max(insets.bottom, spacing.sm);
}

/** True while the soft keyboard is shown. */
export function useKeyboardVisible(): boolean {
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		const show = Keyboard.addListener("keyboardDidShow", () => setVisible(true));
		const hide = Keyboard.addListener("keyboardDidHide", () => setVisible(false));
		return () => {
			show.remove();
			hide.remove();
		};
	}, []);

	return visible;
}
