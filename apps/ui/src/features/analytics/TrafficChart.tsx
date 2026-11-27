import * as sx from "@stylexjs/stylex";
import { Button, Panel, SegmentedControl, Status } from "@from-trees/ui";
import { color, metrics } from "@from-trees/ui/tokens.stylex";
import { useState } from "react";
import { date, hour, hourTick, number, type Counts, type Point } from "./model";

const styles = sx.create({
  chart: { display: "grid", gridTemplateColumns: "max-content minmax(0,1fr)", gap: 8 },
  scale: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    fontSize: metrics.small,
    textAlign: "right",
    color: color.muted,
    paddingBlock: 2,
  },
  graph: { width: "100%", height: 158, display: "block", overflow: "visible" },
  axis: {
    display: "flex",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 4,
    color: color.muted,
    fontSize: metrics.small,
  },
  grid: { stroke: color.border, strokeWidth: 1 },
  line: { stroke: color.accent, strokeWidth: 2, fill: "none" },
  area: { fill: color.accent, opacity: 0.12 },
  marker: { stroke: color.accent, strokeWidth: 1, strokeDasharray: "3 3" },
  point: { fill: color.accent },
  detail: { color: color.muted, fontSize: metrics.small, minHeight: 18, margin: 0 },
  totals: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "start" },
  metric: { display: "grid", textAlign: "left", lineHeight: "1.2" },
  totalTitle: { fontSize: metrics.small, color: color.muted },
  totalValue: { fontSize: 21, fontWeight: 650, fontVariantNumeric: "tabular-nums" },
});

export type Grain = "day" | "hour";
const measures: { key: keyof Counts; label: string }[] = [
  { key: "sessions", label: "Sessions" },
  { key: "views", label: "Browser views" },
  { key: "arrivals", label: "Server arrivals" },
  { key: "inquiries", label: "Accepted inquiries" },
];
const grouping = [
  { value: "hour", label: "Hourly" },
  { value: "day", label: "Daily" },
];

export function TrafficChart({
  series,
  grain,
  onGrain,
  filtered,
  measure,
  onMeasure,
}: {
  series: Point[];
  grain: Grain;
  onGrain: (grain: Grain) => void;
  filtered: boolean;
  measure: keyof Counts;
  onMeasure: (measure: keyof Counts) => void;
}) {
  const [point, setPoint] = useState<number | null>(null);
  const active = filtered && measure === "arrivals" ? "sessions" : measure;
  const shown = measures.filter(({ key }) => !filtered || key !== "arrivals");
  const name = measures.find(({ key }) => key === active)!.label;
  const values = series.map((entry) => entry[active]);
  const selected = point === null ? values.length - 1 : Math.min(point, values.length - 1);
  const reportDate = grain === "hour" ? hour : date;
  const tickDate = grain === "hour" ? hourTick : date;
  const step = Math.max(1, Math.ceil(values.reduce((max, value) => Math.max(max, value), 0) / 3));
  const x = (index: number) => (values.length < 2 ? 500 : (index / (values.length - 1)) * 998 + 1);
  const y = (value: number) => 148 - (value / (step * 3)) * 138;
  const line = values
    .map((value, index) => `${index ? "L" : "M"}${x(index)} ${y(value)}`)
    .join(" ");
  const ticks =
    values.length > 2
      ? [0, Math.floor(values.length / 2), values.length - 1]
      : values.map((_, i) => i);

  return (
    <Panel
      title="Traffic over time"
      actions={
        <SegmentedControl
          label="Time grouping"
          value={grain}
          options={grouping}
          onChange={(value) => {
            setPoint(null);
            onGrain(value === "hour" ? "hour" : "day");
          }}
        />
      }
    >
      <div role="group" aria-label="Traffic measure" {...sx.props(styles.totals)}>
        {shown.map(({ key, label }) => (
          <Button
            key={key}
            variant={active === key ? "secondary" : "ghost"}
            aria-pressed={active === key}
            onPress={() => onMeasure(key)}
          >
            <span {...sx.props(styles.metric)}>
              <span {...sx.props(styles.totalTitle)}>{label}</span>
              <strong {...sx.props(styles.totalValue)}>
                {number.format(series.reduce((sum, entry) => sum + entry[key], 0))}
              </strong>
            </span>
          </Button>
        ))}
      </div>
      {values.length === 0 ? (
        <Status>No recorded activity in this date range.</Status>
      ) : (
        <>
          <div {...sx.props(styles.chart)}>
            <div aria-hidden="true" {...sx.props(styles.scale)}>
              {[3, 2, 1, 0].map((tick) => (
                <span key={tick}>{number.format(tick * step)}</span>
              ))}
            </div>
            <svg
              role="img"
              aria-label={`${name} by ${grain}`}
              viewBox="0 0 1000 158"
              preserveAspectRatio="none"
              {...sx.props(styles.graph)}
              onPointerMove={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                setPoint(
                  Math.min(
                    values.length - 1,
                    Math.max(
                      0,
                      Math.round(
                        ((event.clientX - bounds.left) / bounds.width) * (values.length - 1)
                      )
                    )
                  )
                );
              }}
              onPointerLeave={() => setPoint(null)}
            >
              {[0, 1, 2, 3].map((tick) => (
                <line
                  key={tick}
                  x1="0"
                  x2="1000"
                  y1={y(tick * step)}
                  y2={y(tick * step)}
                  vectorEffect="non-scaling-stroke"
                  {...sx.props(styles.grid)}
                />
              ))}
              <path
                d={`${line} L${x(values.length - 1)} 148 L${x(0)} 148 Z`}
                {...sx.props(styles.area)}
              />
              <path d={line} vectorEffect="non-scaling-stroke" {...sx.props(styles.line)} />
              <line
                x1={x(selected)}
                x2={x(selected)}
                y1="10"
                y2="148"
                vectorEffect="non-scaling-stroke"
                {...sx.props(styles.marker)}
              />
              <ellipse
                cx={x(selected)}
                cy={y(values[selected])}
                rx="6"
                ry="3"
                {...sx.props(styles.point)}
              />
            </svg>
            <div />
            <div aria-hidden="true" {...sx.props(styles.axis)}>
              {ticks.map((index) => (
                <span key={index}>{tickDate.format(Date.parse(series[index].at))}</span>
              ))}
            </div>
          </div>
          <p {...sx.props(styles.detail)}>
            {reportDate.format(Date.parse(series[selected].at))} · {number.format(values[selected])}{" "}
            {name.toLowerCase()}
          </p>
        </>
      )}
    </Panel>
  );
}
