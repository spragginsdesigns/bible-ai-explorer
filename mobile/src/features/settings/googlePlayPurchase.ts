export type StorePurchase = {
  productId: string;
  purchaseToken?: string | null;
  store: string;
  purchaseState: string;
  isSuspendedAndroid?: boolean | null;
};

/** Pending receipts must never be verified or acknowledged as paid. */
export async function completePlayPurchase<T extends StorePurchase>(
  purchase: T,
  verify: (purchase: T) => Promise<boolean>,
  finish: (purchase: T) => Promise<void>,
): Promise<"verified" | "pending" | "ignored"> {
  if (purchase.productId !== "sureword_pro" || purchase.store !== "google" || purchase.isSuspendedAndroid) return "ignored";
  if (purchase.purchaseState === "pending") return "pending";
  if (purchase.purchaseState !== "purchased" || !purchase.purchaseToken) return "ignored";
  if (!await verify(purchase)) throw new Error("Google Play could not verify this purchase. Please restore it again shortly.");
  await finish(purchase);
  return "verified";
}
