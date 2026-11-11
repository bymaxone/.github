'use strict';
const { initials, isBlank } = require('../src/text.js');

describe('text', () => {
  it('builds upper-case initials from each word', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('grace hopper')).toBe('GH');
  });

  it('treats whitespace as blank', () => {
    expect(isBlank('   ')).toBe(true);
    expect(isBlank(' a ')).toBe(false);
  });
});
