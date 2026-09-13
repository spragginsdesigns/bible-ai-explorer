import { describe, expect, it, vi } from "vitest";
import { completePlayPurchase } from "./googlePlayPurchase";

const purchase = { productId: "sureword_pro", store: "google", purchaseState: "purchased", purchaseToken: "test-token" };
describe("verified Play purchase completion", () => {
  it("never verifies or acknowledges pending purchases", async () => {
    const verify=vi.fn(),finish=vi.fn();
    expect(await completePlayPurchase({...purchase,purchaseState:"pending"},verify,finish)).toBe("pending");
    expect(verify).not.toHaveBeenCalled();expect(finish).not.toHaveBeenCalled();
  });
  it("ignores canceled, suspended and unrelated receipts", async () => {
    const verify=vi.fn(),finish=vi.fn();
    for(const p of [{...purchase,purchaseState:"unknown"},{...purchase,isSuspendedAndroid:true},{...purchase,productId:"other"},{...purchase,store:"apple"}])
      expect(await completePlayPurchase(p,verify,finish)).toBe("ignored");
    expect(verify).not.toHaveBeenCalled();expect(finish).not.toHaveBeenCalled();
  });
  it("does not acknowledge when verification returns false or fails", async () => {
    const finish=vi.fn();
    await expect(completePlayPurchase(purchase,async()=>false,finish)).rejects.toThrow("verify");
    await expect(completePlayPurchase(purchase,async()=>{throw new Error("unavailable")},finish)).rejects.toThrow("unavailable");
    expect(finish).not.toHaveBeenCalled();
  });
  it("acknowledges only after the backend grants access", async () => {
    const steps:string[]=[];
    expect(await completePlayPurchase(purchase,async()=>{steps.push("verify");return true;},async()=>{steps.push("finish");})).toBe("verified");
    expect(steps).toEqual(["verify","finish"]);
  });
  it("surfaces acknowledgment failures so restore can retry", async () => {
    await expect(completePlayPurchase(purchase,async()=>true,async()=>{throw new Error("ack failed")})).rejects.toThrow("ack failed");
  });
});
