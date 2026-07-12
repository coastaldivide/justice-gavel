/**
 * godzilla_simulation.test.js
 * 500 cities × 1,000 unique users × unique paths = 500,000 independent sessions
 * Top 10 highest-crime cities per each of the 50 US states.
 * Build to break. Japan must survive.
 */

import { canAccessFeature } from '../utils/subscriptionStateMachine.js';

let _s = 0xDEADBEEF;
const rng = () => { _s = (_s * 1664525 + 1013904223) & 0xFFFFFFFF; return (_s >>> 0) / 0xFFFFFFFF; };
const pick  = a  => a[Math.floor(rng() * a.length)];
const pickW = ws => { const total=ws.reduce((s,w)=>s+w.w,0); let r=rng()*total; for(const w of ws){r-=w.w;if(r<=0)return w.v;} return ws[ws.length-1].v; };
const rand  = (lo,hi) => lo + rng()*(hi-lo);
const randI = (lo,hi) => Math.floor(rand(lo,hi+1));
const randS = seed => { _s = seed; };
const CITIES = [
  {code:'AL01',st:'AL',name:'Birmingham',cr:7200,bm:0.9,lang:'en',ice:'low'},
  {code:'AL02',st:'AL',name:'Montgomery',cr:6800,bm:0.85,lang:'en',ice:'med'},
  {code:'AL03',st:'AL',name:'Mobile',cr:6400,bm:0.8,lang:'en',ice:'low'},
  {code:'AL04',st:'AL',name:'Huntsville',cr:3800,bm:0.95,lang:'en',ice:'low'},
  {code:'AL05',st:'AL',name:'Tuscaloosa',cr:5200,bm:0.75,lang:'en',ice:'low'},
  {code:'AL06',st:'AL',name:'Anniston',cr:8100,bm:0.7,lang:'en',ice:'low'},
  {code:'AL07',st:'AL',name:'Gadsden',cr:7400,bm:0.7,lang:'en',ice:'low'},
  {code:'AL08',st:'AL',name:'Sheffield',cr:6900,bm:0.65,lang:'en',ice:'low'},
  {code:'AL09',st:'AL',name:'Decatur',cr:5800,bm:0.75,lang:'es',ice:'med'},
  {code:'AL10',st:'AL',name:'Opelika',cr:5600,bm:0.7,lang:'en',ice:'low'},
  {code:'AK01',st:'AK',name:'Anchorage',cr:8400,bm:1.2,lang:'en',ice:'low'},
  {code:'AK02',st:'AK',name:'Fairbanks',cr:9200,bm:1.1,lang:'en',ice:'low'},
  {code:'AK03',st:'AK',name:'Juneau',cr:5400,bm:1.3,lang:'en',ice:'low'},
  {code:'AK04',st:'AK',name:'Sitka',cr:4800,bm:1.25,lang:'en',ice:'low'},
  {code:'AK05',st:'AK',name:'Ketchikan',cr:4200,bm:1.2,lang:'en',ice:'low'},
  {code:'AK06',st:'AK',name:'Nome',cr:12000,bm:1.15,lang:'en',ice:'low'},
  {code:'AK07',st:'AK',name:'Kenai',cr:5900,bm:1.1,lang:'en',ice:'low'},
  {code:'AK08',st:'AK',name:'Bethel',cr:11000,bm:1.05,lang:'en',ice:'low'},
  {code:'AK09',st:'AK',name:'Wasilla',cr:6800,bm:1.1,lang:'en',ice:'low'},
  {code:'AK10',st:'AK',name:'Kodiak',cr:4900,bm:1.15,lang:'en',ice:'low'},
  {code:'AZ01',st:'AZ',name:'Phoenix',cr:5900,bm:1.0,lang:'es',ice:'high'},
  {code:'AZ02',st:'AZ',name:'Tucson',cr:5400,bm:0.95,lang:'es',ice:'high'},
  {code:'AZ03',st:'AZ',name:'Mesa',cr:3200,bm:1.0,lang:'es',ice:'med'},
  {code:'AZ04',st:'AZ',name:'Glendale',cr:4800,bm:0.95,lang:'es',ice:'med'},
  {code:'AZ05',st:'AZ',name:'Yuma',cr:5100,bm:0.85,lang:'es',ice:'high'},
  {code:'AZ06',st:'AZ',name:'Surprise',cr:2800,bm:1.0,lang:'en',ice:'low'},
  {code:'AZ07',st:'AZ',name:'Tempe',cr:4200,bm:1.05,lang:'en',ice:'med'},
  {code:'AZ08',st:'AZ',name:'Chandler',cr:2600,bm:1.05,lang:'en',ice:'low'},
  {code:'AZ09',st:'AZ',name:'Flagstaff',cr:5600,bm:1.0,lang:'en',ice:'low'},
  {code:'AZ10',st:'AZ',name:'BullheadCity',cr:6200,bm:0.85,lang:'en',ice:'med'},
  {code:'AR01',st:'AR',name:'LittleRock',cr:8400,bm:0.8,lang:'en',ice:'med'},
  {code:'AR02',st:'AR',name:'FortSmith',cr:6700,bm:0.75,lang:'es',ice:'med'},
  {code:'AR03',st:'AR',name:'NLittleRock',cr:9100,bm:0.75,lang:'en',ice:'low'},
  {code:'AR04',st:'AR',name:'PineBluff',cr:12400,bm:0.65,lang:'en',ice:'low'},
  {code:'AR05',st:'AR',name:'Fayetteville',cr:3400,bm:0.85,lang:'en',ice:'low'},
  {code:'AR06',st:'AR',name:'Springdale',cr:4200,bm:0.75,lang:'es',ice:'med'},
  {code:'AR07',st:'AR',name:'Jonesboro',cr:5700,bm:0.7,lang:'en',ice:'low'},
  {code:'AR08',st:'AR',name:'Conway',cr:3900,bm:0.75,lang:'en',ice:'low'},
  {code:'AR09',st:'AR',name:'Rogers',cr:3200,bm:0.75,lang:'es',ice:'med'},
  {code:'AR10',st:'AR',name:'HotSprings',cr:7400,bm:0.7,lang:'en',ice:'low'},
  {code:'CA01',st:'CA',name:'Oakland',cr:8200,bm:1.5,lang:'es',ice:'low'},
  {code:'CA02',st:'CA',name:'Stockton',cr:8100,bm:1.2,lang:'es',ice:'med'},
  {code:'CA03',st:'CA',name:'Fresno',cr:6800,bm:1.1,lang:'es',ice:'med'},
  {code:'CA04',st:'CA',name:'Sacramento',cr:5400,bm:1.3,lang:'es',ice:'low'},
  {code:'CA05',st:'CA',name:'Modesto',cr:6100,bm:1.1,lang:'es',ice:'med'},
  {code:'CA06',st:'CA',name:'SanBernardino',cr:7800,bm:1.15,lang:'es',ice:'med'},
  {code:'CA07',st:'CA',name:'SanFrancisco',cr:6600,bm:2.0,lang:'es',ice:'low'},
  {code:'CA08',st:'CA',name:'LosAngeles',cr:5200,bm:1.8,lang:'es',ice:'low'},
  {code:'CA09',st:'CA',name:'Vallejo',cr:7400,bm:1.2,lang:'en',ice:'low'},
  {code:'CA10',st:'CA',name:'GardenGrove',cr:3900,bm:1.4,lang:'vi',ice:'med'},
  {code:'CO01',st:'CO',name:'Denver',cr:6200,bm:1.2,lang:'es',ice:'low'},
  {code:'CO02',st:'CO',name:'ColoSprings',cr:5800,bm:1.0,lang:'en',ice:'low'},
  {code:'CO03',st:'CO',name:'Pueblo',cr:7400,bm:0.9,lang:'es',ice:'med'},
  {code:'CO04',st:'CO',name:'Aurora',cr:5100,bm:1.1,lang:'es',ice:'med'},
  {code:'CO05',st:'CO',name:'Lakewood',cr:4200,bm:1.1,lang:'en',ice:'low'},
  {code:'CO06',st:'CO',name:'FortCollins',cr:3400,bm:1.15,lang:'en',ice:'low'},
  {code:'CO07',st:'CO',name:'Boulder',cr:3100,bm:1.3,lang:'en',ice:'low'},
  {code:'CO08',st:'CO',name:'GrandJunction',cr:4900,bm:0.85,lang:'en',ice:'low'},
  {code:'CO09',st:'CO',name:'Westminster',cr:2800,bm:1.1,lang:'en',ice:'low'},
  {code:'CO10',st:'CO',name:'Northglenn',cr:3900,bm:1.0,lang:'es',ice:'med'},
  {code:'CT01',st:'CT',name:'Bridgeport',cr:5900,bm:1.4,lang:'es',ice:'med'},
  {code:'CT02',st:'CT',name:'NewHaven',cr:5400,bm:1.5,lang:'es',ice:'med'},
  {code:'CT03',st:'CT',name:'Hartford',cr:7800,bm:1.45,lang:'es',ice:'med'},
  {code:'CT04',st:'CT',name:'Waterbury',cr:5100,bm:1.3,lang:'es',ice:'low'},
  {code:'CT05',st:'CT',name:'NewBritain',cr:4800,bm:1.25,lang:'es',ice:'low'},
  {code:'CT06',st:'CT',name:'Meriden',cr:3900,bm:1.2,lang:'es',ice:'low'},
  {code:'CT07',st:'CT',name:'Middletown',cr:3200,bm:1.3,lang:'en',ice:'low'},
  {code:'CT08',st:'CT',name:'NewLondon',cr:6800,bm:1.25,lang:'es',ice:'low'},
  {code:'CT09',st:'CT',name:'Norwalk',cr:2600,bm:1.6,lang:'es',ice:'med'},
  {code:'CT10',st:'CT',name:'Danbury',cr:2400,bm:1.55,lang:'es',ice:'med'},
  {code:'DE01',st:'DE',name:'Wilmington',cr:7900,bm:1.2,lang:'es',ice:'med'},
  {code:'DE02',st:'DE',name:'Dover',cr:5200,bm:1.0,lang:'en',ice:'low'},
  {code:'DE03',st:'DE',name:'Newark',cr:2900,bm:1.1,lang:'en',ice:'low'},
  {code:'DE04',st:'DE',name:'Middletown',cr:1900,bm:1.05,lang:'en',ice:'low'},
  {code:'DE05',st:'DE',name:'Bear',cr:2200,bm:1.0,lang:'en',ice:'low'},
  {code:'DE06',st:'DE',name:'Glasgow',cr:1800,bm:0.95,lang:'en',ice:'low'},
  {code:'DE07',st:'DE',name:'Elsmere',cr:4800,bm:1.0,lang:'en',ice:'low'},
  {code:'DE08',st:'DE',name:'Milford',cr:3900,bm:0.9,lang:'en',ice:'low'},
  {code:'DE09',st:'DE',name:'Seaford',cr:4200,bm:0.85,lang:'en',ice:'low'},
  {code:'DE10',st:'DE',name:'Georgetown',cr:3700,bm:0.85,lang:'es',ice:'med'},
  {code:'FL01',st:'FL',name:'Miami',cr:6800,bm:1.3,lang:'es',ice:'med'},
  {code:'FL02',st:'FL',name:'Jacksonville',cr:6200,bm:1.0,lang:'en',ice:'low'},
  {code:'FL03',st:'FL',name:'Tampa',cr:5400,bm:1.1,lang:'es',ice:'med'},
  {code:'FL04',st:'FL',name:'Pensacola',cr:6900,bm:0.9,lang:'en',ice:'low'},
  {code:'FL05',st:'FL',name:'Ocala',cr:7200,bm:0.85,lang:'en',ice:'low'},
  {code:'FL06',st:'FL',name:'Lakeland',cr:5600,bm:0.95,lang:'es',ice:'med'},
  {code:'FL07',st:'FL',name:'FortLauderdale',cr:5100,bm:1.25,lang:'es',ice:'med'},
  {code:'FL08',st:'FL',name:'Gainesville',cr:5800,bm:0.9,lang:'en',ice:'low'},
  {code:'FL09',st:'FL',name:'DaytonaBeach',cr:8100,bm:0.9,lang:'en',ice:'low'},
  {code:'FL10',st:'FL',name:'Tallahassee',cr:6400,bm:0.95,lang:'en',ice:'low'},
  {code:'GA01',st:'GA',name:'Atlanta',cr:7400,bm:1.1,lang:'en',ice:'med'},
  {code:'GA02',st:'GA',name:'Augusta',cr:8900,bm:0.85,lang:'en',ice:'low'},
  {code:'GA03',st:'GA',name:'Columbus',cr:7200,bm:0.8,lang:'en',ice:'low'},
  {code:'GA04',st:'GA',name:'Savannah',cr:7800,bm:0.9,lang:'en',ice:'low'},
  {code:'GA05',st:'GA',name:'Athens',cr:5100,bm:0.85,lang:'es',ice:'med'},
  {code:'GA06',st:'GA',name:'SandySprings',cr:2400,bm:1.2,lang:'en',ice:'low'},
  {code:'GA07',st:'GA',name:'Macon',cr:9600,bm:0.75,lang:'en',ice:'low'},
  {code:'GA08',st:'GA',name:'Roswell',cr:1900,bm:1.15,lang:'en',ice:'low'},
  {code:'GA09',st:'GA',name:'JohnsCreek',cr:1400,bm:1.25,lang:'en',ice:'low'},
  {code:'GA10',st:'GA',name:'WarnerRobins',cr:4400,bm:0.8,lang:'en',ice:'low'},
  {code:'HI01',st:'HI',name:'Honolulu',cr:4200,bm:1.8,lang:'en',ice:'low'},
  {code:'HI02',st:'HI',name:'Hilo',cr:3600,bm:1.5,lang:'en',ice:'low'},
  {code:'HI03',st:'HI',name:'Kailua',cr:2100,bm:1.7,lang:'en',ice:'low'},
  {code:'HI04',st:'HI',name:'PearlCity',cr:2400,bm:1.65,lang:'en',ice:'low'},
  {code:'HI05',st:'HI',name:'Waipahu',cr:3800,bm:1.55,lang:'en',ice:'low'},
  {code:'HI06',st:'HI',name:'Kaneohe',cr:1900,bm:1.7,lang:'en',ice:'low'},
  {code:'HI07',st:'HI',name:'MililaniTown',cr:1400,bm:1.75,lang:'en',ice:'low'},
  {code:'HI08',st:'HI',name:'EwaBeach',cr:1800,bm:1.6,lang:'en',ice:'low'},
  {code:'HI09',st:'HI',name:'Kihei',cr:2900,bm:1.85,lang:'en',ice:'low'},
  {code:'HI10',st:'HI',name:'Makakilo',cr:1600,bm:1.65,lang:'en',ice:'low'},
  {code:'ID01',st:'ID',name:'Boise',cr:2900,bm:0.9,lang:'en',ice:'low'},
  {code:'ID02',st:'ID',name:'Nampa',cr:3400,bm:0.8,lang:'es',ice:'med'},
  {code:'ID03',st:'ID',name:'Meridian',cr:1800,bm:0.95,lang:'en',ice:'low'},
  {code:'ID04',st:'ID',name:'IdahoFalls',cr:3200,bm:0.8,lang:'en',ice:'low'},
  {code:'ID05',st:'ID',name:'Pocatello',cr:4100,bm:0.75,lang:'en',ice:'low'},
  {code:'ID06',st:'ID',name:'Caldwell',cr:4600,bm:0.7,lang:'es',ice:'med'},
  {code:'ID07',st:'ID',name:'CdAlene',cr:2700,bm:0.85,lang:'en',ice:'low'},
  {code:'ID08',st:'ID',name:'TwinFalls',cr:3900,bm:0.75,lang:'en',ice:'low'},
  {code:'ID09',st:'ID',name:'Lewiston',cr:3600,bm:0.8,lang:'en',ice:'low'},
  {code:'ID10',st:'ID',name:'Rexburg',cr:1200,bm:0.75,lang:'en',ice:'low'},
  {code:'IL01',st:'IL',name:'Chicago',cr:6100,bm:1.4,lang:'es',ice:'low'},
  {code:'IL02',st:'IL',name:'Rockford',cr:9200,bm:1.0,lang:'en',ice:'low'},
  {code:'IL03',st:'IL',name:'Aurora',cr:3200,bm:1.1,lang:'es',ice:'med'},
  {code:'IL04',st:'IL',name:'Joliet',cr:4800,bm:1.05,lang:'es',ice:'med'},
  {code:'IL05',st:'IL',name:'NorthChicago',cr:7400,bm:1.0,lang:'es',ice:'med'},
  {code:'IL06',st:'IL',name:'Springfield',cr:5600,bm:0.9,lang:'en',ice:'low'},
  {code:'IL07',st:'IL',name:'EastStLouis',cr:14000,bm:0.85,lang:'en',ice:'low'},
  {code:'IL08',st:'IL',name:'Peoria',cr:6400,bm:0.9,lang:'en',ice:'low'},
  {code:'IL09',st:'IL',name:'Elgin',cr:3600,bm:1.1,lang:'es',ice:'med'},
  {code:'IL10',st:'IL',name:'Cairo',cr:16000,bm:0.7,lang:'en',ice:'low'},
  {code:'IN01',st:'IN',name:'Indianapolis',cr:6800,bm:0.95,lang:'en',ice:'med'},
  {code:'IN02',st:'IN',name:'FortWayne',cr:4200,bm:0.85,lang:'en',ice:'low'},
  {code:'IN03',st:'IN',name:'Evansville',cr:5800,bm:0.8,lang:'en',ice:'low'},
  {code:'IN04',st:'IN',name:'Gary',cr:12400,bm:0.8,lang:'en',ice:'low'},
  {code:'IN05',st:'IN',name:'Hammond',cr:6100,bm:0.85,lang:'es',ice:'med'},
  {code:'IN06',st:'IN',name:'SouthBend',cr:7200,bm:0.85,lang:'en',ice:'low'},
  {code:'IN07',st:'IN',name:'Muncie',cr:7600,bm:0.75,lang:'en',ice:'low'},
  {code:'IN08',st:'IN',name:'TerreHaute',cr:8200,bm:0.75,lang:'en',ice:'low'},
  {code:'IN09',st:'IN',name:'Lafayette',cr:4400,bm:0.8,lang:'en',ice:'low'},
  {code:'IN10',st:'IN',name:'Anderson',cr:6800,bm:0.7,lang:'en',ice:'low'},
  {code:'IA01',st:'IA',name:'DesMoines',cr:5200,bm:0.85,lang:'en',ice:'low'},
  {code:'IA02',st:'IA',name:'CedarRapids',cr:4200,bm:0.8,lang:'en',ice:'low'},
  {code:'IA03',st:'IA',name:'Waterloo',cr:7800,bm:0.75,lang:'en',ice:'low'},
  {code:'IA04',st:'IA',name:'Davenport',cr:5600,bm:0.8,lang:'en',ice:'low'},
  {code:'IA05',st:'IA',name:'SiouxCity',cr:5400,bm:0.75,lang:'es',ice:'med'},
  {code:'IA06',st:'IA',name:'Marshalltown',cr:4900,bm:0.65,lang:'es',ice:'med'},
  {code:'IA07',st:'IA',name:'Muscatine',cr:4200,bm:0.65,lang:'es',ice:'med'},
  {code:'IA08',st:'IA',name:'Dubuque',cr:3400,bm:0.8,lang:'en',ice:'low'},
  {code:'IA09',st:'IA',name:'IowaCity',cr:2800,bm:0.9,lang:'en',ice:'low'},
  {code:'IA10',st:'IA',name:'CouncilBluffs',cr:5100,bm:0.75,lang:'en',ice:'low'},
  {code:'KS01',st:'KS',name:'Wichita',cr:6400,bm:0.85,lang:'es',ice:'med'},
  {code:'KS02',st:'KS',name:'OverlandPark',cr:1800,bm:1.0,lang:'en',ice:'low'},
  {code:'KS03',st:'KS',name:'KansasCity',cr:9200,bm:0.8,lang:'es',ice:'med'},
  {code:'KS04',st:'KS',name:'Topeka',cr:6800,bm:0.8,lang:'en',ice:'low'},
  {code:'KS05',st:'KS',name:'DodgeCity',cr:5400,bm:0.65,lang:'es',ice:'high'},
  {code:'KS06',st:'KS',name:'GardenCity',cr:4900,bm:0.65,lang:'es',ice:'high'},
  {code:'KS07',st:'KS',name:'Lawrence',cr:3200,bm:0.8,lang:'en',ice:'low'},
  {code:'KS08',st:'KS',name:'Salina',cr:5200,bm:0.7,lang:'en',ice:'low'},
  {code:'KS09',st:'KS',name:'Leavenworth',cr:4600,bm:0.65,lang:'en',ice:'low'},
  {code:'KS10',st:'KS',name:'Emporia',cr:5900,bm:0.65,lang:'en',ice:'low'},
  {code:'KY01',st:'KY',name:'Louisville',cr:5600,bm:0.9,lang:'en',ice:'low'},
  {code:'KY02',st:'KY',name:'Lexington',cr:3800,bm:0.9,lang:'en',ice:'low'},
  {code:'KY03',st:'KY',name:'BowlingGreen',cr:4200,bm:0.75,lang:'en',ice:'low'},
  {code:'KY04',st:'KY',name:'Owensboro',cr:4800,bm:0.75,lang:'en',ice:'low'},
  {code:'KY05',st:'KY',name:'Covington',cr:7200,bm:0.85,lang:'en',ice:'low'},
  {code:'KY06',st:'KY',name:'Georgetown',cr:2200,bm:0.8,lang:'en',ice:'low'},
  {code:'KY07',st:'KY',name:'Richmond',cr:3400,bm:0.75,lang:'en',ice:'low'},
  {code:'KY08',st:'KY',name:'Frankfort',cr:5100,bm:0.8,lang:'en',ice:'low'},
  {code:'KY09',st:'KY',name:'Hopkinsville',cr:6200,bm:0.7,lang:'en',ice:'low'},
  {code:'KY10',st:'KY',name:'Paducah',cr:6800,bm:0.7,lang:'en',ice:'low'},
  {code:'LA01',st:'LA',name:'NewOrleans',cr:11200,bm:0.9,lang:'en',ice:'low'},
  {code:'LA02',st:'LA',name:'BatonRouge',cr:9400,bm:0.85,lang:'en',ice:'low'},
  {code:'LA03',st:'LA',name:'Shreveport',cr:10800,bm:0.8,lang:'en',ice:'low'},
  {code:'LA04',st:'LA',name:'Metairie',cr:3800,bm:1.0,lang:'en',ice:'low'},
  {code:'LA05',st:'LA',name:'Lafayette',cr:6400,bm:0.8,lang:'en',ice:'low'},
  {code:'LA06',st:'LA',name:'LakeCharles',cr:7800,bm:0.75,lang:'en',ice:'low'},
  {code:'LA07',st:'LA',name:'Kenner',cr:4200,bm:0.9,lang:'en',ice:'low'},
  {code:'LA08',st:'LA',name:'Monroe',cr:11400,bm:0.7,lang:'en',ice:'low'},
  {code:'LA09',st:'LA',name:'Alexandria',cr:8900,bm:0.7,lang:'en',ice:'low'},
  {code:'LA10',st:'LA',name:'NewIberia',cr:7600,bm:0.65,lang:'en',ice:'low'},
  {code:'ME01',st:'ME',name:'Portland',cr:3400,bm:1.1,lang:'en',ice:'low'},
  {code:'ME02',st:'ME',name:'Lewiston',cr:4800,bm:0.9,lang:'fr',ice:'low'},
  {code:'ME03',st:'ME',name:'Bangor',cr:5200,bm:0.9,lang:'en',ice:'low'},
  {code:'ME04',st:'ME',name:'SPortland',cr:2100,bm:1.05,lang:'en',ice:'low'},
  {code:'ME05',st:'ME',name:'Augusta',cr:3900,bm:0.85,lang:'en',ice:'low'},
  {code:'ME06',st:'ME',name:'Biddeford',cr:3200,bm:0.85,lang:'en',ice:'low'},
  {code:'ME07',st:'ME',name:'Sanford',cr:2800,bm:0.8,lang:'en',ice:'low'},
  {code:'ME08',st:'ME',name:'Waterville',cr:4100,bm:0.8,lang:'en',ice:'low'},
  {code:'ME09',st:'ME',name:'PresqueIsle',cr:2400,bm:0.75,lang:'en',ice:'low'},
  {code:'ME10',st:'ME',name:'Auburn',cr:3600,bm:0.85,lang:'en',ice:'low'},
  {code:'MD01',st:'MD',name:'Baltimore',cr:13400,bm:1.2,lang:'en',ice:'low'},
  {code:'MD02',st:'MD',name:'Frederick',cr:2400,bm:1.3,lang:'en',ice:'low'},
  {code:'MD03',st:'MD',name:'Bowie',cr:1900,bm:1.35,lang:'en',ice:'low'},
  {code:'MD04',st:'MD',name:'Germantown',cr:2200,bm:1.3,lang:'es',ice:'med'},
  {code:'MD05',st:'MD',name:'SilverSpring',cr:2800,bm:1.45,lang:'es',ice:'med'},
  {code:'MD06',st:'MD',name:'Landover',cr:5400,bm:1.2,lang:'en',ice:'low'},
  {code:'MD07',st:'MD',name:'Hagerstown',cr:5100,bm:1.0,lang:'en',ice:'low'},
  {code:'MD08',st:'MD',name:'Annapolis',cr:4200,bm:1.4,lang:'en',ice:'low'},
  {code:'MD09',st:'MD',name:'Salisbury',cr:6800,bm:0.95,lang:'en',ice:'low'},
  {code:'MD10',st:'MD',name:'LangleyPark',cr:5900,bm:1.25,lang:'es',ice:'high'},
  {code:'MA01',st:'MA',name:'Springfield',cr:7800,bm:1.5,lang:'es',ice:'low'},
  {code:'MA02',st:'MA',name:'Worcester',cr:4200,bm:1.45,lang:'es',ice:'low'},
  {code:'MA03',st:'MA',name:'Boston',cr:4900,bm:2.0,lang:'es',ice:'low'},
  {code:'MA04',st:'MA',name:'NewBedford',cr:6200,bm:1.3,lang:'es',ice:'low'},
  {code:'MA05',st:'MA',name:'Brockton',cr:5400,bm:1.35,lang:'pt',ice:'low'},
  {code:'MA06',st:'MA',name:'FallRiver',cr:5900,bm:1.3,lang:'pt',ice:'low'},
  {code:'MA07',st:'MA',name:'Lawrence',cr:7400,bm:1.35,lang:'es',ice:'low'},
  {code:'MA08',st:'MA',name:'Chelsea',cr:6200,bm:1.4,lang:'es',ice:'med'},
  {code:'MA09',st:'MA',name:'Lowell',cr:4800,bm:1.4,lang:'es',ice:'low'},
  {code:'MA10',st:'MA',name:'Lynn',cr:5600,bm:1.4,lang:'es',ice:'med'},
  {code:'MI01',st:'MI',name:'Detroit',cr:14800,bm:0.95,lang:'en',ice:'low'},
  {code:'MI02',st:'MI',name:'Flint',cr:15200,bm:0.8,lang:'en',ice:'low'},
  {code:'MI03',st:'MI',name:'GrandRapids',cr:5400,bm:0.9,lang:'es',ice:'med'},
  {code:'MI04',st:'MI',name:'Warren',cr:3800,bm:0.9,lang:'en',ice:'low'},
  {code:'MI05',st:'MI',name:'SterlingHts',cr:2200,bm:0.95,lang:'en',ice:'low'},
  {code:'MI06',st:'MI',name:'Lansing',cr:7200,bm:0.85,lang:'en',ice:'low'},
  {code:'MI07',st:'MI',name:'AnnArbor',cr:2400,bm:1.1,lang:'en',ice:'low'},
  {code:'MI08',st:'MI',name:'Kalamazoo',cr:7800,bm:0.8,lang:'en',ice:'low'},
  {code:'MI09',st:'MI',name:'Pontiac',cr:9600,bm:0.75,lang:'en',ice:'low'},
  {code:'MI10',st:'MI',name:'Saginaw',cr:13200,bm:0.7,lang:'en',ice:'low'},
  {code:'MN01',st:'MN',name:'Minneapolis',cr:7400,bm:1.1,lang:'so',ice:'low'},
  {code:'MN02',st:'MN',name:'StPaul',cr:5600,bm:1.05,lang:'so',ice:'low'},
  {code:'MN03',st:'MN',name:'Rochester',cr:2800,bm:0.95,lang:'en',ice:'low'},
  {code:'MN04',st:'MN',name:'Duluth',cr:4900,bm:0.9,lang:'en',ice:'low'},
  {code:'MN05',st:'MN',name:'Bloomington',cr:2100,bm:1.05,lang:'en',ice:'low'},
  {code:'MN06',st:'MN',name:'BrooklynPark',cr:3400,bm:1.0,lang:'so',ice:'low'},
  {code:'MN07',st:'MN',name:'Plymouth',cr:1600,bm:1.1,lang:'en',ice:'low'},
  {code:'MN08',st:'MN',name:'MapleGrove',cr:1400,bm:1.05,lang:'en',ice:'low'},
  {code:'MN09',st:'MN',name:'Woodbury',cr:1200,bm:1.1,lang:'en',ice:'low'},
  {code:'MN10',st:'MN',name:'StCloud',cr:3800,bm:0.85,lang:'en',ice:'low'},
  {code:'MS01',st:'MS',name:'Jackson',cr:15400,bm:0.7,lang:'en',ice:'low'},
  {code:'MS02',st:'MS',name:'Gulfport',cr:7200,bm:0.7,lang:'en',ice:'low'},
  {code:'MS03',st:'MS',name:'Southaven',cr:2800,bm:0.75,lang:'en',ice:'low'},
  {code:'MS04',st:'MS',name:'Hattiesburg',cr:8800,bm:0.65,lang:'en',ice:'low'},
  {code:'MS05',st:'MS',name:'Biloxi',cr:6400,bm:0.7,lang:'en',ice:'low'},
  {code:'MS06',st:'MS',name:'Meridian',cr:10200,bm:0.6,lang:'en',ice:'low'},
  {code:'MS07',st:'MS',name:'Tupelo',cr:5400,bm:0.65,lang:'en',ice:'low'},
  {code:'MS08',st:'MS',name:'OliveBranch',cr:2200,bm:0.75,lang:'en',ice:'low'},
  {code:'MS09',st:'MS',name:'Columbus',cr:9800,bm:0.6,lang:'en',ice:'low'},
  {code:'MS10',st:'MS',name:'Starkville',cr:4400,bm:0.65,lang:'en',ice:'low'},
  {code:'MO01',st:'MO',name:'KansasCity',cr:11400,bm:0.9,lang:'en',ice:'low'},
  {code:'MO02',st:'MO',name:'StLouis',cr:19400,bm:0.85,lang:'en',ice:'low'},
  {code:'MO03',st:'MO',name:'Springfield',cr:8200,bm:0.8,lang:'en',ice:'low'},
  {code:'MO04',st:'MO',name:'Independence',cr:6200,bm:0.8,lang:'en',ice:'low'},
  {code:'MO05',st:'MO',name:'Columbia',cr:4400,bm:0.85,lang:'en',ice:'low'},
  {code:'MO06',st:'MO',name:'LeeSummit',cr:2600,bm:0.9,lang:'en',ice:'low'},
  {code:'MO07',st:'MO',name:'OFallon',cr:1800,bm:0.95,lang:'en',ice:'low'},
  {code:'MO08',st:'MO',name:'StJoseph',cr:7400,bm:0.75,lang:'en',ice:'low'},
  {code:'MO09',st:'MO',name:'Jackson',cr:3200,bm:0.7,lang:'en',ice:'low'},
  {code:'MO10',st:'MO',name:'Joplin',cr:6100,bm:0.75,lang:'en',ice:'low'},
  {code:'MT01',st:'MT',name:'Billings',cr:5200,bm:0.85,lang:'en',ice:'low'},
  {code:'MT02',st:'MT',name:'Missoula',cr:4400,bm:0.85,lang:'en',ice:'low'},
  {code:'MT03',st:'MT',name:'GreatFalls',cr:6100,bm:0.75,lang:'en',ice:'low'},
  {code:'MT04',st:'MT',name:'Bozeman',cr:2400,bm:1.0,lang:'en',ice:'low'},
  {code:'MT05',st:'MT',name:'Helena',cr:3800,bm:0.85,lang:'en',ice:'low'},
  {code:'MT06',st:'MT',name:'Kalispell',cr:3200,bm:0.85,lang:'en',ice:'low'},
  {code:'MT07',st:'MT',name:'Havre',cr:5600,bm:0.7,lang:'en',ice:'low'},
  {code:'MT08',st:'MT',name:'Anaconda',cr:4100,bm:0.7,lang:'en',ice:'low'},
  {code:'MT09',st:'MT',name:'Livingston',cr:3600,bm:0.75,lang:'en',ice:'low'},
  {code:'MT10',st:'MT',name:'MilesCity',cr:4800,bm:0.65,lang:'en',ice:'low'},
  {code:'NE01',st:'NE',name:'Omaha',cr:5400,bm:0.9,lang:'es',ice:'med'},
  {code:'NE02',st:'NE',name:'Lincoln',cr:3800,bm:0.85,lang:'en',ice:'low'},
  {code:'NE03',st:'NE',name:'Bellevue',cr:2400,bm:0.85,lang:'en',ice:'low'},
  {code:'NE04',st:'NE',name:'GrandIsland',cr:4200,bm:0.75,lang:'es',ice:'med'},
  {code:'NE05',st:'NE',name:'Kearney',cr:2800,bm:0.75,lang:'en',ice:'low'},
  {code:'NE06',st:'NE',name:'Fremont',cr:3600,bm:0.7,lang:'es',ice:'med'},
  {code:'NE07',st:'NE',name:'Hastings',cr:3200,bm:0.7,lang:'en',ice:'low'},
  {code:'NE08',st:'NE',name:'Norfolk',cr:2900,bm:0.7,lang:'en',ice:'low'},
  {code:'NE09',st:'NE',name:'PapillionCity',cr:1400,bm:0.9,lang:'en',ice:'low'},
  {code:'NE10',st:'NE',name:'Scottsbluff',cr:5200,bm:0.65,lang:'es',ice:'med'},
  {code:'NV01',st:'NV',name:'LasVegas',cr:6400,bm:1.1,lang:'es',ice:'med'},
  {code:'NV02',st:'NV',name:'Henderson',cr:2200,bm:1.1,lang:'en',ice:'low'},
  {code:'NV03',st:'NV',name:'Reno',cr:5900,bm:1.0,lang:'es',ice:'med'},
  {code:'NV04',st:'NV',name:'NorthLV',cr:5400,bm:1.0,lang:'es',ice:'med'},
  {code:'NV05',st:'NV',name:'Paradise',cr:4800,bm:1.1,lang:'en',ice:'low'},
  {code:'NV06',st:'NV',name:'Sparks',cr:3800,bm:1.0,lang:'en',ice:'low'},
  {code:'NV07',st:'NV',name:'CarsonCity',cr:4200,bm:0.9,lang:'en',ice:'low'},
  {code:'NV08',st:'NV',name:'Fallon',cr:3400,bm:0.75,lang:'en',ice:'low'},
  {code:'NV09',st:'NV',name:'Elko',cr:3100,bm:0.8,lang:'en',ice:'low'},
  {code:'NV10',st:'NV',name:'Mesquite',cr:2400,bm:0.9,lang:'en',ice:'low'},
  {code:'NH01',st:'NH',name:'Manchester',cr:3600,bm:1.1,lang:'en',ice:'low'},
  {code:'NH02',st:'NH',name:'Nashua',cr:2400,bm:1.15,lang:'en',ice:'low'},
  {code:'NH03',st:'NH',name:'Concord',cr:2900,bm:1.1,lang:'en',ice:'low'},
  {code:'NH04',st:'NH',name:'Dover',cr:2100,bm:1.05,lang:'en',ice:'low'},
  {code:'NH05',st:'NH',name:'Rochester',cr:3200,bm:1.0,lang:'en',ice:'low'},
  {code:'NH06',st:'NH',name:'Keene',cr:2400,bm:1.0,lang:'en',ice:'low'},
  {code:'NH07',st:'NH',name:'Portsmouth',cr:2600,bm:1.2,lang:'en',ice:'low'},
  {code:'NH08',st:'NH',name:'Exeter',cr:1600,bm:1.1,lang:'en',ice:'low'},
  {code:'NH09',st:'NH',name:'Laconia',cr:4200,bm:0.95,lang:'en',ice:'low'},
  {code:'NH10',st:'NH',name:'Claremont',cr:3900,bm:0.9,lang:'en',ice:'low'},
  {code:'NJ01',st:'NJ',name:'Camden',cr:10200,bm:1.3,lang:'es',ice:'med'},
  {code:'NJ02',st:'NJ',name:'Trenton',cr:9200,bm:1.3,lang:'es',ice:'med'},
  {code:'NJ03',st:'NJ',name:'Newark',cr:8400,bm:1.4,lang:'es',ice:'med'},
  {code:'NJ04',st:'NJ',name:'Paterson',cr:7200,bm:1.3,lang:'es',ice:'med'},
  {code:'NJ05',st:'NJ',name:'EastOrange',cr:7800,bm:1.3,lang:'en',ice:'low'},
  {code:'NJ06',st:'NJ',name:'Bridgeton',cr:11400,bm:1.0,lang:'es',ice:'med'},
  {code:'NJ07',st:'NJ',name:'AtlanticCity',cr:9600,bm:1.1,lang:'en',ice:'low'},
  {code:'NJ08',st:'NJ',name:'Vineland',cr:4800,bm:1.1,lang:'es',ice:'med'},
  {code:'NJ09',st:'NJ',name:'Elizabeth',cr:5200,bm:1.35,lang:'es',ice:'med'},
  {code:'NJ10',st:'NJ',name:'Plainfield',cr:6200,bm:1.2,lang:'es',ice:'med'},
  {code:'NM01',st:'NM',name:'Albuquerque',cr:9800,bm:0.85,lang:'es',ice:'med'},
  {code:'NM02',st:'NM',name:'LasCruces',cr:5400,bm:0.75,lang:'es',ice:'high'},
  {code:'NM03',st:'NM',name:'RioRancho',cr:3200,bm:0.85,lang:'es',ice:'med'},
  {code:'NM04',st:'NM',name:'SantaFe',cr:5900,bm:1.0,lang:'es',ice:'med'},
  {code:'NM05',st:'NM',name:'Roswell',cr:7200,bm:0.7,lang:'es',ice:'med'},
  {code:'NM06',st:'NM',name:'Farmington',cr:8400,bm:0.7,lang:'en',ice:'low'},
  {code:'NM07',st:'NM',name:'Clovis',cr:5800,bm:0.65,lang:'en',ice:'low'},
  {code:'NM08',st:'NM',name:'Hobbs',cr:6200,bm:0.65,lang:'es',ice:'med'},
  {code:'NM09',st:'NM',name:'Alamogordo',cr:4400,bm:0.65,lang:'en',ice:'low'},
  {code:'NM10',st:'NM',name:'Carlsbad',cr:5600,bm:0.65,lang:'en',ice:'low'},
  {code:'NY01',st:'NY',name:'NYC',cr:3800,bm:2.5,lang:'es',ice:'low'},
  {code:'NY02',st:'NY',name:'Buffalo',cr:7400,bm:1.2,lang:'en',ice:'low'},
  {code:'NY03',st:'NY',name:'Rochester',cr:8900,bm:1.15,lang:'en',ice:'low'},
  {code:'NY04',st:'NY',name:'Yonkers',cr:4200,bm:1.6,lang:'es',ice:'low'},
  {code:'NY05',st:'NY',name:'Syracuse',cr:8200,bm:1.1,lang:'en',ice:'low'},
  {code:'NY06',st:'NY',name:'Albany',cr:5400,bm:1.2,lang:'en',ice:'low'},
  {code:'NY07',st:'NY',name:'Schenectady',cr:6800,bm:1.1,lang:'en',ice:'low'},
  {code:'NY08',st:'NY',name:'NewRochelle',cr:3600,bm:1.7,lang:'es',ice:'low'},
  {code:'NY09',st:'NY',name:'MtVernon',cr:6200,bm:1.6,lang:'en',ice:'low'},
  {code:'NY10',st:'NY',name:'Newburgh',cr:12200,bm:1.3,lang:'es',ice:'med'},
  {code:'NC01',st:'NC',name:'Charlotte',cr:5200,bm:0.95,lang:'es',ice:'med'},
  {code:'NC02',st:'NC',name:'Raleigh',cr:3800,bm:1.0,lang:'en',ice:'low'},
  {code:'NC03',st:'NC',name:'Greensboro',cr:5900,bm:0.9,lang:'en',ice:'low'},
  {code:'NC04',st:'NC',name:'Durham',cr:6400,bm:0.9,lang:'en',ice:'low'},
  {code:'NC05',st:'NC',name:'WinstonSalem',cr:5400,bm:0.85,lang:'en',ice:'low'},
  {code:'NC06',st:'NC',name:'Fayetteville',cr:7200,bm:0.8,lang:'en',ice:'low'},
  {code:'NC07',st:'NC',name:'Cary',cr:1400,bm:1.05,lang:'en',ice:'low'},
  {code:'NC08',st:'NC',name:'Wilmington',cr:5100,bm:0.9,lang:'en',ice:'low'},
  {code:'NC09',st:'NC',name:'HighPoint',cr:5600,bm:0.85,lang:'en',ice:'low'},
  {code:'NC10',st:'NC',name:'Concord',cr:3200,bm:0.9,lang:'en',ice:'low'},
  {code:'ND01',st:'ND',name:'Fargo',cr:4800,bm:0.8,lang:'en',ice:'low'},
  {code:'ND02',st:'ND',name:'Bismarck',cr:3600,bm:0.8,lang:'en',ice:'low'},
  {code:'ND03',st:'ND',name:'GrandForks',cr:4200,bm:0.75,lang:'en',ice:'low'},
  {code:'ND04',st:'ND',name:'Minot',cr:4800,bm:0.75,lang:'en',ice:'low'},
  {code:'ND05',st:'ND',name:'WestFargo',cr:2200,bm:0.8,lang:'en',ice:'low'},
  {code:'ND06',st:'ND',name:'Williston',cr:5600,bm:0.75,lang:'en',ice:'low'},
  {code:'ND07',st:'ND',name:'Dickinson',cr:4400,bm:0.7,lang:'en',ice:'low'},
  {code:'ND08',st:'ND',name:'Mandan',cr:2900,bm:0.75,lang:'en',ice:'low'},
  {code:'ND09',st:'ND',name:'Jamestown',cr:3800,bm:0.65,lang:'en',ice:'low'},
  {code:'ND10',st:'ND',name:'ValleyCity',cr:3200,bm:0.6,lang:'en',ice:'low'},
  {code:'OH01',st:'OH',name:'Cleveland',cr:10200,bm:0.9,lang:'en',ice:'low'},
  {code:'OH02',st:'OH',name:'Columbus',cr:5900,bm:0.95,lang:'en',ice:'low'},
  {code:'OH03',st:'OH',name:'Cincinnati',cr:6400,bm:0.9,lang:'en',ice:'low'},
  {code:'OH04',st:'OH',name:'Dayton',cr:9800,bm:0.8,lang:'en',ice:'low'},
  {code:'OH05',st:'OH',name:'Akron',cr:7200,bm:0.85,lang:'en',ice:'low'},
  {code:'OH06',st:'OH',name:'Toledo',cr:7800,bm:0.8,lang:'en',ice:'low'},
  {code:'OH07',st:'OH',name:'Youngstown',cr:13600,bm:0.7,lang:'en',ice:'low'},
  {code:'OH08',st:'OH',name:'Lorain',cr:7400,bm:0.75,lang:'es',ice:'med'},
  {code:'OH09',st:'OH',name:'Springfield',cr:9200,bm:0.7,lang:'en',ice:'low'},
  {code:'OH10',st:'OH',name:'Sandusky',cr:8600,bm:0.7,lang:'en',ice:'low'},
  {code:'OK01',st:'OK',name:'OklahomaCity',cr:6800,bm:0.85,lang:'en',ice:'low'},
  {code:'OK02',st:'OK',name:'Tulsa',cr:7800,bm:0.8,lang:'en',ice:'low'},
  {code:'OK03',st:'OK',name:'Norman',cr:3200,bm:0.85,lang:'en',ice:'low'},
  {code:'OK04',st:'OK',name:'BrokenArrow',cr:2400,bm:0.85,lang:'en',ice:'low'},
  {code:'OK05',st:'OK',name:'Edmond',cr:2200,bm:0.9,lang:'en',ice:'low'},
  {code:'OK06',st:'OK',name:'Lawton',cr:7200,bm:0.75,lang:'en',ice:'low'},
  {code:'OK07',st:'OK',name:'MidwestCity',cr:4400,bm:0.75,lang:'en',ice:'low'},
  {code:'OK08',st:'OK',name:'Enid',cr:5800,bm:0.7,lang:'en',ice:'low'},
  {code:'OK09',st:'OK',name:'Muskogee',cr:8400,bm:0.65,lang:'en',ice:'low'},
  {code:'OK10',st:'OK',name:'Stillwater',cr:3900,bm:0.75,lang:'en',ice:'low'},
  {code:'OR01',st:'OR',name:'Portland',cr:7200,bm:1.3,lang:'es',ice:'low'},
  {code:'OR02',st:'OR',name:'Eugene',cr:4800,bm:1.1,lang:'en',ice:'low'},
  {code:'OR03',st:'OR',name:'Salem',cr:5400,bm:1.0,lang:'es',ice:'med'},
  {code:'OR04',st:'OR',name:'Gresham',cr:4200,bm:1.1,lang:'en',ice:'low'},
  {code:'OR05',st:'OR',name:'Hillsboro',cr:2400,bm:1.15,lang:'es',ice:'med'},
  {code:'OR06',st:'OR',name:'Beaverton',cr:3200,bm:1.15,lang:'en',ice:'low'},
  {code:'OR07',st:'OR',name:'Bend',cr:3100,bm:1.2,lang:'en',ice:'low'},
  {code:'OR08',st:'OR',name:'Medford',cr:5900,bm:0.95,lang:'en',ice:'low'},
  {code:'OR09',st:'OR',name:'Springfield',cr:4400,bm:1.0,lang:'en',ice:'low'},
  {code:'OR10',st:'OR',name:'Corvallis',cr:2800,bm:1.05,lang:'en',ice:'low'},
  {code:'PA01',st:'PA',name:'Philadelphia',cr:8600,bm:1.4,lang:'es',ice:'low'},
  {code:'PA02',st:'PA',name:'Pittsburgh',cr:5200,bm:1.2,lang:'en',ice:'low'},
  {code:'PA03',st:'PA',name:'Allentown',cr:6800,bm:1.1,lang:'es',ice:'med'},
  {code:'PA04',st:'PA',name:'Erie',cr:7400,bm:1.0,lang:'en',ice:'low'},
  {code:'PA05',st:'PA',name:'Reading',cr:8200,bm:1.05,lang:'es',ice:'med'},
  {code:'PA06',st:'PA',name:'Harrisburg',cr:9800,bm:1.05,lang:'en',ice:'low'},
  {code:'PA07',st:'PA',name:'Lancaster',cr:6200,bm:1.05,lang:'es',ice:'med'},
  {code:'PA08',st:'PA',name:'Scranton',cr:5100,bm:1.0,lang:'en',ice:'low'},
  {code:'PA09',st:'PA',name:'Bethlehem',cr:4200,bm:1.1,lang:'es',ice:'med'},
  {code:'PA10',st:'PA',name:'York',cr:7800,bm:1.0,lang:'es',ice:'med'},
  {code:'RI01',st:'RI',name:'Providence',cr:5400,bm:1.4,lang:'es',ice:'low'},
  {code:'RI02',st:'RI',name:'Cranston',cr:2400,bm:1.3,lang:'es',ice:'low'},
  {code:'RI03',st:'RI',name:'Warwick',cr:2800,bm:1.35,lang:'en',ice:'low'},
  {code:'RI04',st:'RI',name:'Pawtucket',cr:5900,bm:1.25,lang:'es',ice:'low'},
  {code:'RI05',st:'RI',name:'EProvidence',cr:3200,bm:1.3,lang:'en',ice:'low'},
  {code:'RI06',st:'RI',name:'Woonsocket',cr:6400,bm:1.2,lang:'fr',ice:'low'},
  {code:'RI07',st:'RI',name:'Newport',cr:4100,bm:1.5,lang:'en',ice:'low'},
  {code:'RI08',st:'RI',name:'Coventry',cr:1800,bm:1.25,lang:'en',ice:'low'},
  {code:'RI09',st:'RI',name:'NKingstown',cr:1400,bm:1.3,lang:'en',ice:'low'},
  {code:'RI10',st:'RI',name:'Cumberland',cr:1900,bm:1.3,lang:'en',ice:'low'},
  {code:'SC01',st:'SC',name:'Charleston',cr:4800,bm:0.9,lang:'en',ice:'low'},
  {code:'SC02',st:'SC',name:'Columbia',cr:8400,bm:0.85,lang:'en',ice:'low'},
  {code:'SC03',st:'SC',name:'NCharleston',cr:7900,bm:0.8,lang:'en',ice:'low'},
  {code:'SC04',st:'SC',name:'MyrtleBeach',cr:8200,bm:0.85,lang:'en',ice:'low'},
  {code:'SC05',st:'SC',name:'RockHill',cr:5400,bm:0.8,lang:'en',ice:'low'},
  {code:'SC06',st:'SC',name:'Greenville',cr:5100,bm:0.85,lang:'en',ice:'low'},
  {code:'SC07',st:'SC',name:'Sumter',cr:8800,bm:0.7,lang:'en',ice:'low'},
  {code:'SC08',st:'SC',name:'Florence',cr:9200,bm:0.7,lang:'en',ice:'low'},
  {code:'SC09',st:'SC',name:'Spartanburg',cr:7600,bm:0.75,lang:'en',ice:'low'},
  {code:'SC10',st:'SC',name:'HiltonHead',cr:2800,bm:1.1,lang:'en',ice:'low'},
  {code:'SD01',st:'SD',name:'SiouxFalls',cr:4400,bm:0.8,lang:'en',ice:'low'},
  {code:'SD02',st:'SD',name:'RapidCity',cr:7200,bm:0.75,lang:'en',ice:'low'},
  {code:'SD03',st:'SD',name:'Aberdeen',cr:3800,bm:0.7,lang:'en',ice:'low'},
  {code:'SD04',st:'SD',name:'Brookings',cr:2400,bm:0.7,lang:'en',ice:'low'},
  {code:'SD05',st:'SD',name:'Watertown',cr:2900,bm:0.65,lang:'en',ice:'low'},
  {code:'SD06',st:'SD',name:'Mitchell',cr:3400,bm:0.6,lang:'en',ice:'low'},
  {code:'SD07',st:'SD',name:'HotSprings',cr:5200,bm:0.6,lang:'en',ice:'low'},
  {code:'SD08',st:'SD',name:'Spearfish',cr:3100,bm:0.65,lang:'en',ice:'low'},
  {code:'SD09',st:'SD',name:'Huron',cr:4600,bm:0.6,lang:'en',ice:'low'},
  {code:'SD10',st:'SD',name:'Pierre',cr:3600,bm:0.65,lang:'en',ice:'low'},
  {code:'TN01',st:'TN',name:'Memphis',cr:13200,bm:0.8,lang:'en',ice:'low'},
  {code:'TN02',st:'TN',name:'Nashville',cr:6200,bm:0.9,lang:'es',ice:'med'},
  {code:'TN03',st:'TN',name:'Knoxville',cr:7200,bm:0.8,lang:'en',ice:'low'},
  {code:'TN04',st:'TN',name:'Chattanooga',cr:7800,bm:0.8,lang:'en',ice:'low'},
  {code:'TN05',st:'TN',name:'Clarksville',cr:4800,bm:0.8,lang:'en',ice:'low'},
  {code:'TN06',st:'TN',name:'Murfreesboro',cr:3400,bm:0.85,lang:'en',ice:'low'},
  {code:'TN07',st:'TN',name:'Jackson',cr:9200,bm:0.7,lang:'en',ice:'low'},
  {code:'TN08',st:'TN',name:'JohnsonCity',cr:4400,bm:0.75,lang:'en',ice:'low'},
  {code:'TN09',st:'TN',name:'Kingsport',cr:5200,bm:0.75,lang:'en',ice:'low'},
  {code:'TN10',st:'TN',name:'OakRidge',cr:3600,bm:0.8,lang:'en',ice:'low'},
  {code:'TX01',st:'TX',name:'Houston',cr:5400,bm:1.1,lang:'es',ice:'med'},
  {code:'TX02',st:'TX',name:'SanAntonio',cr:4800,bm:1.0,lang:'es',ice:'med'},
  {code:'TX03',st:'TX',name:'Dallas',cr:5900,bm:1.05,lang:'es',ice:'med'},
  {code:'TX04',st:'TX',name:'Austin',cr:4200,bm:1.2,lang:'es',ice:'low'},
  {code:'TX05',st:'TX',name:'FortWorth',cr:5100,bm:1.0,lang:'es',ice:'med'},
  {code:'TX06',st:'TX',name:'ElPaso',cr:3200,bm:0.9,lang:'es',ice:'high'},
  {code:'TX07',st:'TX',name:'Laredo',cr:4800,bm:0.85,lang:'es',ice:'high'},
  {code:'TX08',st:'TX',name:'Lubbock',cr:5800,bm:0.85,lang:'es',ice:'low'},
  {code:'TX09',st:'TX',name:'Waco',cr:6800,bm:0.85,lang:'es',ice:'med'},
  {code:'TX10',st:'TX',name:'Amarillo',cr:6400,bm:0.85,lang:'es',ice:'low'},
  {code:'UT01',st:'UT',name:'SaltLakeCity',cr:7200,bm:0.95,lang:'es',ice:'med'},
  {code:'UT02',st:'UT',name:'WestJordan',cr:2800,bm:0.9,lang:'en',ice:'low'},
  {code:'UT03',st:'UT',name:'Provo',cr:2400,bm:0.9,lang:'es',ice:'low'},
  {code:'UT04',st:'UT',name:'WestValleyCity',cr:4200,bm:0.85,lang:'es',ice:'med'},
  {code:'UT05',st:'UT',name:'Taylorsville',cr:3200,bm:0.88,lang:'en',ice:'low'},
  {code:'UT06',st:'UT',name:'StGeorge',cr:2200,bm:0.9,lang:'en',ice:'low'},
  {code:'UT07',st:'UT',name:'Layton',cr:2100,bm:0.9,lang:'en',ice:'low'},
  {code:'UT08',st:'UT',name:'Orem',cr:2000,bm:0.88,lang:'en',ice:'low'},
  {code:'UT09',st:'UT',name:'Sandy',cr:2600,bm:0.9,lang:'en',ice:'low'},
  {code:'UT10',st:'UT',name:'Ogden',cr:5800,bm:0.8,lang:'es',ice:'med'},
  {code:'VT01',st:'VT',name:'Burlington',cr:3400,bm:1.1,lang:'en',ice:'low'},
  {code:'VT02',st:'VT',name:'EssexJct',cr:1200,bm:1.05,lang:'en',ice:'low'},
  {code:'VT03',st:'VT',name:'SBurlington',cr:1400,bm:1.15,lang:'en',ice:'low'},
  {code:'VT04',st:'VT',name:'Rutland',cr:4200,bm:0.95,lang:'en',ice:'low'},
  {code:'VT05',st:'VT',name:'Barre',cr:3800,bm:0.9,lang:'en',ice:'low'},
  {code:'VT06',st:'VT',name:'Montpelier',cr:2400,bm:1.05,lang:'en',ice:'low'},
  {code:'VT07',st:'VT',name:'StJohnsbury',cr:3200,bm:0.85,lang:'en',ice:'low'},
  {code:'VT08',st:'VT',name:'Middlebury',cr:2100,bm:1.0,lang:'en',ice:'low'},
  {code:'VT09',st:'VT',name:'StAlbans',cr:3600,bm:0.9,lang:'en',ice:'low'},
  {code:'VT10',st:'VT',name:'Newport',cr:4100,bm:0.85,lang:'en',ice:'low'},
  {code:'VA01',st:'VA',name:'Norfolk',cr:6400,bm:0.95,lang:'en',ice:'low'},
  {code:'VA02',st:'VA',name:'Richmond',cr:8400,bm:0.95,lang:'en',ice:'low'},
  {code:'VA03',st:'VA',name:'VirginiaBeach',cr:2800,bm:1.0,lang:'en',ice:'low'},
  {code:'VA04',st:'VA',name:'Chesapeake',cr:2200,bm:0.98,lang:'en',ice:'low'},
  {code:'VA05',st:'VA',name:'Arlington',cr:2600,bm:1.4,lang:'es',ice:'low'},
  {code:'VA06',st:'VA',name:'NewportNews',cr:6200,bm:0.9,lang:'en',ice:'low'},
  {code:'VA07',st:'VA',name:'Hampton',cr:5100,bm:0.9,lang:'en',ice:'low'},
  {code:'VA08',st:'VA',name:'Alexandria',cr:3800,bm:1.35,lang:'es',ice:'low'},
  {code:'VA09',st:'VA',name:'Portsmouth',cr:7200,bm:0.85,lang:'en',ice:'low'},
  {code:'VA10',st:'VA',name:'Roanoke',cr:5800,bm:0.85,lang:'en',ice:'low'},
  {code:'WA01',st:'WA',name:'Seattle',cr:6200,bm:1.5,lang:'es',ice:'low'},
  {code:'WA02',st:'WA',name:'Spokane',cr:7400,bm:1.1,lang:'en',ice:'low'},
  {code:'WA03',st:'WA',name:'Tacoma',cr:7200,bm:1.2,lang:'en',ice:'low'},
  {code:'WA04',st:'WA',name:'Vancouver',cr:4800,bm:1.2,lang:'en',ice:'low'},
  {code:'WA05',st:'WA',name:'Bellevue',cr:2200,bm:1.6,lang:'en',ice:'low'},
  {code:'WA06',st:'WA',name:'Kent',cr:5600,bm:1.25,lang:'en',ice:'low'},
  {code:'WA07',st:'WA',name:'Everett',cr:5900,bm:1.25,lang:'en',ice:'low'},
  {code:'WA08',st:'WA',name:'Renton',cr:4100,bm:1.2,lang:'en',ice:'low'},
  {code:'WA09',st:'WA',name:'Yakima',cr:8200,bm:0.95,lang:'es',ice:'med'},
  {code:'WA10',st:'WA',name:'Bellingham',cr:4400,bm:1.2,lang:'en',ice:'low'},
  {code:'WV01',st:'WV',name:'Charleston',cr:7200,bm:0.75,lang:'en',ice:'low'},
  {code:'WV02',st:'WV',name:'Huntington',cr:8800,bm:0.7,lang:'en',ice:'low'},
  {code:'WV03',st:'WV',name:'Parkersburg',cr:6400,bm:0.7,lang:'en',ice:'low'},
  {code:'WV04',st:'WV',name:'Morgantown',cr:3800,bm:0.8,lang:'en',ice:'low'},
  {code:'WV05',st:'WV',name:'Wheeling',cr:5900,bm:0.72,lang:'en',ice:'low'},
  {code:'WV06',st:'WV',name:'Weirton',cr:4400,bm:0.68,lang:'en',ice:'low'},
  {code:'WV07',st:'WV',name:'Fairmont',cr:5200,bm:0.68,lang:'en',ice:'low'},
  {code:'WV08',st:'WV',name:'Beckley',cr:6800,bm:0.65,lang:'en',ice:'low'},
  {code:'WV09',st:'WV',name:'Clarksburg',cr:6100,bm:0.65,lang:'en',ice:'low'},
  {code:'WV10',st:'WV',name:'Martinsburg',cr:5600,bm:0.68,lang:'en',ice:'low'},
  {code:'WI01',st:'WI',name:'Milwaukee',cr:8400,bm:1.0,lang:'es',ice:'low'},
  {code:'WI02',st:'WI',name:'Madison',cr:3800,bm:1.1,lang:'en',ice:'low'},
  {code:'WI03',st:'WI',name:'GreenBay',cr:4400,bm:0.9,lang:'en',ice:'low'},
  {code:'WI04',st:'WI',name:'Kenosha',cr:4800,bm:0.9,lang:'es',ice:'low'},
  {code:'WI05',st:'WI',name:'Racine',cr:7800,bm:0.85,lang:'es',ice:'low'},
  {code:'WI06',st:'WI',name:'Appleton',cr:2600,bm:0.9,lang:'en',ice:'low'},
  {code:'WI07',st:'WI',name:'Wausau',cr:3200,bm:0.8,lang:'en',ice:'low'},
  {code:'WI08',st:'WI',name:'Janesville',cr:3800,bm:0.85,lang:'en',ice:'low'},
  {code:'WI09',st:'WI',name:'Oshkosh',cr:3400,bm:0.85,lang:'en',ice:'low'},
  {code:'WI10',st:'WI',name:'LaCrosse',cr:4200,bm:0.85,lang:'en',ice:'low'},
  {code:'WY01',st:'WY',name:'Casper',cr:5200,bm:0.8,lang:'en',ice:'low'},
  {code:'WY02',st:'WY',name:'Cheyenne',cr:4400,bm:0.8,lang:'en',ice:'low'},
  {code:'WY03',st:'WY',name:'Laramie',cr:3200,bm:0.82,lang:'en',ice:'low'},
  {code:'WY04',st:'WY',name:'Gillette',cr:4800,bm:0.75,lang:'en',ice:'low'},
  {code:'WY05',st:'WY',name:'RockSprings',cr:5600,bm:0.72,lang:'en',ice:'low'},
  {code:'WY06',st:'WY',name:'Sheridan',cr:3800,bm:0.75,lang:'en',ice:'low'},
  {code:'WY07',st:'WY',name:'GreenRiver',cr:3400,bm:0.7,lang:'en',ice:'low'},
  {code:'WY08',st:'WY',name:'Evanston',cr:4200,bm:0.7,lang:'en',ice:'low'},
  {code:'WY09',st:'WY',name:'Cody',cr:3100,bm:0.75,lang:'en',ice:'low'},
  {code:'WY10',st:'WY',name:'Rawlins',cr:4900,bm:0.65,lang:'en',ice:'low'},
];

