import { describe, expect, it } from 'vitest';
import {
  areaPath,
  axisTicks,
  linePath,
  niceAxisMax,
  type PlotArea,
  toPoints,
  xForIndex,
} from '../../src/web/chart-scale.js';

const AREA: PlotArea = { left: 10, top: 0, width: 100, height: 50 };

describe('niceAxisMax', () => {
  it.each([
    [0, 4],
    [3, 4],
    [5, 8],
    [9, 20],
    [37, 40],
    [130, 200],
  ])('rounds a largest value of %i up to an axis top of %i', (largestValue, axisMax) => {
    expect(niceAxisMax(largestValue)).toBe(axisMax);
  });
});

describe('axisTicks', () => {
  it('splits the axis into four whole steps', () => {
    expect(axisTicks(20)).toEqual([0, 5, 10, 15, 20]);
  });
});

describe('toPoints', () => {
  it('spreads values from the left edge to the right edge, zero at the bottom', () => {
    expect(toPoints([0, 2, 4], 4, AREA)).toEqual([
      { x: 10, y: 50 },
      { x: 60, y: 25 },
      { x: 110, y: 0 },
    ]);
  });

  it('centres a single value', () => {
    expect(xForIndex(0, 1, AREA)).toBe(60);
  });
});

describe('linePath and areaPath', () => {
  const points = [
    { x: 10, y: 50 },
    { x: 60, y: 25.25 },
  ];

  it('draws a line through every point', () => {
    expect(linePath(points)).toBe('M10 50 L60 25.3');
  });

  it('closes the area along the baseline', () => {
    expect(areaPath(points, 50)).toBe('M10 50 L60 25.3 L60 50 L10 50 Z');
  });

  it('draws nothing for no points', () => {
    expect(areaPath([], 50)).toBe('');
  });
});
