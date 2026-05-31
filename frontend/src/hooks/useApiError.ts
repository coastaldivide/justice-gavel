/**
 * useApiError — converts technical API errors into user-friendly messages
 */
export function friendlyError(err: any): string {
  if (!err) return 'Something went wrong. Please try again.';
  const status  = err?.response?.status || err?.status;
  const code    = err?.response?.data?.code || err?.code;
  const message = err?.response?.data?.error || err?.message || '';

  // Network / offline
  if (!status && (message.includes('Network') || message.includes('network')))
    return 'No internet connection. Please check your connection and try again.';

  // Auth
  if (status === 401 || code === 'token_expired')
    return 'Your session has expired. Please log in again.';
  if (status === 403)
    return 'You do not have permission to do that.';

  // Not found
  if (status === 404)
    return 'That item could not be found. It may have been removed.';

  // Rate limit
  if (status === 429)
    return 'Too many requests. Please wait a moment and try again.';

  // Validation
  if (status === 422)
    return 'Please check your input and try again.';

  // Server
  if (status && status >= 500)
    return 'A server error occurred. We have been notified. Please try again in a moment.';

  return message || 'Something went wrong. Please try again.';
}
