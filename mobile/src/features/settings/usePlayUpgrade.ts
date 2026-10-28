import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { apiJson, type GetToken } from "@/lib/api";
import { canOfferPlayUpgrade, type UpgradeStatus } from "./membershipView";

/**
 * Whether a Pro wall should show "See SureWord Pro" (which opens the
 * Membership card in Settings -> AI, where Pro is bought through Google Play).
 * Reads /api/billing/status only while `enabled`, so a Pro reader or a screen
 * with no wall on it never pays for the request. Any failure answers false:
 * no button beats a button that leads nowhere.
 */
export function usePlayUpgrade(getToken: GetToken, enabled: boolean): boolean {
	const [offer, setOffer] = useState(false);
	useEffect(() => {
		if (!enabled || Platform.OS !== "android") {
			setOffer(false);
			return;
		}
		let live = true;
		void apiJson<UpgradeStatus>(getToken, "/api/billing/status")
			.then((status) => {
				if (live) setOffer(canOfferPlayUpgrade(Platform.OS, status));
			})
			.catch(() => {
				if (live) setOffer(false);
			});
		return () => {
			live = false;
		};
	}, [getToken, enabled]);
	return offer;
}
