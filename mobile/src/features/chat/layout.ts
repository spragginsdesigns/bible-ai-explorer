import { useEffect, useState, useSyncExternalStore } from "react";
import { Keyboard } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { spacing } from "@/theme";

/** Height of each tab target rendered by app/(app)/_layout.tsx. */
export const TAB_BAR_ITEM_HEIGHT = 72;

/**
 * Full height of the tab bar rendered by app/(app)/_layout.tsx, excluding the
 * safe-area padding beneath it. Include the bar's vertical padding so screens
 * reserve the real visible height instead of consuming their intended gap.
 */
export const TAB_BAR_HEIGHT = TAB_BAR_ITEM_HEIGHT + spacing.xs * 2;

let measuredTabBarHeight: number | null = null;
const tabBarListeners = new Set<() => void>();
const subscribeTabBar = (listener: () => void) => {
	tabBarListeners.add(listener);
	return () => { tabBarListeners.delete(listener); };
};

/** Reserve the actual wrapped tab bar, including OS accessibility scaling. */
export function recordTabBarHeight(height: number) {
	if (!Number.isFinite(height) || height <= 0 || Math.abs(height - (measuredTabBarHeight ?? 0)) < 0.5) return;
	measuredTabBarHeight = height;
	tabBarListeners.forEach(listener => listener());
}

/** Vertical space the floating tab bar occupies at the bottom of a screen. */
export function useTabBarSpace(): number {
	const insets = useSafeAreaInsets();
	const keyboardVisible = useKeyboardVisible();
	const measured = useSyncExternalStore(subscribeTabBar, () => measuredTabBarHeight);
	// The keyboard covers the tab bar, so its clearance is not needed while
	// typing - otherwise the input would float above a dead gap.
	return keyboardVisible ? 0 : measured ?? TAB_BAR_HEIGHT + Math.max(insets.bottom, spacing.sm);
}

/** True while the soft keyboard is shown. */
export function useKeyboardVisible(): boolean {
	const [visible, setVisible] = useState(() => (Keyboard.metrics()?.height ?? 0) > 0);

	useEffect(() => {
		// Android can report a visible IME with zero height for a hardware
		// keyboard. Keep tab clearance then, or Send ends up under the tabs.
		const show = Keyboard.addListener("keyboardDidShow", event => setVisible(event.endCoordinates.height > 0));
		const hide = Keyboard.addListener("keyboardDidHide", () => setVisible(false));
		return () => {
			show.remove();
			hide.remove();
		};
	}, []);

	return visible;
}
