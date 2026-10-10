// Pure maths for the dashboard's server-drawn SVG charts: a y-axis with whole-number steps, and
// the line and area paths. Counts only, never money, so plain numbers are fine here.

export const AXIS_STEPS = 4;

export type Point = { readonly x: number; readonly y: number };

export type PlotArea = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

// A step of 1, 2 or 5 times a power of ten, so the axis reads 0, 5, 10, 15, 20 and not 0, 4.25…
function niceStep(roughStep: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const multiple = [1, 2, 5, 10].find((candidate) => candidate * magnitude >= roughStep) ?? 10;
  return multiple * magnitude;
}

// The top of the y-axis. An empty chart still gets a 0 to 4 axis so it doesn't collapse.
export function niceAxisMax(largestValue: number): number {
  if (largestValue <= AXIS_STEPS) {
    return AXIS_STEPS;
  }
  return niceStep(largestValue / AXIS_STEPS) * AXIS_STEPS;
}

export function axisTicks(axisMax: number): number[] {
  const step = axisMax / AXIS_STEPS;
  return Array.from({ length: AXIS_STEPS + 1 }, (_, index) => index * step);
}

export function yFor(value: number, axisMax: number, area: PlotArea): number {
  return area.top + area.height - (value / axisMax) * area.height;
}

// Evenly spaced from the left edge to the right edge of the plot.
export function xForIndex(index: number, count: number, area: PlotArea): number {
  if (count <= 1) {
    return area.left + area.width / 2;
  }
  return area.left + (index / (count - 1)) * area.width;
}

export function toPoints(values: readonly number[], axisMax: number, area: PlotArea): Point[] {
  return values.map((value, index) => ({
    x: xForIndex(index, values.length, area),
    y: yFor(value, axisMax, area),
  }));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function linePath(points: readonly Point[]): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${round(point.x)} ${round(point.y)}`)
    .join(' ');
}

// The line, then straight down to the baseline and back, so it can be filled.
export function areaPath(points: readonly Point[], baselineY: number): string {
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) {
    return '';
  }
  return `${linePath(points)} L${round(last.x)} ${round(baselineY)} L${round(first.x)} ${round(baselineY)} Z`;
}