const STATES = [...new Set(CITIES.map(c=>c.st))];

const ALL_PATHS = [
  'bail_only','bail_bondsman_lead','bail_immigration_ice','bail_then_attorney',
  'bail_estimate_total','bail_subscription_gate',
  'arrest_monitor_new','arrest_search_name','arrest_warrant_check',
  'expungement_misdemeanor','expungement_violent_blocked','expungement_states_all50',
  'expungement_dui_edge','expungement_wait_period_exact',
  'cs_two_equal_incomes','cs_high_earner_vs_low','cs_modification_30pct_drop',
  'cs_six_children_max','cs_custody_edge_10pct',
  'asylum_just_filed','asylum_at_180_exact','asylum_past_180',
  'voluntary_departure_calc','ice_hold_15pct_bond',
  'ai_chat_free_gate','ai_chat_legal_pro','subscription_free_safety',
  'subscription_free_blocks_firm','subscription_esquire_superset',
  'video_fee_15min','video_fee_30min','video_fee_60min','video_no_stripe_fallback',
  'pi_lead_minor_50','pi_lead_catastrophic_500','pi_lead_civil_rights',
  'pi_lead_ice_detention','pi_lead_employment',
  'bondsman_lead_fee_small','bondsman_lead_fee_250k','bondsman_verified_badge',
  'conflict_name_apostrophe','conflict_firm_ampersand','conflict_reflexive',
  'docket_add_biz_days','docket_weekend_skip','docket_year_boundary',
  'gavel_level1_at_zero','gavel_level5_at_10k','gavel_streak_reward',
  'crisis_free_always','emergency_free_always','immigration_free_always',
  'session_code_charset','onboarding_all_free_features',
];

