import SwiftUI

/// The reader's page surface: photoreal aged parchment (light) and a dark
/// leather-toned sheet (dark), the same two textures Android loads from
/// `mobile/assets/` and web sets on `.parchment-page` - generated together by
/// `scripts/generate-parchment.mjs`, converted into the asset catalogue as
/// JPEG (the source WebP is not an asset-catalogue format).
///
/// Kept out of `ChapterReaderPane` so it can be reasoned about on its own: it
/// is a *fixed* sheet the verses scroll over, like text moving across an
/// unrolled scroll under a lamp, which is what Android does with an absolutely
/// positioned image behind its list. Nothing here is greedy inside the scroll
/// content, so it cannot join the reader's layout minefield (see
/// `macos/README.md`).
private struct ParchmentSheet: View {
    @Environment(\.theme) private var theme

    var body: some View {
        Image(theme.isDark ? "ParchmentDark" : "ParchmentLight")
            .resizable()
            // The texture is a 2:3 portrait plate; filling and clipping keeps
            // its grain at a constant scale whatever the window is doing,
            // where a stretch would smear it at wide widths.
            .aspectRatio(contentMode: .fill)
            .accessibilityHidden(true)
    }
}

/// Chapter reading screen: bundled KJV (offline) or NKJV (bolls.life), the
/// two-tier verse sheet, adjustable type size, and prev/next navigation that
/// rolls into adjacent books like YouVersion.
///
/// Port of `mobile/app/(app)/bible/chapter.tsx`. Clicking a verse opens the
/// verse sheet docked under the chapter (`VerseStudyPanel`); clicking more
/// verses grows the range, as tapping does on Android. The right-click menu
/// keeps its per-verse items as well.
struct ChapterReaderPane: View {
    @Environment(\.appearsActive) private var appearsActive
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app

    @Bindable var model: BibleModel
    let askAI: (_ reference: String, _ text: String) -> Void
    let showAtlas: (_ book: Int, _ chapter: Int) -> Void
    /// Open Learn a verse, as the Added chip does on Android and iOS.
    let showLearn: () -> Void
    /// "Quiz me" on this chapter; the section shows it in front of the reader.
    let startQuiz: (_ book: Int, _ chapter: Int) -> Void

    /// The LC Greek is on the page (LC-15842): the device choice is on, the
    /// book has it, and no chat source pinned a translation.
    private var lcGreek: Bool {
        model.lcGreek && model.translationOverride == nil && LCGreek.has(model.selectedBook ?? 0)
    }
    /// The translation every study path works on: the KJV under the LC Greek.
    private var translation: TranslationID {
        lcGreek ? .kjv : model.translationOverride ?? app.settings.translation
    }
    /// What Copy, Share and Save to note name the words on screen.
    private var textLabel: String { lcGreek ? LCGreek.label : translation.rawValue }

    /// The parchment page surface, per the shared setting. Off restores the
    /// plain reader on the app's own shell, exactly as on Android and web -
    /// nothing else about the reader changes.
    private var parchment: Bool { app.settings.parchment }

    /// The text column (760) plus its own horizontal padding: the page is as
    /// wide as the words plus a margin, never the whole window.
    private static let pageWidth: CGFloat = 760 + Spacing.xxl * 2

    /// The Share sheet (a card, or the words as text) for the verse or
    /// selection whose Share was clicked.
    @State private var shareCard: ShareCardItem?
    @State private var crossReferences = CrossReferencesModel()
    @State private var showingCustomColor = false

    private var sheet: VerseSheetModel { model.sheet }

