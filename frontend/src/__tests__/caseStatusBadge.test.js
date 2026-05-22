/**
 * caseStatusBadge.test.js — Case status badge color logic
 */
const STATUS_COLORS = { Active:'#1565C0', Open:'#1565C0', Closed:'#616161', Pending:'#F57F17', Resolved:'#2E7D32' };
const getStatusColor = (s) => STATUS_COLORS[s] || '#9E9E9E';

describe('Case status badge colors', () => {
  it('Active gets blue', () => { expect(getStatusColor('Active')).toBe('#1565C0'); });
  it('Closed gets grey', () => { expect(getStatusColor('Closed')).toBe('#616161'); });
  it('Pending gets amber', () => { expect(getStatusColor('Pending')).toBe('#F57F17'); });
  it('unknown falls back to default', () => { expect(getStatusColor('Unknown')).toBe('#9E9E9E'); });
  it('null falls back to default', () => { expect(getStatusColor(null)).toBe('#9E9E9E'); });
  it('all defined statuses have valid hex colors', () => {
    Object.values(STATUS_COLORS).forEach(c => { expect(c.startsWith('#')).toBe(true); });
  });
});

describe('Case sort by court date', () => {
  const sort = (cases) => [...cases].sort((a, b) => {
    const da = a.next_court_date ? new Date(a.next_court_date ?? 0).getTime() : Infinity;
    const db = b.next_court_date ? new Date(b.next_court_date ?? 0).getTime() : Infinity;
    return da - db;
  });
  it('earlier court date sorts first', () => {
    const sorted = sort([{id:1, next_court_date:'2026-06-15'},{id:2, next_court_date:'2026-03-10'}]);
    expect(sorted[0].id).toBe(2);
  });
  it('null court date sorts last', () => {
    const sorted = sort([{id:1, next_court_date:null},{id:2, next_court_date:'2026-06-15'}]);
    expect(sorted[0].id).toBe(2);
  });
});
