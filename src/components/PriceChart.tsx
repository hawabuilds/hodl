"use client";

import {useCallback, useEffect, useMemo, useRef} from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
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
  launchInLogicalView,
  lwcCandleStyleOptions,
  lwcLayoutOptions,
  lwcTimeScaleOptions,
  lwcVisibleTimeRange,
  shouldAutoFitVisibleRange,
  toCandleData,
  toLineData,
  toUtcSeconds,
  withCompressedSessionBreaks,
} from "@/lib/chartLwc";
import {CHART_WINDOW_BARS, TIMEFRAME_MS, gapBreakMsForWindow} from "@/lib/chartPlot";
import {price} from "@/lib/format";
import type {ChartPoint, ChartStyle} from "@/lib/types";

interface PriceChartProps {
  points: ChartPoint[];
  height?: number;
  /** Overrides the up / down colour, e.g. for a portfolio line. */
  positive?: boolean;
  /** Dashed rule at the window open, the way a brokerage marks previous close. */
  showBaseline?: boolean;
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
   * the one being read, not the live one.
   */
  onScrub?: (point: ChartPoint | null) => void;
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
  showBaseline = true,
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
  const baselineRef = useRef<IPriceLine | null>(null);
  const pointsRef = useRef(points);
  const prevPointsRef = useRef<ChartPoint[]>([]);
  const styleRef = useRef(style);
  const fittedKeyRef = useRef("");
  const lastTapRef = useRef(0);
  const onScrubRef = useRef(onScrub);
  const onNeedOlderRef = useRef(onNeedOlder);
  const floorPriceRef = useRef(floorPrice);
  const {theme} = useTheme();

  pointsRef.current = points;
  onScrubRef.current = onScrub;
  onNeedOlderRef.current = onNeedOlder;
  floorPriceRef.current = floorPrice;

  const up = positive ?? (points.length >= 2
    ? points[points.length - 1].price >= points[0].price
    : true);
  const color = up ? "var(--green)" : "var(--red)";

  const seriesData = useMemo(() => {
    const times = points.map((point) => point.t);
    const gapMs = gapBreakMsForWindow(windowMs);
    if (style === "candles") {
      return withCompressedSessionBreaks(toCandleData(points), times, gapMs);
    }
    return withCompressedSessionBreaks(toLineData(points), times, gapMs);
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
      chart.timeScale().setVisibleRange({
        from: asTime(range.from),
        to: asTime(range.to),
      });
    } else {
      chart.timeScale().fitContent();
    }
  }, [intraday]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const colors = readColors(host);
    const chart = createChart(host, {
      autoSize: true,
      height,
      layout: {
        background: {type: ColorType.Solid, color: "transparent"},
        textColor: colors.faint,
        fontFamily: "inherit",
        ...lwcLayoutOptions(),
      },
      grid: {
        vertLines: {visible: false},
        horzLines: {color: colors.hairline, style: LineStyle.SparseDotted},
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
          labelVisible: false,
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
        priceFormatter: (value: number) => price(value),
      },
    });

    chartRef.current = chart;

    const onCrosshair = (param: {time?: Time}) => {
      if (param.time === undefined) {
        onScrubRef.current?.(null);
        return;
      }
      onScrubRef.current?.(pointAtTime(pointsRef.current, param.time));
    };
    chart.subscribeCrosshairMove(onCrosshair);

    const onRange = (range: {from: number; to: number} | null) => {
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
      baselineRef.current = null;
      prevPointsRef.current = [];
      fittedKeyRef.current = "";
    };
  }, [height]);

  useEffect(() => {
    const chart = chartRef.current;
    const host = hostRef.current;
    if (!chart || !host) return;

    const colors = readColors(host);
    chart.applyOptions({
      layout: {textColor: colors.faint},
      grid: {horzLines: {color: colors.hairline, style: LineStyle.SparseDotted}},
      crosshair: {vertLine: {color: colors.hairline}},
    });
    const lineColor = up ? colors.green : colors.red;
    const seriesChanged = styleRef.current !== style || seriesRef.current == null;
    styleRef.current = style;
    const scaleOpts = {
      autoscaleInfoProvider: floorAutoscale(chart, floorPriceRef.current),
    };

    if (seriesChanged) {
      if (seriesRef.current) {
        chart.removeSeries(seriesRef.current);
        seriesRef.current = null;
        baselineRef.current = null;
      }
      seriesRef.current =
        style === "candles"
          ? chart.addSeries(CandlestickSeries, {
              ...lwcCandleStyleOptions(colors),
              ...scaleOpts,
            })
          : chart.addSeries(AreaSeries, {
              lineColor,
              topColor: `${lineColor}33`,
              bottomColor: "transparent",
              lineWidth: 2,
              priceLineVisible: false,
              lastValueVisible: false,
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

    if (showBaseline && points[0]) {
      const first = points[0].price;
      if (baselineRef.current) {
        baselineRef.current.applyOptions({
          price: first,
          color: colors.faint,
          axisLabelVisible: false,
          title: "",
        });
      } else {
        baselineRef.current = series.createPriceLine({
          price: first,
          color: colors.faint,
          lineStyle: LineStyle.Dashed,
          lineWidth: 1,
          axisLabelVisible: false,
          title: "",
        });
      }
    } else if (baselineRef.current) {
      series.removePriceLine(baselineRef.current);
      baselineRef.current = null;
    }

    if (shouldFit) {
      fittedKeyRef.current = identityKey;
      applyFit();
    }
  }, [applyFit, floorPrice, points, seriesData, showBaseline, style, theme, up, windowMs]);

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