    /// The chapter on screen, as the sheet sees it. Nil until the text for
    /// this exact translation and chapter has arrived.
    private var context: VerseSheetContext? {
        guard let book = model.book, model.loadedKey == model.chapterKey(translation, lcGreek: lcGreek) else { return nil }
        return VerseSheetContext(
            order: book.order,
            bookName: book.name,
            chapter: model.chapter,
            plainTexts: model.readerVerses.map(\.plainText),
            translation: translation,
            studyTexts: model.studyVerses?.map(VerseMarkup.plainText)
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            ReadingSyncStatus(model: model.reading)
            topBar
            // The line under the chips on web and in Android's reader options:
            // what the LC Greek is, or where the red letters and headings
            // come from.
            Text(lcGreek ? LCGreek.note : ReaderAnnotations.sourceNote(translation))
                .font(.system(size: 11))
                .foregroundStyle(theme.textMuted)
                .padding(.bottom, Spacing.xs)

            if model.loading {
                loadingState
            } else if let error = model.error {
                errorState(error)
            } else {
                // The verse sheet sits under the scroll view, never inside it,
                // and that is a hard requirement: streaming the explanation into
                // a row of the reader's `LazyVStack` re-measures the whole
                // chapter on every update, which pegged the main thread until
                // the stream feeding it starved (`macos/README.md`, "The reader
                // is a layout minefield").
                GeometryReader { geometry in
                    VStack(spacing: 0) {
                        reader
                        if sheet.isOpen, let context {
                            verseSheet(context: context, availableHeight: geometry.size.height)
                                .transition(.move(edge: .bottom).combined(with: .opacity))
                        }
                    }
                    .animation(.snappy, value: sheet.isOpen)
                    // The reader gives up the height the study tier takes in
                    // the same motion.
                    .animation(.snappy, value: sheet.tier)
                }
            }
        }
        // The chapter *and* the translation are part of the identity of what is
        // on screen, so a translation change reloads through the same path a
        // page turn does — and a superseded load is cancelled, not raced.
        .task(id: model.chapterKey(translation, lcGreek: lcGreek)) {
            await model.load(translation: translation, lcGreek: lcGreek)
            let reader = model
            let next = reader.nextLocation
            await app.chapterAudio.load(book: reader.selectedBook ?? 0, chapter: reader.chapter, reference: reader.reference, enabled: translation == .kjv, next: next.flatMap { location in
                guard ChapterAudio.hasNarration(location.order) else { return nil }
                return { @MainActor [weak reader] in reader?.open(order: location.order, chapter: location.chapter) }
            })
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { ChapterAudioBar() }
        .spotlightHost()
        // The lit verse has done its job once it is clicked.
        .onChange(of: sheet.selection != nil) { _, open in
            guard open, let lit = app.onboarding.spotlight, lit.target == .readerVerse else { return }
            app.onboarding.closeSpotlight(completed: lit.isLastStop)
        }
        .onAppear {
            model.reading.setReaderVisible(true)
            model.reading.setForeground(scenePhase == .active)
            model.reading.setReaderFocused(appearsActive)
            model.prepareReading(translation: translation, lcGreek: lcGreek)
        }
        .onDisappear { model.reading.setReaderVisible(false); app.chapterAudio.close() }
        .onChange(of: model.loadedKey) { _, _ in model.prepareReading(translation: translation, lcGreek: lcGreek) }
        .onChange(of: scenePhase) { _, phase in model.reading.setForeground(phase == .active) }
        // A new chapter or translation under an open sheet: the selection no
        // longer describes what is on screen.
        .onChange(of: model.chapterKey(translation, lcGreek: lcGreek)) { _, _ in sheet.chapterChanged() }
        // The peek leaves the chapter readable; only the study tier covers
        // most of it.
        .onChange(of: sheet.obscuresReader) { _, obscured in model.reading.setObscured(obscured) }
        .onChange(of: appearsActive) { _, active in model.reading.setReaderFocused(active) }
        .shareCardSheet(item: $shareCard, api: app.api)
        .sheet(isPresented: $showingCustomColor) {
            CustomHighlightSheet(color: Color(hex: selectionHex ?? HighlightColors.presets[0].hex) ?? .yellow) { hex in
                applyHighlight(hex)
            }
        }
    }

    // MARK: - Chrome

    /// One row at any reader width. A narrow reader drops the Listen and
    /// Who's here titles to their icons first, and every label holds one
    /// line, so a chip never stacks "K/J/V" letter by letter.
    private var topBar: some View {
        ViewThatFits(in: .horizontal) {
            topBarRow(compact: false)
            topBarRow(compact: true)
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.md)
    }

    private func topBarRow(compact: Bool) -> some View {
        HStack(spacing: Spacing.md) {
            Button {
                model.showChapterGrid()
            } label: {
                Label("Chapters", systemImage: "chevron.left")
                    .labelStyle(.titleAndIcon)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(theme.accent)
                    .lineLimit(1)
                    .fixedSize()
            }
            .buttonStyle(SubtleButtonStyle())
            .help("Back to the chapter list")

            Text(model.reference)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.text)
                .lineLimit(1)

            Spacer(minLength: 0)

            if compact {
                chapterActions.labelStyle(.iconOnly)
            } else {
                chapterActions.labelStyle(.titleAndIcon)
            }

            translationChips

            HStack(spacing: Spacing.xs) {
                fontButton("A−", size: 12, enabled: model.canShrinkFont) { model.stepFont(-1) }
                fontButton("A+", size: 15, enabled: model.canGrowFont) { model.stepFont(1) }
            }
            .fixedSize()
        }
    }

