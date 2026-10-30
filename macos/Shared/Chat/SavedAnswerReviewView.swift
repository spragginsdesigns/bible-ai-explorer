import SwiftUI
import UniformTypeIdentifiers

/// The normal message renderer only receives a checked row from the state GET.
/// Type erasure keeps the chat bubble's replacement seam non-recursive.
struct SavedAnswerReviewView: View {
    let message: ChatViewMessage
    let api: APIClient
    let content: (ChatViewMessage) -> AnyView

    @State private var model = SavedAnswerReviewModel()
    @State private var checkTask: Task<Void, Never>?
    @State private var downloadTask: Task<Void, Never>?
    @State private var isExporting = false

    private var binding: SavedAnswerReviewBinding? {
        guard let metadata = message.savedAnswerReview?.metadata,
              let owner = SavedAnswerReviewOwner.current else { return nil }
        return SavedAnswerReviewBinding(owner: owner, metadata: metadata)
    }

    private var document: SavedAnswerOriginalDocument? {
        model.download(for: binding).map(SavedAnswerOriginalDocument.init(data:))
    }

    var body: some View {
        let current = binding
        VStack(alignment: .leading, spacing: Spacing.sm) {
            if let checked = model.message(for: current) {
                content(checked)
            } else {
                Text(notice)
                    .font(.body)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let current {
                HStack(spacing: Spacing.md) {
                    if model.message(for: current) == nil {
                        Button(model.isChecking ? "Checking saved answer…" : "Check saved answer") {
                            checkTask = Task {
                                await model.check(current, using: SavedAnswerReviewTransport(api: api))
                            }
                        }
                        .disabled(model.isChecking || model.isDownloading)
                    }
                    Button(model.isDownloading ? "Preparing original…" : "Download original (unchecked)") {
                        downloadTask = Task {
                            await model.prepareDownload(current, using: SavedAnswerReviewTransport(api: api))
                            guard !Task.isCancelled, model.download(for: current) != nil, binding == current else { return }
                            isExporting = true
                        }
                    }
                    .disabled(model.isChecking || model.isDownloading)
                }
                .buttonStyle(.bordered)
            } else {
                Text(message.savedAnswerReview?.metadata == nil
                     ? "Reopen this saved answer to load its review controls."
                     : "Sign in to check this saved answer or download its original.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let error = model.error {
                Text(error).font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onChange(of: current, initial: true) { _, next in
            cancelTasks()
            isExporting = false
            model.activate(next)
        }
        .onDisappear {
            cancelTasks()
            isExporting = false
            model.activate(nil)
        }
        .fileExporter(isPresented: $isExporting, document: document, contentType: .json,
                      defaultFilename: "SureWord-saved-answer-original-unchecked.json") { _ in
            model.discardDownload()
        }
        .onChange(of: isExporting) { _, presented in
            if !presented { model.discardDownload() }
        }
    }

    private var notice: String {
        if model.state == .pending || (model.state == nil && message.savedAnswerReview?.metadata?.state == .pending) {
            return "This saved answer is being checked before it can be shown."
        }
        return "This saved answer is withheld until its source and claims can be verified. The original is available to download."
    }

    private func cancelTasks() {
        checkTask?.cancel()
        checkTask = nil
        downloadTask?.cancel()
        downloadTask = nil
    }
}

/// User-selected JSON export only; archived data never becomes inline content.
struct SavedAnswerOriginalDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    let data: Data

    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else { throw CocoaError(.fileReadCorruptFile) }
        self.data = data
    }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}
