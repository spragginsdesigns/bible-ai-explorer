import React from "react";
import { Redirect, useLocalSearchParams, type Href } from "expo-router";

/** Old shared URLs stay valid while their destination belongs to its new tab. */
export function LegacyRoute({ pathname }: { pathname: string }) {
	const params = useLocalSearchParams();
	return <Redirect href={{ pathname, params } as Href} withAnchor />;
}
