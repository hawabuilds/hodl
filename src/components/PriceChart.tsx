"use client";

import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LastPriceAnimationMode,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import {cn} from "@/lib/cn";
import {useTheme} from "@/hooks/useTheme";
import {
  isHistoryPrepend,
  isLiveEdgeUpdate,
  isLwcWhitespace,
  LWC_RIGHT_OFFSET_PIXELS,
  launchInLogicalView,
  lwcCandleStyleOptions,
  lwcLayoutOptions,
  lwcTimeScaleOptions,
  lwcVisibleTimeRange,
  shouldAutoFitVisibleRange,
  normalizeLwcPoints,
  toCandleData,
  toLineData,
  toUtcSeconds,
  withCompressedSessionBreaks,
} from "@/lib/chartLwc";
import {CHART_WINDOW_BARS, TIMEFRAME_MS, gapBreakMsForWindow} from "@/lib/chartPlot";
import {formatAxisUsd, priceMinMove} from "@/lib/priceFormat";
import type {ChartPoint, ChartStyle} from "@/lib/types";

interface PriceChartProps {
  points: ChartPoint[];
  /**
   * Pixels, or any CSS length. The chart sizes itself to its host, so a CSS
   * length such as `clamp(240px, 36vh, 400px)` follows the window without the
   * chart being torn down and rebuilt.
   */
  height?: number | string;
  /**
   * Overrides the up / down colour, e.g. for a portfolio line. Otherwise the
   * line is green when the price is up across the bars in view, red when down.
   */
  positive?: boolean;
  /** Up or down across the bars in view, as the line is coloured. */
  onTrend?: (up: boolean) => void;
  /** A token or stock page: the hovered bar's time shows on the time axis. */
  live?: boolean;
  /**
   * Requested window, used only for gap-break policy (1m/5m stay one
   * polyline; coarser pills still break on a silent stretch). The x-axis
   * is the real series plus a small right pad, not this window.
   */
  windowMs?: number;
  emptyLabel?: string;
  className?: string;
  style?: ChartStyle;
  /**
   * First-print / launch price. When that history is in view the Y-scale
   * floors here so a pump rises from launch instead of floating mid-axis.
   */
  floorPrice?: number | null;
  /** Pan-left: ask the page for older real candles. */
  onNeedOlder?: () => void;
  /**
   * Fires as a finger or cursor moves across the chart, and with null when it
   * leaves. The header price follows this so the number under the scrubber is
   * the one being read, not the live one. `viewStart` is the first bar in view,
   * for "+x% from start of view".
   */
  onScrub?: (point: ChartPoint | null, viewStart?: ChartPoint | null) => void;
}

type SeriesApi = ISeriesApi<"Area"> | ISeriesApi<"Candlestick">;

interface ChartColors {
  green: string;
  red: string;
  faint: string;
  hairline: string;
  ink: string;
  card: string;
}

function readColors(el: HTMLElement): ChartColors {
  const css = getComputedStyle(el);
  return {
    green: css.getPropertyValue("--price-up").trim(),
    red: css.getPropertyValue("--price-down").trim(),
    faint: css.getPropertyValue("--text-tertiary").trim(),
    hairline: css.getPropertyValue("--border-default").trim(),
    ink: css.getPropertyValue("--text-primary").trim(),
    card:
      css.getPropertyValue("--bg-base").trim() ||
      css.getPropertyValue("--surface-base").trim(),
  };
}

function asTime(seconds: number): UTCTimestamp {
  return seconds as UTCTimestamp;
}

function pointAtTime(points: ChartPoint[], time: Time): ChartPoint | null {
  if (typeof time !== "number") return null;
  return points.find((point) => toUtcSeconds(point.t) === time) ?? null;
}

