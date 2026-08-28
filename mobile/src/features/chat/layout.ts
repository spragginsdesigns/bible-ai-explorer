import { useEffect, useState } from "react";
import { Keyboard } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { spacing } from "@/theme";

/** Height of each tab target rendered by app/(app)/_layout.tsx. */
export const TAB_BAR_ITEM_HEIGHT = 52;

/**
 * Full height of the tab bar rendered by app/(app)/_layout.tsx, excluding the
 * safe-area padding beneath it. Include the bar's vertical padding so screens
 * reserve the real visible height instead of consuming their intended gap.
 */
export const TAB_BAR_HEIGHT = TAB_BAR_ITEM_HEIGHT + spacing.xs * 2;

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
