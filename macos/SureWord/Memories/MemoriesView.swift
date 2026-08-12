import SwiftUI

/// Manage sheet for the memory feature — the Mac form of Android's push-only
/// `/memories` screen (`mobile/app/(app)/memories.tsx`): the AI-written summary,
/// adding, deleting and clearing. Reached from Settings → Memory → Manage.
///
/// The summary is an LLM call, so it never fires on appear — only when the user
/// asks for it.
struct MemoriesView: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss

    @Bindable var model: MemoriesModel

    @State private var pendingDelete: MemoryRecord?
    @State private var isConfirmingClearAll = false

    var body: some View {
        VStack(spacing: 0) {
            Form {
                summarySection
                addSection
                savedSection
                if !model.memories.isEmpty {
                    Section {
                        Button("Clear all memories", role: .destructive) {
                            isConfirmingClearAll = true
                        }
                    }
                }
            }
            .formStyle(.grouped)

            Divider().overlay(theme.border)

            HStack {
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
            .padding(Spacing.md)
        }
        .frame(width: 520, height: 600)
        .task { await model.load() }
        .confirmationDialog(
            "Delete this memory?",
            isPresented: Binding(
                get: { pendingDelete != nil },
                set: { if !$0 { pendingDelete = nil } }
            ),
            titleVisibility: .visible,
            presenting: pendingDelete
        ) { memory in
            Button("Delete", role: .destructive) {
                Task { await model.delete(memory) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { memory in
            Text("\u{201C}\(memory.content)\u{201D}")
        }
        .confirmationDialog(
            "Clear all memories?",
            isPresented: $isConfirmingClearAll,
            titleVisibility: .visible
        ) {
            Button("Clear all", role: .destructive) {
                Task { await model.clearAll() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("SureWord will forget everything it has learned about you.")
        }
        .memoryErrorAlert(model)
    }

    // MARK: - Summary

    @ViewBuilder
    private var summarySection: some View {
        Section("Summary") {
            switch model.summaryState {
            case .loaded(let summary?, let generatedAt):
                VStack(alignment: .leading, spacing: Spacing.md) {
                    Text(summary.overview)
                        .font(.system(size: 13))
                        .foregroundStyle(theme.text)
                    ForEach(summary.sections) { section in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(section.title)
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(theme.text)
                            Text(section.content)
                                .font(.system(size: 12))
                                .foregroundStyle(theme.textMuted)
                        }
                    }
                    if let generatedAt, !MemoryFormat.relativeTime(generatedAt).isEmpty {
                        hint("Updated \(MemoryFormat.relativeTime(generatedAt))")
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            case .loaded:
                hint("Nothing remembered yet — SureWord learns about you as you chat.")
            default:
                hint("SureWord can write a short summary of everything it remembers about you.")
            }

            HStack(spacing: Spacing.sm) {
                if model.summaryState == .loading {
                    ProgressView().controlSize(.small)
                    Text("Writing your summary…")
                        .font(.system(size: 12))
                        .foregroundStyle(theme.textMuted)
                } else {
                    Button(model.summaryButtonLabel) {
                        Task { await model.generateSummary() }
                    }
                }
                Spacer()
            }
        }
    }

    // MARK: - Add

    @ViewBuilder
    private var addSection: some View {
        Section("Add a memory") {
            HStack(spacing: Spacing.sm) {
                // The prompt, not the title, carries the wording: in a grouped
                // Form a TextField's title becomes a leading label, which here
                // would just repeat the section header and leave the field
                // blank. Android shows it inside the field, so hide the label.
                TextField("Add a memory", text: $model.draft, prompt: Text("Add a memory…"))
                    .labelsHidden()
                    .textFieldStyle(.roundedBorder)
                    .disabled(model.isAdding)
                    .onSubmit { Task { await model.add() } }
                    .onChange(of: model.draft) { _, value in
                        if value.count > MemoryLimits.maxContentLength {
                            model.draft = String(value.prefix(MemoryLimits.maxContentLength))
                        }
                    }
                Button(model.isAdding ? "…" : "Add") {
                    Task { await model.add() }
                }
                .disabled(!model.canAdd)
            }
        }
    }

    // MARK: - Saved memories

    @ViewBuilder
    private var savedSection: some View {
        Section("Saved memories · \(model.memories.count)") {
            if let loadError = model.loadError {
                HStack(spacing: Spacing.md) {
                    Text(loadError)
                        .font(.system(size: 12))
                        .foregroundStyle(theme.danger)
                    Spacer()
                    Button("Retry") { Task { await model.load() } }
                }
            } else if !model.hasLoaded {
                ProgressView().controlSize(.small)
            } else if model.memories.isEmpty {
                hint("Nothing saved yet. Add one above, or just chat — SureWord remembers what matters.")
            } else {
                ForEach(model.groups) { group in
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text(group.label.uppercased())
                            .font(.system(size: 10, weight: .bold))
                            .kerning(0.8)
                            .foregroundStyle(theme.textGhost)
                        ForEach(group.items) { memory in
                            HStack(alignment: .top, spacing: Spacing.sm) {
                                Text(memory.content)
                                    .font(.system(size: 13))
                                    .foregroundStyle(theme.text)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                Button {
                                    pendingDelete = memory
                                } label: {
                                    Image(systemName: "xmark")
                                        .font(.system(size: 10, weight: .bold))
                                        .foregroundStyle(theme.danger)
                                }
                                .buttonStyle(SubtleButtonStyle())
                                .help("Delete this memory")
                                .accessibilityLabel("Delete memory: \(memory.content)")
                            }
                            .padding(.vertical, 2)
                        }
                    }
                }
            }
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
    /// Shared alert plumbing: every memory mutation reports failures the same
    /// way on both the Settings pane and the manage sheet.
    ///
    /// `isActive` exists because both views observe the same model: only the
    /// frontmost one may own the alert, or SwiftUI is asked to present it twice.
    @MainActor
    func memoryErrorAlert(_ model: MemoriesModel, isActive: Bool = true) -> some View {
        alert(
            model.errorAlert?.title ?? "",
            isPresented: Binding(
                get: { isActive && model.errorAlert != nil },
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
