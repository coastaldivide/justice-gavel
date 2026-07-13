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

export function useNetworkError() {
  const { showToast } = useToast();

  const handleError = useCallback((error: any) => {
    if (!error) return;

    // Network / offline
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      showToast('Request timed out — check your connection', 'warning');
      return;
    }
    if (!error.response) {
      showToast('No internet connection', 'warning');
      return;
    }

    const status = error.response?.status;

    if (status === 401) {
      showToast('Session expired — please sign in again', 'error');
      return;
    }
    if (status === 403) {
      showToast('You don\'t have access to this feature', 'error');
      return;
    }
    if (status === 404) {
      showToast('This content is no longer available', 'info');
      return;
    }
    if (status === 429) {
      showToast('Too many requests — please wait a moment', 'warning');
      return;
    }
    if (status >= 500) {
      showToast('Something went wrong on our end — try again shortly', 'error');
      return;
    }

    // Fallback
    const msg = error.response?.data?.error || error.message || 'An error occurred';
    showToast(msg, 'error');
  }, [showToast]);

  return { handleError };
}
