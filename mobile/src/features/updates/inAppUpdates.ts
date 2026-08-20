import { useEffect } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import SpInAppUpdates, {
	IAUInstallStatus,
	IAUUpdateKind,
	type StatusUpdateEvent,
} from "sp-react-native-in-app-updates";

/**
 * Google Play in-app updates (Play Core), Android only.
 *
 * Two paths:
 * - `useInAppUpdates()` runs once per app session at launch: if the Play Store
 *   has a newer build, a FLEXIBLE update downloads in the background and
 *   installs itself the moment the download finishes - the app stays usable
 *   the whole time.
 * - `checkForUpdate()` backs the Settings → "Check for updates" row: a manual
 *   check that hands over to Play's full-screen IMMEDIATE flow when an update
 *   exists.
 *
 * Every path is wrapped: a sideloaded or dev build is not "owned" by Play and
 * the API rejects it - that must degrade to "no update", never an error.
 */

let updater: SpInAppUpdates | null = null;

function getUpdater(): SpInAppUpdates {
	if (!updater) updater = new SpInAppUpdates(false);
	return updater;
}

function currentVersion(): string {
	return Constants.expoConfig?.version ?? "0.0.0";
}

/** Auto-update at launch: flexible download, self-install when it lands. */
export function useInAppUpdates(): void {
	useEffect(() => {
		if (Platform.OS !== "android" || __DEV__) return;
		const spUpdater = getUpdater();
		const onStatus = (status: StatusUpdateEvent) => {
			if (status.status === IAUInstallStatus.DOWNLOADED) {
				void spUpdater.installUpdate();
			}
		};
		spUpdater.addStatusUpdateListener(onStatus);
		void (async () => {
			try {
				const result = await spUpdater.checkNeedsUpdate({ curVersion: currentVersion() });
				if (result.shouldUpdate) {
					await spUpdater.startUpdate({ updateType: IAUUpdateKind.FLEXIBLE });
				}
			} catch {
				// Sideloaded/dev build or Play unreachable - nothing to update.
			}
		})();
		return () => spUpdater.removeStatusUpdateListener(onStatus);
	}, []);
}

export type UpdateCheckResult = "started" | "up-to-date" | "unavailable";

/** Manual check from Settings; "started" means Play's update UI took over. */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
	if (Platform.OS !== "android") return "unavailable";
	try {
		const spUpdater = getUpdater();
		const result = await spUpdater.checkNeedsUpdate({ curVersion: currentVersion() });
		if (!result.shouldUpdate) return "up-to-date";
		await spUpdater.startUpdate({ updateType: IAUUpdateKind.IMMEDIATE });
		return "started";
	} catch {
		return "unavailable";
	}
}
