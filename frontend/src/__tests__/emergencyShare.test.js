/**
 * emergencyShare.test.js — Tests for emergency share message building
 */

describe('Emergency share buildMessage', () => {
  const buildMessage = (name, lat, lng, bondsmanPhone, lawyerPhone) => {
    const mapsLink = `https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
    const lines = [
      `${name} needs legal help right now.`,
      ``,
      `Their location:`,
      mapsLink,
      ``,
    ];
    if (bondsmanPhone) { lines.push(`Bail bondsman (call now):`); lines.push(bondsmanPhone); lines.push(``); }
    if (lawyerPhone) { lines.push(`Criminal defense lawyer:`); lines.push(lawyerPhone); lines.push(``); }
    lines.push(`Sent via Justice Gavel -- justicegavel.app`);
    return lines.join('\n');
  };

  it('includes victim name', () => {
    expect(buildMessage('John Doe', 36.17, -86.78, null, null)).toContain('John Doe');
  });

  it('includes GPS coordinates in maps link', () => {
    const msg = buildMessage('Jane', 36.174993, -86.781567, null, null);
    expect(msg).toContain('36.174993');
    expect(msg).toContain('-86.781567');
    expect(msg).toContain('maps.google.com');
  });

  it('includes bondsman phone when provided', () => {
    const msg = buildMessage('Test', 36.1, -86.7, '615-555-0100', null);
    expect(msg).toContain('615-555-0100');
    expect(msg).toContain('Bail bondsman');
  });

  it('includes lawyer phone when provided', () => {
    const msg = buildMessage('Test', 36.1, -86.7, null, '615-555-0200');
    expect(msg).toContain('615-555-0200');
    expect(msg).toContain('defense lawyer');
  });

  it('omits bondsman section when phone is null', () => {
    expect(buildMessage('Test', 36.1, -86.7, null, '615-555-0200')).not.toContain('Bail bondsman');
  });

  it('omits lawyer section when phone is null', () => {
    expect(buildMessage('Test', 36.1, -86.7, '615-555-0100', null)).not.toContain('defense lawyer');
  });

  it('always ends with Justice Gavel attribution', () => {
    const msg = buildMessage('Test', 36.1, -86.7, null, null);
    expect(msg).toContain('Justice Gavel');
    expect(msg).toContain('justicegavel.app');
  });

  it('includes both bondsman and lawyer when both provided', () => {
    const msg = buildMessage('Test', 36.1, -86.7, '555-0100', '555-0200');
    expect(msg).toContain('555-0100');
    expect(msg).toContain('555-0200');
  });
});
