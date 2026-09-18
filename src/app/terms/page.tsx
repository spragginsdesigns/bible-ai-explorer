import type { Metadata } from "next";
import Link from "next/link";
import {
  FREE_DAILY_MESSAGES,
  PRO_DAILY_MESSAGES,
  PRO_MONTHLY_MESSAGES,
  PRO_MONTHLY_PRICE_CENTS,
} from "@/lib/billing/plans";

// The root layout's title template appends " | SureWord".
export const metadata: Metadata = {
  title: "Membership terms",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#101410] px-6 py-14 text-[#f3efe3]">
      <article className="mx-auto max-w-2xl space-y-7 leading-7">
        <Link href="/" className="text-[#d9b878]">
          Back to SureWord
        </Link>
        <h1 className="text-4xl">SureWord membership terms</h1>
        <p className="text-sm text-[#b6bcb0]">
          September 13, 2026 · LineCrush Inc.
        </p>
        <h2 className="text-xl">Free and Pro access</h2>
        <p>
          SureWord provides Bible study tools and AI assistance. Reading, notes,
          highlights and saved conversations remain available on the Free plan.
          Free includes {FREE_DAILY_MESSAGES} AI actions per day. Pro is $
          {PRO_MONTHLY_PRICE_CENTS / 100} USD per month and includes{" "}
          {PRO_MONTHLY_MESSAGES} AI actions per billing period, with up to{" "}
          {PRO_DAILY_MESSAGES} per day.
          Daily allowances reset at midnight UTC; membership settings show the
          corresponding local time. Unused messages do not roll over.
        </p>
        <h2 className="text-xl">What uses your allowance</h2>
        <p>
          New AI questions, regenerations, note composition, fresh verse
          explanations, generated reading plans and memory summaries count as AI
          actions. An answer and its tool calls count once. Reading saved
          content does not count. Included requests have size, output and
          processing limits; a larger study may need to be broken into smaller
          questions.
        </p>
        <h2 className="text-xl">Payments and cancellation</h2>
        <p>
          Subscriptions renew monthly until canceled. Checkout shows your price
          and any applicable taxes before payment. Manage billing allows you to
          cancel, update payment details and view invoices. Cancellation
          normally keeps paid access through the end of the current paid period.
          Failed payments, refunds or disputes may change access; saved study
          material remains available on Free. These terms do not limit rights
          available under applicable consumer law.
        </p>
        <h2 className="text-xl">Personal API keys</h2>
        <p>
          Personal API keys are optional and can be used on either plan. When
          you choose personal-key access, your AI provider bills the associated
          usage separately. Your provider&apos;s pricing, availability and terms
          apply. A personal key does not remove SureWord&apos;s service or abuse
          limits.
        </p>
        <h2 className="text-xl">Study responsibly</h2>
        <p>
          SureWord&apos;s AI can make mistakes. Verify quotations and references
          in Scripture, read passages in context, and consider interpretations
          carefully. SureWord is a study aid, not a replacement for Scripture,
          your church or appropriate professional assistance.
        </p>
        <h2 className="text-xl">Privacy and help</h2>
        <p>
          See our{" "}
          <Link href="/privacy" className="text-[#d9b878] underline">
            Privacy Policy
          </Link>{" "}
          for information about data handling and contact details. Plan changes
          will be communicated before they apply to a paid renewal.
        </p>
      </article>
    </main>
  );
}