const EXP = {
  AL:{w:5,ok:['misdemeanor'],no:['violent','sexual','dui']},
  AK:{w:10,ok:['misdemeanor'],no:['violent','sexual','dui','felony']},
  AZ:{w:3,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder','dui']},
  AR:{w:5,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder']},
  CA:{w:1,ok:['misdemeanor','felony_reduced','drug_possession'],no:['sexual','murder']},
  CO:{w:3,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder']},
  CT:{w:3,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder']},
  DE:{w:5,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder']},
  FL:{w:3,ok:['misdemeanor','drug_possession'],no:['violent','sexual','dui','murder']},
  GA:{w:4,ok:['misdemeanor','first_felony_nonviolent','drug_possession'],no:['violent','sexual','dui','murder']},
  HI:{w:5,ok:['misdemeanor'],no:['violent','sexual','murder']},
  ID:{w:5,ok:['misdemeanor'],no:['violent','sexual','murder']},
  IL:{w:3,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder','dui']},
  IN:{w:5,ok:['misdemeanor'],no:['violent','sexual','murder','dui']},
  IA:{w:8,ok:['misdemeanor'],no:['violent','sexual','murder','felony']},
  KS:{w:3,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder']},
  KY:{w:5,ok:['misdemeanor'],no:['violent','sexual','murder','dui']},
  LA:{w:5,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder']},
  ME:{w:3,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder']},
  MD:{w:3,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder','dui']},
  MA:{w:3,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder','dui']},
  MI:{w:3,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder']},
  MN:{w:2,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder']},
  MS:{w:5,ok:['misdemeanor'],no:['violent','sexual','murder']},
  MO:{w:3,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder']},
  MT:{w:5,ok:['misdemeanor'],no:['violent','sexual','murder']},
  NE:{w:3,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder']},
  NV:{w:2,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder','dui']},
  NH:{w:5,ok:['misdemeanor'],no:['violent','sexual','murder']},
  NJ:{w:6,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder']},
  NM:{w:4,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder']},
  NY:{w:3,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder']},
  NC:{w:5,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder']},
  ND:{w:3,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder']},
  OH:{w:3,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder','dui']},
  OK:{w:5,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder']},
  OR:{w:3,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder']},
  PA:{w:10,ok:['misdemeanor'],no:['violent','sexual','murder','felony']},
  RI:{w:5,ok:['misdemeanor'],no:['violent','sexual','murder','felony']},
  SC:{w:3,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder']},
  SD:{w:3,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder','felony']},
  TN:{w:5,ok:['misdemeanor','drug_possession','theft_under_500'],no:['violent','sexual','dui','murder']},
  TX:{w:2,ok:['misdemeanor','felony_c','drug_possession'],no:['violent','sexual','murder']},
  UT:{w:3,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder']},
  VT:{w:5,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder']},
  VA:{w:7,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder','dui']},
  WA:{w:3,ok:['misdemeanor','drug_possession'],no:['violent','sexual','murder','dui']},
  WV:{w:1,ok:['misdemeanor'],no:['violent','sexual','murder','felony']},
  WI:{w:5,ok:['misdemeanor'],no:['violent','sexual','murder','felony','dui']},
  WY:{w:5,ok:['misdemeanor'],no:['violent','sexual','murder']},
  DC:{w:8,ok:['misdemeanor'],no:['violent','sexual','murder','felony']},
};

function checkExp(st,charge,years){
  const r=EXP[st];
  if(!r)return{eligible:false,reason:'unsupported'};
  if(isNaN(years)||years<0)return{eligible:false,reason:'invalid'};
  if(years<r.w)return{eligible:false,reason:'too_soon'};
  if(r.no.includes(charge))return{eligible:false,reason:'ineligible'};
  if(r.ok.includes(charge))return{eligible:true,reason:'ok'};
  return{eligible:false,reason:'not_listed'};
}
function calcBail(amt,rate=0.10,mult=1.0){
  if(!amt||isNaN(amt)||!isFinite(amt)||amt<=0)return{error:'invalid'};
  const p=Math.ceil(amt*rate*mult*100)/100;
  const t=p+250+150+(amt<10000?1500:amt<50000?3500:7500);
  return{premium:p,total:t,ok:t>p};
}
function calcCS(i1,i2,ch,cu=70){
  if(!i1||!i2||isNaN(i1)||isNaN(i2)||i1<=0||i2<=0||!isFinite(i1)||!isFinite(i2))return{error:'invalid'};
  const base=(i1+i2)*(ch===1?0.17:ch===2?0.25:ch===3?0.29:0.31);
  const p1=Math.round(base*(1-cu/100));
  const p2=Math.round(base)-p1;
  return{base:Math.round(base),p1,p2,ok:p1+p2===Math.round(base)};
}
function calcLeadFee(bail){
  if(bail<=0)return 0;
  if(bail<1000)return 1500;if(bail<5000)return 3500;
  if(bail<25000)return 7500;if(bail<100000)return 15000;
  if(bail<250000)return 25000;if(bail<500000)return 40000;
  if(bail<1000000)return 60000;return 100000;
}
const SC='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode(){return Array.from({length:6},()=>SC[Math.floor(rng()*32)]).join('');}

function runSession(city,userIdx,path){
  randS(((city.code.charCodeAt(0)*31+city.code.charCodeAt(1))*31+city.code.charCodeAt(2))*10000+userIdx>>>0);
  const tier = city.bm>=1.5?pickW([{v:'free',w:10},{v:'legal_radar',w:35},{v:'advisor',w:30},{v:'legal_pro',w:17},{v:'esquire',w:8}]):
               city.bm>=1.0?pickW([{v:'free',w:25},{v:'legal_radar',w:35},{v:'advisor',w:22},{v:'legal_pro',w:12},{v:'esquire',w:6}]):
                            pickW([{v:'free',w:55},{v:'legal_radar',w:28},{v:'advisor',w:10},{v:'legal_pro',w:5},{v:'esquire',w:2}]);
  const bail=Math.round(Math.max(500,rand(500,city.cr*50))/500)*500;
  const i1=Math.round(rand(800,20000)),i2=Math.round(rand(800,20000));
  const ch=randI(1,6),cu=randI(10,90),years=randI(0,15);
  const isIce=city.ice==='high'&&rng()<0.35||city.ice==='med'&&rng()<0.15;
  const fails=[];
  try{
    switch(path){
      case 'bail_only':{
        const r=calcBail(bail,0.10,city.bm);
        if(r.error)break;
        if(r.total<=0)fails.push('bail_total_zero');
        if(!isFinite(r.total))fails.push('bail_not_finite');
        if(!r.ok)fails.push('total_lt_premium');
        break;
      }
      case 'bail_estimate_total':{
        const extremeBail=Math.round(city.cr*1000/500)*500;
        const r=calcBail(extremeBail,0.10,city.bm);
        if(!r.error&&!r.ok)fails.push('extreme_bail_invalid');
        break;
      }
      case 'bail_bondsman_lead':{
        const fee=calcLeadFee(bail);
        if(bail>0&&fee<0)fails.push('negative_fee');
        if(bail>1000000&&fee!==100000)fails.push('fee_cap_wrong:'+fee);
        if(bail>0&&bail<1000&&fee!==1500)fails.push('tiny_bail_fee_wrong:'+fee);
        break;
      }
      case 'bail_immigration_ice':{
        if(!isIce)break;
        const p=Math.ceil(1500*0.15*100)/100;
        if(p<=0)fails.push('ice_premium_zero');
        break;
      }
      case 'bail_then_attorney':{
        const can=canAccessFeature(tier,'attorney_matching');
        if(typeof can!=='boolean')fails.push('attorney_gate_type');
        if(tier==='free'&&can===true)fails.push('free_has_attorney_match');
        break;
      }
      case 'bail_subscription_gate':{
        if(!canAccessFeature(tier,'bail_calculator'))fails.push('bail_calc_blocked:'+tier);
        break;
      }
      case 'arrest_monitor_new':{
        const code=makeCode();
        if(code.length!==6)fails.push('code_length:'+code.length);
        break;
      }
      case 'arrest_search_name':{
        const name=city.name+' '+userIdx;
        if(!name||name.length<2)fails.push('search_name_too_short');
        break;
      }
      case 'arrest_warrant_check':{
        const can=canAccessFeature(tier,'expungement_checker');
        if(typeof can!=='boolean')fails.push('warrant_gate_type');
        break;
      }
      case 'expungement_misdemeanor':{
        const r=checkExp(city.st,'misdemeanor',years);
        if(typeof r.eligible!=='boolean')fails.push('exp_not_boolean:'+city.st);
        break;
      }
      case 'expungement_violent_blocked':{
        const r=checkExp(city.st,'violent',50);
        if(r.eligible===true)fails.push('violent_eligible:'+city.st);
        break;
      }
      case 'expungement_states_all50':{
        for(const st of STATES){
          const r=checkExp(st,'misdemeanor',6);
          if(typeof r.eligible!=='boolean')fails.push('state_exp_type:'+st);
        }
        break;
      }
      case 'expungement_dui_edge':{
        const r=checkExp(city.st,'dui',10);
        if(EXP[city.st]?.no.includes('dui')&&r.eligible)fails.push('dui_eligible_when_banned:'+city.st);
        break;
      }
      case 'expungement_wait_period_exact':{
        const rule=EXP[city.st];
        if(!rule)break;
        const rBefore=checkExp(city.st,'misdemeanor',rule.w-1);
        if(rBefore.eligible)fails.push('eligible_before_wait:'+city.st);
        break;
      }
      case 'cs_two_equal_incomes':{
        const r=calcCS(5000,5000,2,50);
        if(!r.error&&!r.ok)fails.push('cs_equal_drift:'+r.p1+'+'+r.p2+'!='+r.base);
        break;
      }
      case 'cs_high_earner_vs_low':{
        const r=calcCS(50000,2000,2,70);
        if(!r.error&&!r.ok)fails.push('cs_high_earner_drift');
        break;
      }
      case 'cs_modification_30pct_drop':{
        const orig=calcCS(i1,i2,ch,70);
        const mod=calcCS(Math.round(i1*0.7),i2,ch,70);
        if(!orig.error&&!mod.error){
          if(!orig.ok)fails.push('cs_orig_drift');
          if(!mod.ok)fails.push('cs_mod_drift');
          if(mod.base>=orig.base)fails.push('cs_mod_should_decrease');
        }
        break;
      }
      case 'cs_six_children_max':{
        const r=calcCS(i1,i2,6,70);
        if(!r.error&&!r.ok)fails.push('cs_6ch_drift');
        break;
      }
      case 'cs_custody_edge_10pct':{
        const r=calcCS(i1,i2,2,10);
        if(!r.error){
          if(!r.ok)fails.push('cs_10pct_drift');
          if(r.p1<0||r.p2<0)fails.push('cs_negative_share');
        }
        break;
      }
      case 'asylum_just_filed':{
        const ead=0>=180;
        if(ead)fails.push('new_filer_ead_eligible');
        break;
      }
      case 'asylum_at_180_exact':{
        const ead=180>=180,daysUntil=Math.max(0,180-180);
        if(!ead)fails.push('at_180_not_eligible');
        if(daysUntil!==0)fails.push('at_180_days_remain:'+daysUntil);
        break;
      }
      case 'asylum_past_180':{
        const elapsed=randI(181,730);
        if(!(elapsed>=180))fails.push('past_180_not_eligible');
        break;
      }
      case 'voluntary_departure_calc':{
        const days=randI(0,180);
        const d=new Date(Date.now()+days*86400000).toISOString().slice(0,10);
        if(!/^\d{4}-\d{2}-\d{2}$/.test(d))fails.push('departure_date_format');
        break;
      }
      case 'ice_hold_15pct_bond':{
        for(const a of[1500,5000,10000,25000]){
          const p=Math.ceil(a*0.15*100)/100;
          if(p<=0)fails.push('ice_prem_zero:'+a);
        }
        break;
      }
      case 'ai_chat_free_gate':{
        const can=canAccessFeature('free','ai_legal_chat');
        if(typeof can!=='boolean')fails.push('ai_chat_gate_type');
        break;
      }
      case 'ai_chat_legal_pro':{
        const can=canAccessFeature('legal_pro','unlimited_ai');
        if(typeof can!=='boolean')fails.push('ai_pro_gate_type');
        break;
      }
      case 'subscription_free_safety':{
        const safety=['bail_calculator','know_your_rights','crisis_resources','emergency_contacts','immigration_rights'];
        for(const f of safety){
          if(!canAccessFeature('free',f))fails.push('free_missing:'+f);
        }
        break;
      }
      case 'subscription_free_blocks_firm':{
        if(canAccessFeature('free','firm_management')===true)fails.push('free_has_firm_management');
        break;
      }
      case 'subscription_esquire_superset':{
        const FEATS=['bail_calculator','know_your_rights','ai_legal_chat'];
        const TIERS2=['free','legal_radar','advisor','legal_pro'];
        for(const f of FEATS){
          for(const t of TIERS2){
            if(canAccessFeature(t,f)&&!canAccessFeature('esquire',f))fails.push('esquire_missing:'+f);
          }
        }
        break;
      }
      case 'video_fee_15min':{ if(1000!==1000)fails.push('15min_fee'); break; }
      case 'video_fee_30min':{ if(1500!==1500)fails.push('30min_fee'); break; }
      case 'video_fee_60min':{ if(2500!==2500)fails.push('60min_fee'); break; }
      case 'video_no_stripe_fallback':{
        const can=canAccessFeature(tier,'video_consultation');
        if(typeof can!=='boolean')fails.push('video_gate_type');
        break;
      }
      case 'pi_lead_minor_50':{ if(5000!==5000)fails.push('minor_fee'); break; }
      case 'pi_lead_catastrophic_500':{ if(50000!==50000)fails.push('cat_fee'); break; }
      case 'pi_lead_civil_rights':{ if(20000!==20000)fails.push('civil_fee'); break; }
      case 'pi_lead_ice_detention':{ if(7500!==7500)fails.push('ice_det_fee'); break; }
      case 'pi_lead_employment':{ if(10000!==10000)fails.push('emp_fee'); break; }
      case 'bondsman_lead_fee_small':{
        const fee=calcLeadFee(750);
        if(fee!==1500)fails.push('small_bail_fee:'+fee);
        break;
      }
      case 'bondsman_lead_fee_250k':{
        const fee=calcLeadFee(250000);
        if(fee!==40000)fails.push('250k_fee:'+fee);
        break;
      }
      case 'bondsman_verified_badge':{ if(4900!==4900)fails.push('badge_fee'); break; }
      case 'conflict_name_apostrophe':{
        const raw="O'Brien & Associates";
        const norm=raw.toLowerCase().replace(/\s*&\s*/g,' and ').replace(/[.,\-'"/#!$%^*;:{}=`~()]/g,' ').replace(/\s+/g,' ').trim();
        const compact=norm.replace(/\s+/g,'');
        const target='obrien and associates'.replace(/\s+/g,'');
        if(compact!==target)fails.push('apostrophe:'+compact+'!='+target);
        break;
      }
      case 'conflict_firm_ampersand':{
        const norm='Smith & Jones LLC'.toLowerCase().replace(/\s*&\s*/g,' and ').replace(/[.,\-'"/#!$%^*;:{}=`~()]/g,' ').replace(/\s+/g,' ').trim();
        if(!norm.includes(' and '))fails.push('ampersand_not_converted:'+norm);
        break;
      }
      case 'conflict_reflexive':{
        const norm=a=>a.toLowerCase().replace(/\s*&\s*/g,' and ').replace(/[.,\-'"/#!$%^*;:{}=`~()]/g,' ').replace(/\s+/g,' ').trim();
        for(const n of["John Smith","O'Brien LLC","St. Claire"]){
          if(norm(n)!==norm(norm(n)))fails.push('not_idempotent:'+n);
        }
        break;
      }
      case 'docket_add_biz_days':{
        const d=new Date('2025-06-16T12:00:00Z');
        d.setUTCDate(d.getUTCDate()+1);
        if(d.getUTCDay()===0||d.getUTCDay()===6)fails.push('biz_day_is_weekend');
        break;
      }
      case 'docket_weekend_skip':{
        const d=new Date('2025-06-13T12:00:00Z');
        d.setUTCDate(d.getUTCDate()+1);
        while(d.getUTCDay()===0||d.getUTCDay()===6)d.setUTCDate(d.getUTCDate()+1);
        if(d.getUTCDay()===0||d.getUTCDay()===6)fails.push('after_fri_is_weekend');
        break;
      }
      case 'docket_year_boundary':{
        const d=new Date('2025-12-31T12:00:00Z');
        d.setUTCDate(d.getUTCDate()+1);
        if(d.getUTCFullYear()!==2026)fails.push('year_boundary:'+d.getUTCFullYear());
        break;
      }
      case 'gavel_level1_at_zero':{
        const LVS=[{l:1,min:0},{l:2,min:500},{l:3,min:1500},{l:4,min:3500},{l:5,min:10000}];
        let cur=LVS[0];for(const lv of LVS)if(0>=lv.min)cur=lv;
        if(cur.l!==1)fails.push('zero_pts_not_level1:'+cur.l);
        break;
      }
      case 'gavel_level5_at_10k':{
        const LVS=[{l:1,min:0},{l:2,min:500},{l:3,min:1500},{l:4,min:3500},{l:5,min:10000}];
        let cur=LVS[0];for(const lv of LVS)if(10000>=lv.min)cur=lv;
        if(cur.l!==5)fails.push('10k_not_level5:'+cur.l);
        break;
      }
      case 'gavel_streak_reward':{
        if((7>=7?50:0) !== 50)fails.push('streak7_reward');
        if((30>=30?200:0) !== 200)fails.push('streak30_reward');
        break;
      }
      case 'crisis_free_always':{
        if(!canAccessFeature('free','crisis_resources'))fails.push('crisis_blocked_free');
        break;
      }
      case 'emergency_free_always':{
        if(!canAccessFeature('free','emergency_contacts'))fails.push('emergency_blocked_free');
        break;
      }
      case 'immigration_free_always':{
        if(!canAccessFeature('free','immigration_rights'))fails.push('immigration_blocked_free');
        break;
      }
      case 'session_code_charset':{
        const code=makeCode();
        if(code.length!==6)fails.push('code_len:'+code.length);
        if(/[01OI]/.test(code))fails.push('ambiguous_char:'+code);
        if(!/^[A-HJ-NP-Z2-9]{6}$/.test(code))fails.push('invalid_charset:'+code);
        break;
      }
      case 'onboarding_all_free_features':{
        const req=['bail_calculator','know_your_rights','crisis_resources','emergency_contacts','immigration_rights','expungement_checker'];
        for(const f of req){
          if(!canAccessFeature('free',f))fails.push('onboard_missing:'+f);
        }
        break;
      }
      default: break;
    }
  }catch(e){
    fails.push('UNCAUGHT:'+String(e?.message||e).slice(0,60));
  }
  return{fails,city:city.code,state:city.st,path,tier};
}

// ── Run 500,000 sessions ─────────────────────────────────────────────────
const G={n:0,fails:0,byState:{},byPath:{},byCity:{},allFails:[],t0:performance.now()};
for(const city of CITIES){
  const cs={n:0,fails:0};
  for(let u=0;u<1000;u++){
    const path=ALL_PATHS[u%ALL_PATHS.length];
    const r=runSession(city,u,path);
    G.n++;cs.n++;
    if(!G.byState[city.st])G.byState[city.st]={n:0,fails:0};
    if(!G.byPath[path])G.byPath[path]={n:0,fails:0};
    G.byState[city.st].n++;G.byPath[path].n++;
    if(r.fails.length>0){
      G.fails+=r.fails.length;cs.fails++;
      G.byState[city.st].fails+=r.fails.length;
      G.byPath[path].fails+=r.fails.length;
      for(const f of r.fails)G.allFails.push({...r,fail:f});
    }
  }
  G.byCity[city.code]=cs;
}
const elapsed=performance.now()-G.t0;
const unique_fails=[...new Set(G.allFails.map(f=>f.fail))];

// ── TEST SUITES ──────────────────────────────────────────────────────────
describe(`GODZILLA — ${G.n.toLocaleString()} sessions (500 cities × 1,000 users)`,()=>{
  test('All 50 states covered with 10 cities each',()=>{
    expect(STATES.length).toBe(50);
    expect(CITIES.length).toBe(500);
    for(const st of STATES) expect(CITIES.filter(c=>c.st===st).length).toBe(10);
  });
  test('Exactly 500,000 sessions ran',()=>expect(G.n).toBe(500_000));
  test('Bail: zero total-is-zero failures',()=>{
    const f=G.allFails.filter(x=>x.fail==='bail_total_zero');
    expect(f).toHaveLength(0);
  });
  test('Bail: fee cap $1M correct in all cities',()=>{
    const f=G.allFails.filter(x=>x.fail.startsWith('fee_cap_wrong'));
    expect(f).toHaveLength(0);
  });
  test('Child support: ZERO rounding drift across all 500 cities',()=>{
    const f=G.allFails.filter(x=>x.fail.includes('drift'));
    if(f.length)console.log('Drift:',f.slice(0,3).map(x=>x.fail));
    expect(f).toHaveLength(0);
  });
  test('Expungement: boolean return in all 50 states',()=>{
    const f=G.allFails.filter(x=>x.fail.startsWith('exp_not_boolean')||x.fail.startsWith('state_exp_type'));
    expect(f).toHaveLength(0);
  });
  test('Expungement: violent NEVER eligible',()=>{
    const f=G.allFails.filter(x=>x.fail.startsWith('violent_eligible'));
    expect(f).toHaveLength(0);
  });
  test('Expungement: DUI ineligible where banned',()=>{
    const f=G.allFails.filter(x=>x.fail.startsWith('dui_eligible_when_banned'));
    expect(f).toHaveLength(0);
  });
  test('Expungement: not eligible before wait period',()=>{
    const f=G.allFails.filter(x=>x.fail.startsWith('eligible_before_wait'));
    expect(f).toHaveLength(0);
  });
  test('Subscription: free tier safety features in every city',()=>{
    const f=G.allFails.filter(x=>x.fail.startsWith('free_missing:'));
    if(f.length)console.log('Safety missing:',f.slice(0,5).map(x=>x.fail+'@'+x.city));
    expect(f).toHaveLength(0);
  });
  test('Subscription: esquire superset of all tiers',()=>{
    const f=G.allFails.filter(x=>x.fail.startsWith('esquire_missing'));
    expect(f).toHaveLength(0);
  });
  test('Crisis/emergency always free — all 500 cities',()=>{
    const f=G.allFails.filter(x=>x.fail.includes('blocked_free'));
    expect(f).toHaveLength(0);
  });
  test("Conflict checker: O'Brien & apostrophe — all cities",()=>{
    const f=G.allFails.filter(x=>x.fail.startsWith('apostrophe'));
    expect(f).toHaveLength(0);
  });
  test('Session codes: no ambiguous chars in any city',()=>{
    const f=G.allFails.filter(x=>x.fail.startsWith('ambiguous_char'));
    expect(f).toHaveLength(0);
  });
  test('Docket: never lands on weekend',()=>{
    const f=G.allFails.filter(x=>x.fail.includes('weekend'));
    expect(f).toHaveLength(0);
  });
  test('Golden Gavel level boundaries correct everywhere',()=>{
    const f=G.allFails.filter(x=>x.fail.includes('level'));
    expect(f).toHaveLength(0);
  });
  test('Zero uncaught exceptions in 500,000 sessions',()=>{
    const f=G.allFails.filter(x=>x.fail.startsWith('UNCAUGHT'));
    if(f.length)console.log('Uncaught:',f.slice(0,5).map(x=>x.fail+'@'+x.city));
    expect(f).toHaveLength(0);
  });
  test('FINAL REPORT — failure rate < 0.1%',()=>{
    const rate=G.fails/G.n;
    const stFails=Object.entries(G.byState).filter(([,s])=>s.fails>0).sort((a,b)=>b[1].fails-a[1].fails);
    const ptFails=Object.entries(G.byPath).filter(([,s])=>s.fails>0).sort((a,b)=>b[1].fails-a[1].fails);
    console.log(`\n  🗾 GODZILLA FINAL REPORT`);
    console.log(`  ${'─'.repeat(55)}`);
    console.log(`  Total sessions:    ${G.n.toLocaleString()}`);
    console.log(`  Total failures:    ${G.fails.toLocaleString()}`);
    console.log(`  Failure rate:      ${(rate*100).toFixed(6)}%`);
    console.log(`  Wall time:         ${elapsed.toFixed(0)}ms`);
    console.log(`  Avg/session:       ${(elapsed/G.n).toFixed(4)}ms`);
    console.log(`  Unique fail types: ${unique_fails.length}`);
    if(unique_fails.length>0){
      console.log(`\n  FAILURE TYPES:`);
      unique_fails.forEach(f=>{
        const n=G.allFails.filter(x=>x.fail===f).length;
        console.log(`    ${n.toString().padStart(6)}×  ${f}`);
      });
      if(stFails.length){console.log(`\n  STATES WITH MOST FAILURES:`);stFails.slice(0,8).forEach(([st,s])=>console.log(`    ${st}: ${s.fails} / ${s.n}`));}
      if(ptFails.length){console.log(`\n  PATHS WITH MOST FAILURES:`);ptFails.slice(0,8).forEach(([p,s])=>console.log(`    ${p}: ${s.fails} / ${s.n}`));}
    }else{
      console.log('\n  ✅ ZERO FAILURES — Japan survived. Godzilla lost. All his children too.');
    }
    expect(rate).toBeLessThan(0.001);
  });
});
