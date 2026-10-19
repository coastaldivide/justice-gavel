/**
 * useNetworkError.ts — global network failure handler
 *
 * Catches Axios errors at the app level and shows appropriate toasts.
 * Plug into the queryClient's onError callbacks or use in screens.
 *
 * Classifies:
 *  - Network offline → "No internet connection"
 *  - 401 Unauthorized → redirect to login
 *  - 403 Forbidden → "You don\'t have access to this feature"
 *  - 404 Not Found → "This content is no longer available"
 *  - 429 Rate Limited → "Too many requests — please wait a moment"
 *  - 500+ Server Error → "Something went wrong on our end"
 *  - Timeout → "Request timed out — check your connection"
 */

import { useCallback } from 'react';
import { useToast } from '../components/ToastProvider';
import { t } from '../i18n';

export function useNetworkError() {
  const { showToast } = useToast();

  const handleError = useCallback((error: any) => {
    if (!error) return;

    // Network / offline
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      showToast(t('x_use_network_error_request_timed_out_check'), 'warning');
      return;
    }
    if (!error.response) {
      showToast(t('no_internet'), 'warning');
      return;
    }

    const status = error.response?.status;

    if (status === 401) {
      showToast(t('x_use_network_error_session_expired_please_sign'), 'error');
      return;
    }
    if (status === 403) {
      showToast(t('x_use_network_error_don_t_have_access'), 'error');
      return;
    }
    if (status === 404) {
      showToast(t('x_use_network_error_this_content_no_longer'), 'info');
      return;
    }
    if (status === 429) {
      showToast(t('x_use_network_error_too_many_requests_please'), 'warning');
      return;
    }
    if (status >= 500) {
      showToast(t('x_use_network_error_something_went_wrong_our'), 'error');
      return;
    }

    // Fallback
    const msg = error.response?.data?.error || error.message || t('x_use_network_error_error_occurred');
    showToast(msg, 'error');
  }, [showToast]);

  return { handleError };
}
