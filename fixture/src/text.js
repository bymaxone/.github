'use strict';

function initials(name) {
  return name
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

function isBlank(text) {
  return text.trim().length === 0;
}

function shout(text) {
  return `${text.toUpperCase()}!`;
}

// Read while the spec is collected, to build its `it.each` table.
function sampleWords() {
  return [['hello', 'HELLO!'], ['a b', 'A B!']];
}

module.exports = { initials, isBlank, sampleWords, shout };
