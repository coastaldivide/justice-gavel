/**
 * State / territory names in Spanish and Brazilian Portuguese where they differ
 * from the English name (as US Spanish- and Portuguese-language media write
 * them). Vietnamese uses the English names. Same table as the server
 * (backend/src/i18n/stateNames.js) — the backend i18n test checks they match.
 */
export const STATE_NAMES_I18N: Record<'es' | 'pt' | 'vi', Record<string, string>> = {
  es: {
    DC: 'Washington D. C.', HI: 'Hawái', LA: 'Luisiana', MI: 'Míchigan', MS: 'Misisipi', MO: 'Misuri',
    NH: 'Nuevo Hampshire', NJ: 'Nueva Jersey', NM: 'Nuevo México', NY: 'Nueva York', NC: 'Carolina del Norte',
    ND: 'Dakota del Norte', OR: 'Oregón', PA: 'Pensilvania', SC: 'Carolina del Sur', SD: 'Dakota del Sur',
    WV: 'Virginia Occidental', VI: 'Islas Vírgenes de EE. UU.', AS: 'Samoa Estadounidense', MP: 'Islas Marianas del Norte',
  },
  pt: {
    AK: 'Alasca', CA: 'Califórnia', DC: 'Washington D.C.', FL: 'Flórida', GA: 'Geórgia', HI: 'Havaí', LA: 'Luisiana',
    NH: 'Nova Hampshire', NJ: 'Nova Jersey', NM: 'Novo México', NY: 'Nova York', NC: 'Carolina do Norte',
    ND: 'Dakota do Norte', PA: 'Pensilvânia', SC: 'Carolina do Sul', SD: 'Dakota do Sul', VA: 'Virgínia',
    WV: 'Virgínia Ocidental', PR: 'Porto Rico', VI: 'Ilhas Virgens Americanas', AS: 'Samoa Americana', MP: 'Ilhas Marianas do Norte',
  },
  vi: {},
};
