import { Composition } from "remotion";
import { SureWordSplash } from "./SureWordSplash";

export const SureWordSplashComposition = () => {
	return (
		<Composition
			id="SureWordSplash"
			component={SureWordSplash}
			durationInFrames={84}
			fps={30}
			width={1080}
			height={2340}
		/>
	);
};
