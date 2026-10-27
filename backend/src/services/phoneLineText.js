/**
 * services/phoneLineText.js — what the court-date phone line says (A10), English and Spanish.
 *
 * The phone line speaks only English and Spanish (build plan A10: "the menu is in English and
 * Spanish first"), so its words live here rather than in the four-language app catalogs.
 * It reads ONLY the next court date: day, time, court name and room. Never case details,
 * charges, balances or anything else.
 */
import { courtDayGuidance } from './courtDayGuidance.js';

const DAY_FMT = { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' };

/** 'YYYY-MM-DD' → "Tuesday, November 3" / "martes, 3 de noviembre". */
export function spokenDay(date, lang) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ''));
  if (!m) return String(date || '');
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  return d.toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', DAY_FMT);
}
/** '14:30' → "2:30 PM" / "2:30 p. m." */
export function spokenTime(time, lang) {
  const m = /^(\d{2}):(\d{2})/.exec(String(time || ''));
  if (!m) return null;
  const h = +m[1]; const min = m[2];
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (lang === 'es') return `${h12}:${min} ${h < 12 ? 'de la mañana' : 'de la tarde'}`;
  return `${h12}:${min} ${h < 12 ? 'AM' : 'PM'}`;
}

const esc = (s) => String(s ?? '').replace(/[<>&"']/g, ' ').replace(/\s+/g, ' ').trim();

const T = {
  en: {
    welcome: 'Justice Gavel court date line.',
    menu: 'To hear your next court date, press 1. To get it by text message, press 2. To hear what to do if you missed court, press 3.',
    enter_phone: 'Please enter the 10 digit phone number on file, then press pound.',
    not_found: 'We could not find an upcoming court date for that phone number.',
    none: 'We could not find an upcoming court date for the phone number on file.',
    date: (d) => `Your next court date is ${d.day}${d.time ? `, at ${d.time}` : ''}.${d.court ? ` ${d.court}.` : ''}${d.room ? ` Room ${d.room}.` : ''} Please check with the court clerk if anything changes.`,
    texted: 'We sent your next court date by text message to the number on file.',
    text_blocked: 'We cannot text that number because it replied STOP. Text START to our number to allow texts again.',
    text_wait: 'We already sent a text to that number in the last hour.',
    text_unavailable: 'Text messages are not available right now.',
    text_failed: 'The text message could not be sent. Please try again later.',
    too_many_tries: 'Too many phone numbers were entered. Please call again later.',
    limited: 'You have called many times in a short time. Please call again later. Goodbye.',
    goodbye: 'Thank you for calling. Goodbye.',
    invalid: 'Sorry, that is not an option.',
    sms: (d) => `Justice Gavel: Your next court date is ${d.day}${d.time ? ` at ${d.time}` : ''}${d.court ? `, ${d.court}` : ''}${d.room ? `, room ${d.room}` : ''}. Check with the court clerk if anything changes. Reply STOP to opt out.`,
  },
  es: {
    welcome: 'Línea de fechas de corte de Justice Gavel.',
    menu: 'Para escuchar su próxima fecha de corte, oprima 1. Para recibirla por mensaje de texto, oprima 2. Para saber qué hacer si faltó a la corte, oprima 3.',
    enter_phone: 'Marque el número de teléfono de 10 dígitos que tenemos registrado y luego oprima la tecla de número.',
    not_found: 'No encontramos una próxima fecha de corte para ese número de teléfono.',
    none: 'No encontramos una próxima fecha de corte para el número de teléfono registrado.',
    date: (d) => `Su próxima fecha de corte es el ${d.day}${d.time ? `, a las ${d.time}` : ''}.${d.court ? ` ${d.court}.` : ''}${d.room ? ` Sala ${d.room}.` : ''} Consulte con el secretario de la corte si algo cambia.`,
    texted: 'Enviamos su próxima fecha de corte por mensaje de texto al número registrado.',
    text_blocked: 'No podemos enviar mensajes a ese número porque respondió STOP. Envíe START a nuestro número para permitir mensajes otra vez.',
    text_wait: 'Ya enviamos un mensaje a ese número en la última hora.',
    text_unavailable: 'Los mensajes de texto no están disponibles en este momento.',
    text_failed: 'No se pudo enviar el mensaje de texto. Inténtelo más tarde.',
    too_many_tries: 'Se marcaron demasiados números de teléfono. Llame más tarde.',
    limited: 'Ha llamado muchas veces en poco tiempo. Llame más tarde. Adiós.',
    goodbye: 'Gracias por llamar. Adiós.',
    invalid: 'Lo sentimos, esa no es una opción.',
    sms: (d) => `Justice Gavel: Su próxima fecha de corte es el ${d.day}${d.time ? ` a las ${d.time}` : ''}${d.court ? `, ${d.court}` : ''}${d.room ? `, sala ${d.room}` : ''}. Consulte con el secretario de la corte si algo cambia. Responda STOP para cancelar.`,
  },
};

export const voiceLang = (l) => (l === 'es' ? 'es' : 'en');
export const say = (lang, key) => T[voiceLang(lang)][key];

/** The first prompt, in both languages (SSML: the Spanish sentence is spoken in Spanish). */
export function languagePrompt() {
  return `<speak>${T.en.welcome} To continue in English, press 1. <lang xml:lang="es-US">${T.es.welcome} Para español, oprima 2.</lang></speak>`;
}

/** { date, time, court_name, room } → the spoken sentence. */
export function spokenCourtDate(cd, lang) {
  const l = voiceLang(lang);
  return T[l].date({ day: spokenDay(cd.date, l), time: spokenTime(cd.time, l), court: esc(cd.court_name) || null, room: esc(cd.room) || null });
}
export function smsCourtDate(cd, lang) {
  const l = voiceLang(lang);
  return T[l].sms({ day: spokenDay(cd.date, l), time: spokenTime(cd.time, l), court: esc(cd.court_name) || null, room: esc(cd.room) || null });
}

/** The existing missed-court guidance (services/courtDayGuidance.js), read aloud. */
export function spokenMissedGuidance(lang) {
  const g = courtDayGuidance(voiceLang(lang)).missed;
  return [g.title.replace(/[—–]/g, ','), ...g.steps.map((s) => s.text.replace(/[—–]/g, ','))].join(' ');
}