    /// Listen and Who's here: titled when the row has room, icons when not.
    @ViewBuilder
    private var chapterActions: some View {
        if app.chapterAudio.editions.count > 1 {
            // Mark has an Alive recording too (LC-15532): ask which one,
            // Alive first and marked Recommended (LC-15842).
            Menu {
                ForEach(app.chapterAudio.editions, id: \.self) { edition in
                    Button {
                        app.dailyCross.listen.pause()
                        app.chapterAudio.start(edition: edition)
                    } label: {
                        Text(edition.label)
                        Text(edition.isRecommended ? "\(AudioEdition.recommendedLabel) · \(edition.detail)" : edition.detail)
                        if edition.isRecommended { Image(systemName: "star.fill") }
                    }
                }
            } label: {
                Label("Listen", systemImage: "headphones")
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            .help("Listen to this chapter")
        } else if app.chapterAudio.available {
            Button("Listen", systemImage: "headphones") {
                app.dailyCross.listen.pause()
                app.chapterAudio.start()
            }
            .buttonStyle(SubtleButtonStyle())
            .fixedSize()
            .help("Listen to this chapter")
        }

        if let book = model.selectedBook {
            Button {
                app.openConnections(order: book, chapter: model.chapter, verse: model.sheet.selection?.start)
            } label: {
                Label("Connections", systemImage: AppSection.connections.symbol)
                    .font(.system(size: 11, weight: .semibold)).lineLimit(1)
            }
            .buttonStyle(SubtleButtonStyle())
            .fixedSize()
            .help("See this chapter's connections across the Bible")
            Button {
                showAtlas(book, model.chapter)
            } label: {
                Label("Who's here", systemImage: "person.2")
                    .font(.system(size: 11, weight: .semibold))
                    .lineLimit(1)
            }
            .buttonStyle(SubtleButtonStyle())
            .fixedSize()
            .help("Open the people, places and events in this chapter")
            .accessibilityLabel("Who's in this chapter")
        }
    }

    private var translationChips: some View {
        @Bindable var settings = app.settings
        return HStack(spacing: Spacing.xs) {
            ForEach(TranslationID.allCases, id: \.self) { id in
                translationChip(id.label, help: "Read in the \(id.label)", isActive: !lcGreek && translation == id) {
                    model.translationOverride = nil
                    model.lcGreek = false
                    settings.translation = id
                }
            }
            // The LC Greek (LC-15842) joins the row only on a book that has it.
            if LCGreek.has(model.selectedBook ?? 0) {
                translationChip(LCGreek.label, help: "Read in the \(LCGreek.label)", isActive: lcGreek) {
                    model.translationOverride = nil
                    model.lcGreek = true
                }
            }
        }
    }

    private func translationChip(_ label: String, help: String, isActive: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 11, weight: .bold))
                .lineLimit(1)
                .fixedSize()
                .foregroundStyle(isActive ? theme.accent : theme.textMuted)
                .padding(.horizontal, Spacing.sm)
                .padding(.vertical, 4)
                .background(
                    isActive ? theme.accentSoft : theme.surface,
                    in: .rect(cornerRadius: Radius.full)
                )
                .overlay {
                    Capsule()
                        .strokeBorder(
                            isActive ? theme.accentBorder : theme.borderStrong,
                            lineWidth: 1
                        )
                }
                .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .help(help)
    }

    private func fontButton(
        _ label: String,
        size: CGFloat,
        enabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: size, weight: .bold))
                .foregroundStyle(theme.textSecondary)
                .frame(width: 28, height: 22)
                .background(theme.surface, in: .rect(cornerRadius: Radius.sm))
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.sm)
                        .strokeBorder(theme.borderStrong, lineWidth: 1)
                }
                .contentShape(.rect(cornerRadius: Radius.sm))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.35)
        .accessibilityLabel(label == "A+" ? "Increase text size" : "Decrease text size")
    }

    // MARK: - States

    private var loadingState: some View {
        VStack(spacing: Spacing.md) {
            ProgressView().controlSize(.small)
            Text(translation == .nkjv ? "Loading the NKJV…" : "Opening the chapter…")
                .font(.system(size: 12))
                .foregroundStyle(theme.textFaint)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        GlassCard {
            VStack(spacing: Spacing.md) {
                Text(message)
                    .font(.system(size: 13))
                    .foregroundStyle(theme.textSecondary)
                    .multilineTextAlignment(.center)
                Button("Try again") {
                    Task { await model.load(translation: translation, lcGreek: lcGreek) }
                }
                .buttonStyle(AccentButtonStyle())
            }
            .frame(maxWidth: 320)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Reader

    private var reader: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Spacing.md) {
                    ForEach(model.readerVerses, id: \.number) { verse in
                        verseEntry(verse)
                            .id(verse.number)
                            .onScrollVisibilityChange(threshold: 0.5) { visible in
                                model.readingVisibility(verse: verse.number, visible: visible, translation: translation, lcGreek: lcGreek)
                            }
                    }

                    footer
                }
                .id(model.loadedKey)
                .padding(.horizontal, Spacing.xxl)
                .frame(maxWidth: 760, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            // The reader's breathing room is a content margin rather than
            // padding inside the stack, so that scrolling verse 1 to the top
            // keeps it instead of scrolling it away.
            .contentMargins(.vertical, Spacing.lg, for: .scrollContent)
            // The same gutter the sheet below keeps from the window edge, so
            // the text column is never wider than the page it is printed on -
            // which it would be in a narrow window, now that the page is the
            // background and no longer the scroll view's own frame.
            .contentMargins(.horizontal, parchment ? Spacing.lg : 0, for: .scrollContent)
            // A deep link only lands once the chapter it names is the one on
            // screen — `loadedKey` is what proves that, since the selection
            // changes a render before the text does.
            .onChange(of: model.loadedKey, initial: true) { _, _ in
                if model.pendingVerse == nil {
                    // A newly opened chapter starts at the top. SwiftUI reuses
                    // the row identities `1...n` across chapters and keeps the
                    // old offset, so paging out of the middle of John 3 would
                    // otherwise land in the middle of John 4
                    // (`mobile/app/(app)/bible/chapter.tsx` scrolls to offset 0
                    // for the same reason). Verse 1 is the top anchor.
                    proxy.scrollTo(1, anchor: .top)
                } else {
                    scrollToPendingVerse(proxy)
                }
            }
            // A jump into the chapter already on screen changes nothing but the
            // pending verse - no reload, so `loadedKey` never moves and the
            // effect above never re-fires. Android keys its effect on the verse
            // param for the same reason.
            .onChange(of: model.pendingVerse) { _, verse in
                guard verse != nil else { return }
                scrollToPendingVerse(proxy)
            }
            // The page goes *behind* the scroll view rather than around it -
            // see `page`.
            .background {
                if parchment {
                    page
                }
            }
            .frame(maxWidth: .infinity)
        }
        .overlay(alignment: .bottomTrailing) {
            Button {
                askAI(model.reference, model.chapterText)
            } label: {
                Text("✦ Ask AI")
                    .font(.system(size: 13, weight: .bold))
            }
            .buttonStyle(AccentButtonStyle())
            // The accent button is a translucent amber wash, which had the
            // whole shell behind it before and now floats over the page. Gold
            // on gold is unreadable, so it gets its own opaque plate - on the
            // plain reader too, where it also stops verse text showing through.
            .background(theme.bgElevated, in: .capsule)
            .shadow(color: .black.opacity(0.35), radius: 10, y: 3)
            .padding(Spacing.xl)
            .accessibilityLabel("Ask AI about \(model.reference)")
        }
    }

    /// The page: a fixed sheet the verses scroll over, clipped and rimmed so it
    /// reads as a sheet of parchment on the shell rather than as a wallpaper.
    /// Capped at the text column's width so a wide window gets a page with
    /// margins, not an acre of texture.
    ///
    /// The cap belongs to the *sheet*, not to the scroll view. It used to be a
    /// `.frame(maxWidth:)` on the `ScrollView` itself, which made the container
    /// the page and cost two things: the gutters either side of the page were
    /// dead to the wheel, and macOS drew the scroller inside the page's rim
    /// instead of at the window's edge. The scroll view is full width now; only
    /// what is *drawn* is narrow, and the sheet still does not move, because a
    /// background does not scroll.
    private var page: some View {
        // `Color.clear` is what pins the sheet to the scroll view's bounds. The
        // texture is `aspectRatio(.fill)`, so it *reports* a size bigger than
        // the space it was offered - clipping it directly clips to that
        // oversized rect, and as a background (which is not clipped to its
        // host) the overflow drew straight over the reader's top bar. A clear
        // rectangle takes the offered size exactly and the clip lands on that.
        Color.clear
            .overlay { ParchmentSheet() }
            .clipShape(.rect(cornerRadius: Radius.lg))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.lg)
                    .strokeBorder(theme.borderStrong, lineWidth: 1)
                    // Decoration, and decoration must never take a click that
                    // belongs to the verse row over it.
                    .allowsHitTesting(false)
            }
            // Attached only on the parchment reader. Carried as
            // `opacity(parchment ? 0.35 : 0)` it was still a live shadow the
            // renderer composed on the plain reader too, for nothing.
            .shadow(color: .black.opacity(0.35), radius: 16, y: 4)
            .frame(maxWidth: Self.pageWidth)
            .padding(.horizontal, Spacing.lg)
            .padding(.bottom, Spacing.md)
            .allowsHitTesting(false)
    }

    private func scrollToPendingVerse(_ proxy: ScrollViewProxy) {
        guard model.loadedKey == model.chapterKey(translation, lcGreek: lcGreek),
              let verse = model.pendingVerse,
              verse >= 1, verse <= model.verses.count
        else { return }
        proxy.scrollTo(verse, anchor: .top)
        withAnimation(.easeOut(duration: 0.2)) { model.flash(verse: verse) }
    }

    /// The wash behind a verse row, in precedence order: the deep-link flash,
    /// then the open action panel, then the reader's own persistent highlight.
    ///
    /// All three are parchment-aware, and they have to be. `accentSoft`,
    /// `surface` and `HighlightColors.wash` are mixed for the app's flat shell;
    /// laid over the photoreal sheet the shell's near-black `surface` reads as
    /// a smudge on the light plate and vanishes into the dark one, and a 25%
    /// swatch does the same. On parchment every tint is the sheet's own
    /// `parchmentHighlight` - a value picked per plate - or the swatch's hue
    /// carried at that strength, so a yellow highlight is still yellow and
    /// still legible on both sheets.
    private func rowWash(isHighlighted: Bool, isOpen: Bool, highlightHex: String?) -> Color {
        // The flash is the sheet's own ink-gold rather than the shell's amber,
        // which would read as a sticker on the page.
        if isHighlighted { return parchment ? theme.parchmentHighlight : theme.accentSoft }
        // Half strength: the open row is a "you are here", not a highlight, and
        // must not out-shout a verse the reader actually marked.
        if isOpen { return parchment ? theme.parchmentHighlight.opacity(0.5) : theme.surface }
        guard let highlightHex else { return .clear }
        guard parchment else { return HighlightColors.wash(highlightHex) }
        return (Color(hex: highlightHex) ?? theme.parchmentHighlight)
            .opacity(theme.isDark ? 0.34 : 0.42)
    }

    /// A verse with what the page prints above it: the publisher headings, or
    /// Android's chapter title on a chapter whose first verse has none. Verse 1
    /// carries the title so opening a chapter, which scrolls verse 1 to the
    /// top, still shows it. Headings are never part of the verse, so they sit
    /// outside its wash and its menu and are never copied.
    @ViewBuilder
    private func verseEntry(_ verse: ReaderVerse) -> some View {
        let isTitle = verse.number == 1 && verse.headings.isEmpty

        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array((isTitle ? [model.reference] : verse.headings).enumerated()), id: \.offset) { _, heading in
                Text(heading)
                    .font(.custom(FontFamily.verseItalic, size: isTitle ? 28 : 24))
                    .foregroundStyle(parchment ? theme.parchmentInk : theme.text)
                    .padding(.top, isTitle ? 0 : 16)
                    .padding(.bottom, isTitle ? 24 : 20)
                    .padding(.horizontal, Spacing.sm)
                    .accessibilityAddTraits(.isHeader)
            }
            verseRow(verse)
                .spotlightTarget(.readerVerse, isActive: app.onboarding.spotlightVerse == verse.number)
        }
    }

    @ViewBuilder
    private func verseRow(_ verse: ReaderVerse) -> some View {
        let number = verse.number
        let isHighlighted = model.highlightedVerse == number || (app.chapterAudio.isPlaying && app.chapterAudio.verse == number)
        let isOpen = sheet.selection?.includes(number) ?? false
        let reference = model.verseReference(number)
        let text = model.shownText(number)
        let highlightHex = model.selectedBook.flatMap {
            app.highlights.hex(translation: translation, book: $0, chapter: model.chapter, verse: number)
        }

        VStack(alignment: .leading, spacing: Spacing.sm) {
            // A real Button, not an `onTapGesture` — the same call the notes
            // list makes, and for a second reason here: a tap gesture on a
            // stack inside this `LazyVStack` never fires at all, so clicking a
            // verse did nothing. It also earns keyboard activation and an
            // accessibility action.
            //
            // Deliberately NOT `.textSelection(.enabled)` either. A selectable
            // `Text` takes ownership of the whole text region on macOS: it
            // swallows left-clicks *and* right-clicks, so right-clicking a
            // verse raised the system Cut/Copy/Font menu instead of SureWord's
            // own. Copy still sits one click away on the verse sheet's action
            // bar and in the context menu, and the AI explanation *is*
            // selectable.
            Button {
                tap(number)
            } label: {
                verseText(verse)
                    .lineSpacing(model.lineHeight - model.fontSize)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(reference). Explain this verse")
            .accessibilityHint(isOpen ? "Selected. Click to change the selection." : "Opens the verse sheet")
            .accessibilityAddTraits(isOpen ? .isSelected : [])
        }
        .padding(.horizontal, Spacing.sm)
        .padding(.vertical, Spacing.xs)
        .background(
            rowWash(isHighlighted: isHighlighted, isOpen: isOpen, highlightHex: highlightHex),
            in: .rect(cornerRadius: Radius.md)
        )
        .contentShape(.rect(cornerRadius: Radius.md))
        .contextMenu {
            if let order = model.selectedBook {
                Menu("Highlight") {
                    ForEach(HighlightColors.presets) { preset in
                        let isCurrent = highlightHex?.caseInsensitiveCompare(preset.hex) == .orderedSame
                        Button {
                            app.highlights.setColor(
                                translation: translation,
                                book: order,
                                chapter: model.chapter,
                                verse: number,
                                hex: preset.hex
                            )
                        } label: {
                            Label(
                                highlightName(preset),
                                systemImage: isCurrent ? "checkmark" : "circle.fill"
                            )
                        }
                    }
                    if highlightHex != nil {
                        Divider()
                        Button("Remove Highlight") {
                            app.highlights.remove(
                                translation: translation,
                                book: order,
                                chapter: model.chapter,
                                verse: number
                            )
                        }
                    }
                }
                Divider()
            }
            Button("Copy") {
                model.copy(reference: reference, text: text, translation: translation, label: textLabel)
            }
            Button("Share…") {
                share(reference: reference, text: text)
            }
            Button("Save to note") {
                model.saveToNote(reference: reference, text: text, translation: translation, label: textLabel)
            }
            Button("✦ Expand with AI") {
                askAI(reference, model.verseText(number))
            }
        }
    }

    /// Open the Share sheet on the words on screen. The card is drawn in the
    /// translation on the page; the LC Greek label has no card, so that page
    /// shares as text, with the same text Share always sent.
    private func share(reference: String, text: String) {
        shareCard = ShareCardItem(
            target: .verse(reference: reference, translation: textLabel),
            shareText: VerseAttachment.formatForSharing(
                reference: reference,
                text: text,
                translation: translation,
                label: textLabel
            )
        )
    }

    /// Verse number then the formatted segments (`ReaderAnnotations`),
    /// concatenated into one `Text` so the number stays inline with the
    /// wrapped body. The sourced words of Jesus take Android's two reds.
    private func verseText(_ verse: ReaderVerse) -> Text {
        // Ink read against the sheet, not against the shell: the parchment
        // tokens are a separate set for exactly this reason.
        let ink = parchment ? theme.parchmentInk : theme.textSecondary
        let numberInk = parchment ? theme.parchmentNumber : theme.accentDim
        let redLetter = theme.isDark ? Color(hex: 0xEF8A83) : Color(hex: 0xA12E2A)

        var result = Text("\(verse.number) ")
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(numberInk)
        if verse.omitted {
            result = result
                + Text("Not included in this edition\u{2019}s main text.")
                .font(.system(size: 14))
                .italic()
                .foregroundStyle(parchment ? theme.parchmentInk.opacity(0.55) : theme.textMuted)
        }
        for segment in verse.segments {
            result = result
                + Text(segment.text)
                .font(
                    .custom(
                        segment.italic ? FontFamily.verseItalic : FontFamily.verse,
                        size: model.fontSize
                    )
                )
                .italic(segment.italic)
                .foregroundStyle(segment.jesusSpeech ? redLetter : ink)
        }
        return result
    }

    // MARK: - Verse sheet

    /// The reader's click. A refused click (the ten-verse cap) changes
    /// nothing, and the action bar says why.
    private func tap(_ number: Int) {
        guard let context else { return }
        sheet.tap(number, context: context)
    }

    /// Stored colours for the selection, verse → hex.
    private var selectionHighlights: [Int: String] {
        guard let book = model.selectedBook else { return [:] }
        var map: [Int: String] = [:]
        for verse in sheet.activeSelection.verses {
            if let hex = app.highlights.hex(translation: translation, book: book, chapter: model.chapter, verse: verse) {
                map[verse] = hex
            }
        }
        return map
    }

    private var selectionHex: String? { sheet.activeSelection.sharedColor(in: selectionHighlights) }

    private func verseSheet(context: VerseSheetContext, availableHeight: CGFloat) -> some View {
        let reference = sheet.reference(context)
        let text = sheet.text(context)
        let highlights = selectionHighlights
        let shared = sheet.activeSelection.sharedColor(in: highlights)
        let markedAs = shared.flatMap(markedAsLabel)
        let message = sheet.actionMessage
            ?? markedAs.map { VerseSheetModel.Message(text: "Marked as \u{201C}\($0)\u{201D}", tone: .muted) }

        return VerseStudyPanel(
            model: sheet,
            title: reference,
            subtitle: sheet.subtitle,
            availableHeight: availableHeight,
            onClose: { sheet.close() },
            peek: {
                InsightTeaserView(
                    insight: sheet.insight,
                    onExpand: { sheet.openStudy(.explain) },
                    onRetry: { sheet.retryInsight(context) }
                )
            },
            study: {
                studyView(context: context, reference: reference, text: text)
            },
            footer: {
                VerseActionBarView(
                    color: shared,
                    canRemove: !highlights.isEmpty,
                    labelForPreset: highlightName,
                    onHighlight: { applyHighlight($0) },
                    onRemoveHighlight: removeHighlight,
                    onCustomColor: { showingCustomColor = true },
                    // Ask takes the study words (the KJV under the LC Greek).
                    actions: actions(context: context, reference: reference, text: text, highlighted: shared != nil),
                    message: message
                )
            }
        )
    }

    @ViewBuilder
    private func studyView(context: VerseSheetContext, reference: String, text: String) -> some View {
        @Bindable var sheet = sheet
        let selection = sheet.activeSelection
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text(text)
                .font(.custom(FontFamily.verse, size: 17))
                .foregroundStyle(theme.textSecondary)
                .lineLimit(4)
                .padding(.horizontal, Spacing.lg)

            StudyTabsView(selection: $sheet.studyTab)

            VStack(alignment: .leading, spacing: Spacing.sm) {
                // Each study is a model generation, so a range studies its
                // first verse only rather than firing one per selected verse.
                if (sheet.studyTab == .words || sheet.studyTab == .seeAlso), selection.count > 1 {
                    Text("For verse \(selection.start)")
                        .font(.system(size: 12))
                        .foregroundStyle(theme.textFaint)
                }
                switch sheet.studyTab {
                case .explain:
                    VerseInsightView(
                        status: sheet.insight.status,
                        text: sheet.insight.text,
                        error: sheet.insight.error,
                        onRetry: { sheet.retryInsight(context) }
                    )
                case .words:
                    // The Hebrew or Greek behind the verse, word by word beside
                    // the King James wording it became.
                    WordStudyView(
                        api: app.api,
                        book: context.order,
                        chapter: context.chapter,
                        verse: selection.start,
                        modelId: app.settings.chatModelId,
                        onAsk: { prompt, attach in
                            // `askAI` is the sheet's one door into chat: it
                            // attaches the passage, closes the sheet and
                            // switches sections. The prompt is set first so the
                            // composer is already filled when chat appears.
                            app.chat.input = prompt
                            askAI(reference, sheet.studyText(context))
                            // "Every verse" is a lexicon search, not a question
                            // about this passage, so it travels without it.
                            if !attach { app.chat.attachment = nil }
                        }
                    )
                case .seeAlso:
                    CrossReferencesView(
                        model: crossReferences,
                        reference: VerseSelection(start: selection.start, end: selection.start)
                            .reference(bookName: context.bookName, chapter: context.chapter),
                        translation: context.translation,
                        onNavigate: openCrossReference
                    )
                case .notes:
                    notesTab(context: context, reference: reference, selection: selection)
                }
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.top, Spacing.xs)
        }
    }

    /// Study notes that mention the selection, and a way to add it to one.
    /// A note opens in the Notes section; the Mac's Notes pane owns its own
    /// selection, so the hop lands on the library, as a chat note receipt does
    /// (`ChatView.openReceipt`).
    private func notesTab(context: VerseSheetContext, reference: String, selection: VerseSelection) -> some View {
        let matched = ChapterNotes.notesForSelection(
            ChapterNotes.matchChapterNotes(
                notes: NotesStore.shared.notes.map {
                    ChapterNoteSummary(
                        id: $0.id,
                        title: $0.title,
                        plainText: $0.plainText,
                        updatedAt: $0.updatedAt
                    )
                },
                context: ChapterNotesContext(
                    bookName: context.bookName,
                    chapter: context.chapter,
                    verseCount: context.plainTexts.count
                )
            ),
            selection: selection
        )
        return VStack(alignment: .leading, spacing: Spacing.sm) {
            if matched.isEmpty {
                Text("No study notes mention \(reference) yet.")
                    .font(.system(size: 13))
                    .foregroundStyle(theme.textMuted)
            } else {
                ForEach(matched) { note in
                    Button {
                        sheet.close()
                        app.section = .notes
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("✎ \(note.title)")
                                .font(.system(size: 13.5, weight: .bold))
                                .foregroundStyle(theme.accent)
                            if !note.excerpt.isEmpty {
                                Text(note.excerpt)
                                    .font(.system(size: 12.5))
                                    .foregroundStyle(theme.textSecondary)
                                    .lineLimit(2)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(Spacing.sm)
                        .background(theme.surface, in: RoundedRectangle(cornerRadius: Radius.md))
                        .contentShape(.rect(cornerRadius: Radius.md))
                    }
                    .buttonStyle(.plain)
                }
            }
            Button {
                Task { await saveToNote(context) }
            } label: {
                Text("＋ Add \(reference) to a note")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(theme.accent)
                    .frame(maxWidth: .infinity, minHeight: 38)
                    .background(theme.accentSoft, in: RoundedRectangle(cornerRadius: Radius.md))
                    .contentShape(.rect(cornerRadius: Radius.md))
            }
            .buttonStyle(.plain)
            .disabled(sheet.saveBusy)
        }
        // The library cache is read from disk once per run; the reader may be
        // the first screen to need it.
        .task { await NotesStore.shared.hydrate() }
    }

    private func actions(context: VerseSheetContext, reference: String, text: String, highlighted: Bool) -> [VerseSheetAction] {
        let study = sheet.studyText(context)
        let choice = app.chapterAudio.editions.count > 1
        let listen = app.chapterAudio.available ? [VerseSheetAction(id: "listen", systemImage: "headphones", label: "Listen") {
            app.dailyCross.listen.pause()
            app.chapterAudio.start(from: sheet.selection?.start ?? 1, edition: choice ? .regular : nil)
        }] : []
        // A book with an Alive recording (LC-15532) offers it too, first, as
        // Listen recommends it (LC-15842).
        let alive = choice ? [VerseSheetAction(id: "listen-alive", systemImage: "headphones", label: AudioEdition.alive.label) {
            app.dailyCross.listen.pause()
            app.chapterAudio.start(from: sheet.selection?.start ?? 1, edition: .alive)
        }] : []
        return alive + listen + [
            VerseSheetAction(id: "ask", systemImage: "sparkles", label: "Ask") {
                askAI(reference, study)
            },
            VerseSheetAction(
                id: "copy",
                systemImage: sheet.copied ? "checkmark" : "doc.on.doc",
                label: sheet.copied ? "Copied" : "Copy",
                active: sheet.copied
            ) {
                // The same string Android's `selectionShareText` builds: the
                // reference, the words in quotes, then the label.
                VerseActions.copy(reference: reference, text: text, translation: translation, label: context.label)
                sheet.markCopied()
            },
            // The card is drawn in the translation on the page; the LC Greek
            // label has no card, so that page shares as text.
            VerseSheetAction(id: "share", systemImage: "square.and.arrow.up", label: "Share") {
                shareCard = ShareCardItem(
                    target: .verse(reference: reference, translation: context.label),
                    shareText: sheet.shareText(context)
                )
            },
            VerseSheetAction(
                id: "note",
                systemImage: "square.and.pencil",
                label: sheet.saveBusy ? "Saving…" : "Note",
                disabled: sheet.saveBusy
            ) {
                Task { await saveToNote(context) }
            },
            // Adds every selected verse to Learn (as "highlight" when the
            // range is highlighted); the "Added" chip then opens Learn, as on
            // Android and iOS.
            VerseSheetAction(
                id: "learn",
                systemImage: sheet.learnStatus == .added ? "graduationcap.fill" : "graduationcap",
                label: sheet.learnStatus == .adding ? "Adding…" : sheet.learnStatus == .added ? "Added" : "Learn",
                disabled: sheet.learnStatus == .adding,
                active: sheet.learnStatus == .added
            ) {
                if sheet.learnStatus == .added {
                    showLearn()
                } else {
                    Task { await addToLearn(context, highlighted: highlighted) }
                }
            },
        ]
    }

    /// Highlight writes are optimistic - the store recolours at once and rolls
    /// back any verse whose write fails - so this fires one per verse.
    private func applyHighlight(_ hex: String) {
        guard let book = model.selectedBook else { return }
        for verse in sheet.activeSelection.verses {
            app.highlights.setColor(translation: translation, book: book, chapter: model.chapter, verse: verse, hex: hex)
        }
    }

    private func removeHighlight() {
        guard let book = model.selectedBook else { return }
        for verse in sheet.activeSelection.verses {
            app.highlights.remove(translation: translation, book: book, chapter: model.chapter, verse: verse)
        }
    }

    /// Save the selection as a new note. A failure stays on the action bar;
    /// a success closes the sheet with the toast the reader has always shown.
    private func saveToNote(_ context: VerseSheetContext) async {
        let reference = sheet.reference(context)
        guard await sheet.saveToNote(api: app.api, context: context) != nil else { return }
        sheet.close()
        model.show(toast: "Saved \(reference) to your notes")
    }

    private func addToLearn(_ context: VerseSheetContext, highlighted: Bool) async {
        let api = app.api
        await sheet.addToLearn(context: context, highlighted: highlighted) { body in
            try await api.json("/api/learn", method: "POST", body: body, as: VerseLearnCard.self)
        }
    }

    /// The sheet is not modal, so a See-also jump lands straight away: the
    /// reader opens the passage in place and flashes the verse. Opening closes
    /// the sheet (`BibleModel.dismissVerseActions`).
    private func openCrossReference(_ target: Reference) {
        model.open(target, translationOverride: model.translationOverride)
    }

    /// What to call a highlight colour in the reader: the label the user gave it
    /// in Settings when there is one, the hue name otherwise.
    private func highlightName(_ preset: HighlightPreset) -> String {
        HighlightColors.displayName(preset, in: app.settings.highlightLabels)
    }

    /// The user's label for a stored hex, or nil for an unnamed preset and for
    /// a custom colour picked out of the colour well.
    private func markedAsLabel(_ hex: String) -> String? {
        HighlightColors.label(forHex: hex, in: app.settings.highlightLabels)
    }

    private var footer: some View {
        VStack(spacing: Spacing.xl) {
            if let book = model.book {
                QuizEntryCard(
                    book: book.order,
                    chapter: model.chapter,
                    title: model.reference,
                    showsKJVNote: lcGreek || translation != .kjv,
                    onStart: { startQuiz(book.order, model.chapter) }
                )
                .frame(maxWidth: 520)
                .frame(maxWidth: .infinity)
                .id("quiz-\(book.order):\(model.chapter)")
            }

            // An em dash, matching `TranslationID.copyright`'s own - so the
            // NKJV line does not read "NKJV - © Thomas Nelson - text via …"
            // with two different dashes in one sentence.
            Text(lcGreek ? "\(LCGreek.label) \u{2014} \(LCGreek.copyright)" : "\(translation.name) \u{2014} \(translation.copyright)")
                .font(.system(size: 11))
                .italic()
                .foregroundStyle(parchment ? theme.parchmentInk.opacity(0.55) : theme.textGhost)
                .frame(maxWidth: .infinity)

            HStack(spacing: Spacing.md) {
                navButton(
                    title: "‹ Previous",
                    target: model.previousLocation,
                    accent: false
                )
                navButton(
                    title: "Next ›",
                    target: model.nextLocation,
                    accent: true
                )
            }
        }
        .padding(.top, Spacing.lg)
    }

    private func navButton(title: String, target: Bible.Location?, accent: Bool) -> some View {
        Button {
            model.go(to: target)
        } label: {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(accent ? theme.accent : theme.textSecondary)
                .frame(maxWidth: .infinity, minHeight: 40)
                .background(
                    accent ? theme.accentSoft : theme.surface,
                    in: .rect(cornerRadius: Radius.lg)
                )
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.lg)
                        .strokeBorder(accent ? theme.accentBorder : theme.borderStrong, lineWidth: 1)
                }
                .contentShape(.rect(cornerRadius: Radius.lg))
        }
        .buttonStyle(.plain)
        .disabled(target == nil)
        .opacity(target == nil ? 0.35 : 1)
        .help(target.map { location in
            "\(Bible.book(order: location.order)?.name ?? "") \(location.chapter)"
        } ?? "")
    }
}
