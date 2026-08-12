import SwiftUI

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

    private var translation: TranslationID { app.settings.translation }

    var body: some View {
        VStack(spacing: 0) {
            topBar

            if model.loading {
                loadingState
            } else if let error = model.error {
                errorState(error)
            } else {
                reader
            }
        }
        // The chapter *and* the translation are part of the identity of what is
        // on screen, so a translation change reloads through the same path a
        // page turn does — and a superseded load is cancelled, not raced.
        .task(id: model.chapterKey(translation)) {
            await model.load(translation: translation)
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
            // pending verse — no reload, so `loadedKey` never moves and the
            // effect above never re-fires. Android keys its effect on the verse
            // param for the same reason.
            .onChange(of: model.pendingVerse) { _, verse in
                guard verse != nil else { return }
                scrollToPendingVerse(proxy)
            }
        }
        .overlay(alignment: .bottomTrailing) {
            Button {
                askAI(model.reference, model.chapterText)
            } label: {
                Text("✦ Ask AI")
                    .font(.system(size: 13, weight: .bold))
            }
            .buttonStyle(AccentButtonStyle())
            .padding(Spacing.xl)
            .accessibilityLabel("Ask AI about \(model.reference)")
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

    @ViewBuilder
    private func verseRow(number: Int, markup: String) -> some View {
        let isHighlighted = model.highlightedVerse == number
        let isOpen = model.actionVerse == number
        let reference = model.verseReference(number)
        let text = VerseMarkup.plainText(markup)

        VStack(alignment: .leading, spacing: Spacing.sm) {
            verseText(number: number, markup: markup)
                .lineSpacing(model.lineHeight - model.fontSize)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)

            if isOpen {
                actionRow(reference: reference, text: text)
            }
        }
        .padding(.horizontal, Spacing.sm)
        .padding(.vertical, Spacing.xs)
        .background(
            isHighlighted ? theme.accentSoft : (isOpen ? theme.surface : .clear),
            in: .rect(cornerRadius: Radius.md)
        )
        .contentShape(.rect(cornerRadius: Radius.md))
        .onTapGesture {
            model.actionVerse = isOpen ? nil : number
        }
        .contextMenu {
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
            Button("Ask AI about this verse") {
                askAI(reference, text)
            }
        }
    }

    /// Verse number then the emphasis-aware segments, concatenated into one
    /// `Text` so the number stays inline with the wrapped body.
    private func verseText(number: Int, markup: String) -> Text {
        var result = Text("\(number) ")
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(theme.accentDim)
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
                .foregroundStyle(theme.textSecondary)
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

            Button("✦ Ask AI") {
                askAI(reference, text)
            }
            .buttonStyle(SubtleButtonStyle())

            Spacer()
        }
        .font(.system(size: 11, weight: .semibold))
        .foregroundStyle(theme.textMuted)
    }

    private var footer: some View {
        VStack(spacing: Spacing.xl) {
            Text("\(translation.label) — \(translation.copyright)")
                .font(.system(size: 11))
                .italic()
                .foregroundStyle(theme.textGhost)
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
