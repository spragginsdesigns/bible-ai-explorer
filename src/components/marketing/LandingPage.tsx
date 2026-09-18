import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  BookOpen,
  Bookmark,
  Heart,
  Check,
  ArrowUpRight,
} from "lucide-react";
import PlatformDownloads from "./PlatformDownloads";
import PersonalStudyExample from "./PersonalStudyExample";
import type { InstallPlatform } from "@/lib/install-platform";
import {
  PRO_MONTHLY_PRICE_CENTS,
  FREE_DAILY_MESSAGES,
  PRO_MONTHLY_MESSAGES,
  PRO_DAILY_MESSAGES,
} from "@/lib/billing/plans";
import { LANDING_FAQ } from "@/lib/marketing/faq";
import styles from "./landing.module.css";

const SITE_URL = "https://sureword.app";

// Kept identical to the root metadata description in src/app/layout.tsx so the
// rich result and the meta description tell search engines the same thing.
const APP_DESCRIPTION =
  "Come hungry for the Word. SureWord is a KJV Bible study app and personal Bible study companion with AI. Ask any Bible question and get answers grounded in Scripture.";

const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: "SureWord",
      url: SITE_URL,
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#app`,
      name: "SureWord",
      applicationCategory: "ReferenceApplication",
      operatingSystem: "Web, Android, macOS",
      url: SITE_URL,
      description: APP_DESCRIPTION,
      publisher: {
        "@type": "Organization",
        name: "LineCrush Inc.",
        url: SITE_URL,
      },
      offers: [
        {
          "@type": "Offer",
          name: "SureWord Free",
          price: 0,
          priceCurrency: "USD",
        },
        {
          "@type": "Offer",
          name: "SureWord Pro",
          price: PRO_MONTHLY_PRICE_CENTS / 100,
          priceCurrency: "USD",
        },
      ],
    },
    {
      "@type": "FAQPage",
      "@id": `${SITE_URL}/#faq`,
      mainEntity: LANDING_FAQ.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.answer,
        },
      })),
    },
  ],
};

