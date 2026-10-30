# Google Play membership verification

The Android purchase path uses the `sureword_pro` product and `monthly` base plan. The existing price is USD 15 per month. License testing uses Google's no-charge test instruments and accelerated periods; it does not change the customer plan or its price.

## Runtime contract

- Subscription access comes from Google's verified subscriptionsv2 state, account binding and current expiry. New sales can be disabled without revoking existing paid access or stopping background renewal checks.
- Quota accounting uses the exact funded order period, after validating the order ID, purchase token, product, monthly plan and period bounds. Grace and verified replacements retaining the same expiry preserve the existing quota bucket.
- Accounting failures preserve verified paid access and native acknowledgement. The previous bucket is retained conservatively, and verification remains stale so a later refresh can repair it. RTDN requests retry after committing valid entitlement. Each optional Orders request has a five-second timeout.
- Billing status derives plan, subscription and quota from one settled membership snapshot. A concurrent refresh winner cannot make a paid caller fall back to Free.
- Receipt binding, replacement, refresh and final account deletion use the same User lock. Deletion rereads and cancels the current token before dropping the account. Cancellation failure retains the account.
- New payment-provider relationships check other active providers under the lock. Existing paid relationships can still restore and reconcile. Previously issued Stripe checkout URLs are not reserved or canceled by these guards.

## Deployment and proof status

The 14-file billing source passed on immutable, unpromoted candidate `dpl_8q1QZozEAKWzLXDEyYEczm4TQCVE`, exported from main `13d167da` plus the selected billing changes. Sales-disabled candidate `dpl_Ba7iJGwqbd3pHEtx5KKeCeLeZQ3Y` uses the same source with its checkout flag off. The release also preserves newer main notification commit `48cc35c2`; its nine files do not overlap the billing source. Public publication follows the combined-source check and is recorded after deployment.

Observed on October 30, 2026:

| Check | Evidence |
| --- | --- |
| License configuration | Dedicated publishing-account-only test list saved in Play Console. No real payment instrument used. |
| Play event configuration | Enabled the existing SureWord Pub/Sub topic in Play Console. Console-generated notification delivered with HTTP 200. |
| Native purchase and restore | No-charge purchase completed, Android and authenticated API showed Pro, and native Restore purchase succeeded. |
| Reinstall | Reinstalled the exact existing QA APK with `adb install -r`; installation succeeded, the signed-in account and user data remained, and Android reopened with Pro during grace. No uninstall or data clear was used. |
| Real renewal | Captured RTDN type 2 at 18:32:05.964 UTC; persisted expiry advanced at 18:32:07.851 UTC without status requests. |
| Candidate accounting | Real receipt verification returned 200. The candidate stored the funded 18:37:00.388 to 18:42:00.388 UTC period and returned matching Pro and quota fields. |
| Account isolation | Another authorized test account was denied with 403; a forged receipt returned 400. |
| Cancellation and expiry | Cancellation retained Pro through the paid period, then Android and the API returned Free. |
| Deletion failure and retry | A new disposable account containing an imported copy of the owner's no-charge test receipt returned 400 without confirmation and 503 on cancellation failure, retaining DB and Clerk records. After repairing that fixture, the real DELETE handler returned 200, deleted its DB/Clerk records and stopped actual test renewal. This is a handler integration fixture, not a claim of a native purchase bound to that disposable account. |
| Test revocation | Google accepted revocation with 204. The candidate returned Free with a revoked subscription before the previous paid expiry. |
| Initial payment decline | Google's always-declines test instrument rejected the purchase. Android and the authenticated candidate retained Free. |
| Grace | Captured RTDN type 6. Google reported grace, Android and the candidate retained Pro, and the existing allowance remained available. |
| Account hold | Captured RTDN type 5. Google reported hold, Android and the candidate returned Free. |
| Payment recovery | Restored the approving test instrument and captured RTDN type 1. Google returned active; candidate verification returned 200, Pro resumed and the new funded period started at 18:58:36.075 UTC with 600 period messages, retaining daily usage. |
| New sales disabled | The isolated candidate returned `playCheckoutAvailable: false` and Pro. At the following period boundary it refreshed expiry and retained Pro with a matching status/quota snapshot. |
| Merchant configuration | Google's merchant summary showed a linked payout bank and payout schedule. No real charge, transaction settlement or cash payout was performed. |
| Static and regression checks | The exact 14-file candidate passed 161 focused billing/account tests, TypeScript and full-source ESLint, plus independent review. The production build completed. |

Pending slow test instruments were not offered for this configured checkout; the unit suite covers pending-purchase refusal. Known-token grace recovery with unchanged expiry and a changed paid order is covered by actual-flow regressions, including Orders outage followed by retry. These failed before the guard correction and passed afterward.

Local raw receipts and screenshots are intentionally ignored under `artifacts/billing-e2e-2026-10-30/`. They contain no persisted session tokens, purchase tokens or provider keys. A temporary pull-only Pub/Sub copy is used to record event type and time for the designated test purchase; it does not acknowledge the production consumer's messages.

An attempted direct signed replay to the protected candidate could not mint the designated RTDN identity. No IAM permission was broadened. Actual Play delivery, candidate receipt verification and post-publication event checks provide the product-path evidence.
