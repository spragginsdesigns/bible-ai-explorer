let launchAnimationStarted = false;

/**
 * The module is recreated only when Android starts a fresh JavaScript process,
 * which is exactly a cold start. Returning from the background, activity/root
 * recreation and permission dialogs all keep the process, so none of them
 * replay the launch animation (Austin, 2026-10-11: once per real open only).
 */
export function shouldShowLaunchAnimationThisSession() {
	return !launchAnimationStarted;
}

export function markLaunchAnimationStartedThisSession() {
	launchAnimationStarted = true;
}

export function resetLaunchAnimationSessionForTests() {
	launchAnimationStarted = false;
}
