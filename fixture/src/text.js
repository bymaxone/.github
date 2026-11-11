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

module.exports = { initials, isBlank };
