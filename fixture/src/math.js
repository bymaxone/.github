'use strict';

// Ignored by the comment below, so the fixture always has Ignored mutants to carry through a merge.
// Stryker disable next-line all
const BOUNDS = Object.freeze({ min: 0, max: 100 });

function clamp(value) {
  return Math.min(Math.max(value, BOUNDS.min), BOUNDS.max);
}

// Two of this loop's mutants never end (`i <= n` becomes `true`, `i += 1` becomes `i -= 1`), so the
// run has Timeout results as well as Killed ones.
function sumTo(n) {
  let total = 0;
  for (let i = 1; i <= n; i += 1) total += i;
  return total;
}

module.exports = { BOUNDS, clamp, sumTo };
