export const PRIMARY_TAB_ROUTES = ["index", "bible", "notes"] as const;

export type PrimaryTabRoute = (typeof PRIMARY_TAB_ROUTES)[number];

const PRIMARY_TAB_ROUTE_SET = new Set<string>(PRIMARY_TAB_ROUTES);

export function isPrimaryTabRoute(
	routeName: string,
): routeName is PrimaryTabRoute {
	return PRIMARY_TAB_ROUTE_SET.has(routeName);
}
