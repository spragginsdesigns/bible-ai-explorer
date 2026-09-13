const PRODUCTION_ORIGIN = "https://sureword.app";

/** A server setting, never a destination supplied by the checkout caller. */
export function resolveBillingReturnOrigin(
  raw: string | undefined,
  testMode: boolean,
): string {
  const url = new URL(raw?.trim() || PRODUCTION_ORIGIN);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Billing return origin must contain only a scheme and host.",
    );
  if (!testMode && url.origin !== PRODUCTION_ORIGIN)
    throw new Error("Live billing must return to SureWord.");
  const localTest =
    testMode &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !localTest)
    throw new Error("Billing requires HTTPS except for local sandbox tests.");
  return url.origin;
}
