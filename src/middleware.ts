import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
	"/sign-in(.*)",
	"/sign-up(.*)",
	"/api/webhooks(.*)",
	// The Clerk Frontend API proxy (src/app/%5F%5Fclerk) carries the sign-in
	// traffic itself, so protecting it would deadlock: you would need a session
	// to be allowed to make the calls that establish a session.
	"/__clerk(.*)",
]);

const isApiRoute = createRouteMatcher(["/api(.*)", "/trpc(.*)"]);

/**
 * Deny by default, but send signed-out visitors to our own /sign-in page.
 *
 * We do NOT use auth.protect() here. On this production Clerk instance it
 * resolved the sign-in destination to the hosted Account Portal at
 * accounts.bible-ai-explorer.vercel.app, which cannot exist - you cannot add
 * DNS records under vercel.app - so every signed-out page load died with
 * ERR_CONNECTION_CLOSED. With no portal reachable it then fell back to
 * rewriting the request to /_not-found, turning the whole site into a 404.
 *
 * Redirecting explicitly keeps the destination a fact of this file rather than
 * something derived from NEXT_PUBLIC_CLERK_SIGN_IN_URL being inlined correctly
 * at build time, which is exactly the sort of indirection that produced a
 * site-wide outage with no error anywhere.
 */
export default clerkMiddleware(async (auth, request) => {
	if (isPublicRoute(request)) return;

	const { userId } = await auth();
	if (userId) return;

	// API callers get a status they can act on, not an HTML login page. The
	// mobile client depends on this: it retries once with a fresh token on 401.
	if (isApiRoute(request)) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const signInUrl = new URL("/sign-in", request.url);
	signInUrl.searchParams.set("redirect_url", request.url);
	return NextResponse.redirect(signInUrl);
});

export const config = {
	matcher: [
		// Skip Next.js internals and all static files
		"/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
		// Always run for API routes
		"/(api|trpc)(.*)",
	],
};