/** The first and last real bars inside the visible time range. */
function barsInView(
  chart: IChartApi,
  points: ChartPoint[],
): {first: ChartPoint; last: ChartPoint} | null {
  if (points.length === 0) return null;
  const range = chart.timeScale().getVisibleRange();
  if (!range || typeof range.from !== "number" || typeof range.to !== "number") {
    return {first: points[0], last: points[points.length - 1]};
  }
  const from = range.from;
  const to = range.to;
  const inView = points.filter((point) => {
    const t = toUtcSeconds(point.t);
    return t >= from && t <= to;
  });
  if (inView.length === 0) return null;
  return {first: inView[0], last: inView[inView.length - 1]};
}

function floorAutoscale(chart: IChartApi, floor?: number | null) {
  return (
    original: () => {
      priceRange: {minValue: number; maxValue: number};
      margins?: {above: number; below: number};
    } | null,
  ) => {
    const res = original();
    if (
      !res?.priceRange ||
      floor == null ||
      !(floor > 0) ||
      !launchInLogicalView(chart.timeScale().getVisibleLogicalRange())
    ) {
      return res;
    }
    return {
      ...res,
      priceRange: {
        minValue: Math.min(res.priceRange.minValue, floor),
        maxValue: Math.max(res.priceRange.maxValue, floor),
      },
    };
  };
}

/**
 * Lightweight Charts wrapper.
 *
 * Domain is the real series plus a small right pad. Closed-market holes stay
 * holes (no forward-fill); LWC equal-spaces real prints so a weekend does not
 * dominate the width. Auto-fit only on first load, interval/style change, or
 * double-tap — live updates must not yank a user pan back to the newest bar.
 */
