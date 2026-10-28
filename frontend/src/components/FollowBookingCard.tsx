/**
 * FollowBookingCard — "Follow this booking" on an arrest record (A9, docs/CUSTODY_ALERTS.md).
 * Shown only when the server's ⚖ setting CUSTODY_ALERTS_ENABLED is on (GET /api/custody/status)
 * and the person is signed in. Following needs an explicit "send me alerts" consent; texts need a
 * second consent and go only to the account's VERIFIED phone (no number is typed here; without
 * one the card offers "Verify my number"). Texts are held between 9 PM and 8 AM local time. We
 * repeat only what the jail roster shows ("no longer listed — call the jail to confirm"), never
 * "released" on our own.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api, apiErrorMessage } from '../services/api';
import { useToast } from './ToastProvider';
import { t, useLang } from '../i18n';
import { Btn, Card, Check, Line } from './bondDesk/ui';

interface Status { enabled: boolean; max_follows: number; texts_live: boolean; verified_phone_last4?: string | null }

export function FollowBookingCard({ arrestId }: { arrestId: number | null | undefined }) {
  useLang();
  const navigation = useNavigation<any>();
  const { showToast } = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [state, setState] = useState<{ follow_id: number | null; trackable: boolean } | null>(null);
  const [consent, setConsent] = useState(false);
  const [texts, setTexts] = useState(false);
  const [textConsent, setTextConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    if (!arrestId) return;
    (async () => {
      try {
        const s = await api.get<Status>('/custody/status');
        if (!mounted.current || !s.data?.enabled) return;
        setStatus(s.data);
        const a = await api.get<{ follow_id: number | null; trackable: boolean }>(`/custody/arrest/${arrestId}`);
        if (mounted.current) setState(a.data);
      } catch { /* signed out, offline or off: the card stays hidden */ }
    })();
  }, [arrestId]);

  if (!arrestId || !status?.enabled || !state) return null;

  const follow = async () => {
    if (busy) return;
    if (!consent) { setError(t('cus_consent_needed')); return; }
    if (texts && !status?.verified_phone_last4) { setError(t('cus_verify_first')); return; }
    if (texts && !textConsent) { setError(t('cus_text_needed')); return; }
    setBusy(true); setError('');
    try {
      const r = await api.post<{ follow_id: number }>('/custody/follows', {
        arrest_id: arrestId, consent: true, ...(texts ? { text_opt_in: true, text_consent: true } : {}),
      });
      if (!mounted.current) return;
      setState({ follow_id: r.data.follow_id, trackable: true });
      showToast(t('cus_following_now'), 'success');
    } catch (e) { if (mounted.current) setError(apiErrorMessage(e, t('cus_follow_failed'))); }
    finally { if (mounted.current) setBusy(false); }
  };

  return (
    <Card title={t('cus_follow_title')} testID="follow-booking-card">
      {!state.trackable ? <Line muted testID="follow-not-trackable">{t('cus_not_trackable')}</Line>
        : state.follow_id ? (
          <>
            <Line tone="ok" testID="follow-following">{t('cus_following')}</Line>
            <Btn kind="ghost" label={t('cus_open_alerts')} onPress={() => navigation.navigate('CustodyAlerts')} testID="follow-open" />
          </>
        ) : (
          <View>
            <Line muted>{t('cus_follow_intro')}</Line>
            <Check label={t('cus_consent')} value={consent} onChange={setConsent} testID="follow-consent" />
            {status.texts_live && <Check label={t('cus_texts_too')} value={texts} onChange={setTexts} testID="follow-texts" />}
            {texts && (status.verified_phone_last4 ? (
              <>
                <Line testID="follow-verified-phone">{t('cus_texts_verified', { last4: status.verified_phone_last4 })}</Line>
                <Check label={t('cus_text_consent')} value={textConsent} onChange={setTextConsent} testID="follow-text-consent" />
                <Line muted>{t('cus_text_night')}</Line>
              </>
            ) : (
              <>
                <Line testID="follow-verify-first">{t('cus_verify_first')}</Line>
                <Btn kind="ghost" label={t('cus_verify_btn')} onPress={() => navigation.navigate('VerifyPhone')} testID="follow-verify-phone" />
              </>
            ))}
            {!!error && <Line tone="danger" testID="follow-error">{error}</Line>}
            <Btn label={t('cus_follow')} onPress={follow} busy={busy} disabled={!consent} testID="follow-booking" />
          </View>
        )}
    </Card>
  );
}
