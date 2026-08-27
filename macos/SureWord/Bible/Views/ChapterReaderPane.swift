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

/// Chapter reading screen: bundled KJV (offline) or NKJV (bolls.life), per-verse
/// actions (copy / share / save to note / Ask AI), adjustable type size, and
/// prev/next navigation that rolls into adjacent books like YouVersion.
///
/// Port of `mobile/app/(app)/bible/chapter.tsx`. Android opens the actions from
/// a long-press bottom sheet; a Mac gets both a click-to-open inline row and the
/// same four items on the right-click menu.
struct ChapterReaderPane: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app

    @Bindable var model: BibleModel
    let askAI: (_ reference: String, _ text: String) -> Void
    let showAtlas: (_ book: Int, _ chapter: Int) -> Void

    private var translation: TranslationID { app.settings.translation }

    /// The parchment page surface, per the shared setting. Off restores the
    /// plain reader on the app's own shell, exactly as on Android and web -
    /// nothing else about the reader changes.
    private var parchment: Bool { app.settings.parchment }

    /// The text column (760) plus its own horizontal padding: the page is as
    /// wide as the words plus a margin, never the whole window.
    private static let pageWidth: CGFloat = 760 + Spacing.xxl * 2

    var body: some View {
        VStack(spacing: 0) {
            topBar

            if model.loading {
                loadingState
            } else if let error = model.error {
                errorState(error)
            } else {
                reader
                versePanel
            }
        }
        // The chapter *and* the translation are part of the identity of what is
        // on screen, so a translation change reloads through the same path a
        // page turn does — and a superseded load is cancelled, not raced.
        .task(id: model.chapterKey(translation)) {
            await model.load(translation: translation)
        }
        // Reading history for "Pick Up Your Cross": a chapter counts as read
        // only once it has actually been on screen for a few seconds. Keyed on
        // `loadedKey` rather than the selection so the clock starts when the
        // text is really there, and paging away cancels the wait mid-sleep.
        .task(id: model.loadedKey) {
            guard model.loadedKey == model.chapterKey(translation) else { return }
            try? await Task.sleep(for: BibleModel.readEventDelay)
            guard !Task.isCancelled else { return }
            model.recordRead(translation: translation)
        }
    }

    // MARK: - Chrome

    private var topBar: some View {
        HStack(spacing: Spacing.md) {
            Button {
                model.showChapterGrid()
            } label: {
                Label("Chapters", systemImage: "chevron.left")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(theme.accent)
            }
            .buttonStyle(SubtleButtonStyle())
            .help("Back to the chapter list")

            Text(model.reference)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.text)
                .lineLimit(1)

            Spacer()

            if let book = model.selectedBook {
                Button {
                    showAtlas(book, model.chapter)
                } label: {
                    Label("Who's here", systemImage: "person.2")
                        .font(.system(size: 11, weight: .semibold))
                }
                .buttonStyle(SubtleButtonStyle())
                .help("Open the people, places and events in this chapter")
                .accessibilityLabel("Who's in this chapter")
            }

            translationChips

            HStack(spacing: Spacing.xs) {
                fontButton("A−", size: 12, enabled: model.canShrinkFont) { model.stepFont(-1) }
                fontButton("A+", size: 15, enabled: model.canGrowFont) { model.stepFont(1) }
            }
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.md)
    }

    private var translationChips: some View {
        @Bindable var settings = app.settings
        return HStack(spacing: Spacing.xs) {
            ForEach(TranslationID.allCases, id: \.self) { id in
                let isActive = translation == id
                Button {
                    settings.translation = id
                } label: {
                    Text(id.label)
                        .font(.system(size: 11, weight: .bold))
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
                .help("Read in the \(id.label)")
            }
        }
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
                    Task { await model.load(translation: translation) }
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
                    ForEach(Array(model.verses.enumerated()), id: \.offset) { index, markup in
                        verseRow(number: index + 1, markup: markup)
                            .id(index + 1)
                    }

                    footer
                }
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

    // MARK: - Verse panel

    /// Tap-a-verse lands here: the tapped verse's explanation and actions, in a
    /// panel pinned under the reader rather than inline in the verse list.
    ///
    /// The placement is a hard requirement, not a layout preference. Streaming
    /// text into a row of the reader's `LazyVStack` re-measures every verse in
    /// the chapter on every update — a chapter of Cormorant Garamond, tens of
    /// times a second — which pegged the main thread so badly that the very
    /// stream feeding it never got scheduled again, and the explanation never
    /// arrived. Outside the scroll view, the verse list never re-measures at
    /// all. It also happens to be the better Mac reading experience, and the
    /// closest analogue to Android's bottom sheet.
    @ViewBuilder
    private var versePanel: some View {
        if let number = model.actionVerse {
            let reference = model.verseReference(number)
            let text = model.verseText(number)

            VStack(alignment: .leading, spacing: Spacing.sm) {
                HStack {
                    Text(reference)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(theme.accent)
                    Spacer()
                    Button {
                        model.dismissVerseActions()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(theme.textMuted)
                    }
                    .buttonStyle(.plain)
                    .help("Close")
                    .accessibilityLabel("Close verse panel")
                }

                VerseInsightView(
                    status: model.insight.status,
                    text: model.insight.text,
                    error: model.insight.error,
                    onRetry: { model.insight.retry() }
                )

                actionRow(reference: reference, text: text)
            }
            .padding(.horizontal, Spacing.xxl)
            .padding(.vertical, Spacing.md)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .center)
            .background(theme.glassLight)
            .overlay(alignment: .top) {
                Rectangle()
                    .fill(theme.border)
                    .frame(height: 1)
            }
        }
    }

    private func scrollToPendingVerse(_ proxy: ScrollViewProxy) {
        guard model.loadedKey == model.chapterKey(translation),
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

    @ViewBuilder
    private func verseRow(number: Int, markup: String) -> some View {
        let isHighlighted = model.highlightedVerse == number
        let isOpen = model.actionVerse == number
        let reference = model.verseReference(number)
        let text = VerseMarkup.plainText(markup)
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
            // own. Copy still sits one click away in the action row and the
            // context menu, and the AI explanation below *is* selectable.
            Button {
                model.toggleVerse(number, translation: translation)
            } label: {
                verseText(number: number, markup: markup)
                    .lineSpacing(model.lineHeight - model.fontSize)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(reference). Explain this verse")
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
                            Label(preset.name, systemImage: isCurrent ? "checkmark" : "circle.fill")
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
                model.copy(reference: reference, text: text, translation: translation)
            }
            ShareLink(
                item: VerseAttachment.formatForSharing(
                    reference: reference,
                    text: text,
                    translation: translation
                )
            ) {
                Text("Share…")
            }
            Button("Save to note") {
                model.saveToNote(reference: reference, text: text, translation: translation)
            }
            Button("✦ Expand with AI") {
                askAI(reference, text)
            }
        }
    }

    /// Verse number then the emphasis-aware segments, concatenated into one
    /// `Text` so the number stays inline with the wrapped body.
    private func verseText(number: Int, markup: String) -> Text {
        // Ink read against the sheet, not against the shell: the parchment
        // tokens are a separate set for exactly this reason.
        let ink = parchment ? theme.parchmentInk : theme.textSecondary
        let numberInk = parchment ? theme.parchmentNumber : theme.accentDim

        var result = Text("\(number) ")
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(numberInk)
        for segment in VerseMarkup.segments(markup) {
            result = result
                + Text(segment.text)
                .font(
                    .custom(
                        segment.italic ? FontFamily.verseItalic : FontFamily.verse,
                        size: model.fontSize
                    )
                )
                .italic(segment.italic)
                .foregroundStyle(ink)
        }
        return result
    }

    private func actionRow(reference: String, text: String) -> some View {
        HStack(spacing: Spacing.sm) {
            Button("Copy") {
                model.copy(reference: reference, text: text, translation: translation)
            }
            .buttonStyle(SubtleButtonStyle())

            ShareLink(
                item: VerseAttachment.formatForSharing(
                    reference: reference,
                    text: text,
                    translation: translation
                )
            ) {
                Text("Share")
            }
            .buttonStyle(SubtleButtonStyle())

            Button("Save to note") {
                model.saveToNote(reference: reference, text: text, translation: translation)
            }
            .buttonStyle(SubtleButtonStyle())

            Button("✦ Expand with AI") {
                askAI(reference, text)
            }
            .buttonStyle(SubtleButtonStyle())

            if let order = model.selectedBook, let verse = model.actionVerse {
                highlightControls(order: order, verse: verse)
            }

            Spacer()
        }
        .font(.system(size: 11, weight: .semibold))
        .foregroundStyle(theme.textMuted)
    }

    /// YouVersion-style highlight picker: the shared preset swatches (current
    /// colour ringed), a native `ColorPicker` for a custom colour, and a
    /// Remove button once the verse is highlighted.
    private func highlightControls(order: Int, verse: Int) -> some View {
        let current = app.highlights.hex(
            translation: translation,
            book: order,
            chapter: model.chapter,
            verse: verse
        )
        return HStack(spacing: Spacing.xs) {
            ForEach(HighlightColors.presets) { preset in
                let isCurrent = current?.caseInsensitiveCompare(preset.hex) == .orderedSame
                Button {
                    app.highlights.setColor(
                        translation: translation,
                        book: order,
                        chapter: model.chapter,
                        verse: verse,
                        hex: preset.hex
                    )
                } label: {
                    Circle()
                        .fill(Color(hex: preset.hex) ?? .clear)
                        .frame(width: 14, height: 14)
                        .overlay {
                            if isCurrent {
                                Circle()
                                    .strokeBorder(theme.accent, lineWidth: 2)
                                    .padding(-2)
                            }
                        }
                        .contentShape(.circle)
                }
                .buttonStyle(.plain)
                .help("Highlight \(preset.name)")
                .accessibilityLabel("Highlight \(preset.name)")
            }

            ColorPicker(
                "",
                selection: Binding(
                    get: { current.flatMap { Color(hex: $0) } ?? Color(hex: 0xF5D76E) },
                    set: { picked in
                        guard let hex = HighlightColors.hexString(from: picked) else { return }
                        app.highlights.setColor(
                            translation: translation,
                            book: order,
                            chapter: model.chapter,
                            verse: verse,
                            hex: hex
                        )
                    }
                ),
                supportsOpacity: false
            )
            .labelsHidden()
            .frame(width: 28, height: 22)
            .help("Custom highlight color")

            if current != nil {
                Button("Remove") {
                    app.highlights.remove(
                        translation: translation,
                        book: order,
                        chapter: model.chapter,
                        verse: verse
                    )
                }
                .buttonStyle(SubtleButtonStyle())
            }
        }
    }

    private var footer: some View {
        VStack(spacing: Spacing.xl) {
            // An em dash, matching `TranslationID.copyright`'s own - so the
            // NKJV line does not read "NKJV - © Thomas Nelson - text via …"
            // with two different dashes in one sentence.
            Text("\(translation.label) \u{2014} \(translation.copyright)")
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
