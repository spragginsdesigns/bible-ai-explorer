import { BookOpen, ChevronDown } from "lucide-react";
import styles from "./personal-study-example.module.css";

// Curated excerpts from Austin's September 10 and 11 conversations and
// September 11 and 12 reflections. Austin confirmed he read both September
// 11 reflections and that they helped, without being the main reason he felt
// closer to God. This public sample never reads account data.
export default function PersonalStudyExample() {
  return (
    <figure className={styles.study} aria-label="A real SureWord study across three days">
      <div className={styles.header}>
        <span><BookOpen size={16} aria-hidden="true" /> Your walk, remembered</span>
        <span className={styles.realStudy}>A real study</span>
      </div>

      <ol className={styles.journey} aria-label="Earlier conversations and the reflections read between them">
        <li>
          <p className={styles.when}>You shared <time dateTime="2026-09-10">Sept 10</time></p>
          <blockquote>
            “I feel like my faith is slipping away lately. I feel less close to God.”
          </blockquote>
          <div className={styles.reply}>
            <p className={styles.replyLabel}><span aria-hidden="true">S</span> SureWord replied · excerpt</p>
            <blockquote>
              Feeling distant from God is not the same thing as being distant
              from God; His nearness to you was never based on your emotional
              temperature to begin with, but on the finished work of Christ
              and His own promise.
            </blockquote>
          </div>
        </li>
        <li className={styles.morning}>
          <p className={styles.when}>You read <time dateTime="2026-09-11">Sept 11 · morning</time></p>
          <p className={styles.morningTitle}>Pick Up Your Cross</p>
          <p className={styles.transcriptIntro}>From the personal reflections you read that morning</p>
          <div className={styles.transcript}>
            <p className={styles.transcriptTitle}>Draw Nigh to God <span>James 4:8</span></p>
            <blockquote className={styles.scriptureExcerpt}>
              “Draw nigh to God, and he will draw nigh to you.”
              <cite>KJV · excerpt</cite>
            </blockquote>
            <blockquote className={styles.transcriptExcerpt}>
              <p>
                God’s Word meets that longing to return with a clear invitation.
                Draw nigh to God. It also gives you a direct call to deal honestly
                with what has been drawing you away. Cleanse your hands, and
                purify your heart.
              </p>
              <p className={styles.transcriptHighlight}>
                Your confidence to draw near rests in what Christ has provided,
                not in your ability to make yourself worthy.
              </p>
            </blockquote>
            <details className={styles.transcriptDetails}>
              <summary>More from this reflection <ChevronDown size={14} aria-hidden="true" /></summary>
              <blockquote>
                <p>
                  Begin today with James chapter four. Watch how humility,
                  repentance, submission to God, resistance to the devil, and
                  refusal of friendship with the world belong together in
                  drawing near to God. Then read Psalm fifty-one. Notice how
                  David brings his sin plainly before God and asks for a clean
                  heart and a renewed spirit. Finish with Hebrews chapter ten.
                  Look for the confidence you have through Christ to draw near
                  with a true heart and to hold fast your faith.
                </p>
              </blockquote>
            </details>
          </div>
          <div className={styles.transcript}>
            <p className={styles.transcriptTitle}>Renewed Instead of Conformed <span>Romans 12:2</span></p>
            <blockquote className={styles.scriptureExcerpt}>
              “be ye transformed by the renewing of your mind”
              <cite>KJV · excerpt</cite>
            </blockquote>
            <blockquote className={styles.transcriptExcerpt}>
              <p>
                Keep this practical. Notice one worldly pattern in your thinking
                today. Refuse to let it direct you, and replace it with what
                God’s Word says. Then let that renewed thinking produce one
                concrete act of obedience to God’s good, acceptable, and
                perfect will.
              </p>
              <p className={styles.transcriptHighlight}>
                Keep bringing this trouble to the Lord in prayer. Don’t accept
                the world’s pattern as inevitable when Scripture calls you to
                be transformed.
              </p>
            </blockquote>
            <details className={styles.transcriptDetails}>
              <summary>More from this reflection <ChevronDown size={14} aria-hidden="true" /></summary>
              <blockquote>
                <p>
                  Notice where this command stands. Romans chapter twelve begins
                  with the mercies of God. Verse one says, “I beseech you
                  therefore, brethren, by the mercies of God, that ye present
                  your bodies a living sacrifice, holy, acceptable unto God,
                  which is your reasonable service.” Then comes the call not
                  to be conformed, but transformed. A renewed mind isn’t
                  separated from daily obedience. Your thinking, your body,
                  your choices, and your service to God belong together.
                </p>
              </blockquote>
            </details>
          </div>
        </li>
        <li>
          <p className={styles.when}>You returned <time dateTime="2026-09-11">Sept 11 · evening</time></p>
          <blockquote>
            “I feel closer to God today than I have in weeks. Praise the Lord.”
          </blockquote>
          <div className={styles.reply}>
            <p className={styles.replyLabel}><span aria-hidden="true">S</span> SureWord replied · excerpt</p>
            <blockquote>
              It is also encouraging that your heart is recognizing God’s
              goodness rather than taking these blessings for granted. Keep
              walking with Him today through simple gratitude, prayer, and
              obedience.
            </blockquote>
          </div>
          <aside className={styles.contribution} aria-label="My reflection on that day">
            <span>Looking back</span>
            <p>
              These reflections weren’t the main reason I felt closer to God
              that day, but they helped me a great deal.
            </p>
          </aside>
        </li>
      </ol>

      <div className={styles.passage}>
        <p className={styles.eyebrow}>The next morning · Sept 12</p>
        <blockquote>“Lord, I believe; help thou mine unbelief.”</blockquote>
        <p className={styles.verse}>Mark 9:24 · KJV · excerpt</p>
        <p className={styles.context}>A father brings his struggling faith to Jesus.</p>
      </div>

      <div className={styles.reflection}>
        <div className={styles.reflectionHeading}>
          <span className={styles.brand} aria-hidden="true">S</span>
          <p>Pick Up Your Cross <span>Your personal daily reflection</span></p>
        </div>
        <p className={styles.whyToday}>
          You recently said you were afraid your faith was slipping, even as you
          prayed for God to draw you closer. You later praised the Lord for
          feeling closer to Him, and Mark 9:24 gives you words for continuing
          to depend on Him without hiding your weakness.
        </p>
        <p className={styles.takeaway}>
          Do not wait until your faith feels strong before coming to the Lord.
        </p>
        <p className={styles.readInContext}>Read in context: Mark 9:14–29</p>
      </div>

      <figcaption className={styles.caption}>
        From my own walk with God. Real conversations and reflections, excerpted.
      </figcaption>
    </figure>
  );
}
