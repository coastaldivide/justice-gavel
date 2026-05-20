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
import { View, Text, TouchableOpacity, ScrollView, FlatList, Linking, StyleSheet, TextInput, Platform, ActivityIndicator, Alert, KeyboardAvoidingView, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../constants/theme';
import {
  STATE_COURT_FORMS,
  FEDERAL_SOURCES,
  type CourtFormSource} from '../data/courtFormsRegistry';
import LegalDisclaimerModal, { hasValidConsent } from '../components/LegalDisclaimerModal';
import { api } from '../services/api';

// ── Form categories ───────────────────────────────────────────────────────────
const FORM_CATEGORIES = [
  {
    key: 'criminal_defense',
    label: 'Criminal Defense',
    icon: '⚖️',
    description: 'Motions, responses, pro se appearances'},
  {
    key: 'expungement',
    label: 'Expungement / Record Sealing',
    icon: '🗂️',
    description: 'Clear or seal criminal records'},
  {
    key: 'bail_bond',
    label: 'Bail & Bond',
    icon: '🔓',
    description: 'Bail reduction, bond review motions'},
  {
    key: 'protective_order',
    label: 'Protective Orders',
    icon: '🛡️',
    description: 'Restraining orders and protective orders'},
  {
    key: 'civil_rights',
    label: 'Civil Rights',
    icon: '✊',
    description: '§ 1983 claims, rights violations'},
  {
    key: 'small_claims',
    label: 'Small Claims',
    icon: '📋',
    description: 'Claims under your state\'s monetary limit'},
];

type Phase = 'state_select' | 'category_select' | 'form_display' | 'ai_guide';

export default function CourtFormsScreen({ route, navigation }: ScreenProps): JSX.Element {
  const navigation = useNavigation();
  const { COLORS, FONTS , colors} = useTheme();
  const s = styles(COLORS, FONTS);

  const [phase, setPhase] = useState<Phase>('state_select');
  const [selectedState, setSelectedState] = useState<CourtFormSource | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [consentGranted, setConsentGranted] = useState(false);
  const [aiGuide, setAiGuide] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // ── State search / filter ─────────────────────────────────────────────────
  const filteredStates = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return [
      { state: 'FED', stateName: 'Federal Courts (All Districts)', aocName: FEDERAL_SOURCES.aocName, formsPortalUrl: FEDERAL_SOURCES.formsPortalUrl, fillablePdf: true, eFiling: true },
      ...STATE_COURT_FORMS,
    ];
    return [
      { state: 'FED', stateName: 'Federal Courts (All Districts)', aocName: FEDERAL_SOURCES.aocName, formsPortalUrl: FEDERAL_SOURCES.formsPortalUrl, fillablePdf: true, eFiling: true },
      ...STATE_COURT_FORMS,
    ].filter(s =>
      s.stateName.toLowerCase().includes(q) ||
      s.state.toLowerCase().includes(q) ||
      s.aocName.toLowerCase().includes(q)
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
      setConsentGranted(true);
      setPhase('form_display');
    }
  }, []);

  const onConsentAccepted = useCallback(() => {
    setShowDisclaimer(false);
    setConsentGranted(true);
    setPhase('form_display');
  }, []);

  // ── Open official form URL ─────────────────────────────────────────────────
  const openFormUrl = useCallback((url: string) => {
    Linking.openURL(url).catch(() => {
      Alert.alert(
        'Could Not Open Link',
        'Please visit the URL directly in your browser:\n\n' + url,
        [{ text: 'OK' }]
      );
    });
  }, []);

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
      const categoryLabel = FORM_CATEGORIES.find(c => c.key === selectedCategory)?.label ?? selectedCategory;
      const res = await api.post('/chat/ask', {
        message: `Explain what information someone needs to gather before completing a ${categoryLabel} form in ${selectedState.stateName}.

          List the typical fields on these forms and explain what each field means in plain language.
          Do NOT recommend what strategy to take or what to write. Only explain what each field is asking for.

          Format as a numbered list. Start with the most important fields. Keep each explanation to 2-3 sentences.`,
        systemContext: 'court_forms_explainer',
        disclaimer: 'information_only'});
      if (mountedRef.current) setAiGuide(res.data?.response ?? res.data?.content ?? null);
    } catch {
      if (mountedRef.current) setAiGuide('Unable to load field guide. Please refer to the official court form instructions for assistance.');
    } finally {
      if (mountedRef.current) setAiLoading(false);
    }
  }, [selectedState, selectedCategory]);

  // ── Render helpers ─────────────────────────────────────────────────────────
  const renderStateItem = useCallback(({ item }: { item: CourtFormSource }) => (
    <TouchableOpacity
      style={s.stateRow}
      onPress={() => onSelectState(item)}
      accessibilityRole="button"
      accessibilityLabel={`Select ${item.stateName}`}
    >
      <View style={s.stateInfo}>
        <Text maxFontSizeMultiplier={1.4} style={s.stateName}>{item.stateName}</Text>
        <Text maxFontSizeMultiplier={1.4} style={s.stateAoc}>{item.aocName}</Text>
      </View>
      <View style={s.stateBadges}>
        {item.fillablePdf && (
          <View style={[s.badge, { backgroundColor: colors.legalBg }]}>
            <Text maxFontSizeMultiplier={1.4} style={[s.badgeText, { color: colors.legalDark }]}>Fillable PDF</Text>
          </View>
        )}
        {item.eFiling && (
          <View style={[s.badge, { backgroundColor: colors.bgSubtle }]}>
            <Text maxFontSizeMultiplier={1.4} style={[s.badgeText, { color: colors.blue }]}>E-File</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  ), [s, onSelectState]);

  // ── Phase: State selection ─────────────────────────────────────────────────
  if (phase === 'state_select') {
    return (
      <View style={s.root}>
        <View style={s.header}>
          <Text maxFontSizeMultiplier={1.4} style={s.headerTitle}>Official Court Forms</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.headerSub}>
            Select your state to find official government court forms
          </Text>
        </View>
        <View style={s.searchBox}>
          <TextInput
            style={s.searchInput}
            placeholder="Search states..."
            placeholderTextColor={COLORS.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            clearButtonMode="while-editing"
            accessibilityLabel="Search states"
          blurOnSubmit
        />
        </View>
        <FlatList
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
          data={filteredStates}
          ListEmptyComponent={
            <View style={{ padding:40, alignItems:'center' }}>
              <Text maxFontSizeMultiplier={1.4} style={{ fontSize:15, color:COLORS.textMuted, textAlign:'center' }}>
                No states match your search. Try a different name or abbreviation.
              </Text>
            </View>
          }
          keyExtractor={item => item.state}
          renderItem={renderStateItem}
          ItemSeparatorComponent={() => <View style={s.separator} />}
          getItemLayout={(_, index) => ({ length: 72, offset: 72 * index, index })}
          ListHeaderComponent={
            <View>
              <Text maxFontSizeMultiplier={1.4} style={s.disclaimerText}>
                All forms link to official .gov and court websites. Government forms
                are public domain (17 U.S.C. § 105).
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
          <TouchableOpacity onPress={() => setPhase('state_select')} style={s.backBtn}
            accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.4} style={s.backBtnText}>← States</Text>
          </TouchableOpacity>
          <Text maxFontSizeMultiplier={1.4} style={s.subHeaderTitle}>{selectedState.stateName}</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.subHeaderSub}>{selectedState.aocName}</Text>
        </View>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps='handled' contentContainerStyle={s.categoryList}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
          {FORM_CATEGORIES.map(cat => (
            <TouchableOpacity
              key={cat.key}
              style={s.categoryCard}
              onPress={() => onSelectCategory(cat.key)}
              accessibilityRole="button"
              accessibilityLabel={cat.label}
            >
              <Text maxFontSizeMultiplier={1.4} style={s.categoryIcon}>{cat.icon}</Text>
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
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, fontWeight: '700', color: colors.warnDark, marginBottom: 4 }}>
              ⚠️ Juvenile Records -- Different Process
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, color: colors.warnDark, lineHeight: 19 }}>
              Juvenile records use separate courts, forms, and eligibility rules in every state.
              The forms above apply to adult criminal records only. For juvenile records,
              contact your state juvenile court clerk or visit{' '}
              <Text maxFontSizeMultiplier={1.4}
                style={{ color: colors.blue, textDecorationLine: 'underline' }}
                onPress={() => Linking.openURL('https://www.juvenilelaw.org/find-help').catch(() => {})}
              >
                juvenilelaw.org/find-help
              </Text>
              .
            </Text>
          </View>

<TouchableOpacity
            style={[s.categoryCard, s.selfHelpCard]}
            onPress={() => openFormUrl(selectedState.selfHelpUrl ?? selectedState.formsPortalUrl)}
            accessibilityRole="button"
            accessibilityLabel="All forms -- open official state portal"
          >
            <Text maxFontSizeMultiplier={1.4} style={s.categoryIcon}>🌐</Text>
            <View style={s.categoryInfo}>
              <Text maxFontSizeMultiplier={1.4} style={s.categoryLabel}>All Forms -- Official Portal</Text>
              <Text maxFontSizeMultiplier={1.4} style={s.categoryDesc}>{selectedState.aocName}</Text>
            </View>
            <Text maxFontSizeMultiplier={1.4} style={s.chevron}>↗</Text>
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
    const categoryInfo = FORM_CATEGORIES.find(c => c.key === selectedCategory);
    const primaryUrl = getBestUrl(selectedState, selectedCategory);
    const selfHelpUrl = selectedState.selfHelpUrl ?? selectedState.formsPortalUrl;

    return (
      <View style={s.root}>
        <View style={s.subHeader}>
          <TouchableOpacity onPress={() => setPhase('category_select')} style={s.backBtn}
            accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.4} style={s.backBtnText}>← {selectedState.stateName}</Text>
          </TouchableOpacity>
          <Text maxFontSizeMultiplier={1.4} style={s.subHeaderTitle}>{categoryInfo?.label}</Text>
        </View>

        <ScrollView keyboardShouldPersistTaps='handled' contentContainerStyle={s.formContent}>

          {/* Information notice */}
          <View style={s.infoNotice}>
            <Text maxFontSizeMultiplier={1.4} style={s.infoNoticeTitle}>ℹ️ Legal Information Only</Text>
            <Text maxFontSizeMultiplier={1.4} style={s.infoNoticeText}>
              The links below open official government form portals. Justice Gavel
              helps you understand what each form asks for. This is not legal advice.
              Consult a licensed attorney before filing.
            </Text>
          </View>

          {/* Official form link */}
          <Text maxFontSizeMultiplier={1.4} style={s.sectionLabel}>Official Government Forms</Text>
          <TouchableOpacity
            style={s.formLink}
            onPress={() => openFormUrl(primaryUrl)}
            accessibilityRole="link"
            accessibilityLabel={`Open ${selectedState.stateName} ${categoryInfo?.label} forms`}
          >
            <View style={s.formLinkLeft}>
              <Text maxFontSizeMultiplier={1.4} style={s.formLinkTitle}>
                {selectedState.stateName} -- {categoryInfo?.label} Forms
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
              style={[s.formLink, s.formLinkSecondary]}
              onPress={() => openFormUrl(selfHelpUrl)}
              accessibilityRole="link"
              accessibilityLabel="Open self-help portal"
            >
              <View style={s.formLinkLeft}>
                <Text maxFontSizeMultiplier={1.4} style={s.formLinkTitle}>Self-Help Center</Text>
                <Text maxFontSizeMultiplier={1.4} style={s.formLinkUrl} numberOfLines={1}>{selfHelpUrl}</Text>
                <Text maxFontSizeMultiplier={1.4} style={s.formLinkSource}>Plain-language guides and instructions</Text>
              </View>
              <View style={[s.govBadge, { backgroundColor: colors.bgSubtle }]}>
                <Text maxFontSizeMultiplier={1.4} style={[s.govBadgeText, { color: colors.blue }]}>Self-Help</Text>
              </View>
            </TouchableOpacity>
          )}

          {/* Federal forms link */}
          <TouchableOpacity
            style={[s.formLink, s.formLinkSecondary]}
            onPress={() => openFormUrl(FEDERAL_SOURCES.formsPortalUrl)}
            accessibilityRole="link"
            accessibilityLabel="Open federal court forms"
          >
            <View style={s.formLinkLeft}>
              <Text maxFontSizeMultiplier={1.4} style={s.formLinkTitle}>Federal Court Forms</Text>
              <Text maxFontSizeMultiplier={1.4} style={s.formLinkUrl}>uscourts.gov</Text>
              <Text maxFontSizeMultiplier={1.4} style={s.formLinkSource}>Administrative Office of the U.S. Courts</Text>
            </View>
            <View style={[s.govBadge, { backgroundColor: colors.bgSubtle }]}>
              <Text maxFontSizeMultiplier={1.4} style={[s.govBadgeText, { color: colors.blue }]}>Federal</Text>
            </View>
          </TouchableOpacity>

          {/* National legal aid link */}
          <TouchableOpacity
            style={[s.formLink, s.formLinkSecondary]}
            onPress={() => openFormUrl('https://www.lawhelp.org/')}
            accessibilityRole="link"
            accessibilityLabel="Open LawHelp.org free legal help"
          >
            <View style={s.formLinkLeft}>
              <Text maxFontSizeMultiplier={1.4} style={s.formLinkTitle}>LawHelp.org -- Free Legal Help</Text>
              <Text maxFontSizeMultiplier={1.4} style={s.formLinkUrl}>lawhelp.org</Text>
              <Text maxFontSizeMultiplier={1.4} style={s.formLinkSource}>
                Non-profit legal aid referrals and interactive forms -- all 50 states
              </Text>
            </View>
          </TouchableOpacity>

          {/* AI field guide CTA */}
          <Text maxFontSizeMultiplier={1.4} style={s.sectionLabel}>Understand the Form</Text>
          <TouchableOpacity
            style={s.aiGuideBtn}
            onPress={loadAiGuide}
            accessibilityRole="button"
            accessibilityLabel="Get AI field guide"
          >
            <Text maxFontSizeMultiplier={1.4} style={s.aiGuideBtnIcon}>🤖</Text>
            <View style={s.aiGuideBtnInfo}>
              <Text maxFontSizeMultiplier={1.4} style={s.aiGuideBtnTitle}>
                AI Field Guide -- What Each Section Asks For
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={s.aiGuideBtnSub}>
                Plain-language explanations of form fields. Not legal advice.
              </Text>
            </View>
          </TouchableOpacity>

          {/* Filing reminder */}
          <View style={s.filingReminder}>
            <Text maxFontSizeMultiplier={1.4} style={s.filingReminderTitle}>Before You File</Text>
            <Text maxFontSizeMultiplier={1.4} style={s.filingReminderText}>
              {'• '}Read all instructions on the official form carefully{'\n'}
              {'• '}Complete every required field -- blank fields can result in rejection{'\n'}
              {'• '}Make copies before filing{'\n'}
              {'• '}Confirm filing fees and deadlines with the clerk's office{'\n'}
              {'• '}Consider consulting a{' '}
              <Text maxFontSizeMultiplier={1.4}
                style={s.link}
                onPress={() => openFormUrl('https://www.lawhelp.org/')}
              >
                free legal aid attorney
              </Text>
              {' '}before filing
            </Text>
          </View>

        </ScrollView>
      </View>
    );
  }

  // ── Phase: AI field guide ─────────────────────────────────────────────────
  if (phase === 'ai_guide') {
    const categoryInfo = FORM_CATEGORIES.find(c => c.key === selectedCategory);
    return (
      <View style={s.root}>
        <View style={s.subHeader}>
          <TouchableOpacity onPress={() => setPhase('form_display')} style={s.backBtn}
            accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={1.4} style={s.backBtnText}>← Forms</Text>
          </TouchableOpacity>
          <Text maxFontSizeMultiplier={1.4} style={s.subHeaderTitle}>Field Guide</Text>
          <Text maxFontSizeMultiplier={1.4} style={s.subHeaderSub}>
            {selectedState?.stateName} · {categoryInfo?.label}
          </Text>
        </View>

        <ScrollView keyboardShouldPersistTaps='handled' contentContainerStyle={s.formContent}>

          {/* Disclaimer banner -- always shown in AI phase */}
          <View style={s.aiDisclaimerBanner}>
            <Text maxFontSizeMultiplier={1.4} style={s.aiDisclaimerTitle}>⚠️ NOT LEGAL ADVICE</Text>
            <Text maxFontSizeMultiplier={1.4} style={s.aiDisclaimerText}>
              This AI explanation describes what form fields ask for. It does not
              constitute legal advice, a legal strategy, or a recommendation of
              what to write. Laws vary by jurisdiction. Consult a licensed attorney
              before filing.
            </Text>
          </View>

          {aiLoading ? (
            <View style={s.loadingBox}>
              <ActivityIndicator size="large" color={COLORS.navy} />
              <Text maxFontSizeMultiplier={1.4} style={s.loadingText}>Loading field guide…</Text>
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
              <Text maxFontSizeMultiplier={1.4} style={s.formLinkTitle}>Open Official Form</Text>
              <Text maxFontSizeMultiplier={1.4} style={s.formLinkSub}>
                Always use the official government form when filing.
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
const styles = (C: Record<string, unknown>, F: Record<string, unknown>) => StyleSheet.create({
  root:            { flex: 1, backgroundColor: C.bg },
  header:          { backgroundColor: C.navy, paddingTop: Platform.OS === 'ios' ? 56 : 32, paddingBottom: 16, paddingHorizontal: 20 },
  headerTitle:     { fontSize: 22, fontFamily: F.bold, color: COLORS.bgCard, marginBottom: 4 },
  headerSub:       { fontSize: 12, fontFamily: F.regular, color: colors.border },
  subHeader:       { backgroundColor: C.bgCard, paddingTop: Platform.OS === 'ios' ? 56 : 32, paddingBottom: 12, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn:         { marginBottom: 4 },
  backBtnText:     { fontSize: 14,
    lineHeight: 21, fontFamily: F.medium, color: C.blue },
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
    lineHeight: 21, fontFamily: F.bold, color: C.blue, marginBottom: 4 },
  infoNoticeText:  { fontSize: 12, fontFamily: F.regular, color: C.textSecond, lineHeight: 19 },
  sectionLabel:    { fontSize: 11, fontFamily: F.medium, color: C.textMuted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8, marginTop: 16 },
  formLink:        { flexDirection: 'row', alignItems: 'center', backgroundColor: C.bgCard, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: C.border, marginBottom: 10, gap: 12 },
  formLinkSecondary: { borderColor: C.bgSubtle, backgroundColor: C.bgSubtle },
  formLinkLeft:    { flex: 1 },
  formLinkTitle:   { fontSize: 14,
    lineHeight: 21, fontFamily: F.semiBold, color: C.textPrimary, marginBottom: 2 },
  formLinkUrl:     { fontSize: 11, fontFamily: F.regular, color: C.blue, marginBottom: 2 },
  formLinkSource:  { fontSize: 11, fontFamily: F.regular, color: C.textMuted },
  formLinkSub:     { fontSize: 12, fontFamily: F.regular, color: C.textMuted, marginTop: 2 },
  govBadge:        { backgroundColor: colors.legal, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  govBadgeText:    { fontSize: 11, fontFamily: F.bold, color: colors.legal },
  aiGuideBtn:      { flexDirection: 'row', alignItems: 'center', backgroundColor: C.navy, borderRadius: 12, padding: 16, gap: 12, marginBottom: 10 },
  aiGuideBtnIcon:  { fontSize: 22 },
  aiGuideBtnInfo:  { flex: 1 },
  aiGuideBtnTitle: { fontSize: 14,
    lineHeight: 21, fontFamily: F.semiBold, color: COLORS.bgCard },
  aiGuideBtnSub:   { fontSize: 12, fontFamily: F.regular, color: colors.border, marginTop: 2 },
  filingReminder:  { backgroundColor: C.bgCard, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: C.border, marginTop: 10 },
  filingReminderTitle: { fontSize: 14,
    lineHeight: 21, fontFamily: F.bold, color: C.textPrimary, marginBottom: 8 },
  filingReminderText: { fontSize: 12, fontFamily: F.regular, color: C.textSecond, lineHeight: 22 },
  link:            { color: C.blue, textDecorationLine: 'underline' },
  aiDisclaimerBanner: { backgroundColor: '#FFA726', borderRadius: 8, padding: 16, borderLeftWidth: 3, borderLeftColor: '#FFA726', marginBottom: 16 },
  aiDisclaimerTitle: { fontSize: 12, fontFamily: F.bold, color: colors.emergency, marginBottom: 4 },
  aiDisclaimerText: { fontSize: 12, fontFamily: F.regular, color: '#FFA726', lineHeight: 18 },
  loadingBox:      { alignItems: 'center', paddingVertical: 40, gap: 12 },
  loadingText:     { fontSize: 14,
    lineHeight: 21, fontFamily: F.regular, color: C.textMuted },
  aiGuideContent:  { backgroundColor: C.bgCard, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: C.border },
  aiGuideText:     { fontSize: 14, fontFamily: F.regular, color: C.textPrimary, lineHeight: 22 }});
