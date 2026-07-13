/**
 * useConfirm.ts — replaces Alert.alert with multi-button dialogs
 *
 * Resolves: 40 screens with Alert.alert('title', 'msg', [{Cancel},{OK}]) patterns.
 * Returns a promise that resolves to true (confirmed) or false (cancelled).
 *
 * Usage — replaces:
 *   Alert.alert('Delete?', 'This cannot be undone.', [
 *     { text: 'Cancel', style: 'cancel' },
 *     { text: 'Delete', style: 'destructive', onPress: () => deleteItem() },
 *   ]);
 *
 * With:
 *   const confirmed = await confirm('Delete?', 'This cannot be undone.');
 *   if (confirmed) deleteItem();
 *
 *   // Or with custom labels:
 *   const confirmed = await confirm('Delete case?', undefined, {
 *     confirmLabel: 'Delete',
 *     destructive: true,
 *   });
 */

import { useCallback } from 'react';
import { Alert, Platform } from 'react-native';

interface ConfirmOptions {
  confirmLabel?: string;
  cancelLabel?:  string;
  destructive?:  boolean;
}

export function useConfirm() {
  const confirm = useCallback(
    (title: string, message?: string, opts: ConfirmOptions = {}): Promise<boolean> => {
      const { confirmLabel = 'OK', cancelLabel = 'Cancel', destructive = false } = opts;
      return new Promise((resolve) => {
        Alert.alert(
          title,
          message,
          [
            {
              text:    cancelLabel,
              style:   'cancel',
              onPress: () => resolve(false),
            },
            {
              text:    confirmLabel,
              style:   destructive ? 'destructive' : 'default',
              onPress: () => resolve(true),
            },
          ],
          { cancelable: true, onDismiss: () => resolve(false) }
        );
      });
    },
    []
  );

  return { confirm };
}

/**
 * Quick migration guide for the 40 remaining screens:
 *
 * BEFORE (ChatScreen, SettingsScreen, etc.):
 *   Alert.alert(
 *     'Clear chat history',
 *     'This cannot be undone.',
 *     [{ text: 'Cancel' }, { text: 'Clear', onPress: clearHistory }]
 *   );
 *
 * AFTER:
 *   const { confirm } = useConfirm();
 *   const ok = await confirm('Clear chat history?', 'This cannot be undone.', {
 *     confirmLabel: 'Clear',
 *     destructive: true,
 *   });
 *   if (ok) clearHistory();
 *
 * This preserves native dialog behavior (iOS action sheet style, Android alert)
 * while giving a clean async API that's easier to test.
 */
