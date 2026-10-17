import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// The Share sheet for verses, Pick Up Your Cross and answers on macOS and iOS
/// (`docs/FEATURES.md`, "Share cards"). Port of
/// `mobile/src/features/shareCards/ShareCardSheet.tsx` and the web's
/// `src/components/share/ShareCardDialog.tsx`; the pure rules live in
/// `ShareCards.swift`.
///
/// The preview is the server's own card at half size, so what the reader sees
/// is exactly what gets shared, and switching style or size costs about 60 KB.
/// Share image downloads the full card and opens the system share UI with the
/// file. Text (or, for an answer, its link) stays one tap away and is the path
/// that works offline.

/// One open of the sheet, for `.sheet(item:)`. A fresh id per open, so a
/// second open of the same verse starts clean, as Android's sheet does.
struct ShareCardItem: Identifiable {
    let id = UUID()
    let target: ShareCardTarget
    /// The plain-text form for Share as text. Unused for answers, which share a link.
    var shareText: String?
}

extension DailyCrossEntry {
    /// The Share sheet for this day, or nil for a row from a server old enough
    /// to send no id: the cross card is fetched by that id.
    var shareCardItem: ShareCardItem? {
        guard let id, !id.isEmpty else { return nil }
        return ShareCardItem(
            target: .cross(id: id, reference: reference),
            shareText: ShareCards.crossShareText(reference: reference, text: text, question: question)
        )
    }
}

/// What is waiting for the system share UI.
struct OutgoingShare: Identifiable {
    enum Payload {
        /// The downloaded card, as a JPEG file the receiving app can keep.
        case image(URL)
        case text(String)
        case link(URL)
    }

    let id = UUID()
    let payload: Payload

    /// The analytics `method`, Android's spelling.
    var method: String {
        switch payload {
        case .image: "image"
        case .text: "text"
        case .link: "link"
        }
    }
}

// MARK: - API

extension APIClient {
    /// The verse's one-line word of encouragement, written once per passage on
    /// the server. An AI call: callers ask the consent gate first.
    func shareCardEncouragement(for reference: String) async throws -> EncouragementResponse {
        try await json(
            "/api/cards/encouragement",
            method: "POST",
            body: EncouragementRequest(ref: reference),
            as: EncouragementResponse.self
        )
    }

    /// One card's JPEG. Only the personal cross card goes out with the session;
    /// a verse or answer card is public and asked for with none.
    func shareCardImage(_ path: String, withSession: Bool) async throws -> Data {
        withSession ? try await data(path) : try await publicData(path)
    }
}

// MARK: - Model

/// State behind one open of the sheet. Owned by the view as `@State`, so it
/// lives exactly as long as the sheet does.
@MainActor
@Observable
final class ShareCardModel {
    enum Note {
        case idle
        case loading
        /// `reference` is the server's own spelling, which the card URL must use.
        case ready(text: String, reference: String)
        case unavailable(String)
    }

    enum Preview {
        case loading(String?)
        case ready(Image)
        case error(String)
    }

    static let writingNotice = "Writing a word for this verse…"
    static let noteFallback = "Encouragement isn't available right now."
    static let linkFallback = "The link didn't reach the server. Check your connection and try again."
    static let cardFallback = "The card didn't load. Check your connection and try again."

    let item: ShareCardItem
    private let api: APIClient
    private let defaults: UserDefaults

    private(set) var prefs: ShareCardPrefs
    private(set) var note: Note = .idle
    private(set) var link: SharedAnswerLink?
    private(set) var linkError: String?
    private(set) var preview: Preview = .loading(nil)
    /// True while Share image downloads the full card.
    private(set) var isPreparing = false
    private(set) var actionError: String?
    /// Set when a file, text or link is ready for the system share UI; the view
    /// presents it and clears it.
    var pendingShare: OutgoingShare?

    /// Previews already drawn, by path, so a style tapped twice is never
    /// fetched twice.
    private var previews: [String: Image] = [:]
    private var previewTask: Task<Void, Never>?
    private var noteTask: Task<Void, Never>?
    private var linkTask: Task<Void, Never>?
    private var started = false
    /// The device's zone, so the cross card's date is the reader's day.
    private let timeZone = TimeZone.current.identifier

