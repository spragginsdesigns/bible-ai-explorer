# Note AI operation recovery

The native editor retains an attempt before sending a note-panel turn. That
attempt is separate from conversation history and remains account-scoped
across app restarts. Legacy ledger entries keep their existing conservative
recovery path; new attempts explicitly select the operation-receipt protocol.

1. Reserve the immutable `NoteAIRequest` at `POST /api/note-ai/operations`.
   The server binds its UUID to the authenticated user, source note and a
   SHA-256 fingerprint of the request. JSON key ordering is insignificant.
2. Send that same request to `POST /api/note-ai`. Execution can claim a
   matching reserved operation exactly once. Missing, cancelled, mismatched
   and duplicate claims cannot start the AI loop.
3. Every note-mutating tool commits through `withNoteAIWrite`. Its short
   database transaction locks the operation row, requires `running`, and
   includes the actual note and link writes. Generated-text checks and
   embedding network calls stay outside this transaction. Embedding commits
   independently recheck the canonical source hash under a note-row lock.
4. Execution settlement and recovery cancellation lock the same operation
   row. They wait for any active note commit. After either returns, a late
   tool from that operation cannot write, including after provider errors or
   a lost gateway response. A worker killed without a finally callback is
   recoverable by cancellation; no timeout is treated as proof of completion.
5. The editor reads `GET /api/note-ai/operations/<id>?noteId=...` after a clean
   stream terminal. On reserve/transport failure or explicit Check, it uses
   `POST /api/note-ai/operations/<id>/cancel` with `{noteId}`. Cancellation
   creates a tombstone even if reservation has not arrived, fencing delayed
   reserve/execute requests. Only `settled` or `cancelled`, followed by a fresh
   canonical note GET, permits another manual PATCH. HTTP status, SSE DONE
   and persisted assistant prose alone are insufficient.

Cancellation fences note mutations from this turn; it does not undo an
already committed edit or reverse unrelated assistant actions. The source
note and user foreign keys cascade deletion and account rekeying. Clearing
note-AI messages cancels those operations in the same transaction as message
deletion, retaining their receipts. Initial user and late assistant persistence
also take the operation lock, so they cannot recreate history after Clear.
Receipts store request
hashes and execution state, without prompt or note content.

Existing web, Android and older Apple clients omit `operationId` and retain
their existing route contract. The additive server protocol must be deployed
before an Apple client that requires it is distributed. Apple runtime proof
and release state are tracked separately in `PARITY.md`.

Verification includes real local Postgres locking and the installed AI SDK
route lifecycle in `tests/note-ai-operations.integration.test.mjs`, adapter
transaction boundaries in `tests/note-ai-write-fence.test.mjs`, and native
held-response/restart/manual-save regressions in `NoteAIIntegrityTests.swift`.
