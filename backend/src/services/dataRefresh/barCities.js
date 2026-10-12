/**
 * dataRefresh/barCities.js — cities covered by the national provider refresh,
 * each with its state bar's public "find a lawyer" page. Used by
 * src/scripts/scrape_providers_national.js and the Sunday scheduler step.
 */
const CITY_LIST = [
  // AK
  { city: 'Anchorage', state: 'AK', bar: 'https://www.alaskabar.org/membership/member-directory/' },
  // AL
  { city: 'Birmingham', state: 'AL', bar: 'https://www.alabar.org/for-the-public/find-a-lawyer/' },
  { city: 'Montgomery', state: 'AL', bar: 'https://www.alabar.org/for-the-public/find-a-lawyer/' },
  // AR
  { city: 'Little Rock', state: 'AR', bar: 'https://www.arkbar.com/for-the-public/find-an-attorney' },
  { city: 'Fort Smith', state: 'AR', bar: 'https://www.arkbar.com/for-the-public/find-an-attorney' },
  // AZ
  { city: 'Phoenix', state: 'AZ', bar: 'https://www.azbar.org/for-the-public/lawyer-referral-service/' },
  { city: 'Tucson', state: 'AZ', bar: 'https://www.azbar.org/for-the-public/lawyer-referral-service/' },
  // CA
  { city: 'Los Angeles', state: 'CA', bar: 'https://www.calbar.ca.gov/Attorneys/Conduct-Discipline/Attorney-Search' },
  { city: 'San Diego', state: 'CA', bar: 'https://www.calbar.ca.gov/Attorneys/Conduct-Discipline/Attorney-Search' },
  { city: 'San Francisco', state: 'CA', bar: 'https://www.calbar.ca.gov/Attorneys/Conduct-Discipline/Attorney-Search' },
  { city: 'San Jose', state: 'CA', bar: 'https://www.calbar.ca.gov/Attorneys/Conduct-Discipline/Attorney-Search' },
  { city: 'Sacramento', state: 'CA', bar: 'https://www.calbar.ca.gov/Attorneys/Conduct-Discipline/Attorney-Search' },
  // CO
  { city: 'Denver', state: 'CO', bar: 'https://www.cobar.org/for-the-public/find-a-lawyer/' },
  { city: 'Colorado Springs', state: 'CO', bar: 'https://www.cobar.org/for-the-public/find-a-lawyer/' },
  // CT
  { city: 'Hartford', state: 'CT', bar: 'https://jud.ct.gov/AttorneyDiscipline/FindAttorney.aspx' },
  { city: 'Bridgeport', state: 'CT', bar: 'https://jud.ct.gov/AttorneyDiscipline/FindAttorney.aspx' },
  // FL
  { city: 'Jacksonville', state: 'FL', bar: 'https://www.floridabar.org/public/referral/' },
  { city: 'Miami', state: 'FL', bar: 'https://www.floridabar.org/public/referral/' },
  { city: 'Tampa', state: 'FL', bar: 'https://www.floridabar.org/public/referral/' },
  // GA
  { city: 'Atlanta', state: 'GA', bar: 'https://www.gabar.org/barinaction/findalawyer.cfm' },
  { city: 'Savannah', state: 'GA', bar: 'https://www.gabar.org/barinaction/findalawyer.cfm' },
  // HI
  { city: 'Honolulu', state: 'HI', bar: 'https://www.hsba.org/HSBA/Public/FindaLawyer.aspx' },
  // IA
  { city: 'Des Moines', state: 'IA', bar: 'https://www.iowabar.org/page/FindaLawyer' },
  // ID
  { city: 'Boise', state: 'ID', bar: 'https://isb.idaho.gov/members/member-directory/' },
  // IL
  { city: 'Chicago', state: 'IL', bar: 'https://www.iardc.org/LawyerSearch.aspx' },
  { city: 'Springfield', state: 'IL', bar: 'https://www.iardc.org/LawyerSearch.aspx' },
  // IN
  { city: 'Indianapolis', state: 'IN', bar: 'https://www.inbar.org/page/FindAttorney' },
  { city: 'Fort Wayne', state: 'IN', bar: 'https://www.inbar.org/page/FindAttorney' },
  // KS
  { city: 'Wichita', state: 'KS', bar: 'https://www.ksbar.org/page/Find_An_Attorney' },
  // KY
  { city: 'Louisville', state: 'KY', bar: 'https://www.kybar.org/page/FindAnAttorney' },
  { city: 'Lexington', state: 'KY', bar: 'https://www.kybar.org/page/FindAnAttorney' },
  // LA
  { city: 'New Orleans', state: 'LA', bar: 'https://www.lsba.org/public/findalawyer.aspx' },
  { city: 'Baton Rouge', state: 'LA', bar: 'https://www.lsba.org/public/findalawyer.aspx' },
  // MA
  { city: 'Boston', state: 'MA', bar: 'https://www.massbar.org/for-the-public/find-a-lawyer' },
  // MD
  { city: 'Baltimore', state: 'MD', bar: 'https://www.msba.org/for-public/find-a-lawyer/' },
  // MI
  { city: 'Detroit', state: 'MI', bar: 'https://www.michbar.org/member/directory' },
  { city: 'Grand Rapids', state: 'MI', bar: 'https://www.michbar.org/member/directory' },
  // MN
  { city: 'Minneapolis', state: 'MN', bar: 'https://lprb.mncourts.gov/AttorneySearch/' },
  // MO
  { city: 'Kansas City', state: 'MO', bar: 'https://mobar.org/site/For-the-Public/Find-a-Lawyer.aspx' },
  { city: 'St. Louis', state: 'MO', bar: 'https://mobar.org/site/For-the-Public/Find-a-Lawyer.aspx' },
  // MS
  { city: 'Jackson', state: 'MS', bar: 'https://www.msbar.org/for-the-public/find-a-lawyer/' },
  // NC
  { city: 'Charlotte', state: 'NC', bar: 'https://www.nclawyer.org/directory/' },
  { city: 'Raleigh', state: 'NC', bar: 'https://www.nclawyer.org/directory/' },
  // NE
  { city: 'Omaha', state: 'NE', bar: 'https://www.nebar.com/page/find_a_lawyer' },
  // NJ
  { city: 'Newark', state: 'NJ', bar: 'https://www.njcourts.gov/forms/10153_atty_search.pdf' },
  { city: 'Jersey City', state: 'NJ', bar: 'https://www.njcourts.gov/forms/10153_atty_search.pdf' },
  // NM
  { city: 'Albuquerque', state: 'NM', bar: 'https://www.nmbar.org/Attorneys/FindaLawyer.aspx' },
  // NV
  { city: 'Las Vegas', state: 'NV', bar: 'https://www.nvbar.org/member-search/' },
  { city: 'Reno', state: 'NV', bar: 'https://www.nvbar.org/member-search/' },
  // NY
  { city: 'New York', state: 'NY', bar: 'https://iapps.courts.state.ny.us/attorney/AttorneySearch' },
  { city: 'Buffalo', state: 'NY', bar: 'https://iapps.courts.state.ny.us/attorney/AttorneySearch' },
  // OH
  { city: 'Columbus', state: 'OH', bar: 'https://www.ohiobar.org/find-a-lawyer/' },
  { city: 'Cleveland', state: 'OH', bar: 'https://www.ohiobar.org/find-a-lawyer/' },
  { city: 'Cincinnati', state: 'OH', bar: 'https://www.ohiobar.org/find-a-lawyer/' },
  // OK
  { city: 'Oklahoma City', state: 'OK', bar: 'https://www.okbar.org/members/lawyerreferral/' },
  { city: 'Tulsa', state: 'OK', bar: 'https://www.okbar.org/members/lawyerreferral/' },
  // OR
  { city: 'Portland', state: 'OR', bar: 'https://www.osbar.org/members/membersearch.html' },
  // PA
  { city: 'Philadelphia', state: 'PA', bar: 'https://www.pabar.org/site/For-the-Public/Find-a-Lawyer' },
  { city: 'Pittsburgh', state: 'PA', bar: 'https://www.pabar.org/site/For-the-Public/Find-a-Lawyer' },
  // SC
  { city: 'Columbia', state: 'SC', bar: 'https://www.scbar.org/public/find-a-lawyer/' },
  // TN
  { city: 'Memphis', state: 'TN', bar: 'https://www.tba.org/member-directory' },
  { city: 'Nashville', state: 'TN', bar: 'https://www.tba.org/member-directory' },
  { city: 'Knoxville', state: 'TN', bar: 'https://www.tba.org/member-directory' },
  // TX
  { city: 'Houston', state: 'TX', bar: 'https://www.texasbar.com/AM/Template.cfm?Section=Find_A_Lawyer' },
  { city: 'Dallas', state: 'TX', bar: 'https://www.texasbar.com/AM/Template.cfm?Section=Find_A_Lawyer' },
  { city: 'San Antonio', state: 'TX', bar: 'https://www.texasbar.com/AM/Template.cfm?Section=Find_A_Lawyer' },
  { city: 'Austin', state: 'TX', bar: 'https://www.texasbar.com/AM/Template.cfm?Section=Find_A_Lawyer' },
  // UT
  { city: 'Salt Lake City', state: 'UT', bar: 'https://services.utahbar.org/Member-Services/Member-Directory' },
  // VA
  { city: 'Virginia Beach', state: 'VA', bar: 'https://www.vsb.org/site/public/find-a-lawyer' },
  { city: 'Richmond', state: 'VA', bar: 'https://www.vsb.org/site/public/find-a-lawyer' },
  // WA
  { city: 'Seattle', state: 'WA', bar: 'https://www.wsba.org/for-the-public/find-a-lawyer' },
  { city: 'Spokane', state: 'WA', bar: 'https://www.wsba.org/for-the-public/find-a-lawyer' },
  // WI
  { city: 'Milwaukee', state: 'WI', bar: 'https://www.wisbar.org/forPublic/Pages/FindaLawyer.aspx' },
  { city: 'Madison', state: 'WI', bar: 'https://www.wisbar.org/forPublic/Pages/FindaLawyer.aspx' },
  // DC
  { city: 'Washington', state: 'DC', bar: 'https://www.dcbar.org/for-the-public/find-a-member' },
  // DE
  { city: 'Wilmington', state: 'DE', bar: 'https://www.dsba.org/find-a-lawyer' },
  { city: 'Dover', state: 'DE', bar: 'https://www.dsba.org/find-a-lawyer' },
  { city: 'Newark', state: 'DE', bar: 'https://www.dsba.org/find-a-lawyer' },
  // ME
  { city: 'Portland', state: 'ME', bar: 'https://www.mainebar.org/page/FindAnAttorney' },
  { city: 'Bangor', state: 'ME', bar: 'https://www.mainebar.org/page/FindAnAttorney' },
  { city: 'Lewiston', state: 'ME', bar: 'https://www.mainebar.org/page/FindAnAttorney' },
  { city: 'Augusta', state: 'ME', bar: 'https://www.mainebar.org/page/FindAnAttorney' },
  // MT
  { city: 'Billings', state: 'MT', bar: 'https://www.montanabar.org/page/FindAnAttorney' },
  { city: 'Missoula', state: 'MT', bar: 'https://www.montanabar.org/page/FindAnAttorney' },
  { city: 'Great Falls', state: 'MT', bar: 'https://www.montanabar.org/page/FindAnAttorney' },
  { city: 'Bozeman', state: 'MT', bar: 'https://www.montanabar.org/page/FindAnAttorney' },
  { city: 'Helena', state: 'MT', bar: 'https://www.montanabar.org/page/FindAnAttorney' },
  // ND
  { city: 'Fargo', state: 'ND', bar: 'https://www.sband.org/page/FindAnAttorney' },
  { city: 'Bismarck', state: 'ND', bar: 'https://www.sband.org/page/FindAnAttorney' },
  { city: 'Grand Forks', state: 'ND', bar: 'https://www.sband.org/page/FindAnAttorney' },
  { city: 'Minot', state: 'ND', bar: 'https://www.sband.org/page/FindAnAttorney' },
  // NH
  { city: 'Manchester', state: 'NH', bar: 'https://www.nhbar.org/find-a-lawyer' },
  { city: 'Nashua', state: 'NH', bar: 'https://www.nhbar.org/find-a-lawyer' },
  { city: 'Concord', state: 'NH', bar: 'https://www.nhbar.org/find-a-lawyer' },
  { city: 'Derry', state: 'NH', bar: 'https://www.nhbar.org/find-a-lawyer' },
  { city: 'Portsmouth', state: 'NH', bar: 'https://www.nhbar.org/find-a-lawyer' },
  // RI
  { city: 'Providence', state: 'RI', bar: 'https://www.ribar.com/for-the-public' },
  { city: 'Warwick', state: 'RI', bar: 'https://www.ribar.com/for-the-public' },
  { city: 'Cranston', state: 'RI', bar: 'https://www.ribar.com/for-the-public' },
  { city: 'Pawtucket', state: 'RI', bar: 'https://www.ribar.com/for-the-public' },
  // SD
  { city: 'Sioux Falls', state: 'SD', bar: 'https://www.statebarofsouthdakota.com/page/FindAnAttorney' },
  { city: 'Rapid City', state: 'SD', bar: 'https://www.statebarofsouthdakota.com/page/FindAnAttorney' },
  { city: 'Aberdeen', state: 'SD', bar: 'https://www.statebarofsouthdakota.com/page/FindAnAttorney' },
  { city: 'Watertown', state: 'SD', bar: 'https://www.statebarofsouthdakota.com/page/FindAnAttorney' },
  // VT
  { city: 'Burlington', state: 'VT', bar: 'https://www.vtbar.org/for-the-public/find-a-lawyer' },
  { city: 'South Burlington', state: 'VT', bar: 'https://www.vtbar.org/for-the-public/find-a-lawyer' },
  { city: 'Montpelier', state: 'VT', bar: 'https://www.vtbar.org/for-the-public/find-a-lawyer' },
  { city: 'Rutland', state: 'VT', bar: 'https://www.vtbar.org/for-the-public/find-a-lawyer' },
  { city: 'Barre', state: 'VT', bar: 'https://www.vtbar.org/for-the-public/find-a-lawyer' },
  // WV
  { city: 'Charleston', state: 'WV', bar: 'https://wvlawyerreferral.com' },
  { city: 'Huntington', state: 'WV', bar: 'https://wvlawyerreferral.com' },
  { city: 'Morgantown', state: 'WV', bar: 'https://wvlawyerreferral.com' },
  { city: 'Parkersburg', state: 'WV', bar: 'https://wvlawyerreferral.com' },
  { city: 'Wheeling', state: 'WV', bar: 'https://wvlawyerreferral.com' },
  { city: 'Weirton', state: 'WV', bar: 'https://wvlawyerreferral.com' },
  { city: 'Beckley', state: 'WV', bar: 'https://wvlawyerreferral.com' },
  // WY
  { city: 'Cheyenne', state: 'WY', bar: 'https://www.wyomingbar.org/for-the-public/find-a-lawyer' },
  { city: 'Casper', state: 'WY', bar: 'https://www.wyomingbar.org/for-the-public/find-a-lawyer' },
  { city: 'Laramie', state: 'WY', bar: 'https://www.wyomingbar.org/for-the-public/find-a-lawyer' },
  { city: 'Gillette', state: 'WY', bar: 'https://www.wyomingbar.org/for-the-public/find-a-lawyer' },
  { city: 'Rock Springs', state: 'WY', bar: 'https://www.wyomingbar.org/for-the-public/find-a-lawyer' },
  // ── States the original list was missing (DC, DE, ME, MT, ND, NH, RI, SD, VT, WV, WY, KY) ──
  { city: 'Washington',      state: 'DC', bar: 'https://www.dcbar.org/for-the-public/find-a-member' },
  { city: 'Wilmington',      state: 'DE', bar: 'https://www.dsba.org/find-a-lawyer' },
  { city: 'Dover',           state: 'DE', bar: 'https://www.dsba.org/find-a-lawyer' },
  { city: 'Portland',        state: 'ME', bar: 'https://www.mainebar.org/page/FindAnAttorney' },
  { city: 'Bangor',          state: 'ME', bar: 'https://www.mainebar.org/page/FindAnAttorney' },
  { city: 'Billings',        state: 'MT', bar: 'https://www.montanabar.org/page/FindAnAttorney' },
  { city: 'Missoula',        state: 'MT', bar: 'https://www.montanabar.org/page/FindAnAttorney' },
  { city: 'Great Falls',     state: 'MT', bar: 'https://www.montanabar.org/page/FindAnAttorney' },
  { city: 'Fargo',           state: 'ND', bar: 'https://www.sband.org/page/FindAnAttorney' },
  { city: 'Bismarck',        state: 'ND', bar: 'https://www.sband.org/page/FindAnAttorney' },
  { city: 'Manchester',      state: 'NH', bar: 'https://www.nhbar.org/find-a-lawyer' },
  { city: 'Concord',         state: 'NH', bar: 'https://www.nhbar.org/find-a-lawyer' },
  { city: 'Nashua',          state: 'NH', bar: 'https://www.nhbar.org/find-a-lawyer' },
  { city: 'Providence',      state: 'RI', bar: 'https://www.ribar.com/For-The-Public/Lawyer-Referral-Service' },
  { city: 'Warwick',         state: 'RI', bar: 'https://www.ribar.com/For-The-Public/Lawyer-Referral-Service' },
  { city: 'Sioux Falls',     state: 'SD', bar: 'https://www.statebarofsouthdakota.com/page/FindAnAttorney' },
  { city: 'Rapid City',      state: 'SD', bar: 'https://www.statebarofsouthdakota.com/page/FindAnAttorney' },
  { city: 'Burlington',      state: 'VT', bar: 'https://www.vtbar.org/for-the-public/find-a-lawyer' },
  { city: 'Montpelier',      state: 'VT', bar: 'https://www.vtbar.org/for-the-public/find-a-lawyer' },
  { city: 'Charleston',      state: 'WV', bar: 'https://wvlawyerreferral.com' },
  { city: 'Huntington',      state: 'WV', bar: 'https://wvlawyerreferral.com' },
  { city: 'Morgantown',      state: 'WV', bar: 'https://wvlawyerreferral.com' },
  { city: 'Cheyenne',        state: 'WY', bar: 'https://www.wyomingbar.org/for-the-public/find-a-lawyer' },
  { city: 'Casper',          state: 'WY', bar: 'https://www.wyomingbar.org/for-the-public/find-a-lawyer' },
  { city: 'Louisville',      state: 'KY', bar: 'https://www.kybar.org/page/FindAnAttorney' },
  { city: 'Lexington',       state: 'KY', bar: 'https://www.kybar.org/page/FindAnAttorney' },

  // ── Missing states — added for final complete national scrape ────────────
  // DC
  { city: 'Washington',       state: 'DC',  bar: 'https://www.dcbar.org/for-the-public/find-a-member' },
  // DE
  { city: 'Wilmington',       state: 'DE',  bar: 'https://www.dsba.org/find-a-lawyer' },
  { city: 'Dover',            state: 'DE',  bar: 'https://www.dsba.org/find-a-lawyer' },
  { city: 'Newark',           state: 'DE',  bar: 'https://www.dsba.org/find-a-lawyer' },
  // ME
  { city: 'Portland',         state: 'ME',  bar: 'https://www.mainebar.org/page/FindAnAttorney' },
  { city: 'Bangor',           state: 'ME',  bar: 'https://www.mainebar.org/page/FindAnAttorney' },
  { city: 'Lewiston',         state: 'ME',  bar: 'https://www.mainebar.org/page/FindAnAttorney' },
  // MT
  { city: 'Billings',         state: 'MT',  bar: 'https://www.montanabar.org/page/FindAnAttorney' },
  { city: 'Missoula',         state: 'MT',  bar: 'https://www.montanabar.org/page/FindAnAttorney' },
  { city: 'Great Falls',      state: 'MT',  bar: 'https://www.montanabar.org/page/FindAnAttorney' },
  { city: 'Bozeman',          state: 'MT',  bar: 'https://www.montanabar.org/page/FindAnAttorney' },
  { city: 'Helena',           state: 'MT',  bar: 'https://www.montanabar.org/page/FindAnAttorney' },
  // ND
  { city: 'Fargo',            state: 'ND',  bar: 'https://www.sband.org/page/FindAnAttorney' },
  { city: 'Bismarck',         state: 'ND',  bar: 'https://www.sband.org/page/FindAnAttorney' },
  { city: 'Grand Forks',      state: 'ND',  bar: 'https://www.sband.org/page/FindAnAttorney' },
  { city: 'Minot',            state: 'ND',  bar: 'https://www.sband.org/page/FindAnAttorney' },
  // NH
  { city: 'Manchester',       state: 'NH',  bar: 'https://www.nhbar.org/find-a-lawyer' },
  { city: 'Nashua',           state: 'NH',  bar: 'https://www.nhbar.org/find-a-lawyer' },
  { city: 'Concord',          state: 'NH',  bar: 'https://www.nhbar.org/find-a-lawyer' },
  { city: 'Derry',            state: 'NH',  bar: 'https://www.nhbar.org/find-a-lawyer' },
  // RI
  { city: 'Providence',       state: 'RI',  bar: 'https://www.ribar.com/for-the-public' },
  { city: 'Warwick',          state: 'RI',  bar: 'https://www.ribar.com/for-the-public' },
  { city: 'Cranston',         state: 'RI',  bar: 'https://www.ribar.com/for-the-public' },
  { city: 'Pawtucket',        state: 'RI',  bar: 'https://www.ribar.com/for-the-public' },
  // SD
  { city: 'Sioux Falls',      state: 'SD',  bar: 'https://www.statebarofsouthdakota.com/page/FindAnAttorney' },
  { city: 'Rapid City',       state: 'SD',  bar: 'https://www.statebarofsouthdakota.com/page/FindAnAttorney' },
  { city: 'Aberdeen',         state: 'SD',  bar: 'https://www.statebarofsouthdakota.com/page/FindAnAttorney' },
  // VT
  { city: 'Burlington',       state: 'VT',  bar: 'https://www.vtbar.org/for-the-public/find-a-lawyer' },
  { city: 'South Burlington', state: 'VT',  bar: 'https://www.vtbar.org/for-the-public/find-a-lawyer' },
  { city: 'Montpelier',       state: 'VT',  bar: 'https://www.vtbar.org/for-the-public/find-a-lawyer' },
  { city: 'Rutland',          state: 'VT',  bar: 'https://www.vtbar.org/for-the-public/find-a-lawyer' },
  { city: 'Barre',            state: 'VT',  bar: 'https://www.vtbar.org/for-the-public/find-a-lawyer' },
  // WV
  { city: 'Charleston',       state: 'WV',  bar: 'https://wvlawyerreferral.com' },
  { city: 'Huntington',       state: 'WV',  bar: 'https://wvlawyerreferral.com' },
  { city: 'Morgantown',       state: 'WV',  bar: 'https://wvlawyerreferral.com' },
  { city: 'Parkersburg',      state: 'WV',  bar: 'https://wvlawyerreferral.com' },
  { city: 'Wheeling',         state: 'WV',  bar: 'https://wvlawyerreferral.com' },
  { city: 'Weirton',          state: 'WV',  bar: 'https://wvlawyerreferral.com' },
  // WY
  { city: 'Cheyenne',         state: 'WY',  bar: 'https://www.wyomingbar.org/for-the-public/find-a-lawyer' },
  { city: 'Casper',           state: 'WY',  bar: 'https://www.wyomingbar.org/for-the-public/find-a-lawyer' },
  { city: 'Laramie',          state: 'WY',  bar: 'https://www.wyomingbar.org/for-the-public/find-a-lawyer' },
  { city: 'Gillette',         state: 'WY',  bar: 'https://www.wyomingbar.org/for-the-public/find-a-lawyer' },
  { city: 'Rock Springs',     state: 'WY',  bar: 'https://www.wyomingbar.org/for-the-public/find-a-lawyer' },

];

// The list grew by appending; keep one entry per city + state.
export const ALL_BAR_CITIES = [...new Map(CITY_LIST.map(c => [`${c.city}|${c.state}`, c])).values()];
