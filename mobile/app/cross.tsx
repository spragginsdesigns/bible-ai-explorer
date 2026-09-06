import React from "react";
import { Redirect } from "expo-router";

/**
 * Preserve old notification/deep-link URLs while keeping Cross inside the
 * Bible stack. The anchor makes a cold `/cross` link include Bible home below
 * the destination before Android Back is handled.
 */
export default function LegacyCrossRedirect() {
	return <Redirect href="/bible/cross" withAnchor />;
}
