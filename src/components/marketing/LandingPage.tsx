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
import { ANDROID_APK_URL, MACOS_DMG_URL } from "@/lib/constants";
import {
  PRO_MONTHLY_PRICE_CENTS,
  FREE_DAILY_MESSAGES,
  PRO_MONTHLY_MESSAGES,
  PRO_DAILY_MESSAGES,
} from "@/lib/billing/plans";
import styles from "./landing.module.css";

export default function LandingPage({
  billingOpen = false,
  limitsEnabled = false,
}: {
  billingOpen?: boolean;
  limitsEnabled?: boolean;
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
        <section className={styles.hero}>
          <div className={styles.intro}>
            <p className={styles.eyebrow}>
              <span /> A little space for what matters most
            </p>
            <h1>
              Come hungry
              <br />
              for <em>the Word.</em>
            </h1>
            <p className={styles.dek}>
              Bring your questions. Open your Bible. Find a little more
              understanding, one passage at a time.
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
            <div className={styles.downloads}>
              <a href={ANDROID_APK_URL}>
                Get Android <ArrowUpRight size={13} />
              </a>
              <a href={MACOS_DMG_URL}>
                Get macOS <ArrowUpRight size={13} />
              </a>
              <span>Or study right here on the web.</span>
            </div>
          </div>
          <div className={styles.study} aria-label="Example Scripture study">
            <div className={styles.studyTop}>
              <span>
                <BookOpen size={16} /> A moment in the Word
              </span>
              <span>JOHN 15 · KJV</span>
            </div>
            <div className={styles.passage}>
              <span className={styles.eyebrow}>Abide in me</span>
              <blockquote>
                “I am the vine, ye are the branches: He that abideth in me, and
                I in him, the same bringeth forth much fruit: for without me ye
                can do nothing.”
              </blockquote>
              <p>John 15:5</p>
            </div>
            <div className={styles.example}>
              <p className={styles.question}>
                What does it mean to abide in Christ?
              </p>
              <div className={styles.answer}>
                <span className={styles.smallBrand}>S</span>
                <div>
                  <p>
                    Jesus describes a life of dependence on Him. A branch bears
                    fruit because it remains connected to the vine. In the same
                    way, we depend on Christ as we receive His words and walk in
                    His love.
                  </p>
                  <p className={styles.reference}>
                    Read in context: John 15:1–10
                  </p>
                </div>
              </div>
              <div className={styles.sampleFooter}>
                <span>
                  Illustrative study · always read the passage in context
                </span>
                <Bookmark size={15} />
              </div>
            </div>
          </div>
        </section>
        <div className={styles.quietLine}>
          <span>Scripture at the center.</span>
          <span>Room for honest questions.</span>
          <span>A habit you can return to.</span>
        </div>
        <section id="experience" className={styles.experience}>
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>Made for your daily walk</p>
            <h2>
              Go a little deeper.
              <br />
              <em>Keep what you discover.</em>
            </h2>
          </div>
          <div className={styles.features}>
            <article>
              <BookOpen />
              <h3>Understand the passage</h3>
              <p>
                Ask about a verse, explore its context, and follow Scripture
                references back to the text.
              </p>
              <span>Read. Ask. Reflect.</span>
            </article>
            <article>
              <Bookmark />
              <h3>Make the study your own</h3>
              <p>
                Keep notes and highlights together. Return to the conversations
                that helped something click.
              </p>
              <span>Your discoveries, in one place.</span>
            </article>
            <article>
              <Heart />
              <h3>Build a daily rhythm</h3>
              <p>
                Follow a reading plan and return to Pick Up Your Cross for a
                daily invitation to reflect and respond.
              </p>
              <span>A small step, taken faithfully.</span>
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
              <p>A thoughtful place to begin.</p>
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
                  Thoughtful, Scripture-grounded AI
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
            We want to help people spend more time in Scripture and grow in
            understanding. Free access makes it easier to begin. Paid
            memberships help us keep building and cover the real cost of AI.
          </p>
          <span>A Christian Bible study companion by LineCrush Inc.</span>
        </section>
        <section className={styles.faq} aria-label="Common questions">
          <h2>A few honest answers.</h2>
          <details>
            <summary>Can I keep using SureWord for free?</summary>
            <p>
              Yes. Reading, notes, highlights and saved study remain accessible
              when your included AI allowance runs out. Free includes{" "}
              {FREE_DAILY_MESSAGES} messages each day, with no credit card
              required.
            </p>
          </details>
          <details>
            <summary>What counts as an AI message?</summary>
            <p>
              A new AI question, regeneration, note-composition request, fresh
              verse explanation, memory summary or generated reading plan counts
              as one action. Tools used within an answer do not count
              separately. Opening saved content does not use a message. Daily
              allowances reset at midnight UTC, shown in your local time in
              membership settings.
            </p>
          </details>
          <details>
            <summary>
              Does the AI replace reading the Bible or being part of a church?
            </summary>
            <p>
              No. SureWord is a study aid and its AI can make mistakes. Read
              cited passages in context, examine interpretations carefully, and
              stay connected to your local church.
            </p>
          </details>
          <details>
            <summary>Can I choose my own model?</summary>
            <p>
              Included AI uses a model selected by SureWord, so you can start
              immediately. Add a personal provider key in Settings to use
              supported models and reasoning options. Your provider bills that
              usage separately.
            </p>
          </details>
        </section>
        <section className={styles.closing}>
          <p className={styles.eyebrow}>Your next quiet moment starts here</p>
          <h2>
            Open the Word.
            <br />
            <em>Bring your questions.</em>
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
          <Link href="/sign-in">Sign in</Link>
        </div>
      </footer>
    </div>
  );
}
