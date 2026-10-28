import Foundation

/// Keeps a failed save visible in the editor before a shell or list changes
/// selection. Android uses the same guard for tab departure and Back.
@MainActor
final class NoteDepartureCoordinator {
    private var owner: UUID?
    private var flush: (@MainActor () async -> Bool)?
    private var departureTask: (id: UUID, task: Task<Bool, Never>)?

    var hasEditor: Bool { owner != nil }

    func register(owner: UUID, flush: @escaping @MainActor () async -> Bool) {
        self.owner = owner
        self.flush = flush
    }

    func unregister(owner: UUID) {
        guard self.owner == owner else { return }
        self.owner = nil
        flush = nil
    }

    func canLeave() async -> Bool {
        if let active = departureTask { return await active.task.value }
        guard let flush else { return true }
        let id = UUID()
        let task = Task { await flush() }
        departureTask = (id, task)
        let success = await task.value
        if departureTask?.id == id { departureTask = nil }
        return success
    }
}
