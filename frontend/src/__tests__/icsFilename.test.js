/** icsFilename — the download is named after the court day, never the VTIMEZONE's DST date. */
jest.mock('../services/api', () => ({ api: { get: jest.fn() } }));
const { icsFilename } = require('../utils/icsExport');

const TIMED = ['BEGIN:VCALENDAR', 'BEGIN:VTIMEZONE', 'TZID:America/Chicago', 'BEGIN:DAYLIGHT', 'DTSTART:20250309T020000', 'END:DAYLIGHT',
  'END:VTIMEZONE', 'BEGIN:VEVENT', 'UID:x', 'DTSTAMP:20261018T000000Z', 'DTSTART;TZID=America/Chicago:20261103T093000', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');

describe('icsFilename', () => {
  it('uses the VEVENT DTSTART of a timed event', () => {
    expect(icsFilename(TIMED)).toBe('court-date-2026-11-03.ics');
  });
  it('uses the VEVENT DTSTART of an all-day event', () => {
    expect(icsFilename('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261231\r\nEND:VEVENT\r\nEND:VCALENDAR')).toBe('court-date-2026-12-31.ics');
  });
  it('falls back to a generic name', () => {
    expect(icsFilename('BEGIN:VCALENDAR\r\nEND:VCALENDAR')).toBe('court-date.ics');
  });
});
