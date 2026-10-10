import {
  areaPath,
  axisTicks,
  linePath,
  niceAxisMax,
  type PlotArea,
  toPoints,
  xForIndex,
  yFor,
} from '../chart-scale.js';

// Server-drawn SVG charts (no client-side JavaScript). Colours come from the stylesheet through
// the `tone` class names; the gradients are SVG attributes because the CSP blocks inline styles.

export type ChartTone = 'cyan' | 'green' | 'blue' | 'sky' | 'pale';

export type ChartSeries = {
  readonly name: string;
  readonly tone: ChartTone;
  readonly values: readonly number[];
};

function Legend(props: { series: readonly ChartSeries[]; shape: 'dot' | 'square' }) {
  return (
    <ul class="legend">
      {props.series.map((series) => (
        <li>
          <span class={`swatch ${props.shape} ${series.tone}`} />
          {series.name}
        </li>
      ))}
    </ul>
  );
}

function largestValue(series: readonly ChartSeries[]): number {
  return Math.max(0, ...series.flatMap((one) => one.values));
}

function YAxis(props: { axisMax: number; area: PlotArea }) {
  const right = props.area.left + props.area.width;
  return (
    <g class="axis">
      {axisTicks(props.axisMax).map((tick) => {
        const y = yFor(tick, props.axisMax, props.area);
        return (
          <>
            <line x1={props.area.left} x2={right} y1={y} y2={y} class="grid" />
            <text x={props.area.left - 10} y={y + 4} text-anchor="end">
              {String(tick)}
            </text>
          </>
        );
      })}
    </g>
  );
}

const LINE_AREA: PlotArea = { left: 44, top: 12, width: 656, height: 150 };

const GRADIENT_COLOURS: Readonly<Record<ChartTone, string>> = {
  cyan: '#38bdf8',
  green: '#22c55e',
  blue: '#1d6cf2',
  sky: '#60a5fa',
  pale: '#bfdbfe',
};

function LineGradients(props: { series: readonly ChartSeries[] }) {
  return (
    <defs>
      {props.series.map((series) => (
        <linearGradient id={`fill-${series.tone}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={GRADIENT_COLOURS[series.tone]} stop-opacity="0.35" />
          <stop offset="1" stop-color={GRADIENT_COLOURS[series.tone]} stop-opacity="0.02" />
        </linearGradient>
      ))}
    </defs>
  );
}

function LineSeriesShape(props: { series: ChartSeries; axisMax: number }) {
  const points = toPoints(props.series.values, props.axisMax, LINE_AREA);
  const baseline = LINE_AREA.top + LINE_AREA.height;
  return (
    <g class={`series ${props.series.tone}`}>
      <path d={areaPath(points, baseline)} fill={`url(#fill-${props.series.tone})`} />
      <path d={linePath(points)} class="line" />
      {points.map((point) => (
        <circle cx={point.x} cy={point.y} r="3.5" class="point" />
      ))}
    </g>
  );
}

// One line per series over shared x labels, the first series drawn at the back.
export function LineChart(props: {
  description: string;
  labels: readonly string[];
  series: readonly ChartSeries[];
}) {
  const axisMax = niceAxisMax(largestValue(props.series));
  const labelY = LINE_AREA.top + LINE_AREA.height + 24;
  return (
    <figure class="chart">
      <svg viewBox="0 0 720 200" role="img" class="chart-svg">
        <title>{props.description}</title>
        <LineGradients series={props.series} />
        <YAxis axisMax={axisMax} area={LINE_AREA} />
        {props.labels.map((label, index) => (
          <text
            x={xForIndex(index, props.labels.length, LINE_AREA)}
            y={labelY}
            text-anchor="middle"
            class="axis"
          >
            {label}
          </text>
        ))}
        {props.series.map((series) => (
          <LineSeriesShape series={series} axisMax={axisMax} />
        ))}
      </svg>
      <Legend series={props.series} shape="dot" />
    </figure>
  );
}

const BAR_AREA: PlotArea = { left: 34, top: 12, width: 316, height: 150 };
const BAR_WIDTH = 8;
const BAR_GAP = 3;

function BarGroup(props: {
  series: readonly ChartSeries[];
  groupIndex: number;
  groupCount: number;
  axisMax: number;
}) {
  const groupWidth = BAR_AREA.width / props.groupCount;
  const barsWidth = props.series.length * BAR_WIDTH + (props.series.length - 1) * BAR_GAP;
  const groupLeft = BAR_AREA.left + props.groupIndex * groupWidth + (groupWidth - barsWidth) / 2;
  const baseline = BAR_AREA.top + BAR_AREA.height;
  return (
    <>
      {props.series.map((series, seriesIndex) => {
        const value = series.values[props.groupIndex] ?? 0;
        if (value === 0) {
          return null;
        }
        const top = yFor(value, props.axisMax, BAR_AREA);
        return (
          <rect
            x={groupLeft + seriesIndex * (BAR_WIDTH + BAR_GAP)}
            y={top}
            width={BAR_WIDTH}
            height={baseline - top}
            rx="2"
            class={`bar ${series.tone}`}
          />
        );
      })}
    </>
  );
}

// Bars side by side for each label (a "grouped" bar chart).
export function BarChart(props: {
  description: string;
  labels: readonly string[];
  series: readonly ChartSeries[];
}) {
  const axisMax = niceAxisMax(largestValue(props.series));
  const groupWidth = BAR_AREA.width / props.labels.length;
  return (
    <figure class="chart">
      <svg viewBox="0 0 360 200" role="img" class="chart-svg">
        <title>{props.description}</title>
        <YAxis axisMax={axisMax} area={BAR_AREA} />
        {props.labels.map((label, index) => (
          <>
            <BarGroup
              series={props.series}
              groupIndex={index}
              groupCount={props.labels.length}
              axisMax={axisMax}
            />
            <text
              x={BAR_AREA.left + index * groupWidth + groupWidth / 2}
              y={BAR_AREA.top + BAR_AREA.height + 24}
              text-anchor="middle"
              class="axis"
            >
              {label}
            </text>
          </>
        ))}
      </svg>
      <Legend series={props.series} shape="square" />
    </figure>
  );
}
