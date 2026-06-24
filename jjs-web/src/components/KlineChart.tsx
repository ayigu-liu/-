import { useEffect, useRef } from 'react'
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  type IChartApi,
  type Time,
} from 'lightweight-charts'
import type { KlineBar } from '@/types'

export type ChartType = 'candle' | 'line' | 'realtime'

interface KlineChartProps {
  data: KlineBar[]
  period: string
  chartType: ChartType
  tickData?: { time: number; value: number }[]
}

export function KlineChart({ data, period, chartType, tickData }: KlineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candleRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lineRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const volumeRef = useRef<any>(null)
  const fittedRef = useRef(false)

  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#1a2332' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' },
      },
      crosshair: { mode: 0 },
      rightPriceScale: {
        borderColor: '#1e293b',
      },
      timeScale: {
        borderColor: '#1e293b',
        timeVisible: true,
        secondsVisible: false,
      },
      width: containerRef.current.clientWidth,
      height: 400,
    })

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#ef4444',
      downColor: '#10b981',
      borderColor: '#ef4444',
      borderUpColor: '#ef4444',
      borderDownColor: '#10b981',
      wickColor: '#ef4444',
      wickUpColor: '#ef4444',
      wickDownColor: '#10b981',
      priceScaleId: 'main',
    }, 0)

    const lineSeries = chart.addSeries(LineSeries, {
      color: '#3b82f6',
      lineWidth: 1,
      priceScaleId: 'main',
    }, 0)

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#3b82f6',
      priceFormat: { type: 'volume' },
    }, 1)
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.2, bottom: 0 },
    })

    chartRef.current = chart
    candleRef.current = candleSeries
    lineRef.current = lineSeries
    volumeRef.current = volumeSeries

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth })
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      lineRef.current = null
      volumeRef.current = null
    }
  }, [])

  useEffect(() => {
    fittedRef.current = false
    updateData()
  }, [chartType])

  useEffect(() => {
    updateData()
  }, [data, tickData])

  function updateData() {
    if (!candleRef.current || !lineRef.current || !volumeRef.current) return

    if (chartType === 'realtime' && tickData && tickData.length > 0) {
      candleRef.current.setData([])
      lineRef.current.setData(tickData.map((d: { time: number; value: number }) => ({
        time: d.time as Time,
        value: d.value,
      })))
      volumeRef.current.setData([])
      if (!fittedRef.current) {
        chartRef.current?.timeScale().fitContent()
        fittedRef.current = true
      }
      return
    }

    const sorted = [...data].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())

    if (chartType === 'candle') {
      candleRef.current.setData(sorted.map((d: KlineBar) => ({
        time: (new Date(d.time).getTime() / 1000) as Time,
        open: d.open / 100,
        high: d.high / 100,
        low: d.low / 100,
        close: d.close / 100,
      })))
      lineRef.current.setData([])
      volumeRef.current.setData(sorted.map((d: KlineBar) => ({
        time: (new Date(d.time).getTime() / 1000) as Time,
        value: d.volume,
      })))
    } else {
      candleRef.current.setData([])
      lineRef.current.setData(sorted.map((d: KlineBar) => ({
        time: (new Date(d.time).getTime() / 1000) as Time,
        value: d.close / 100,
      })))
      volumeRef.current.setData([])
    }

    chartRef.current?.timeScale().fitContent()
    fittedRef.current = true
  }

  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({ height: 400 })
    }
  }, [period])

  return <div ref={containerRef} className="w-full rounded overflow-hidden" style={{ minHeight: 400 }} />
}
