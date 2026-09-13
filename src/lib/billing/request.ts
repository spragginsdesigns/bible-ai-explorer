/** Browser writes must originate from this site. Native bearer callers omit Origin. */
export function rejectCrossSiteMutation(req: Request): Response | null {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) {
    return Response.json(
      { error: "Cross-site billing request rejected." },
      { status: 403 },
    );
  }
  return null;
}
