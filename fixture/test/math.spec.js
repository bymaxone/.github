'use strict';
const { clamp, sumTo } = require('../src/math.js');

describe('math', () => {
  it('keeps a value inside the bounds', () => {
    expect(clamp(-5)).toBe(0);
    expect(clamp(500)).toBe(100);
    expect(clamp(50)).toBe(50);
  });

  it('sums the integers from one to n', () => {
    expect(sumTo(0)).toBe(0);
    expect(sumTo(4)).toBe(10);
  });
});
