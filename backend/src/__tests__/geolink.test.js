import { haversineKm, haversineMiles, bboxFromLatLng } from '../services/geolink.js';

describe('geolink — haversine distance', () => {
  test('same point is 0 km', () => {
    expect(haversineKm(36.17, -86.78, 36.17, -86.78)).toBe(0);
  });

  test('Nashville to Memphis ~340 km', () => {
    const d = haversineKm(36.17, -86.78, 35.15, -90.05);
    expect(d).toBeGreaterThan(300);
    expect(d).toBeLessThan(350);
  });

  test('haversineMiles Nashville→Memphis ~212 miles', () => {
    const d = haversineMiles(36.17, -86.78, 35.15, -90.05);
    expect(d).toBeGreaterThan(185);
    expect(d).toBeLessThan(220);
  });

  test('bboxFromLatLng returns 4 valid bounds', () => {
    const bbox = bboxFromLatLng(36.17, -86.78, 25);
    expect(bbox.minLat).toBeLessThan(36.17);
    expect(bbox.maxLat).toBeGreaterThan(36.17);
    expect(bbox.minLng).toBeLessThan(-86.78);
    expect(bbox.maxLng).toBeGreaterThan(-86.78);
  });

  test('bboxFromLatLng 0-mile radius collapses to a point', () => {
    const bbox = bboxFromLatLng(36.17, -86.78, 0);
    expect(bbox.minLat).toBeCloseTo(bbox.maxLat, 4);
    expect(bbox.minLng).toBeCloseTo(bbox.maxLng, 4);
  });
});