    init(item: ShareCardItem, api: APIClient, defaults: UserDefaults = .standard) {
        self.item = item
        self.api = api
        self.defaults = defaults
        self.prefs = ShareCardPrefs.load(defaults)
    }

    var target: ShareCardTarget { item.target }
    var drawable: Bool { ShareCards.canDraw(target) }

    var isVerse: Bool {
        if case .verse = target { return true }
        return false
    }

    var isPreviewReady: Bool {
        if case .ready = preview { return true }
        return false
    }

    /// The quiet line under the toggle when the word could not be written.
    var noteHint: String? {
        guard prefs.encourage, case .unavailable(let message) = note else { return nil }
        return message
    }

    var secondaryLabel: String {
        if case .answer = target { return "Share link" }
        return "Share as text"
    }

    var canShareWords: Bool {
        if case .answer = target { return link?.shareURL != nil }
        return item.shareText != nil
    }

    private var wantsNote: Bool { isVerse && drawable && prefs.encourage }

    private var readyNote: (text: String, reference: String)? {
        guard wantsNote, case .ready(let text, let reference) = note else { return nil }
        return (text, reference)
    }

    // MARK: Lifecycle

    func start() {
        guard !started else { return }
        started = true
        mintLink()
        requestNoteIfNeeded()
        loadPreview()
    }

    func stop() {
        previewTask?.cancel()
        noteTask?.cancel()
        linkTask?.cancel()
    }

    // MARK: Choices

    func choose(style: ShareCardStyle) {
        guard style != prefs.style else { return }
        prefs.style = style
        remember()
        loadPreview()
    }

    func choose(format: ShareCardFormat) {
        guard format != prefs.format else { return }
        prefs.format = format
        remember()
        loadPreview()
    }

    func setEncourage(_ encourage: Bool) {
        prefs.encourage = encourage
        remember()
        // Turning it back on after a failure is the way to try again.
        if encourage, case .unavailable = note { note = .idle }
        requestNoteIfNeeded()
        loadPreview()
    }

    private func remember() {
        actionError = nil
        prefs.save(defaults)
    }

    func retry() {
        previews.removeAll()
        if case .answer = target, link == nil { mintLink() }
        loadPreview()
    }

    // MARK: The answer's link

    /// An answer's card is drawn from its public snapshot, so the link is
    /// minted as the sheet opens. Minting is idempotent per answer, and the
    /// POST is also what re-activates a link revoked in Settings, so it runs on
    /// every open rather than reusing a cached URL.
    private func mintLink() {
        guard case .answer(let conversationID, let messageID) = target else { return }
        linkError = nil
        linkTask = Task { [weak self, api] in
            do {
                let minted = try await api.shareAnswer(conversationID: conversationID, messageID: messageID)
                guard let self, !Task.isCancelled else { return }
                if minted.shareURL == nil || minted.id.isEmpty {
                    self.linkError = Self.linkFallback
                } else {
                    self.link = minted
                }
                self.loadPreview()
            } catch {
                guard let self, !Task.isCancelled else { return }
                self.linkError = Self.message(error, fallback: Self.linkFallback)
                self.loadPreview()
            }
        }
    }

    // MARK: The word of encouragement

    /// Ask for the verse's encouragement as the sheet opens. A passage someone
    /// already shared answers at once; a first share takes a few seconds. Any
    /// failure (AI turned off, the model down, the hourly cap) leaves a plain
    /// verse card and a quiet line under the toggle.
    private func requestNoteIfNeeded() {
        guard wantsNote, case .idle = note, case .verse(let reference, _) = target else { return }
        note = .loading
        noteTask = Task { [weak self, api] in
            // The POST reaches a model, so it waits on the same consent sheet
            // as every other AI action the reader starts with a tap.
            guard await AIConsentGate.ensure(.tap) else {
                self?.finishNote(.unavailable(AIConsent.declinedNotice))
                return
            }
            do {
                let result = try await api.shareCardEncouragement(for: reference)
                self?.finishNote(.ready(text: result.text, reference: result.reference))
            } catch {
                self?.finishNote(.unavailable(Self.message(error, fallback: Self.noteFallback)))
            }
        }
    }

    private func finishNote(_ next: Note) {
        guard !Task.isCancelled else { return }
        note = next
        loadPreview()
    }

    // MARK: Previews