export default function LandingPage({
  billingOpen = false,
  limitsEnabled = false,
  installPlatform = "other",
}: {
  billingOpen?: boolean;
  limitsEnabled?: boolean;
  installPlatform?: InstallPlatform;
}) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
          <Image src="/icon-192.png" alt="" width={36} height={36} />
          SureWord
        </Link>
        <nav aria-label="Website">
          <a href="#experience">The experience</a>
          <a href="#pricing">Membership</a>
          <Link href="/sign-in">
            Sign in <ArrowUpRight size={14} />
          </Link>
        </nav>
      </header>
      <main>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
        />
        <section className={styles.hero}>
          <div className={styles.intro}>
            <p className={styles.eyebrow}>
              <span /> Bible study that grows with you
            </p>
            <h1>
              Come hungry
              <br />
              for <em>the Word.</em>
            </h1>
            <p className={styles.dek}>
              A personal Bible study companion that remembers what you share
              and builds on what you read. Your questions, goals and daily walk
              help shape a study experience that becomes more your own over time.
            </p>
            <Link href="/sign-up" className={styles.primary}>
              Start studying free <ArrowRight size={18} />
            </Link>
            <p className={styles.fine}>
              {limitsEnabled
                ? `${FREE_DAILY_MESSAGES} free AI messages every day. `
                : "Start free. "}
              No credit card required.
            </p>
            <PlatformDownloads initialPlatform={installPlatform} />
          </div>
          <PersonalStudyExample />
        </section>
        <div className={styles.quietLine}>
          <span>Grounded in Scripture.</span>
          <span>Shaped by your own walk.</span>
          <span>Building on what came before.</span>
        </div>
        <section id="experience" className={styles.experience}>
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>More personal with every chapter</p>
            <h2>
              Your walk has a story.
              <br />
              <em>Your study can build on it.</em>
            </h2>
            <p>
              As you read, ask questions and reflect, SureWord has more of your
              own context to draw on. A conversation today can help shape what
              you explore tomorrow.
            </p>
          </div>
          <div className={styles.features}>
            <article>
              <BookOpen />
              <h3>It remembers what matters to you</h3>
              <p>
                With memory enabled, SureWord can remember your study goals,
                preferences and things you share across conversations. Keep
                building on a question without starting from scratch each time.
              </p>
              <span>Your context comes with you.</span>
            </article>
            <article>
              <Bookmark />
              <h3>It follows your reading</h3>
              <p>
                Chapters you read in SureWord become part of your reading
                history. Your notes, highlights and earlier questions give your
                study more context, helping you connect what you’re learning.
              </p>
              <span>Each passage adds to your journey.</span>
            </article>
            <article>
              <Heart />
              <h3>It helps you find your next step</h3>
              <p>
                Explore questions suggested from your own study, create a
                reading plan around a goal, and return to Pick Up Your Cross
                for a daily reflection shaped by your reading and personal context.
              </p>
              <span>A reason to return to the Word.</span>
            </article>
          </div>
        </section>
        <section id="pricing" className={styles.pricing}>
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>A place for everyone</p>
            <h2>
              Start freely.
              <br />
              <em>Grow at your own pace.</em>
            </h2>
            <p>
              Reading Scripture and keeping your study material stay free. Pro
              helps cover AI costs and continued development.
            </p>
          </div>
          <div className={styles.plans}>
            <article className={styles.plan}>
              <span className={styles.eyebrow}>SureWord Free</span>
              <h3>
                $0 <span>always</span>
              </h3>
              <p>Your personal study starts here.</p>
              <ul>
                <li>
                  <Check />
                  Bible reading, notes and highlights
                </li>
                <li>
                  <Check />
                  Saved study conversations
                </li>
                <li>
                  <Check />
                  Personal memories and reading history
                </li>
                <li>
                  <Check />
                  {limitsEnabled
                    ? `${FREE_DAILY_MESSAGES} included AI messages per day`
                    : "Included AI to start studying"}
                </li>
                <li>
                  <Check />
                  No model or API key setup needed
                </li>
              </ul>
              <Link className={styles.secondary} href="/sign-up">
                Begin your study <ArrowRight size={17} />
              </Link>
            </article>
            <article className={`${styles.plan} ${styles.pro}`}>
              <span className={styles.eyebrow}>
                SureWord Pro {billingOpen ? "" : "· Coming soon"}
              </span>
              <h3>
                ${PRO_MONTHLY_PRICE_CENTS / 100} <span>/ month</span>
              </h3>
              <p>More room for deeper conversations.</p>
              <ul>
                <li>
                  <Check />
                  Everything in Free
                </li>
                <li>
                  <Check />
                  {PRO_MONTHLY_MESSAGES} included AI messages per billing month
                </li>
                <li>
                  <Check />
                  Up to {PRO_DAILY_MESSAGES} messages on a study day
                </li>
                <li>
                  <Check />
                  More room to build on your personal study
                </li>
              </ul>
              <Link
                className={styles.primary}
                href={billingOpen ? "/membership" : "/sign-up"}
              >
                {billingOpen ? "Explore Pro" : "Start free today"}
                <ArrowRight size={17} />
              </Link>
              <p className={styles.fine}>
                {billingOpen
                  ? "Renews monthly. Cancel through billing settings."
                  : "Pro memberships are coming soon. Start free today."}
              </p>
            </article>
          </div>
          <p className={styles.byok}>
            Already have an AI API key? <strong>Bring it with you.</strong>{" "}
            Personal keys work on Free or Pro, with usage billed by your
            provider.
          </p>
        </section>
        <section className={styles.mission}>
          <span className={styles.eyebrow}>Why we built SureWord</span>
          <h2>
            Helpful to others first.
            <br />
            <em>Sustainable for the long run.</em>
          </h2>
          <p>
            Each person brings their own questions, history and hopes to
            Scripture. We’re building SureWord to help you grow in understanding
            and apply what you read to your own daily walk. Free access makes it
            easier to begin. Paid memberships help us keep building and cover
            the real cost of AI.
          </p>
          <span>A Christian Bible study companion by LineCrush Inc.</span>
        </section>
        <section className={styles.faq} aria-label="Common questions">
          <h2>A few honest answers.</h2>
          {LANDING_FAQ.map((item) => (
            <details key={item.question}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </section>
        <section className={styles.closing}>
          <p className={styles.eyebrow}>A personal place to grow in the Word</p>
          <h2>
            Start with a question.
            <br />
            <em>Build on it tomorrow.</em>
          </h2>
          <Link href="/sign-up" className={styles.primary}>
            Start studying free <ArrowRight size={18} />
          </Link>
        </section>
      </main>
      <footer className={styles.footer}>
        <Link href="/" className={styles.brand}>
          SureWord
        </Link>
        <span>© {new Date().getFullYear()} LineCrush Inc.</span>
        <div>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <a href="/llms.txt">llms.txt</a>
          <Link href="/sign-in">Sign in</Link>
        </div>
      </footer>
    </div>
  );
}
