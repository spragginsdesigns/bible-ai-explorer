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
          <div className={styles.study} aria-label="Illustrative personalized Scripture study">
            <div className={styles.studyTop}>
              <span>
                <BookOpen size={16} /> Building on your study
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
              <p className={styles.personalContext}>
                Your recent reading: John 15<br />
                Your remembered goal: a steadier daily reading habit
              </p>
              <p className={styles.question}>
                How can I live this out on a busy day?
              </p>
              <div className={styles.answer}>
                <span className={styles.smallBrand}>S</span>
                <div>
                  <p>
                    Jesus describes dependence on Him: a branch bears fruit by
                    remaining in the vine. For the reading habit you’re building,
                    begin with a few verses from John 15. Carry one question into
                    your day: where can I depend on Christ and put His words
                    into practice?
                  </p>
                  <p className={styles.reference}>
                    Read in context: John 15:1–10
                  </p>
                </div>
              </div>
              <div className={styles.sampleFooter}>
                <span>
                  Illustrative personal context and answer · John 15:1–10
                </span>
                <Bookmark size={15} />
              </div>
            </div>
          </div>
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
          <details>
            <summary>How does SureWord become more personal?</summary>
            <p>
              SureWord draws on your saved memories, reading history, questions
              and notes to give future conversations context. Suggested questions
              and Pick Up Your Cross can build on what you’ve been studying and
              what matters to you. You can also choose your Bible translation,
              appearance and reading goals to make the experience your own.
            </p>
          </details>
          <details>
            <summary>Can I choose what SureWord remembers?</summary>
            <p>
              Yes. Ask it to remember, correct or forget a detail, or manage your
              saved memories in Settings. You can turn memory off there too.
              Removing a memory does not delete your notes, conversations or
              reading history.
            </p>
          </details>
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
          <Link href="/sign-in">Sign in</Link>
        </div>
      </footer>
    </div>
  );
}