    /// The card path for `style` in the current format. While a word of
    /// encouragement is on, the reference is the server's own spelling, so the
    /// card is one canonical URL.
    func path(style: ShareCardStyle, size: ShareCardSize) -> String? {
        var drawn = target
        if let readyNote, case .verse(_, let translation) = target {
            drawn = .verse(reference: readyNote.reference, translation: translation)
        }
        let request = ShareCardRequest(
            style: style,
            format: prefs.format,
            size: size,
            note: readyNote != nil,
            timeZone: timeZone
        )
        return ShareCards.path(for: drawn, request, sharedAnswerID: link?.id)
    }

    /// Load the chosen preview, then warm the other styles so a tap on them is
    /// instant.
    private func loadPreview() {
        previewTask?.cancel()
        guard drawable else { return }
        if wantsNote {
            switch note {
            case .idle, .loading:
                preview = .loading(Self.writingNotice)
                return
            case .ready, .unavailable:
                break
            }
        }
        guard let path = path(style: prefs.style, size: .preview) else {
            preview = linkError.map(Preview.error) ?? .loading(nil)
            return
        }
        if let cached = previews[path] {
            preview = .ready(cached)
        } else {
            preview = .loading(nil)
        }
        let style = prefs.style
        previewTask = Task { [weak self] in
            do {
                guard let image = try await self?.fetchPreview(path) else { return }
                guard let self, !Task.isCancelled else { return }
                self.preview = .ready(image)
                for other in ShareCardStyle.allCases where other != style {
                    guard !Task.isCancelled, let otherPath = self.path(style: other, size: .preview) else { continue }
                    _ = try? await self.fetchPreview(otherPath)
                }
            } catch {
                guard let self, !Task.isCancelled else { return }
                self.preview = .error(Self.message(error, fallback: Self.cardFallback))
            }
        }
    }

    private func fetchPreview(_ path: String) async throws -> Image {
        if let cached = previews[path] { return cached }
        let data = try await api.shareCardImage(path, withSession: ShareCards.needsSession(target))
        guard let image = Self.image(from: data) else { throw APIError(message: Self.cardFallback) }
        previews[path] = image
        return image
    }

    private static func image(from data: Data) -> Image? {
        #if os(macOS)
        NSImage(data: data).map { Image(nsImage: $0) }
        #else
        UIImage(data: data).map { Image(uiImage: $0) }
        #endif
    }

    // MARK: Sharing

    /// Download the full card, keep it as a named JPEG, and hand it to the
    /// system share UI.
    func shareImage() async {
        guard !isPreparing, let path = path(style: prefs.style, size: .full) else { return }
        isPreparing = true
        actionError = nil
        defer { isPreparing = false }
        do {
            let data = try await api.shareCardImage(path, withSession: ShareCards.needsSession(target))
            let file = try Self.write(data, named: ShareCards.fileName(target, style: prefs.style, format: prefs.format))
            pendingShare = OutgoingShare(payload: .image(file))
        } catch {
            guard !Task.isCancelled else { return }
            actionError = Self.message(error, fallback: "That card couldn't be shared. Try again.")
        }
    }

    /// Share as text (the words travel with the door, so a text share brings
    /// people in too), or an answer's link.
    func shareWords() {
        guard !isPreparing else { return }
        actionError = nil
        switch target {
        case .answer:
            guard let url = link?.shareURL else { return }
            pendingShare = OutgoingShare(payload: .link(url))
        case .verse(let reference, _), .cross(_, let reference):
            guard let text = item.shareText else { return }
            pendingShare = OutgoingShare(payload: .text(ShareCards.textShare(text, reference: reference, note: readyNote?.text)))
        }
    }

    /// Something actually left the device: the event carries the kind and the
    /// method only, never the reference or the words.
    func didShare(_ share: OutgoingShare) {
        AnalyticsReporter.track(
            AnalyticsEvents.shareCardShared,
            ["kind": .string(target.kind), "method": .string(share.method)]
        )
    }

