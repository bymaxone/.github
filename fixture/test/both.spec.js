'use strict';
const { clamp, sumTo } = require('../src/math.js');
const { initials, isBlank } = require('../src/text.js');

// Reaches both source files, so with two shards the same test runs in each and its id has to be
// reconciled by the merge.
describe('math and text together', () => {
  it('clamps a number derived from text', () => {
    expect(clamp(initials('a b c').length * 40)).toBe(100);
    expect(isBlank(String(sumTo(3)))).toBe(false);
  });
});
