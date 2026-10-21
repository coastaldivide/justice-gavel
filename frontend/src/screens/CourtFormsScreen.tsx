import { useToast } from '../components/ToastProvider';
import { AppIcon, IconLabel, ICONS } from '../components/AppIcon';
/**
 * CourtFormsScreen.tsx
 *
 * Official court form finder and AI-assisted form completion guide.
 *
 * What this screen does:
 *  1. User selects their state
 *  2. User selects form category (criminal defense, expungement, bail, etc.)
 *  3. App shows the official government form URL from courtFormsRegistry.ts
 *  4. AI assists in explaining what each field means and what to enter
 *     (information only -- never recommends what to write for legal strategy)
 *  5. User opens the official PDF directly (in-app WebView or external browser)
 *  6. User completes, prints, and files their own form
 *
 * LEGAL GUARDRAILS:
 *  - Every form link goes to a .gov or official court URL
 *  - AI explains what fields mean; never recommends what user should write
 *  - Disclaimer shown before AI assistance loads
 *  - "NOT LEGAL ADVICE" watermark on every AI explanation
 *  - Clear self-help framing throughout
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Linking, StyleSheet, TextInput, Platform, ActivityIndicator, KeyboardAvoidingView } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useTheme, FONT, type ThemeColors, themeColors } from '../constants/theme';
import {
  STATE_COURT_FORMS,
  FEDERAL_SOURCES,
  type CourtFormSource} from '../data/courtFormsRegistry';
import LegalDisclaimerModal, { hasValidConsent } from '../components/LegalDisclaimerModal';
import { api, apiErrorMessage } from '../services/api';
import { pollJob } from '../services/jobPoller';
import { t, perLang, useLang } from '../i18n';

// ── Form categories ───────────────────────────────────────────────────────────
const FORM_CATEGORIES = perLang(() => [
  {
    key: 'criminal_defense',
    label: t('x_court_forms_criminal_defense'),
    icon: ICONS.lawyer,
    description: t('x_court_forms_motions_responses_pro_se')},
  {
    key: 'expungement',
    label: t('x_court_forms_expungement_record_sealing'),
    icon: ICONS.cases,
    description: t('x_court_forms_clear_seal_criminal_records')},
  {
    key: 'bail_bond',
    label: t('x_court_forms_bail_bond'),
    icon: ICONS.bail,
    description: t('x_court_forms_bail_reduction_bond_review')},
  {
    key: 'protective_order',
    label: t('x_court_forms_protective_orders'),
    icon: ICONS.shield,
    description: t('x_court_forms_restraining_orders_protective_orders')},
  {
    key: 'civil_rights',
    label: t('x_practice_area_selector_civil_rights'),
    icon: ICONS.rights,
    description: t('x_court_forms_1983_claims_rights_violations')},
  {
    key: 'small_claims',
    label: t('x_court_forms_small_claims'),
    icon: ICONS.clipboard,
    description: t('x_court_forms_claims_under_state_s')},
]);

type Phase = 'state_select' | 'category_select' | 'form_display' | 'ai_guide';

function CourtFormsScreen(): React.JSX.Element | null {
  useLang();
  const { showToast } = useToast();
  const { colors } = useTheme();
  const s = styles(colors, FONT);

  const [phase, setPhase] = useState<Phase>('state_select');
  const [selectedState, setSelectedState] = useState<CourtFormSource | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [aiGuide, setAiGuide] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // ── State search / filter ─────────────────────────────────────────────────
  const filteredStates = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return [
      { state: 'FED', stateName: t('x_court_forms_federal_courts_all_districts'), aocName: FEDERAL_SOURCES().aocName, formsPortalUrl: FEDERAL_SOURCES().formsPortalUrl, fillablePdf: true, eFiling: true },
      ...STATE_COURT_FORMS(),
    ];
    return [
      { state: 'FED', stateName: t('x_court_forms_federal_courts_all_districts'), aocName: FEDERAL_SOURCES().aocName, formsPortalUrl: FEDERAL_SOURCES().formsPortalUrl, fillablePdf: true, eFiling: true },
      ...STATE_COURT_FORMS(),
    ].filter(s =>
      (s.stateName || "").toLowerCase().includes(q) ||
      (s.state || "").toLowerCase().includes(q) ||
      (s.aocName || "").toLowerCase().includes(q)
    );
  }, [searchQuery]);

  // ── State selection ────────────────────────────────────────────────────────
  const onSelectState = useCallback((state: CourtFormSource) => {
    setSelectedState(state);
    setPhase('category_select');
  }, []);

  // ── Category selection ─────────────────────────────────────────────────────
  const onSelectCategory = useCallback(async (categoryKey: string) => {
    setSelectedCategory(categoryKey);
    const alreadyConsented = await hasValidConsent();
    if (!alreadyConsented) {
      setShowDisclaimer(true);
    } else {
      setPhase('form_display');
    }
  }, []);

  const onConsentAccepted = useCallback(() => {
    setShowDisclaimer(false);
    setPhase('form_display');
  }, []);

  // ── Open official form URL ─────────────────────────────────────────────────
  const openFormUrl = useCallback((url: string) => {
    Linking.openURL(url).catch(() => {
      showToast(t('x_court_forms_please_visit_url_directly'), 'warning');
    });
  }, [showToast]);

  // ── Get best URL for selected state + category ────────────────────────────
  const getBestUrl = useCallback((state: CourtFormSource, category: string): string => {
    if (category === 'expungement') return state.expungementFormsUrl ?? state.formsPortalUrl;
    if (category === 'bail_bond') return state.bailFormsUrl ?? state.criminalFormsUrl ?? state.formsPortalUrl;
    if (category === 'criminal_defense') return state.criminalFormsUrl ?? state.formsPortalUrl;
    return state.selfHelpUrl ?? state.formsPortalUrl;
  }, []);

  // ── AI field guide (information only) ─────────────────────────────────────
  const loadAiGuide = useCallback(async () => {
    if (!selectedState || !selectedCategory) return;
    setAiLoading(true);
    setPhase('ai_guide');
    try {
      const categoryLabel = FORM_CATEGORIES().find(c => c.key === selectedCategory)?.label ?? selectedCategory;
      const res = await api.post('/chat/ask', {
        message: t('x_court_forms_explain_what_information_someone', { categoryLabel, stateName: selectedState.stateName }),
        systemContext: 'court_forms_explainer',
        disclaimer: 'information_only'});
      // /chat/ask queues the answer as a job: wait for it
      let reply: unknown = res.data?.reply;
      if (!reply && res.data?.jobId) {
        const job = await pollJob(String(res.data.jobId), { timeoutMs: 90_000 });
        const r = job.result as { reply?: string } | undefined;
        if (job.status === 'failed' || !r?.reply) throw new Error(job.error || 'no reply');
        reply = r.reply;
      }
      if (mountedRef.current) setAiGuide(typeof reply === 'string' && reply ? reply : t('x_court_forms_unable_load_field_guide'));
    } catch (e: any) {
      if (mountedRef.current) {
        setAiGuide(e?.response?.status === 401 ? t('x_court_forms_sign_in_ai')
          : apiErrorMessage(e, t('x_court_forms_unable_load_field_guide')));
      }
    } finally {
      if (mountedRef.current) setAiLoading(false);
    }
  }, [selectedState, selectedCategory]);

  // ── Render helpers ─────────────────────────────────────────────────────────
  const renderStateItem = useCallback(({ item }: { item: CourtFormSource }) => (
    <TouchableOpacity
  accessibilityRole="button"
      style={s.stateRow}
      accessibilityLabel={item.stateName} onPress={() => onSelectState(item)}
    >
      <View style={s.stateInfo}>
        <Text maxFontSizeMultiplier={1.4} style={s.stateName}>{item.stateName}</Text>
        <Text maxFontSizeMultiplier={1.4} style={s.stateAoc}>{item.aocName}</Text>
      </View>
      <View style={s.stateBadges}>
        {item.fillablePdf && (
          <View style={[s.badge, { backgroundColor: colors.legalBg }]}>
            <Text maxFontSizeMultiplier={1.4} style={[s.badgeText, { color: colors.legal }]}>{t('x_court_forms_fillable_pdf')}</Text>
          </View>
        )}
        {item.eFiling && (
          <View style={[s.badge, { backgroundColor: colors.bgSubtle }]}>
            <Text maxFontSizeMultiplier={1.4} style={[s.badgeText, { color: colors.textBrand }]}>{t('x_court_forms_e_file')}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  ), [s, onSelectState, colors]);

  // ── Phase: State selection ─────────────────────────────────────────────────
  if (phase === 'state_select') {
  return (
      <View style={s.root}
        testID="court-forms-screen">
        <View style={s.header}>
          <Text maxFontSizeMultiplier={1.4} style={s.headerTitle}>{t('x_court_forms_official_court_forms')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.headerSub}>
            {t('x_court_forms_select_state_find_official')}
          </Text>
        </View>
        <View style={s.searchBox}>
          <TextInput
            style={s.searchInput}
            placeholder={t('x_court_forms_search_states')}
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            clearButtonMode="while-editing"
            accessibilityLabel={t('x_court_forms_search_states_2')}
          accessibilityHint={t('cp_double_tap')}
          blurOnSubmit
        />
        </View>
        <FlashList
          data={filteredStates}
          ListEmptyComponent={
            <View style={{ padding:40, alignItems:'center' }}>
              <IconLabel icon={ICONS.document} textStyle={{ fontSize:15, color:colors.textMuted, textAlign:'center' }} maxFontSizeMultiplier={1.4}>{t('x_court_forms_no_states_match_search')}</IconLabel>
            </View>
          }
          keyExtractor={item => item.state}
          renderItem={renderStateItem}
          ItemSeparatorComponent={() => <View style={s.separator} />}
          ListHeaderComponent={
            <View>
              <Text maxFontSizeMultiplier={1.4} style={s.disclaimerText}>
                {t('x_court_forms_all_forms_link_official')}
              </Text>
            </View>
          }
        />
        <LegalDisclaimerModal
          visible={showDisclaimer}
          onAccept={onConsentAccepted}
        />
      </View>
    );
  }

  // ── Phase: Category selection ──────────────────────────────────────────────
  if (phase === 'category_select' && selectedState) {
    return (
      <View style={s.root}>
        <View style={s.subHeader}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('x_court_forms_back_states')}
            onPress={() => { setSelectedState(null); setPhase('state_select'); }}>
            <Text maxFontSizeMultiplier={1.4} style={s.backBtnText}>{t('x_court_forms_states')}</Text>
          </TouchableOpacity>
          <Text maxFontSizeMultiplier={1.4} style={s.subHeaderTitle}>{selectedState.stateName}</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.subHeaderSub}>{selectedState.aocName}</Text>
        </View>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps='handled' contentContainerStyle={s.categoryList}>
          
          {FORM_CATEGORIES().length === 0 && (
            <View style={{ alignItems: 'center', paddingVertical: 32 }}>
              <Text style={{ color: colors.textMuted, fontSize: 14 }}>{t('x_court_forms_no_results_yet')}</Text>
            </View>
          )}
{FORM_CATEGORIES().map(cat => (
            <TouchableOpacity accessibilityRole="button"
              key={cat.key}
              style={s.categoryCard}
              accessibilityLabel={cat.label} onPress={() => onSelectCategory(cat.key)}
            >
              <AppIcon name={cat.icon} size={22} color={colors.textBrand} style={s.categoryIcon} />
              <View style={s.categoryInfo}>
                <Text maxFontSizeMultiplier={1.4} style={s.categoryLabel}>{cat.label}</Text>
                <Text maxFontSizeMultiplier={1.4} style={s.categoryDesc} numberOfLines={2} ellipsizeMode="tail">{cat.description}</Text>
              </View>
              <Text maxFontSizeMultiplier={1.4} style={s.chevron}>›</Text>
            </TouchableOpacity>
          ))}

          {/* Juvenile records -- always separate from adult records */}
          <View style={{
            backgroundColor: colors.warnBg, borderRadius: 12, padding: 16,
            borderWidth: 1, borderColor: colors.gold}}>
            <IconLabel icon={ICONS.statusWarn} iconColor={colors.warn} textStyle={{ fontSize: 12, fontWeight: '700', color: colors.warnDark, marginBottom: 4 }} maxFontSizeMultiplier={1.4}>{t('x_court_forms_juvenile_records_different_process')}</IconLabel>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, color: colors.warnDark, lineHeight: 19 }}>
              {t('x_court_forms_juvenile_records_use_separate')}{' '}
              <Text maxFontSizeMultiplier={1.4}
                style={{ color: colors.textBrand, textDecorationLine: 'underline' }}
                onPress={() => Linking.openURL('https://www.juvenilelaw.org/find-help').catch(() => showToast(t('action_failed'), 'error'))}
              >
                juvenilelaw.org/find-help
              </Text>
              .
            </Text>
          </View>

