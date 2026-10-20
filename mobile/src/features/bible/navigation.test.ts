import { describe, expect, it } from "vitest";
import { StackRouter } from "expo-router/build/react-navigation/routers/StackRouter";
import { TabRouter } from "expo-router/build/react-navigation/routers/TabRouter";
import { PRIMARY_TAB_ROUTES } from "@/lib/primaryTabs";

type State = { index: number; routes: Array<{ key: string; name: string; params?: Record<string, unknown> }> };
const options = (routeNames: string[]) => ({ routeNames, routeParamList: {}, routeGetIdList: {} });
const stateOf = (state: unknown) => state as State;
const focused = (state: State) => state.routes[state.index]?.name;

describe("Daily Walk navigation", () => {
 it.each(["today", "study"])("keeps a passage inside its %s context", (owner) => {
  const router = StackRouter({ initialRouteName: "index" });
  const opts = options(["index", "cross", "plan", "notes", "chapter"]);
  let state = stateOf(router.getInitialState(opts));
  const context = owner === "today" ? "cross" : "notes";
  for (const name of [context, "chapter"]) {
   state = stateOf(router.getStateForAction(state as never, { type: "PUSH", payload: { name, params: { book: "43", chapter: "3", verse: "16", translation: "KJV" } } }, opts));
  }
  expect(focused(state)).toBe("chapter");
  expect(state.routes[state.index].params).toMatchObject({ book: "43", chapter: "3", verse: "16", translation: "KJV" });
  state = stateOf(router.getStateForAction(state as never, { type: "GO_BACK" }, opts));
  expect(focused(state)).toBe(context);
  state = stateOf(router.getStateForAction(state as never, { type: "GO_BACK" }, opts));
  expect(focused(state)).toBe("index");
 });

 it("returns through actual tab history without a hidden feature tab", () => {
  const router = TabRouter({ backBehavior: "history", initialRouteName: "today" });
  const opts = options([...PRIMARY_TAB_ROUTES, "settings", "memories", "notes"]);
  let state = stateOf(router.getInitialState(opts));
  for (const name of ["bible", "connections", "study"]) {
   state = stateOf(router.getStateForAction(state as never, { type: "JUMP_TO", payload: { name } }, opts));
  }
  for (const name of ["connections", "bible", "today"]) {
   state = stateOf(router.getStateForAction(state as never, { type: "GO_BACK" }, opts));
   expect(focused(state)).toBe(name);
  }
  expect(router.getStateForAction(state as never, { type: "GO_BACK" }, opts)).toBeNull();
 });

 it.each(["cross", "plan", "notes", "chapter"])("anchors a cold %s destination above the owner's home", (name) => {
  const router = StackRouter({ initialRouteName: "index" });
  const opts = options([name, "index"]);
  let state = stateOf(router.getInitialState(opts));
  state = stateOf(router.getStateForAction(state as never, { type: "NAVIGATE", payload: { name } }, opts));
  expect(state.routes.map((route) => route.name)).toEqual(["index", name]);
 });
});