    /// Cards are written into their own folder under the temporary directory,
    /// named for what they show, and the OS may clear them whenever it likes.
    private static func write(_ data: Data, named name: String) throws -> URL {
        let folder = FileManager.default.temporaryDirectory.appending(path: "share-cards", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appending(path: name, directoryHint: .notDirectory)
        try data.write(to: file, options: .atomic)
        return file
    }

    /// The server's own `{ "error": ... }` text when there is one (a 422 says
    /// the passage is too long for that size), else the fixed sentence.
    private static func message(_ error: any Error, fallback: String) -> String {
        if let apiError = error as? APIError, !apiError.message.isEmpty { return apiError.message }
        return fallback
    }
}

// MARK: - View

struct ShareCardSheet: View {
    @Environment(\.theme) private var theme
    @State private var model: ShareCardModel
    private let onClose: () -> Void

    init(item: ShareCardItem, api: APIClient, onClose: @escaping () -> Void) {
        _model = State(initialValue: ShareCardModel(item: item, api: api))
        self.onClose = onClose
    }

    var body: some View {
        chrome
            .task { model.start() }
            .onDisappear { model.stop() }
    }

    #if os(macOS)
    private static let sheetSize = CGSize(width: 440, height: 700)

    private var chrome: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Share")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(theme.text)
                Spacer()
                Button("Done", action: onClose)
                    .keyboardShortcut(.cancelAction)
            }
            .padding(Spacing.md)
            Divider().overlay(theme.border)
            ScrollView {
                content(maxPreviewHeight: Self.sheetSize.height * 0.44, width: Self.sheetSize.width)
            }
        }
        .frame(width: Self.sheetSize.width, height: Self.sheetSize.height)
        .background(theme.bgElevated)
    }
    #else
    private var chrome: some View {
        NavigationStack {
            GeometryReader { proxy in
                ScrollView {
                    // The preview never takes more than about 44% of the
                    // screen, so the choices and the button stay in view.
                    content(maxPreviewHeight: proxy.size.height * 0.44, width: proxy.size.width)
                }
            }
            .background(theme.bgElevated)
            .navigationTitle("Share")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", action: onClose)
                }
            }
        }
        .presentationDetents([.large])
        .sheet(item: $model.pendingShare) { share in
            ActivitySheet(share: share) {
                model.didShare(share)
                model.pendingShare = nil
                onClose()
            }
            .presentationDetents([.medium, .large])
        }
    }
    #endif

    private func content(maxPreviewHeight: CGFloat, width: CGFloat) -> some View {
        VStack(spacing: Spacing.md) {
            if model.drawable {
                preview(maxHeight: maxPreviewHeight, width: width)
                styleChips
                formatPicker
                if model.isVerse { encourageRow }
                shareImageButton
            } else {
                Text(ShareCards.textOnlyNotice)
                    .font(.system(size: 14))
                    .foregroundStyle(theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.vertical, Spacing.md)
            }

            Button {
                model.shareWords()
            } label: {
                Text(model.secondaryLabel)
                    .frame(maxWidth: .infinity, minHeight: 36)
            }
            .buttonStyle(GhostShareButtonStyle())
            .disabled(model.isPreparing || !model.canShareWords)
            #if os(macOS)
            .background {
                SharingPicker(share: $model.pendingShare, matches: { share in
                    if case .image = share.payload { return false }
                    return true
                }, onShared: model.didShare)
            }
            #endif

            if let actionError = model.actionError {
                Text(actionError)
                    .font(.system(size: 13))
                    .foregroundStyle(theme.danger)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.lg)
        .frame(maxWidth: .infinity)
    }

    // MARK: Preview

    private func preview(maxHeight: CGFloat, width: CGFloat) -> some View {
        let aspect = CGFloat(model.prefs.format.aspectRatio)
        let height = max(120, min(maxHeight, (width - Spacing.xl * 2) / aspect))
        return ZStack {
            switch model.preview {
            case .ready(let image):
                image
                    .resizable()
                    .scaledToFill()
            case .error(let message):
                VStack(spacing: Spacing.md) {
                    Text(message)
                        .font(.system(size: 13))
                        .foregroundStyle(theme.textSecondary)
                        .multilineTextAlignment(.center)
                    Button("Try again") { model.retry() }
                        .buttonStyle(AccentButtonStyle())
                }
                .padding(Spacing.lg)
            case .loading(let message):
                VStack(spacing: Spacing.md) {
                    ProgressView()
                        .tint(theme.accent)
                    if let message {
                        Text(message)
                            .font(.system(size: 13))
                            .foregroundStyle(theme.textSecondary)
                            .multilineTextAlignment(.center)
                    }
                }
                .padding(Spacing.lg)
            }
        }
        .frame(width: height * aspect, height: height)
        .background(theme.surface)
        .clipShape(.rect(cornerRadius: Radius.lg))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.lg)
                .strokeBorder(theme.borderStrong, lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Preview of the \(model.prefs.style.label) \(model.prefs.format.rawValue) card")
    }

    // MARK: Choices

    private var styleChips: some View {
        HStack(spacing: Spacing.sm) {
            ForEach(ShareCardStyle.allCases) { style in
                let selected = style == model.prefs.style
                Button {
                    model.choose(style: style)
                } label: {
                    HStack(spacing: 6) {
                        StyleSwatch(style: style)
                        Text(style.label)
                            .font(.system(size: 13, weight: .semibold))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                    .foregroundStyle(selected ? theme.accent : theme.textMuted)
                    .padding(.horizontal, 10)
                    .frame(minHeight: 40)
                    .background(selected ? theme.accentSoft : .clear, in: .capsule)
                    .overlay {
                        Capsule().strokeBorder(selected ? theme.accent : theme.borderStrong, lineWidth: selected ? 1.5 : 1)
                    }
                    .contentShape(.capsule)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(style.label) style")
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
    }

    private var formatPicker: some View {
        Picker("Card size", selection: Binding(
            get: { model.prefs.format },
            set: { model.choose(format: $0) }
        )) {
            ForEach(ShareCardFormat.allCases) { format in
                Text(format.label).tag(format)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .frame(maxWidth: 240)
    }

    private var encourageRow: some View {
        Toggle(isOn: Binding(
            get: { model.prefs.encourage },
            set: { model.setEncourage($0) }
        )) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Add a word of encouragement")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(theme.textSecondary)
                if let hint = model.noteHint {
                    Text(hint)
                        .font(.system(size: 12))
                        .foregroundStyle(theme.textFaint)
                }
            }
        }
        .toggleStyle(.switch)
        .tint(theme.accent)
        .frame(minHeight: 44)
    }

    private var shareImageButton: some View {
        Button {
            Task { await model.shareImage() }
        } label: {
            Text(model.isPreparing ? "Preparing…" : "Share image")
                .font(.system(size: 14, weight: .semibold))
                .frame(maxWidth: .infinity, minHeight: 36)
        }
        .buttonStyle(AccentButtonStyle())
        .disabled(model.isPreparing || !model.isPreviewReady)
        .padding(.top, Spacing.xs)
        #if os(macOS)
        .background {
            SharingPicker(share: $model.pendingShare, matches: { share in
                if case .image = share.payload { return true }
                return false
            }, onShared: model.didShare)
        }
        #endif
    }
}

/// The small "Share" pill under Pick Up Your Cross's verse card, Android's
/// `sharePill`, beside the same action in the toolbar.
struct CrossSharePill: View {
    @Environment(\.theme) private var theme
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label("Share", systemImage: "square.and.arrow.up")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(theme.accent)
                .padding(.horizontal, Spacing.md)
                .frame(minHeight: 36)
                .background(theme.accentSoft, in: .capsule)
                .overlay { Capsule().strokeBorder(theme.accentBorder, lineWidth: 1) }
                .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Share today's word as a card")
    }
}

/// The chip's two-colour swatch: the style's ground with its glow rising in it.
private struct StyleSwatch: View {
    let style: ShareCardStyle

    var body: some View {
        Circle()
            .fill(Color(hex: style.swatch.ground))
            .overlay(alignment: .top) {
                Circle()
                    .fill(Color(hex: style.swatch.glow, opacity: 0.9))
                    .frame(width: 12, height: 12)
                    .padding(.top, 2)
            }
            .clipShape(.circle)
            .frame(width: 18, height: 18)
            .accessibilityHidden(true)
    }
}

/// The secondary action: an outline, quieter than the accent primary.
private struct GhostShareButtonStyle: ButtonStyle {
    @Environment(\.theme) private var theme
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(isEnabled ? theme.textSecondary : theme.textGhost)
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.sm)
            .background(configuration.isPressed ? theme.surfacePressed : .clear, in: .capsule)
            .overlay {
                Capsule().strokeBorder(theme.borderStrong, lineWidth: 1)
            }
            .contentShape(.capsule)
            .opacity(isEnabled ? 1 : 0.6)
    }
}

// MARK: - Presenting

extension View {
    /// The Share sheet for whatever `item` names, in each platform's own
    /// presentation (a sheet on both; detents on iOS, a fixed panel on macOS).
    func shareCardSheet(item: Binding<ShareCardItem?>, api: APIClient) -> some View {
        sheet(item: item) { open in
            ShareCardSheet(item: open, api: api) { item.wrappedValue = nil }
        }
    }
}

#if os(iOS)
/// The system share sheet for one card, text or link. `UIActivityViewController`
/// rather than `ShareLink` because the file does not exist until Share image
/// has downloaded it, and `ShareLink` needs its item up front.
private struct ActivitySheet: UIViewControllerRepresentable {
    let share: OutgoingShare
    /// Called once something was actually sent, not when the sheet is swiped away.
    let onShared: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onShared: onShared) }

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let items: [Any]
        switch share.payload {
        case .image(let file): items = [file]
        case .text(let text): items = [text]
        case .link(let url): items = [AnswerLinkItem(url: url)]
        }
        let controller = UIActivityViewController(activityItems: items, applicationActivities: nil)
        let coordinator = context.coordinator
        controller.completionWithItemsHandler = { _, completed, _, _ in
            MainActor.assumeIsolated {
                if completed { coordinator.onShared() }
            }
        }
        return controller
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}

    @MainActor
    final class Coordinator {
        let onShared: () -> Void
        init(onShared: @escaping () -> Void) { self.onShared = onShared }
    }
}

