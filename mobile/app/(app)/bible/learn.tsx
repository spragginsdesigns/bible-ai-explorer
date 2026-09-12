import LearnScreen from "@/features/learn/LearnScreen";

/**
 * N4 Learn a verse. One verse per screen, one job; the queue and schedule
 * are the server's (docs/FEATURES.md contract), and the screen rehearses
 * offline from the bundled KJV when the API cannot be reached.
 */
export default function LearnRoute() {
	return <LearnScreen />;
}