<TouchableOpacity
  accessibilityRole="button"
            style={[s.categoryCard, s.selfHelpCard]}
            onPress={() => openFormUrl(selectedState.selfHelpUrl ?? selectedState.formsPortalUrl)}
            accessibilityLabel={t('x_court_forms_all_forms_open_official')}
          >
            <AppIcon name={ICONS.globe} size={20} color={colors.textBrand} style={s.categoryIcon} />
            <View style={s.categoryInfo}>
              <Text maxFontSizeMultiplier={1.4} style={s.categoryLabel}>{t('x_court_forms_all_forms_official_portal')}</Text>
              <Text maxFontSizeMultiplier={1.4} style={s.categoryDesc}>{selectedState.aocName}</Text>
            </View>
            <AppIcon name={ICONS.external} size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </ScrollView>
        <LegalDisclaimerModal
          visible={showDisclaimer}
          onAccept={onConsentAccepted}
        />
      </KeyboardAvoidingView>
      </View>
    );
  }

  // ── Phase: Form display + links ────────────────────────────────────────────
  if (phase === 'form_display' && selectedState && selectedCategory) {
    const categoryInfo = FORM_CATEGORIES().find(c => c.key === selectedCategory);
    const primaryUrl = getBestUrl(selectedState, selectedCategory);
    const selfHelpUrl = selectedState.selfHelpUrl ?? selectedState.formsPortalUrl;

    return (
      <View style={s.root}>
        <View style={s.subHeader}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('x_court_forms_back', { stateName: selectedState.stateName })}
            onPress={() => { setSelectedCategory(null); setPhase('category_select'); }}>
            <Text maxFontSizeMultiplier={1.4} style={s.backBtnText}>← {selectedState.stateName}</Text>
          </TouchableOpacity>
          <Text maxFontSizeMultiplier={1.4} style={s.subHeaderTitle}>{categoryInfo?.label}</Text>
        </View>

        <ScrollView keyboardShouldPersistTaps='handled' contentContainerStyle={s.formContent}>

          {/* Information notice */}
          <View style={s.infoNotice}>
            <IconLabel icon={ICONS.alertNormal} textStyle={s.infoNoticeTitle} maxFontSizeMultiplier={1.4}>{t('x_court_forms_legal_information_only')}</IconLabel>
            <Text maxFontSizeMultiplier={1.4} style={s.infoNoticeText}>
              {t('x_court_forms_links_below_open_official')}
            </Text>
          </View>

          {/* Official form link */}
          <Text maxFontSizeMultiplier={1.4} style={s.sectionLabel}>{t('x_court_forms_official_government_forms')}</Text>
          <TouchableOpacity
            accessibilityRole="link"
            style={s.formLink}
            onPress={() => openFormUrl(primaryUrl)}
            accessibilityLabel={t('x_court_forms_open_forms', { stateName: selectedState.stateName, label: categoryInfo?.label })}
          >
            <View style={s.formLinkLeft}>
              <Text maxFontSizeMultiplier={1.4} style={s.formLinkTitle}>
                {t('x_court_forms_forms', { stateName: selectedState.stateName, label: categoryInfo?.label })}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={s.formLinkUrl} numberOfLines={1}>{primaryUrl}</Text>
              <Text maxFontSizeMultiplier={1.4} style={s.formLinkSource}>{selectedState.aocName}</Text>
            </View>
            <View style={s.govBadge}>
              <Text maxFontSizeMultiplier={1.4} style={s.govBadgeText}>.gov</Text>
            </View>
          </TouchableOpacity>

          {/* Self-help portal */}
          {selfHelpUrl !== primaryUrl && (
            <TouchableOpacity
              accessibilityRole="link"
              style={[s.formLink, s.formLinkSecondary]}
              onPress={() => openFormUrl(selfHelpUrl)}
              accessibilityLabel={t('x_court_forms_open_self_help_portal')}
            >
              <View style={s.formLinkLeft}>
                <Text maxFontSizeMultiplier={1.4} style={s.formLinkTitle}>{t('x_court_forms_self_help_center')}</Text>
                <Text maxFontSizeMultiplier={1.4} style={s.formLinkUrl} numberOfLines={1}>{selfHelpUrl}</Text>
                <Text maxFontSizeMultiplier={1.4} style={s.formLinkSource}>{t('x_court_forms_plain_language_guides_instructions')}</Text>
              </View>
              <View style={[s.govBadge, { backgroundColor: colors.bgSubtle }]}>
                <Text maxFontSizeMultiplier={1.4} style={[s.govBadgeText, { color: colors.textBrand }]}>{t('x_court_forms_self_help')}</Text>
              </View>
            </TouchableOpacity>
          )}

          {/* Federal forms link */}
          <TouchableOpacity
            accessibilityRole="link"
            style={[s.formLink, s.formLinkSecondary]}
            onPress={() => openFormUrl(FEDERAL_SOURCES().formsPortalUrl)}
            accessibilityLabel={t('x_court_forms_open_federal_court_forms')}
          >
            <View style={s.formLinkLeft}>
              <Text maxFontSizeMultiplier={1.4} style={s.formLinkTitle}>{t('x_court_forms_federal_court_forms')}</Text>
              <Text maxFontSizeMultiplier={1.4} style={s.formLinkUrl}>uscourts.gov</Text>
              <Text maxFontSizeMultiplier={1.4} style={s.formLinkSource}>{t('x_court_forms_registry_administrative_office_u_s')}</Text>
            </View>
            <View style={[s.govBadge, { backgroundColor: colors.bgSubtle }]}>
              <Text maxFontSizeMultiplier={1.4} style={[s.govBadgeText, { color: colors.textBrand }]}>{t('x_practice_area_selector_federal')}</Text>
            </View>
          </TouchableOpacity>

          {/* National legal aid link */}
          <TouchableOpacity
            accessibilityRole="link"
            style={[s.formLink, s.formLinkSecondary]}
            onPress={() => openFormUrl('https://www.lawhelp.org/')}
            accessibilityLabel={t('x_court_forms_open_lawhelp_org_free')}
          >
            <View style={s.formLinkLeft}>
              <Text maxFontSizeMultiplier={1.4} style={s.formLinkTitle}>{t('x_court_forms_lawhelp_org_free_legal')}</Text>
              <Text maxFontSizeMultiplier={1.4} style={s.formLinkUrl}>lawhelp.org</Text>
              <Text maxFontSizeMultiplier={1.4} style={s.formLinkSource}>
                {t('x_court_forms_non_profit_legal_aid')}
              </Text>
            </View>
          </TouchableOpacity>

          {/* AI field guide CTA */}
          <Text maxFontSizeMultiplier={1.4} style={s.sectionLabel}>{t('x_court_forms_understand_form')}</Text>
          <TouchableOpacity accessibilityRole="button"
            style={s.aiGuideBtn}
            onPress={loadAiGuide}
            accessibilityLabel={t('x_court_forms_get_ai_field_guide')}
          >
            <AppIcon name="hardware-chip-outline" size={20} color={themeColors().textBrand} />
            <View style={s.aiGuideBtnInfo}>
              <Text maxFontSizeMultiplier={1.4} style={s.aiGuideBtnTitle}>
                {t('x_court_forms_ai_field_guide_what')}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={s.aiGuideBtnSub}>
                {t('x_court_forms_plain_language_explanations_form')}
              </Text>
            </View>
          </TouchableOpacity>

          {/* Filing reminder */}
          <View style={s.filingReminder}>
            <Text maxFontSizeMultiplier={1.4} style={s.filingReminderTitle}>{t('x_court_forms_before_file')}</Text>
            <Text maxFontSizeMultiplier={1.4} style={s.filingReminderText}>
              {t('x_court_forms_read_all_instructions_official')}{' '}
              <Text maxFontSizeMultiplier={1.4}
                style={s.link}
                onPress={() => openFormUrl('https://www.lawhelp.org/')}
              >
                {t('x_court_forms_free_legal_aid_attorney')}
              </Text>
              {' '}{t('x_court_forms_before_filing')}
            </Text>
          </View>

        </ScrollView>
      </View>
    );
  }

  // ── Phase: AI field guide ─────────────────────────────────────────────────
  if (phase === 'ai_guide') {
    const categoryInfo = FORM_CATEGORIES().find(c => c.key === selectedCategory);
    return (
      <View style={s.root}>
        <View style={s.subHeader}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('x_court_forms_back_forms')}
            onPress={() => setPhase('form_display')}>
            <Text maxFontSizeMultiplier={1.4} style={s.backBtnText}>{t('x_court_forms_forms_2')}</Text>
          </TouchableOpacity>
          <Text maxFontSizeMultiplier={1.4} style={s.subHeaderTitle}>{t('x_court_forms_field_guide')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.subHeaderSub}>
            {selectedState?.stateName} · {categoryInfo?.label}
          </Text>
        </View>

        <ScrollView keyboardShouldPersistTaps='handled' contentContainerStyle={s.formContent}>

          {/* Disclaimer banner -- always shown in AI phase */}
          <View style={s.aiDisclaimerBanner}>
            <IconLabel icon={ICONS.statusWarn} iconColor={colors.warn} textStyle={s.aiDisclaimerTitle} maxFontSizeMultiplier={1.4}>{t('x_court_forms_not_legal_advice')}</IconLabel>
            <Text maxFontSizeMultiplier={1.4} style={s.aiDisclaimerText}>
              {t('x_court_forms_this_ai_explanation_describes')}
            </Text>
          </View>

          {aiLoading ? (
            <View style={s.loadingBox}>
              <ActivityIndicator size="large" color={themeColors().textBrand} />
              <Text maxFontSizeMultiplier={1.4} style={s.loadingText}>{t('x_court_forms_loading_field_guide')}</Text>
            </View>
          ) : aiGuide ? (
            <View style={s.aiGuideContent}>
              <Text maxFontSizeMultiplier={1.4} style={s.aiGuideText}>{aiGuide}</Text>
            </View>
          ) : null}

          {/* Always re-link to official source */}
          <TouchableOpacity
  accessibilityRole="button"
            style={[s.formLink, { marginTop: 20 }]}
            onPress={() => openFormUrl(
              selectedState ? getBestUrl(selectedState, selectedCategory ?? '') : 'https://www.uscourts.gov/forms-rules/forms'
            )}
          >
            <View style={s.formLinkLeft}>
              <Text maxFontSizeMultiplier={1.4} style={s.formLinkTitle}>{t('x_court_forms_open_official_form')}</Text>
              <Text maxFontSizeMultiplier={1.4} style={s.formLinkSub}>
                {t('x_court_forms_always_use_official_government')}
              </Text>
            </View>
            <View style={s.govBadge}>
              <Text maxFontSizeMultiplier={1.4} style={s.govBadgeText}>.gov</Text>
            </View>
          </TouchableOpacity>

        </ScrollView>
      </View>
    );
  }

  return null;
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = (C: ThemeColors, F: typeof FONT) => StyleSheet.create({
  root:            { flex: 1, backgroundColor: C.bg },
  header:          { backgroundColor: C.navy, paddingTop: Platform.OS === 'ios' ? 56 : 32, paddingBottom: 16, paddingHorizontal: 20 },
  headerTitle:     { fontSize: 22, fontFamily: F.bold, color: C.bgCard, marginBottom: 4 },
  headerSub:       { fontSize: 12, fontFamily: F.regular, color: C.border },
  subHeader:       { backgroundColor: C.bgCard, paddingTop: Platform.OS === 'ios' ? 56 : 32, paddingBottom: 12, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn:         { marginBottom: 4 },
  backBtnText:     { fontSize: 14,
    lineHeight: 21, fontFamily: F.medium, color: C.info },
  subHeaderTitle:  { fontSize: 18, fontFamily: F.bold, color: C.textPrimary },
  subHeaderSub:    { fontSize: 12, fontFamily: F.regular, color: C.textMuted, marginTop: 2 },
  searchBox:       { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: C.bgCard, borderBottomWidth: 1, borderBottomColor: C.border },
  searchInput:     { backgroundColor: C.bgSubtle, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15,
    lineHeight: 22, fontFamily: F.regular, color: C.textPrimary },
  disclaimer:      { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: C.bgSubtle },
  disclaimerText:  { fontSize: 12, fontFamily: F.regular, color: C.textMuted, textAlign: 'center', lineHeight: 18 },
  stateRow:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 16, backgroundColor: C.bgCard, minHeight: 72 },
  stateInfo:       { flex: 1 },
  stateName:       { fontSize: 15,
    lineHeight: 22, fontFamily: F.semiBold, color: C.textPrimary },
  stateAoc:        { fontSize: 12, fontFamily: F.regular, color: C.textMuted, marginTop: 2 },
  stateBadges:     { flexDirection: 'row', gap: 4, marginLeft: 8, flexShrink: 0 },
  badge:           { borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText:       { fontSize: 11, fontFamily: F.medium },
  separator:       { height: StyleSheet.hairlineWidth, backgroundColor: C.border },
  categoryList:    { padding: 16, gap: 10 },
  categoryCard:    { flexDirection: 'row', alignItems: 'center', backgroundColor: C.bgCard, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: C.border, gap: 12 },
  selfHelpCard:    { borderColor: C.blue, borderStyle: 'dashed' },
  categoryIcon:    { fontSize: 22 },
  categoryInfo:    { flex: 1 },
  categoryLabel:   { fontSize: 15,
    lineHeight: 22, fontFamily: F.semiBold, color: C.textPrimary },
  categoryDesc:    { fontSize: 12, fontFamily: F.regular, color: C.textMuted, marginTop: 2 },
  chevron:         { fontSize: 20, color: C.textMuted },
  formContent:     { padding: 16, gap: 0 },
  infoNotice:      { backgroundColor: C.bgSubtle, borderRadius: 8, padding: 16, borderLeftWidth: 3, borderLeftColor: C.blue, marginBottom: 20 },
  infoNoticeTitle: { fontSize: 14,
    lineHeight: 21, fontFamily: F.bold, color: C.info, marginBottom: 4 },
  infoNoticeText:  { fontSize: 12, fontFamily: F.regular, color: C.textSecond, lineHeight: 19 },
  sectionLabel:    { fontSize: 11, fontFamily: F.medium, color: C.textMuted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8, marginTop: 16 },
  formLink:        { flexDirection: 'row', alignItems: 'center', backgroundColor: C.bgCard, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: C.border, marginBottom: 10, gap: 12 },
  formLinkSecondary: { borderColor: C.bgSubtle, backgroundColor: C.bgSubtle },
  formLinkLeft:    { flex: 1 },
  formLinkTitle:   { fontSize: 14,
    lineHeight: 21, fontFamily: F.semiBold, color: C.textPrimary, marginBottom: 2 },
  formLinkUrl:     { fontSize: 11, fontFamily: F.regular, color: C.info, marginBottom: 2 },
  formLinkSource:  { fontSize: 11, fontFamily: F.regular, color: C.textMuted },
  formLinkSub:     { fontSize: 12, fontFamily: F.regular, color: C.textMuted, marginTop: 2 },
  govBadge:        { backgroundColor: C.legalBg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  govBadgeText:    { fontSize: 11, fontFamily: F.bold, color: C.legal },
  aiGuideBtn:      { flexDirection: 'row', alignItems: 'center', backgroundColor: C.navy, borderRadius: 12, padding: 16, gap: 12, marginBottom: 10 },
  aiGuideBtnIcon:  { fontSize: 22 },
  aiGuideBtnInfo:  { flex: 1 },
  aiGuideBtnTitle: { fontSize: 14,
    lineHeight: 21, fontFamily: F.semiBold, color: C.bgCard },
  aiGuideBtnSub:   { fontSize: 12, fontFamily: F.regular, color: C.border, marginTop: 2 },
  filingReminder:  { backgroundColor: C.bgCard, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: C.border, marginTop: 10 },
  filingReminderTitle: { fontSize: 14,
    lineHeight: 21, fontFamily: F.bold, color: C.textPrimary, marginBottom: 8 },
  filingReminderText: { fontSize: 12, fontFamily: F.regular, color: C.textSecond, lineHeight: 22 },
  link:            { color: C.info, textDecorationLine: 'underline' },
  aiDisclaimerBanner: { backgroundColor: C.infoBg, borderRadius: 8, padding: 16, borderLeftWidth: 3, borderLeftColor: C.steelMid, marginBottom: 16 },
  aiDisclaimerTitle: { fontSize: 12, fontFamily: F.bold, color: C.emergency, marginBottom: 4 },
  aiDisclaimerText: { fontSize: 12, fontFamily: F.regular, color: C.info, lineHeight: 18 },
  loadingBox:      { alignItems: 'center', paddingVertical: 40, gap: 12 },
  loadingText:     { fontSize: 14,
    lineHeight: 21, fontFamily: F.regular, color: C.textMuted },
  aiGuideContent:  { backgroundColor: C.bgCard, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: C.border },
  aiGuideText:     { fontSize: 14, fontFamily: F.regular, color: C.textPrimary, lineHeight: 22 }});
export default React.memo(CourtFormsScreen);