/// An answer's link, with the subject Android puts on its `Share.share` call
/// ("An answer from SureWord") for the apps that use one, such as Mail.
private final class AnswerLinkItem: NSObject, UIActivityItemSource {
    static let subject = "An answer from SureWord"
    let url: URL
    init(url: URL) { self.url = url }

    func activityViewControllerPlaceholderItem(_ controller: UIActivityViewController) -> Any { url }
    func activityViewController(_ controller: UIActivityViewController, itemForActivityType type: UIActivity.ActivityType?) -> Any? { url }
    func activityViewController(_ controller: UIActivityViewController, subjectForActivityType type: UIActivity.ActivityType?) -> String { Self.subject }
}
#endif

#if os(macOS)
/// Opens `NSSharingServicePicker` anchored to the button it sits behind, once
/// a share it `matches` is pending. A bridge rather than `ShareLink` for the
/// same reason as iOS: the card file does not exist until it is downloaded,
/// and `ShareLink` needs its item up front.
///
/// The sheet stays open afterwards, unlike iOS: the chosen service (AirDrop,
/// Messages) presents from this sheet's window, and closing it under them
/// would take their UI with it.
private struct SharingPicker: NSViewRepresentable {
    @Binding var share: OutgoingShare?
    let matches: (OutgoingShare) -> Bool
    let onShared: (OutgoingShare) -> Void

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> NSView { NSView() }

    func updateNSView(_ view: NSView, context: Context) {
        let coordinator = context.coordinator
        // An update pass can run again before the task below clears the
        // binding; one pending share opens one picker.
        guard let pending = share, matches(pending), coordinator.presented != pending.id else { return }
        coordinator.presented = pending.id
        let onShared = onShared
        coordinator.onChoose = { onShared(pending) }
        // Out of the update pass: clearing the binding and running the picker's
        // menu both belong after SwiftUI has finished laying this view out.
        Task { @MainActor in
            share = nil
            let items: [Any]
            switch pending.payload {
            case .image(let file): items = [file]
            case .text(let text): items = [text]
            case .link(let url): items = [url]
            }
            let picker = NSSharingServicePicker(items: items)
            picker.delegate = coordinator
            picker.show(relativeTo: view.bounds, of: view, preferredEdge: .minY)
        }
    }

    @MainActor
    final class Coordinator: NSObject, @preconcurrency NSSharingServicePickerDelegate {
        var onChoose: (() -> Void)?
        var presented: UUID?

        func sharingServicePicker(_ sharingServicePicker: NSSharingServicePicker, didChoose service: NSSharingService?) {
            if service != nil { onChoose?() }
            onChoose = nil
        }
    }
}
#endif
