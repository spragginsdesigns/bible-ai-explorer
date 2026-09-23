import SwiftUI

/// Settings -> Shared answers, shared by the macOS and iOS Settings forms and
/// matching the web `/settings` section: every public link this account has
/// minted, with the way to take one back.
///
/// The view owns its own `Section` for the same reason `ChurchSectionView` does
/// (`Shared/Church/ChurchView.swift:16`): the settings screens then register it
/// with one line each. Unlike Memories there is nothing to push - a link is one
/// line of text, and the list is short by nature.
///
/// There is no public index of shared answers anywhere; this list is the
/// owner's own, read from `GET /api/shared`.
struct SharedAnswersSectionView: View {
    @Environment(\.theme) private var theme

    @Bindable var model: SharedAnswersModel

    /// The row whose link was just copied, so the confirmation lands on that row
    /// rather than as a screen-wide toast a Form has nowhere to put.
    @State private var copiedID: String?
    @State private var pendingRevoke: SharedAnswerRow?
    /// The row waiting on the "Show in search" confirmation. Turning it on makes
    /// the answer findable by strangers, so it asks first; turning it off never
    /// does.
    @State private var pendingListing: SharedAnswerRow?

    static let description =
        "Links you have created for single answers. Anyone with a link can read that answer, "
        + "and nothing else from the conversation. Links are unlisted, so search engines "
        + "don't show them, unless you turn on Show in search. Revoking one takes it back."

    static let listConfirmTitle = "Show this answer in search?"
    static let listConfirmMessage =
        "Anyone will be able to find this question and answer on Google and other search engines. "
        + "Your name is never shown. You can turn this off at any time."

    static let emptyState = "Answers you share appear here."

    var body: some View {
        Section("Shared answers") {
            // Both presentations hang off the hint rather than off the Section,
            // matching how `ChurchSectionView` attaches its own remove dialog to
            // a concrete row inside the section.
            hint(Self.description)
                .sharedAnswersErrorAlert(model)
                .confirmationDialog(
                    "Revoke this link?",
                    isPresented: Binding(
                        get: { pendingRevoke != nil },
                        set: { if !$0 { pendingRevoke = nil } }
                    ),
                    titleVisibility: .visible,
                    presenting: pendingRevoke
                ) { share in
                    Button("Revoke", role: .destructive) {
                        Task { await model.revoke(share) }
                    }
                    Button("Cancel", role: .cancel) {}
                } message: { share in
                    Text(
                        "\u{201C}\(share.title)\u{201D} will stop opening for anyone who already has the link."
                    )
                }
            content
        }
    }

    @ViewBuilder
    private var content: some View {
        if let loadError = model.loadError {
            HStack(spacing: Spacing.md) {
                Text(loadError)
                    .font(.system(size: 12))
                    .foregroundStyle(theme.danger)
                Spacer()
                Button("Retry") { Task { await model.load() } }
            }
        } else if !model.hasLoaded {
            HStack {
                ProgressView().controlSize(.small)
                Spacer()
            }
        } else if model.shares.isEmpty {
            hint(Self.emptyState)
        } else {
            ForEach(model.shares) { share in
                row(share)
            }
        }
    }

    @ViewBuilder
    private func row(_ share: SharedAnswerRow) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(share.title)
                .font(.system(size: 13))
                .foregroundStyle(share.isRevoked ? theme.textMuted : theme.text)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)

            HStack(spacing: Spacing.sm) {
                if let createdAt = share.createdAt,
                   !MemoryFormat.relativeTime(createdAt).isEmpty {
                    Text(MemoryFormat.relativeTime(createdAt))
                        .font(.system(size: 11))
                        .foregroundStyle(theme.textGhost)
                }
                if share.isRevoked {
                    Text("Revoked")
                        .font(.system(size: 10, weight: .bold))
                        .kerning(0.6)
                        .foregroundStyle(theme.textMuted)
                }
                Spacer()
                // A revoked link no longer opens, so neither action is offered
                // on it: copying a dead URL is a trap, and revoking twice is a
                // no-op the server already treats as one.
                if !share.isRevoked {
                    Button(copiedID == share.id ? "Link copied" : "Copy link") {
                        copy(share)
                    }
                    .buttonStyle(SubtleButtonStyle())
                    .font(.system(size: 11))
                    .foregroundStyle(theme.textMuted)
                    .accessibilityLabel("Copy the link to: \(share.title)")

                    Button("Revoke") { pendingRevoke = share }
                        .buttonStyle(SubtleButtonStyle())
                        .font(.system(size: 11))
                        .foregroundStyle(theme.danger)
                        .disabled(model.isRevoking(share))
                        .accessibilityLabel("Revoke the link to: \(share.title)")
                }
            }

            // Listing a revoked link is a 409 on the server, and revoking
            // already unlists it, so the switch only exists on a live link.
            if !share.isRevoked {
                Toggle(isOn: listedBinding(share)) {
                    Text("Show in search")
                        .font(.system(size: 12))
                        .foregroundStyle(theme.textMuted)
                }
                .toggleStyle(.switch)
                .controlSize(.small)
                .disabled(model.isUpdatingListing(share) || model.isRevoking(share))
                .accessibilityLabel("Show this answer in search: \(share.title)")
                // Hung off the row's own switch, bound to this row only, so it
                // does not stack a second alert onto the hint that already
                // carries the error alert and the revoke dialog.
                .alert(
                    Self.listConfirmTitle,
                    isPresented: Binding(
                        get: { pendingListing?.id == share.id },
                        set: { if !$0, pendingListing?.id == share.id { pendingListing = nil } }
                    )
                ) {
                    Button("Cancel", role: .cancel) {}
                    Button("Show in search") {
                        Task { await model.setListed(share, listed: true) }
                    }
                } message: {
                    Text(Self.listConfirmMessage)
                }
            }
        }
        .padding(.vertical, 2)
    }

    /// Off applies at once; on waits for the confirmation. The getter reads the
    /// model, so a cancelled confirmation leaves the switch where it was.
    private func listedBinding(_ share: SharedAnswerRow) -> Binding<Bool> {
        Binding(
            get: { model.shares.first(where: { $0.id == share.id })?.listed ?? share.listed },
            set: { next in
                if next {
                    pendingListing = share
                } else {
                    Task { await model.setListed(share, listed: false) }
                }
            }
        )
    }

    private func copy(_ share: SharedAnswerRow) {
        SharedAnswerPasteboard.copy(share.url)
        copiedID = share.id
        Task {
            try? await Task.sleep(for: .seconds(2))
            // Only clear our own confirmation: a copy of another row in the
            // meantime owns the label now.
            if copiedID == share.id { copiedID = nil }
        }
    }

    private func hint(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11))
            .foregroundStyle(theme.textGhost)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension View {
    /// Shared alert plumbing, matching `memoryErrorAlert`
    /// (`Shared/Memories/MemoriesView.swift:285`). Only one view observes this
    /// model at a time, so there is no `isActive` flag to arbitrate.
    @MainActor
    func sharedAnswersErrorAlert(_ model: SharedAnswersModel) -> some View {
        alert(
            model.errorAlert?.title ?? "",
            isPresented: Binding(
                get: { model.errorAlert != nil },
                set: { if !$0 { model.errorAlert = nil } }
            ),
            presenting: model.errorAlert
        ) { _ in
            Button("OK", role: .cancel) {}
        } message: { alert in
            Text(alert.message)
        }
    }
}
