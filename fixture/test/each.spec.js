'use strict';
const { sampleWords, shout } = require('../src/text.js');

// A mutant that empties the table makes Jest report one test under the unformatted `%s` title, so
// that title becomes the id of the test that killed it; the shard merge has to map that id back to
// the rows the unmutated run lists.
describe('shout', () => {
  it.each(sampleWords())('adds an exclamation mark in row %#', (word, expected) => {
    expect(shout(word)).toBe(expected);
  });
});
