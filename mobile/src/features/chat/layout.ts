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
	return TAB_BAR_HEIGHT + Math.max(insets.bottom, spacing.sm);
}
