
import { t } from '../i18n';/**
 * useApiError — converts technical API errors into user-friendly messages
 */
export function friendlyError(err: any): string {
  if (!err) return t('x_error_state_something_went_wrong_please');
  const status  = err?.response?.status || err?.status;
  const code    = err?.response?.data?.code || err?.code;
  const message = err?.response?.data?.error || err?.message || '';

  // Network / offline
  if (!status && (message.includes('Network') || message.includes('network')))
    return t('x_use_api_error_no_internet_connection_please');

  // Auth
  if (status === 401 || code === 'token_expired')
    return t('x_use_api_error_session_has_expired_please');
  if (status === 403)
    return t('x_use_api_error_do_not_have_permission');

  // Not found
  if (status === 404)
    return t('x_use_api_error_that_item_could_not');

  // Rate limit
  if (status === 429)
    return t('x_use_api_error_too_many_requests_please');

  // Validation
  if (status === 422)
    return t('x_use_api_error_please_check_input_try');

  // Server
  if (status && status >= 500)
    return t('x_use_api_error_server_error_occurred_we');

  return message || t('x_error_state_something_went_wrong_please');
}
