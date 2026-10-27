/**
 * data/transit_agencies.js — public transit agencies by county, for "Plan your court day" (A8).
 *
 * Tennessee first. A county is listed ONLY when we have a cited source for its transit agency's
 * official web address; every other county shows just 211 and map directions to the court.
 * Each row: the agency's own name, the area it serves (a city bus system may not cover the whole
 * county — say so), the link we open (its trip planner when the source shows one, else its site),
 * the source we checked the address against and the date checked.
 *
 * Sources: the agency's own site, or its National Transit Database agency profile published by the
 * Federal Transit Administration (transit.dot.gov), which lists the agency's website.
 * Re-check yearly (addresses change); remove a row rather than keep a broken link.
 */
export const TRANSIT_CHECKED = '2026-10-27';

export const TRANSIT_AGENCIES = Object.freeze([
  {
    state: 'TN', county: 'Davidson', agency: 'WeGo Public Transit', serves: 'Nashville and Davidson County',
    url: 'https://www.wegotransit.com/', trip_planner: false,
    source_url: 'https://wegotransit.com/ride/transit-services/buses', checked: TRANSIT_CHECKED,
  },
  {
    state: 'TN', county: 'Shelby', agency: 'MATA (Memphis Area Transit Authority)', serves: 'Memphis',
    url: 'https://www.matatransit.com/', trip_planner: true,
    source_url: 'https://www.matatransit.com/assets/2/6/MATA-TourismBrochure-1220.pdf', checked: TRANSIT_CHECKED,
  },
  {
    state: 'TN', county: 'Knox', agency: 'Knoxville Area Transit (KAT)', serves: 'Knoxville',
    url: 'https://katbus.com/', trip_planner: true,
    source_url: 'https://katbus.com/buses', checked: TRANSIT_CHECKED,
  },
  {
    state: 'TN', county: 'Hamilton', agency: 'CARTA', serves: 'Chattanooga',
    url: 'https://www.gocarta.org/trip-planner/', trip_planner: true,
    source_url: 'https://www.gocarta.org/routes-schedules/rider-guide/', checked: TRANSIT_CHECKED,
  },
  {
    state: 'TN', county: 'Montgomery', agency: 'Clarksville Transit System (CTS)', serves: 'Clarksville',
    url: 'http://www.ridects.com', trip_planner: false,
    source_url: 'https://www.transit.dot.gov/sites/fta.dot.gov/files/transit_agency_profile_doc/2024/40092.pdf', checked: TRANSIT_CHECKED,
  },
  {
    state: 'TN', county: 'Rutherford', agency: 'Rover (City of Murfreesboro)', serves: 'Murfreesboro',
    url: 'http://www.murfreesborotn.gov/248/Public-Transit---Rover-BusSystem', trip_planner: false,
    source_url: 'https://www.transit.dot.gov/sites/fta.dot.gov/files/transit_agency_profile_doc/2023/40186.pdf', checked: TRANSIT_CHECKED,
  },
  {
    state: 'TN', county: 'Madison', agency: 'Jackson Transit Authority', serves: 'Jackson',
    url: 'http://www.ridejta.com/', trip_planner: false,
    source_url: 'https://www.transit.dot.gov/sites/fta.dot.gov/files/transit_agency_profile_doc/2024/40057.pdf', checked: TRANSIT_CHECKED,
  },
  {
    state: 'TN', county: 'Washington', agency: 'Johnson City Transit', serves: 'Johnson City',
    url: 'http://www.johnsoncitytransit.org/', trip_planner: false,
    source_url: 'https://www.transit.dot.gov/sites/fta.dot.gov/files/transit_agency_profile_doc/2023/40054.pdf', checked: TRANSIT_CHECKED,
  },
  {
    state: 'TN', county: 'Williamson', agency: 'Franklin Transit Authority', serves: 'Franklin',
    url: 'https://franklintransit.org/', trip_planner: false,
    source_url: 'https://www.transit.dot.gov/sites/fta.dot.gov/files/transit_agency_profile_doc/2024/40162.pdf', checked: TRANSIT_CHECKED,
  },
  {
    state: 'TN', county: 'Sullivan', agency: 'Kingsport Area Transit Service', serves: 'Kingsport',
    url: 'http://www.kingsporttransit.org/', trip_planner: false,
    source_url: 'https://www.transit.dot.gov/sites/fta.dot.gov/files/transit_agency_profile_doc/2023/40080.pdf', checked: TRANSIT_CHECKED,
  },
]);

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+county$/, '');

/** The agency for a county ("Davidson" / "Davidson County") in a state ("TN"), or null. */
export function transitAgencyFor(county, state) {
  const c = norm(county); const st = String(state ?? '').trim().toUpperCase();
  if (!c || !st) return null;
  return TRANSIT_AGENCIES.find((a) => a.state === st && norm(a.county) === c) || null;
}
