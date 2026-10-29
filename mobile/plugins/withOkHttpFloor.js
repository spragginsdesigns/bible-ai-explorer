// Forces OkHttp 4.12.1, the first 4.x release that blocks the eight eMudhra
// intermediate CAs Mozilla and Google reported compromised on 2026-10-22.
// React Native, PostHog (through RN networking), Fresco, Coil and media3 all
// reach the network through OkHttp, and without this the graph resolves
// 4.12.0, which still trusts them on devices whose trust store or Play
// Services hasn't been patched. Drop this once React Native pins >= 4.12.1.
const { withAppBuildGradle } = require("expo/config-plugins");

const OKHTTP_VERSION = "4.12.1";
const MARKER = "// sureword: okhttp CA floor";

const BLOCK = `
${MARKER}
configurations.all {
    resolutionStrategy {
        force "com.squareup.okhttp3:okhttp:${OKHTTP_VERSION}"
        force "com.squareup.okhttp3:okhttp-urlconnection:${OKHTTP_VERSION}"
    }
}
`;

module.exports = function withOkHttpFloor(config) {
	return withAppBuildGradle(config, (cfg) => {
		if (!cfg.modResults.contents.includes(MARKER)) {
			cfg.modResults.contents += BLOCK;
		}
		return cfg;
	});
};
