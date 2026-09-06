import { describe, expect, it } from "vitest";
import { StackRouter } from "expo-router/build/react-navigation/routers/StackRouter";
import { TabRouter } from "expo-router/build/react-navigation/routers/TabRouter";

const routeParamList = {};

type RouterState = {
	index: number;
	routes: Array<{ key: string; name: string }>;
	history?: Array<{ key: string }>;
};

function stateOf<T extends RouterState>(value: unknown): T {
	if (!value || typeof value !== "object") throw new Error("router returned no state");
	return value as T;
}

function routerOptions(routeNames: string[]) {
	return { routeNames, routeParamList, routeGetIdList: {} };
}

function focusedTab(state: RouterState) {
	return state.routes[state.index]?.name;
}

function historyNames(state: RouterState) {
	return (state.history ?? []).map((item: { key: string }) =>
		state.routes.find((route: { key: string }) => route.key === item.key)?.name
	);
}

describe("Bible navigation contract", () => {
	it("keeps Cross inside the Bible stack and returns Cross then Bible home", () => {
		const tabs = TabRouter({ backBehavior: "history" });
		const tabRoutes = ["index", "bible", "notes", "settings", "memories"];
		let tabState = stateOf<RouterState>(tabs.getInitialState(routerOptions(tabRoutes)));
		tabState = stateOf<RouterState>(tabs.getStateForAction(
			tabState as never,
			{ type: "JUMP_TO", payload: { name: "bible" } },
			routerOptions(tabRoutes)
		));

		const bible = StackRouter({ initialRouteName: "index" });
		const bibleRoutes = ["index", "cross", "chapter"];
		let bibleState = stateOf<RouterState>(bible.getInitialState(routerOptions(bibleRoutes)));
		bibleState = stateOf<RouterState>(bible.getStateForAction(bibleState as never, {
			type: "PUSH",
			payload: { name: "cross" },
		}, routerOptions(bibleRoutes)));
		bibleState = stateOf<RouterState>(bible.getStateForAction(bibleState as never, {
			type: "PUSH",
			payload: { name: "chapter", params: { book: "43", chapter: "3" } },
		}, routerOptions(bibleRoutes)));

		expect(focusedTab(tabState)).toBe("bible");
		expect(bibleState.routes.map((route: { name: string }) => route.name)).toEqual([
			"index",
			"cross",
			"chapter",
		]);
		bibleState = stateOf<RouterState>(bible.getStateForAction(bibleState as never, { type: "GO_BACK" }, routerOptions(bibleRoutes)));
		expect(bibleState.routes[bibleState.index].name).toBe("cross");
		bibleState = stateOf<RouterState>(bible.getStateForAction(bibleState as never, { type: "GO_BACK" }, routerOptions(bibleRoutes)));
		expect(bibleState.routes[bibleState.index].name).toBe("index");
	});

	it("anchors a cold chapter deep link on Bible home", () => {
		const bible = StackRouter({ initialRouteName: "index" });
		const routes = ["chapter", "index", "cross"];
		let state = stateOf<RouterState>(bible.getInitialState(routerOptions(routes)));
		state = stateOf<RouterState>(bible.getStateForAction(state as never, {
			type: "NAVIGATE",
			payload: { name: "chapter", params: { book: "43", chapter: "3" } },
		}, routerOptions(routes)));

		expect(state.routes.map((route) => route.name)).toEqual(["index", "chapter"]);
		expect(state.routes[state.index]?.name).toBe("chapter");
	});

	it("captures the old hidden-tab failure as a negative control", () => {
		const tabs = TabRouter({ backBehavior: "history" });
		const routes = ["index", "bible", "notes", "settings", "memories", "cross"];
		let state = stateOf<RouterState>(tabs.getInitialState(routerOptions(routes)));
		for (const name of ["bible", "cross", "bible"]) {
			state = stateOf<RouterState>(tabs.getStateForAction(
				state as never,
				{ type: "JUMP_TO", payload: { name } },
				routerOptions(routes)
			));
		}

		expect(historyNames(state)).toEqual(["index", "cross", "bible"]);
		state = stateOf<RouterState>(tabs.getStateForAction(state as never, { type: "GO_BACK" }, routerOptions(routes)));
		expect(focusedTab(state)).toBe("cross");
		state = stateOf<RouterState>(tabs.getStateForAction(state as never, { type: "GO_BACK" }, routerOptions(routes)));
		expect(focusedTab(state)).toBe("index");
	});
});
