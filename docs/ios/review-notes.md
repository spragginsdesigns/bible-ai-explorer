# App Review notes

Prepared for iOS 1.31.0 on 2026-11-03; not yet written to App Store Connect.
The live 1.30.0 notes still describe the review account as Free. The final
acceptance run restored that account to Pro, and native Android QA confirmed
Pro active. Keep the account on Pro and correct the notes rather than change
its plan to match stale copy. App Store Connect currently reports the monthly
subscription APPROVED and 1.30.0 DEVELOPER_REJECTED; 1.26.0 is READY_FOR_SALE.

Credentials belong only in App Store Connect's Sign-in Information and the
private vault. Preserve the existing email, password and contact fields;
never copy them into this document or release evidence. The review account
uses normal Clerk password sign-in.

## Notes field

```text
SIGN IN
Use the demo email and password in Sign-in Information. Tap Sign in on the welcome screen, enter the email, Continue, then the password. The supplied account currently has Pro active. Please keep this account for review.

SUREWORD
SureWord is a Christian Bible study app rooted in the King James Version. Bible text is bundled for offline reading. Today opens the daily Cross; Bible opens books, chapters and translations. Study includes Notes and the offline Timeline, People and Places Atlas.

AI AND SAVED ANSWERS
Chat accepts Bible questions, photos, documents and audio files. Audio attachments show their transcript. AI sharing requires disclosure consent; Settings > AI shows the permission and withdrawal control. Saved answers are checked before display, and their original content remains available separately. Study > Notes supports manual editing and AI assistance.

SUREWORD PRO
The supplied account shows Pro active, so it does not show Subscribe. Free accounts can open the StoreKit purchase screen at Settings > AI > SureWord Pro. The approved monthly product is com.spragginsdesigns.sureword.pro.monthly. The purchase screen includes price, Subscribe, Restore Purchases, terms and privacy links. Use a Sandbox Apple Account for purchase testing. Pro includes Listen, the spoken devotional, and more AI usage.

VOICE PREVIEW
Hands-free device speech is restricted to the verified developer owner. It is not enabled for the supplied review account. Experimental GPT-Live is disabled in production.

REPORTING AND DELETION
Thumbs-down under an answer reports a problem. Settings > Send feedback reaches the developer. Delete account is under Settings > the profile row; please do not delete the supplied account.

NOTIFICATIONS
Optional permission is requested when a relevant feature is enabled, never at launch. There are no ads or user-to-user messages.

Privacy: https://sureword.app/privacy
Support: https://sureword.app/support
Contact: spragginsdesigns@gmail.com
```

## Verification limits

The eight-case Free/Pro API run and Apple saved-history/native note tests are
separate gates. The note rewrite test proved note persistence while the
assistant explanation remained withheld. Original export checks proved the
expected snippet and sheet opening/cancellation, not full file equality or a
saved file. Notification runtime was explicitly skipped. Owner microphone
and blind-user acceptance must not be inferred from the review account.

The disk cleanup deleted the original iOS archive and native QA files. The
new archive and any fresh simulator tests must be recorded separately from
recovered, hash-identical historical receipts. Reuse the existing iOS
simulator; the Mac may have two iOS simulators total at most.
