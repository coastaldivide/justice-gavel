import type { Lang } from './index';

/**
 * State / territory names in each language where they differ from the English
 * name (as US Spanish-, Portuguese-, Haitian Creole-, Chinese-, Arabic- and
 * Tagalog-language media write them). Vietnamese and Tagalog use the English
 * names; ht / zh / ar translated by Claude on 2026-10-27 (needs native-speaker review). Same
 * table as the server (backend/src/i18n/stateNames.js) — the backend i18n test
 * checks they match.
 */
export const STATE_NAMES_I18N: Record<Exclude<Lang, 'en'>, Record<string, string>> = {
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
  ht: {
    CA: 'Kalifòni', DC: 'Washington D.C.', FL: 'Florid', GA: 'Jòji', HI: 'Awayi',
    LA: 'Lwizyàn', MA: 'Masachousèt', NM: 'Nouvo Meksik', NY: 'Nouyòk', NC: 'Kawolin dinò',
    ND: 'Dakota dinò', PA: 'Pennsilvani', SC: 'Kawolin disid', SD: 'Dakota disid', TX: 'Teksas',
    VA: 'Vijini', WV: 'Vijini Lwès', PR: 'Pòtoriko', VI: 'Zile Vyèj Ameriken yo', AS: 'Samoa Ameriken',
    MP: 'Zile Mariyàn di Nò',
  },
  zh: {
    AL: '阿拉巴马州', AK: '阿拉斯加州', AZ: '亚利桑那州', AR: '阿肯色州', CA: '加利福尼亚州',
    CO: '科罗拉多州', CT: '康涅狄格州', DE: '特拉华州', DC: '华盛顿特区', FL: '佛罗里达州',
    GA: '佐治亚州', HI: '夏威夷州', ID: '爱达荷州', IL: '伊利诺伊州', IN: '印第安纳州',
    IA: '艾奥瓦州', KS: '堪萨斯州', KY: '肯塔基州', LA: '路易斯安那州', ME: '缅因州',
    MD: '马里兰州', MA: '马萨诸塞州', MI: '密歇根州', MN: '明尼苏达州', MS: '密西西比州',
    MO: '密苏里州', MT: '蒙大拿州', NE: '内布拉斯加州', NV: '内华达州', NH: '新罕布什尔州',
    NJ: '新泽西州', NM: '新墨西哥州', NY: '纽约州', NC: '北卡罗来纳州', ND: '北达科他州',
    OH: '俄亥俄州', OK: '俄克拉何马州', OR: '俄勒冈州', PA: '宾夕法尼亚州', RI: '罗得岛州',
    SC: '南卡罗来纳州', SD: '南达科他州', TN: '田纳西州', TX: '得克萨斯州', UT: '犹他州',
    VT: '佛蒙特州', VA: '弗吉尼亚州', WA: '华盛顿州', WV: '西弗吉尼亚州', WI: '威斯康星州',
    WY: '怀俄明州', PR: '波多黎各', GU: '关岛', VI: '美属维尔京群岛', AS: '美属萨摩亚',
    MP: '北马里亚纳群岛',
  },
  ar: {
    AL: 'ألاباما', AK: 'ألاسكا', AZ: 'أريزونا', AR: 'أركنساس', CA: 'كاليفورنيا',
    CO: 'كولورادو', CT: 'كونيتيكت', DE: 'ديلاوير', DC: 'واشنطن العاصمة', FL: 'فلوريدا',
    GA: 'جورجيا', HI: 'هاواي', ID: 'أيداهو', IL: 'إلينوي', IN: 'إنديانا',
    IA: 'آيوا', KS: 'كانساس', KY: 'كنتاكي', LA: 'لويزيانا', ME: 'مين',
    MD: 'ميريلاند', MA: 'ماساتشوستس', MI: 'ميشيغان', MN: 'مينيسوتا', MS: 'ميسيسيبي',
    MO: 'ميزوري', MT: 'مونتانا', NE: 'نبراسكا', NV: 'نيفادا', NH: 'نيوهامبشير',
    NJ: 'نيوجيرسي', NM: 'نيومكسيكو', NY: 'نيويورك', NC: 'كارولاينا الشمالية', ND: 'داكوتا الشمالية',
    OH: 'أوهايو', OK: 'أوكلاهوما', OR: 'أوريغون', PA: 'بنسلفانيا', RI: 'رود آيلاند',
    SC: 'كارولاينا الجنوبية', SD: 'داكوتا الجنوبية', TN: 'تينيسي', TX: 'تكساس', UT: 'يوتا',
    VT: 'فيرمونت', VA: 'فرجينيا', WA: 'واشنطن', WV: 'فرجينيا الغربية', WI: 'ويسكونسن',
    WY: 'وايومنغ', PR: 'بورتوريكو', VI: 'جزر العذراء الأمريكية', GU: 'غوام', AS: 'ساموا الأمريكية',
    MP: 'جزر ماريانا الشمالية',
  },
  tl: {

  },
};
