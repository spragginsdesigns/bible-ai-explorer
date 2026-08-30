let launchAnimationStarted = false;

/**
 * The module is recreated only when Android starts a fresh JavaScript process.
 * Activity/root recreation inside that process must not replay the launch video.
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