export function PriceChart({
  points,
  height = 190,
  positive,
  onTrend,
  live = false,
  windowMs,
  emptyLabel = "Not enough history yet",
  className,
  style = "line",
  floorPrice,
  onNeedOlder,
  onScrub,
}: PriceChartProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<SeriesApi | null>(null);
  const pointsRef = useRef(points);
  const prevPointsRef = useRef<ChartPoint[]>([]);
  const styleRef = useRef(style);
  const fittedKeyRef = useRef("");
  const lastTapRef = useRef(0);
  const onScrubRef = useRef(onScrub);
  const onTrendRef = useRef(onTrend);
  const onNeedOlderRef = useRef(onNeedOlder);
  const floorPriceRef = useRef(floorPrice);
  const {theme} = useTheme();

  pointsRef.current = points;
  onScrubRef.current = onScrub;
  onTrendRef.current = onTrend;
  onNeedOlderRef.current = onNeedOlder;
  floorPriceRef.current = floorPrice;

  // Green when the price is up across the bars in view, red when down.
  // Starts from the whole series and follows the view once it is drawn.
  const [viewUp, setViewUp] = useState(true);
  const up = positive ?? viewUp;
  const color = up ? "var(--green)" : "var(--red)";

  const refreshTrend = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const bars = barsInView(chart, pointsRef.current);
    if (!bars) return;
    const next = bars.last.price >= bars.first.price;
    setViewUp(next);
    onTrendRef.current?.(next);
  }, []);

  // The axis steps as finely as the price moves: a thousandth of the smallest
  // bar. The default $0.01 left a token at $0.0000025 one tick, at zero.
  const minMove = useMemo(() => priceMinMove(points.map((point) => point.price)), [points]);
  const minMoveRef = useRef(minMove);
  minMoveRef.current = minMove;

  const seriesData = useMemo(() => {
    // Cleaned once so the bars and their real times stay the same length, and
    // so LWC never sees two points in one second — see `normalizeLwcPoints`.
    const clean = normalizeLwcPoints(points);
    const times = clean.map((point) => point.t);
    const gapMs = gapBreakMsForWindow(windowMs);
    if (style === "candles") {
      return withCompressedSessionBreaks(toCandleData(clean), times, gapMs);
    }
    return withCompressedSessionBreaks(toLineData(clean), times, gapMs);
  }, [points, style, windowMs]);

  const bucketMs =
    windowMs != null && windowMs > 0 ? windowMs / CHART_WINDOW_BARS : undefined;
  const intraday = bucketMs != null && bucketMs <= TIMEFRAME_MS["5m"];
  const scaleOptsFor = (barCount: number) =>
    lwcTimeScaleOptions({intraday, barCount});

  const applyFit = useCallback(() => {
    const chart = chartRef.current;
    if (!chart || pointsRef.current.length < 2) return;
    chart.timeScale().applyOptions(scaleOptsFor(pointsRef.current.length));
    const range = lwcVisibleTimeRange(pointsRef.current);
    if (range) {
      const timeScale = chart.timeScale();
      // A fitted time range centres the last bar half a bar in from the edge.
      // A candle needs that half bar for its body; a line does not, and zoomed
      // in on a wide pane the half bar was 30-40px of nothing between the line
      // and the price axis. So a line is fitted by bar index instead, running
      // on to the same small pad as everything else.
      const first = timeScale.timeToIndex(asTime(range.from), true);
      const last = timeScale.timeToIndex(asTime(range.to), true);
      const width = timeScale.width();
      if (
        style === "line" &&
        first !== null &&
        last !== null &&
        last > first &&
        width > 0
      ) {
        const spacing = width / (last - first + 1);
        timeScale.setVisibleLogicalRange({
          from: first,
          to: last - 0.5 + LWC_RIGHT_OFFSET_PIXELS / spacing,
        });
      } else {
        timeScale.setVisibleRange({
          from: asTime(range.from),
          to: asTime(range.to),
        });
      }
    } else {
      chart.timeScale().fitContent();
    }
  }, [intraday, style]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const colors = readColors(host);
    const chart = createChart(host, {
      autoSize: true,
      ...(typeof height === "number" ? {height} : {}),
      layout: {
        background: {type: ColorType.Solid, color: "transparent"},
        textColor: colors.faint,
        fontFamily: "inherit",
        ...lwcLayoutOptions(),
      },
      // No lines across the chart at all — no grid, no previous-close rule, no
      // last-price line. The axis labels carry the scale.
      grid: {
        vertLines: {visible: false},
        horzLines: {visible: false},
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: {top: 0.08, bottom: 0.06},
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        ...lwcTimeScaleOptions({intraday, barCount: pointsRef.current.length}),
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: {
          color: colors.hairline,
          width: 1,
          style: LineStyle.Solid,
          // On a token page the hovered bar's time sits on the time axis;
          // the header above has room for the price and its change only.
          labelVisible: live,
        },
        horzLine: {visible: false, labelVisible: false},
      },
      handleScroll: {
        vertTouchDrag: false,
        horzTouchDrag: true,
        mouseWheel: true,
        pressedMouseMove: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        pinch: true,
        mouseWheel: true,
        axisDoubleClickReset: true,
      },
      localization: {
        priceFormatter: (value: number) => formatAxisUsd(value, minMoveRef.current),
      },
    });

    chartRef.current = chart;

    const onCrosshair = (param: {time?: Time}) => {
      if (param.time === undefined) {
        onScrubRef.current?.(null);
        return;
      }
      const view = barsInView(chart, pointsRef.current);
      onScrubRef.current?.(pointAtTime(pointsRef.current, param.time), view?.first ?? null);
    };
    chart.subscribeCrosshairMove(onCrosshair);

    const onRange = (range: {from: number; to: number} | null) => {
      refreshTrend();
      if (!range || range.from > 2) return;
      onNeedOlderRef.current?.();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);

    return () => {
      chart.unsubscribeCrosshairMove(onCrosshair);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      prevPointsRef.current = [];
      fittedKeyRef.current = "";
    };
  }, [height, live, refreshTrend]);

  useEffect(() => {
    const chart = chartRef.current;
    const host = hostRef.current;
    if (!chart || !host) return;

    const colors = readColors(host);
    chart.applyOptions({
      layout: {textColor: colors.faint},
      crosshair: {vertLine: {color: colors.hairline}},
    });
    const lineColor = up ? colors.green : colors.red;
    const seriesChanged = styleRef.current !== style || seriesRef.current == null;
    styleRef.current = style;
    const scaleOpts = {
      autoscaleInfoProvider: floorAutoscale(chart, floorPriceRef.current),
      priceFormat: {
        type: "custom" as const,
        minMove,
        formatter: (value: number) => formatAxisUsd(value, minMove),
      },
    };
    // No last-price line, no price tag on the axis for it, no live dot: the
    // header above the chart already says where the price is now.
    const lastPrice = {
      priceLineVisible: false,
      lastValueVisible: false,
    };

    if (seriesChanged) {
      if (seriesRef.current) {
        chart.removeSeries(seriesRef.current);
        seriesRef.current = null;
      }
      seriesRef.current =
        style === "candles"
          ? chart.addSeries(CandlestickSeries, {
              ...lwcCandleStyleOptions(colors),
              ...lastPrice,
              ...scaleOpts,
            })
          : chart.addSeries(AreaSeries, {
              lineColor,
              topColor: `${lineColor}33`,
              bottomColor: "transparent",
              lineWidth: 2,
              ...lastPrice,
              lastPriceAnimation: LastPriceAnimationMode.Disabled,
              crosshairMarkerRadius: 4,
              ...scaleOpts,
            });
      prevPointsRef.current = [];
    } else if (seriesRef.current && style === "line") {
      seriesRef.current.applyOptions({
        lineColor,
        topColor: `${lineColor}33`,
        ...scaleOpts,
      });
    } else if (seriesRef.current) {
      seriesRef.current.applyOptions({
        ...lwcCandleStyleOptions(colors),
        ...lastPrice,
        ...scaleOpts,
      });
    }

    const series = seriesRef.current;
    if (!series || seriesData.length === 0) return;

    const prevPoints = prevPointsRef.current;
    const liveEdge = !seriesChanged && isLiveEdgeUpdate(prevPoints, points);
    const prepend = !seriesChanged && isHistoryPrepend(prevPoints, points);
    const last = seriesData[seriesData.length - 1];
    const visible = prepend
      ? chart.timeScale().getVisibleLogicalRange()
      : null;
    const identityKey = `${style}:${windowMs ?? ""}`;
    const shouldFit = shouldAutoFitVisibleRange({
      hasFitted: fittedKeyRef.current === identityKey,
      liveEdge,
      prepend,
      seriesIdentityChanged:
        fittedKeyRef.current !== "" && fittedKeyRef.current !== identityKey,
    });

    if (liveEdge && last && !isLwcWhitespace(last)) {
      series.update(last as never);
    } else {
      series.setData(seriesData as never);
      if (visible && prepend) {
        const added = points.length - prevPoints.length;
        chart.timeScale().setVisibleLogicalRange({
          from: visible.from + added,
          to: visible.to + added,
        });
      }
    }
    prevPointsRef.current = points;

    if (shouldFit) {
      fittedKeyRef.current = identityKey;
      applyFit();
    }
    refreshTrend();
  }, [applyFit, floorPrice, live, minMove, points, refreshTrend, seriesData, style, theme, up, windowMs]);

  const resetView = useCallback(() => {
    applyFit();
    onScrubRef.current?.(null);
  }, [applyFit]);

  return (
    <div
      ref={hostRef}
      style={{height, color}}
      className={cn("relative w-full touch-pan-y select-none", className)}
      onDoubleClick={resetView}
      onTouchEnd={() => {
        const now = Date.now();
        if (now - lastTapRef.current < 280) resetView();
        lastTapRef.current = now;
      }}
    >
      {points.length < 2 ? (
        <div className="absolute inset-0 z-10 grid place-items-center rounded-panel bg-wash text-[13px] font-medium text-faint">
          {emptyLabel}
        </div>
      ) : null}
    </div>
  );
}
