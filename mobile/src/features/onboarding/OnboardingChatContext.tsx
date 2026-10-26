import { createContext, useContext } from "react";
import type { ChoiceCardView, ShowMeView } from "@/lib/chatView";

/**
 * What the chat screen lets a Walk with me card do. Provided by the Chat
 * screen so MessageBubble (memoized, and shared by every conversation) does
 * not carry a prop per card action. Absent outside the chat screen, where the
 * cards render read-only.
 */
export interface OnboardingChatActions {
	/** Do the step's device action (text size, reminder hour), then send the label. */
	answer: (card: ChoiceCardView, label: string) => void;
	/** "Type my own" or Speak: focus the composer. */
	typeOwn: (card: ChoiceCardView) => void;
	/** Light up a place in the app, or run the whole tour. */
	showMe: (card: ShowMeView) => void;
}

export const OnboardingChatContext = createContext<OnboardingChatActions | null>(null);

export function useOnboardingChat(): OnboardingChatActions | null {
	return useContext(OnboardingChatContext);
}
