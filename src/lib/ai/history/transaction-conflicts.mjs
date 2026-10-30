/** Only captured, explicitly bounded local-transaction conflicts. Never message matching. */
const bindingFields = ['ownerId', 'sourceDigest', 'contextDigest', 'policyDigest', 'displayDigest', 'reviewDigest', 'envelopeDigest'];
export function isHistorySerializationConflict(error) {
  return error?.code === 'P2034' || error?.code === 'P2010' && error?.meta?.code === '40001';
}
export function isHistoryClaimBindingConflict(error) {
  if (error?.code !== 'P2002' || error?.meta?.modelName !== 'AiAnswerReview') return false;
  const target = error.meta.target;
  if (target === 'AiAnswerReview_owner_binding_key') return true;
  return Array.isArray(target) && target.length === bindingFields.length && bindingFields.every((field, index) => target[index] === field);
}
export function isHistoryPendingOwnerConflict(error) {
  if (error?.code !== 'P2002' || error?.meta?.modelName !== 'AiAnswerReview') return false;
  const target = error.meta.target;
  return target === 'AiAnswerReview_one_pending_owner' || Array.isArray(target) && target.length === 1 && target[0] === 'ownerId';
}
export function isRetryableHistoryTransactionConflict(error) {
  return isHistorySerializationConflict(error) || isHistoryClaimBindingConflict(error) || isHistoryPendingOwnerConflict(error);
}
