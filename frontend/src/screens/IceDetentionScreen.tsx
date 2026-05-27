/**
 * IceDetentionScreen — ICE Detention Emergency Guide
 *
 * Target users:
 *   1. Person who was just detained by ICE
 *   2. Family member whose loved one was just detained
 *   3. DACA recipient arrested and needs to know immigration consequences
 *   4. Anyone who opened the door to ICE officers
 *
 * Design principles:
 *   - Works 100% OFFLINE — no API calls — always available
 *   - Bilingual English / Spanish toggle at the top
 *   - Panic-readable: big text, high contrast, action-first
 *   - Real phone numbers, real links (ACLU, NILC, RAICES, CLINIC)
 *   - Legally accurate: sourced from ACLU "Know Your Rights" (2024),
 *     National Immigration Law Center, Immigrant Legal Resource Center
 *   - All rights described apply under the 4th, 5th, 14th Amendments
 *     to ALL persons in the US regardless of immigration status
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Linking, Alert, Share,
} from 'react-native';
import { useTheme, COLORS, FONTS, RADIUS } from '../constants/theme';
import { hapticImpact, hapticSelection } from '../utils/webCompat';

// ── Content ────────────────────────────────────────────────────────────────────

const CONTENT = {
  en: {
    langBtn: 'Español 🌐',
    title: 'ICE Detention Help',
    subtitle: 'Know your rights — regardless of immigration status',

    rights: [
      {
        icon: '🤐', color: '#dc2626', bg: '#fef2f2',
        title: 'RIGHT TO REMAIN SILENT',
        body: 'You do NOT have to answer questions about where you were born, how you entered the US, or your immigration status.\n\nSay exactly: "I am exercising my right to remain silent."',
        bold: true,
      },
      {
        icon: '⚖️', color: '#1d4ed8', bg: '#eff6ff',
        title: 'RIGHT TO A LAWYER',
        body: 'You have the right to speak with an attorney BEFORE answering any questions — even if you cannot afford one. ICE must allow you to make a phone call.\n\nSay: "I want a lawyer before I answer any questions."',
        bold: false,
      },
      {
        icon: '🚫', color: '#7c3aed', bg: '#f5f3ff',
        title: 'DO NOT SIGN ANYTHING',
        body: 'Never sign documents ICE gives you without a lawyer. This includes "voluntary departure" forms. Signing can permanently waive your right to a hearing before a judge and result in immediate deportation with no appeal.',
        bold: false,
      },
      {
        icon: '🚪', color: '#d97706', bg: '#fffbeb',
        title: 'YOUR HOME IS PROTECTED',
        body: 'ICE cannot enter your home without a judicial warrant signed by a JUDGE — not an ICE "administrative warrant." Ask them to slide it under the door. If they cannot, do not open the door. You may speak through the closed door.',
        bold: false,
      },
      {
        icon: '🌐', color: '#059669', bg: '#ecfdf5',
        title: 'THESE RIGHTS APPLY TO EVERYONE',
        body: 'These rights apply to every person in the United States — citizen, green card holder, visa holder, DACA recipient, undocumented person, or asylum seeker. Your immigration status does NOT change these rights.',
        bold: false,
      },
    ],

    stepsTitle: 'WHAT TO DO RIGHT NOW',
    steps: [
      'Stay calm. Panic leads to mistakes. Breathe.',
      'Say only: "I want a lawyer. I am exercising my right to remain silent." Then stop talking.',
      'Do NOT run, resist physically, or argue with officers.',
      'Write down or memorize: officer name, badge number, agency, and vehicle number.',
      'Call — or have a family member call — an immigration attorney or legal aid immediately.',
      'If released, write down everything that happened as soon as possible.',
    ],

    locateTitle: 'FIND WHERE THEY ARE HELD',
    locateDesc: 'If a family member was detained, use the official ICE Detainee Locator. You need their full legal name and country of birth.',
    locateBtn: '🔍 Open ICE Detainee Locator',
    locateUrl: 'https://locator.ice.gov/odls/#/index',

    legalTitle: 'FREE LEGAL HELP — CALL NOW',
    resources: [
      {
        name: 'RAICES Emergency Line',
        phone: '210-787-3745',
        url: 'https://www.raicestexas.org',
        desc: 'Immigration legal services, especially families & children',
        highlight: true,
      },
      {
        name: 'National Immigration Law Center',
        phone: '213-639-3900',
        url: 'https://www.nilc.org',
        desc: 'Free legal help for low-income immigrants',
        highlight: false,
      },
      {
        name: 'ACLU Immigrants\' Rights Project',
        phone: '212-549-2660',
        url: 'https://www.aclu.org/know-your-rights/immigrants-rights',
        desc: 'Know-your-rights info and legal referrals',
        highlight: false,
      },
      {
        name: 'Immigrant Legal Resource Center',
        phone: '415-255-9499',
        url: 'https://www.ilrc.org',
        desc: 'Know-your-rights materials, legal aid referrals',
        highlight: false,
      },
      {
        name: 'Catholic Legal Immigration Network (CLINIC)',
        phone: '301-587-7993',
        url: 'https://cliniclegal.org',
        desc: 'Nationwide network of immigration legal services',
        highlight: false,
      },
    ],

    shareBtn: '📤 Share This With Family',
    shareMsg: `ICE DETENTION RIGHTS — Share with family:

1. STAY CALM
2. Say ONLY: "I want a lawyer. I am exercising my right to remain silent."
3. Do NOT sign anything
4. Do NOT open the door without a judge-signed warrant
5. These rights apply regardless of immigration status

📍 Find where they are: https://locator.ice.gov/odls
📞 Free legal help: RAICES 210-787-3745 | NILC 213-639-3900

Download Justice Gavel: https://justicegavel.app`,

    disclaimer: 'General legal information only — not legal advice. Content sourced from the ACLU (2024), National Immigration Law Center, and Immigrant Legal Resource Center. Immigration law is complex and changes frequently. Consult a licensed immigration attorney for your specific situation.',
  },

  es: {
    langBtn: 'English 🌐',
    title: 'Ayuda con Detención del ICE',
    subtitle: 'Conozca sus derechos — sin importar su estatus migratorio',

    rights: [
      {
        icon: '🤐', color: '#dc2626', bg: '#fef2f2',
        title: 'DERECHO A GUARDAR SILENCIO',
        body: 'NO tiene que responder preguntas sobre dónde nació, cómo entró a los EE.UU., o su estatus migratorio.\n\nDiga exactamente: "Estoy ejerciendo mi derecho a guardar silencio."',
        bold: true,
      },
      {
        icon: '⚖️', color: '#1d4ed8', bg: '#eff6ff',
        title: 'DERECHO A UN ABOGADO',
        body: 'Tiene derecho a hablar con un abogado ANTES de responder cualquier pregunta — aunque no pueda pagar uno. El ICE debe permitirle hacer una llamada telefónica.\n\nDiga: "Quiero un abogado antes de responder cualquier pregunta."',
        bold: false,
      },
      {
        icon: '🚫', color: '#7c3aed', bg: '#f5f3ff',
        title: 'NO FIRME NADA',
        body: 'Nunca firme documentos que el ICE le dé sin un abogado presente. Esto incluye formularios de "salida voluntaria." Firmar puede eliminar permanentemente su derecho a una audiencia ante un juez y resultar en deportación inmediata sin apelación.',
        bold: false,
      },
      {
        icon: '🚪', color: '#d97706', bg: '#fffbeb',
        title: 'SU HOGAR ESTÁ PROTEGIDO',
        body: 'El ICE no puede entrar a su hogar sin una orden judicial firmada por un JUEZ — no una "orden administrativa" del ICE. Pídales que la deslicen bajo la puerta. Si no pueden, no abra la puerta. Puede hablar a través de la puerta cerrada.',
        bold: false,
      },
      {
        icon: '🌐', color: '#059669', bg: '#ecfdf5',
        title: 'ESTOS DERECHOS APLICAN A TODOS',
        body: 'Estos derechos aplican a toda persona en los Estados Unidos — ciudadano, residente permanente, titular de visa, beneficiario de DACA, persona indocumentada, o solicitante de asilo. Su estatus migratorio NO cambia estos derechos.',
        bold: false,
      },
    ],

    stepsTitle: 'QUÉ HACER AHORA MISMO',
    steps: [
      'Mantenga la calma. El pánico lleva a errores. Respire.',
      'Diga solo: "Quiero un abogado. Estoy ejerciendo mi derecho a guardar silencio." Luego deje de hablar.',
      'NO huya, resista físicamente, ni discuta con los agentes.',
      'Anote o memorice: nombre del agente, número de placa, agencia y número de vehículo.',
      'Llame — o haga que un familiar llame — a un abogado de inmigración o asistencia legal de inmediato.',
      'Si lo liberan, anote todo lo que sucedió lo antes posible.',
    ],

    locateTitle: 'ENCUENTRE DÓNDE ESTÁ DETENIDO',
    locateDesc: 'Si un familiar fue detenido, use el Localizador de Detenidos oficial del ICE. Necesita su nombre legal completo y país de nacimiento.',
    locateBtn: '🔍 Abrir Localizador del ICE',
    locateUrl: 'https://locator.ice.gov/odls/#/index',

    legalTitle: 'AYUDA LEGAL GRATUITA — LLAME AHORA',
    resources: [
      {
        name: 'Línea de Emergencia RAICES',
        phone: '210-787-3745',
        url: 'https://www.raicestexas.org',
        desc: 'Servicios legales de inmigración, especialmente familias y niños',
        highlight: true,
      },
      {
        name: 'Centro Nacional de Ley de Inmigración',
        phone: '213-639-3900',
        url: 'https://www.nilc.org',
        desc: 'Ayuda legal gratuita para inmigrantes de bajos ingresos',
        highlight: false,
      },
      {
        name: 'Proyecto de Derechos de Inmigrantes de la ACLU',
        phone: '212-549-2660',
        url: 'https://www.aclu.org',
        desc: 'Información de derechos y derivaciones legales',
        highlight: false,
      },
      {
        name: 'Centro de Recursos Legales para Inmigrantes',
        phone: '415-255-9499',
        url: 'https://www.ilrc.org',
        desc: 'Materiales de derechos y derivaciones de asistencia legal',
        highlight: false,
      },
      {
        name: 'Red Católica de Inmigración Legal (CLINIC)',
        phone: '301-587-7993',
        url: 'https://cliniclegal.org',
        desc: 'Red nacional de servicios legales de inmigración',
        highlight: false,
      },
    ],

    shareBtn: '📤 Compartir con la Familia',
    shareMsg: `DERECHOS DE DETENCIÓN DEL ICE — Comparta con su familia:

1. MANTENGA LA CALMA
2. Diga SOLO: "Quiero un abogado. Estoy ejerciendo mi derecho a guardar silencio."
3. NO firme nada
4. NO abra la puerta sin orden firmada por un juez
5. Estos derechos aplican sin importar el estatus migratorio

📍 Encuentre dónde está: https://locator.ice.gov/odls
📞 Ayuda legal gratuita: RAICES 210-787-3745 | NILC 213-639-3900

Descargue Justice Gavel: https://justicegavel.app`,

    disclaimer: 'Información legal general solamente — no es asesoramiento legal. Contenido basado en la ACLU (2024), Centro Nacional de Ley de Inmigración y Centro de Recursos Legales para Inmigrantes. La ley de inmigración es compleja y cambia frecuentemente. Consulte a un abogado de inmigración autorizado para su situación específica.',
  },
} as const;

type Lang = keyof typeof CONTENT;

// ── Component ──────────────────────────────────────────────────────────────────

export default function IceDetentionScreen(): React.JSX.Element {
  const { colors, isDark } = useTheme();
  const [lang, setLang] = useState<Lang>('en');
  const L = CONTENT[lang];
  const s = makeStyles(colors, isDark);

  const toggleLang = useCallback(() => {
    hapticSelection();
    setLang(l => l === 'en' ? 'es' : 'en');
  }, []);

  const openLink = useCallback((url: string) => {
    hapticImpact();
    Linking.openURL(url).catch(() =>
      Alert.alert('Could not open link', 'Please visit ' + url)
    );
  }, []);

  const callNumber = useCallback((phone: string) => {
    hapticImpact();
    Linking.openURL('tel:' + phone.replace(/[^\d+]/g, '')).catch(() =>
      Alert.alert('Call', phone)
    );
  }, []);

  const shareInfo = useCallback(() => {
    hapticImpact();
    Share.share({ message: L.shareMsg, title: 'ICE Detention Rights' });
  }, [L.shareMsg]);

  return (
    <ScrollView
      testID="ice-detention-screen"
      style={[s.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={{ paddingBottom: 48 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Language toggle */}
      <View style={s.langRow}>
        <TouchableOpacity style={s.langBtn} onPress={toggleLang} testID="ice-lang-toggle">
          <Text style={s.langBtnTxt}>{L.langBtn}</Text>
        </TouchableOpacity>
      </View>

      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerEmoji}>🛑</Text>
        <Text style={s.headerTitle}>{L.title}</Text>
        <Text style={s.headerSub}>{L.subtitle}</Text>
      </View>

      {/* Rights */}
      <Text style={[s.sectionLabel, { color: colors.textFaint }]}>YOUR RIGHTS / SUS DERECHOS</Text>
      {L.rights.map((r, i) => (
        <View key={i} style={[s.rightCard, { backgroundColor: r.bg, borderColor: r.color }]}>
          <View style={s.rightTop}>
            <Text style={s.rightIcon}>{r.icon}</Text>
            <Text style={[s.rightTitle, { color: r.color }]}>{r.title}</Text>
          </View>
          <Text style={[s.rightBody, r.bold && s.rightBodyBold, { color: isDark ? '#f9fafb' : '#1f2937' }]}>
            {r.body}
          </Text>
        </View>
      ))}

      {/* Steps */}
      <Text style={[s.sectionLabel, { color: colors.textFaint }]}>{L.stepsTitle}</Text>
      {L.steps.map((step, i) => (
        <View key={i} style={[s.stepRow, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <View style={s.stepBubble}>
            <Text style={s.stepBubbleTxt}>{i + 1}</Text>
          </View>
          <Text style={[s.stepTxt, { color: colors.textPrimary }]}>{step}</Text>
        </View>
      ))}

      {/* Detainee locator */}
      <Text style={[s.sectionLabel, { color: colors.textFaint }]}>{L.locateTitle}</Text>
      <View style={[s.locatorCard, { backgroundColor: colors.bgCard, borderColor: COLORS.legal }]}>
        <Text style={[s.locatorDesc, { color: colors.textSecond }]}>{L.locateDesc}</Text>
        <TouchableOpacity
          style={s.locatorBtn}
          onPress={() => openLink(L.locateUrl)}
          testID="ice-locator-btn"
        >
          <Text style={s.locatorBtnTxt}>{L.locateBtn}</Text>
        </TouchableOpacity>
      </View>

      {/* Legal resources */}
      <Text style={[s.sectionLabel, { color: colors.textFaint }]}>{L.legalTitle}</Text>
      {L.resources.map((r, i) => (
        <View key={i} style={[
          s.resourceCard,
          { backgroundColor: r.highlight ? COLORS.legalBg : colors.bgCard, borderColor: r.highlight ? COLORS.legal : colors.border },
        ]}>
          <Text style={[s.resourceName, { color: colors.textPrimary }]}>
            {r.highlight ? '⭐ ' : ''}{r.name}
          </Text>
          <Text style={[s.resourceDesc, { color: colors.textMuted }]}>{r.desc}</Text>
          <View style={s.resourceBtns}>
            <TouchableOpacity
              style={[s.callBtn, { backgroundColor: r.highlight ? COLORS.legal : COLORS.navy }]}
              onPress={() => callNumber(r.phone)}
              testID={`ice-call-${i}`}
            >
              <Text style={s.callBtnTxt}>📞 {r.phone}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.webBtn, { borderColor: colors.border }]}
              onPress={() => openLink(r.url)}
              testID={`ice-web-${i}`}
            >
              <Text style={[s.webBtnTxt, { color: colors.textSecond }]}>Web →</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      {/* Share */}
      <TouchableOpacity style={s.shareBtn} onPress={shareInfo} testID="ice-share-btn">
        <Text style={s.shareBtnTxt}>{L.shareBtn}</Text>
      </TouchableOpacity>

      {/* Disclaimer */}
      <View style={[s.disclaimer, { backgroundColor: colors.warnBg, borderColor: colors.warn }]}>
        <Text style={[s.disclaimerTxt, { color: colors.textSecond }]}>{L.disclaimer}</Text>
      </View>
    </ScrollView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const makeStyles = (colors: any, isDark: boolean) => StyleSheet.create({
  screen:   { flex: 1 },

  langRow:    { flexDirection: 'row', justifyContent: 'flex-end', padding: 12, paddingBottom: 0 },
  langBtn:    { backgroundColor: COLORS.navy, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 },
  langBtnTxt: { color: '#fff', fontSize: 13, fontFamily: 'Inter_700Bold', fontWeight: '700' },

  header:      { backgroundColor: '#991b1b', padding: 24, paddingTop: 12, alignItems: 'center', gap: 6 },
  headerEmoji: { fontSize: 44 },
  headerTitle: { fontSize: 24, fontFamily: 'Inter_900Black', fontWeight: '900', color: '#fff', textAlign: 'center' },
  headerSub:   { fontSize: 13, color: 'rgba(255,255,255,0.85)', textAlign: 'center', lineHeight: 19 },

  sectionLabel: { fontSize: 11, fontFamily: 'Inter_900Black', fontWeight: '900', letterSpacing: 1.5,
    textTransform: 'uppercase', marginTop: 20, marginBottom: 8, paddingHorizontal: 16 },

  rightCard:      { marginHorizontal: 16, marginBottom: 10, borderRadius: RADIUS.lg, borderWidth: 2, padding: 14 },
  rightTop:       { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  rightIcon:      { fontSize: 22 },
  rightTitle:     { fontSize: 13, fontFamily: 'Inter_900Black', fontWeight: '900', flex: 1, lineHeight: 19 },
  rightBody:      { fontSize: 13, lineHeight: 20 },
  rightBodyBold:  { fontSize: 14, fontFamily: 'Inter_700Bold', fontWeight: '700', lineHeight: 22 },

  stepRow:       { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginHorizontal: 16,
    marginBottom: 8, borderRadius: RADIUS.md, borderWidth: 1, padding: 12 },
  stepBubble:    { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.navy,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  stepBubbleTxt: { color: '#fff', fontSize: 13, fontFamily: 'Inter_900Black', fontWeight: '900' },
  stepTxt:       { flex: 1, fontSize: 13, lineHeight: 20 },

  locatorCard: { marginHorizontal: 16, marginBottom: 10, borderRadius: RADIUS.lg, borderWidth: 2, padding: 16 },
  locatorDesc: { fontSize: 13, lineHeight: 19, marginBottom: 14 },
  locatorBtn:  { backgroundColor: COLORS.legal, borderRadius: RADIUS.md, paddingVertical: 14, alignItems: 'center' },
  locatorBtnTxt: { color: '#fff', fontSize: 14, fontFamily: 'Inter_700Bold', fontWeight: '700' },

  resourceCard:  { marginHorizontal: 16, marginBottom: 10, borderRadius: RADIUS.lg, borderWidth: 1.5, padding: 14 },
  resourceName:  { fontSize: 14, fontFamily: 'Inter_700Bold', fontWeight: '700', lineHeight: 20, marginBottom: 3 },
  resourceDesc:  { fontSize: 12, lineHeight: 17, marginBottom: 10 },
  resourceBtns:  { flexDirection: 'row', gap: 8 },
  callBtn:       { flex: 1, borderRadius: RADIUS.md, paddingVertical: 10, alignItems: 'center' },
  callBtnTxt:    { color: '#fff', fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  webBtn:        { borderRadius: RADIUS.md, paddingVertical: 10, paddingHorizontal: 14,
    alignItems: 'center', borderWidth: 1 },
  webBtnTxt:     { fontSize: 12, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },

  shareBtn:    { marginHorizontal: 16, marginVertical: 16, backgroundColor: COLORS.navy,
    borderRadius: RADIUS.lg, paddingVertical: 15, alignItems: 'center' },
  shareBtnTxt: { color: '#fff', fontSize: 15, fontFamily: 'Inter_700Bold', fontWeight: '700' },

  disclaimer:    { marginHorizontal: 16, borderRadius: RADIUS.md, borderWidth: 1, padding: 14 },
  disclaimerTxt: { fontSize: 11, lineHeight: 17 },
});
