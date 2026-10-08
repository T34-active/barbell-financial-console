<script setup lang="ts">
import { use } from 'echarts/core'
import { PieChart } from 'echarts/charts'
import { TooltipComponent, LegendComponent } from 'echarts/components'
import { LabelLayout } from 'echarts/features'
import { CanvasRenderer } from 'echarts/renderers'
import type { ComposeOption } from 'echarts/core'
import type { PieSeriesOption } from 'echarts/charts'
import type { LegendComponentOption, TooltipComponentOption } from 'echarts/components'
import VChart from 'vue-echarts'
import type { BarbellPart, BarbellSleeve } from '@/types/finance'
import { useFinanceStore } from '@/stores/finance'
import { useFinanceFormat } from '@/composables/useFinanceFormat'
import { useTheme } from '@/composables/useTheme'
import { div } from '@/utils/decimal'

use([PieChart, TooltipComponent, LegendComponent, LabelLayout, CanvasRenderer])

type ECOption = ComposeOption<PieSeriesOption | TooltipComponentOption | LegendComponentOption>

const store = useFinanceStore()
const { money, percent } = useFinanceFormat()
const { isDark } = useTheme()

const SLEEVE_META: Record<
  BarbellSleeve,
  { name: string; colorKey: string; fallback: string; shades: string[] }
> = {
  safe: {
    name: '安全端',
    colorKey: '--safe',
    fallback: '#0f766e',
    shades: ['#0f766e', '#14b8a6', '#2dd4bf', '#5eead4', '#99f6e4', '#115e59'],
  },
  neutral: {
    name: '中性',
    colorKey: '--accent',
    fallback: '#2f6fed',
    shades: ['#2f6fed', '#6b9cff', '#93b4ff', '#1d4ed8'],
  },
  risk: {
    name: '进取端',
    colorKey: '--risk',
    fallback: '#b45309',
    shades: ['#b45309', '#d97706', '#f59e0b', '#fbbf24', '#fcd34d', '#92400e'],
  },
}

function cssVar(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function mixHex(hex: string, toward: '#000000' | '#ffffff', amount: number) {
  const raw = hex.replace('#', '')
  if (raw.length !== 6) return hex
  const t = toward === '#ffffff' ? 255 : 0
  const ch = (i: number) => {
    const c = Number.parseInt(raw.slice(i, i + 2), 16)
    return Math.round(c + (t - c) * amount)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${ch(0)}${ch(2)}${ch(4)}`
}

const sleeveTotals = computed(() => {
  const b = store.barbell
  return (
    [
      { sleeve: 'safe' as const, value: Math.max(b.safeValue, 0), ratio: b.safeRatio },
      {
        sleeve: 'neutral' as const,
        value: Math.max(b.neutralValue, 0),
        ratio: b.neutralRatio,
      },
      { sleeve: 'risk' as const, value: Math.max(b.riskValue, 0), ratio: b.riskRatio },
    ] as const
  ).filter((item) => item.value > 0)
})

const detailParts = computed(() => store.barbell.parts.filter((part) => part.value > 0))

const partsBySleeve = computed(() => {
  const map: Record<BarbellSleeve, BarbellPart[]> = {
    safe: [],
    neutral: [],
    risk: [],
  }
  for (const part of detailParts.value) {
    map[part.sleeve].push(part)
  }
  return map
})

const chartOption = computed<ECOption>(() => {
  void isDark.value
  const inkMuted = cssVar('--ink-muted', '#8b9aab')
  const surfaceRaised = cssVar('--surface-raised', '#1a222d')
  const ink = cssVar('--ink', '#e8eef4')
  const lighten = isDark.value ? 0.12 : 0.18

  const shadeIndex: Record<BarbellSleeve, number> = {
    safe: 0,
    neutral: 0,
    risk: 0,
  }

  const innerData = sleeveTotals.value.map((item) => {
    const meta = SLEEVE_META[item.sleeve]
    return {
      name: meta.name,
      value: item.value,
      ratio: item.ratio,
      sleeve: item.sleeve,
      itemStyle: { color: cssVar(meta.colorKey, meta.fallback) },
    }
  })

  const outerData = detailParts.value.map((part) => {
    const meta = SLEEVE_META[part.sleeve]
    const base = cssVar(meta.colorKey, meta.fallback)
    const idx = shadeIndex[part.sleeve]++
    const color = mixHex(base, '#ffffff', Math.min(0.55, lighten + idx * 0.1))
    const sleeveTotal =
      part.sleeve === 'safe'
        ? store.barbell.safeValue
        : part.sleeve === 'neutral'
          ? store.barbell.neutralValue
          : store.barbell.riskValue
    return {
      name: part.name,
      value: part.value,
      sleeve: part.sleeve,
      sleeveName: meta.name,
      sleeveShare: sleeveTotal > 0 ? div(part.value, sleeveTotal) : 0,
      itemStyle: { color },
    }
  })

  return {
    animationDuration: 450,
    tooltip: {
      trigger: 'item',
      backgroundColor: surfaceRaised,
      borderColor: cssVar('--surface-line', '#2c3644'),
      textStyle: { color: ink, fontSize: 12 },
      formatter: (params: unknown) => {
        const p = params as {
          seriesName?: string
          name: string
          value: number
          percent: number
          data: {
            ratio?: number
            sleeveName?: string
            sleeveShare?: number
          }
        }
        if (p.seriesName === '三端') {
          const ratioText =
            typeof p.data?.ratio === 'number' ? percent(p.data.ratio) : `${p.percent.toFixed(1)}%`
          return `${p.name}<br/>${money(p.value)} · ${ratioText}`
        }
        const within =
          typeof p.data?.sleeveShare === 'number'
            ? percent(p.data.sleeveShare)
            : `${p.percent.toFixed(1)}%`
        return `${p.data.sleeveName ?? ''} · ${p.name}<br/>${money(p.value)} · 占该端 ${within} · 占总资产 ${p.percent.toFixed(1)}%`
      },
    },
    legend: {
      type: 'scroll',
      bottom: 0,
      left: 'center',
      width: '92%',
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: inkMuted, fontSize: 11 },
      data: outerData.map((item) => item.name),
    },
    series: [
      {
        name: '三端',
        type: 'pie',
        radius: ['0%', '40%'],
        center: ['50%', '46%'],
        silent: false,
        label: {
          position: 'inner',
          color: '#fff',
          fontSize: 12,
          formatter: '{b}\n{d}%',
          textShadowColor: 'rgba(0,0,0,0.35)',
          textShadowBlur: 2,
        },
        labelLine: { show: false },
        itemStyle: {
          borderColor: surfaceRaised,
          borderWidth: 2,
        },
        data: innerData,
      },
      {
        name: '明细',
        type: 'pie',
        radius: ['50%', '76%'],
        center: ['50%', '46%'],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 4,
          borderColor: surfaceRaised,
          borderWidth: 2,
        },
        label: {
          color: ink,
          formatter: '{b}\n{d}%',
          fontSize: 12,
          lineHeight: 16,
        },
        labelLine: {
          length: 14,
          length2: 8,
          lineStyle: { color: inkMuted },
        },
        emphasis: {
          scale: true,
          scaleSize: 5,
          label: { fontWeight: 600 },
        },
        data: outerData,
      },
    ],
  }
})
</script>

<template>
  <section class="panel px-5 py-5 md:px-6">
    <div class="flex items-end justify-between gap-3">
      <div>
        <h2 class="section-title">哑铃结构</h2>
        <p class="mt-1 text-sm text-ink-muted">
          内环三端 · 外环持仓明细；黄金 / 加密进中性，不计入安全端
        </p>
      </div>
      <span class="i-carbon-chart-ring text-2xl text-ink-muted" />
    </div>

    <div class="mt-4 h-[28rem] w-full md:h-[36rem]">
      <VChart class="h-full w-full" :option="chartOption" autoresize />
    </div>

    <div class="mt-2 grid gap-3 md:grid-cols-3">
      <div class="rounded-lg border border-safe/25 bg-safe-soft/50 px-4 py-3">
        <p class="text-sm font-medium text-safe">安全端</p>
        <p class="stat-num mt-1 text-lg font-semibold">
          {{ money(store.barbell.safeValue) }}
        </p>
        <p class="mt-1 text-xs text-ink-muted">
          {{ percent(store.barbell.safeRatio) }}
        </p>
        <ul class="mt-2 space-y-1 text-xs text-ink-muted">
          <li v-for="part in partsBySleeve.safe" :key="part.id" class="flex justify-between gap-2">
            <span>{{ part.name }}</span>
            <span class="stat-num shrink-0">{{ money(part.value) }}</span>
          </li>
          <li v-if="partsBySleeve.safe.length === 0">暂无</li>
        </ul>
      </div>
      <div class="rounded-lg border border-accent/25 bg-accent-soft/50 px-4 py-3">
        <p class="text-sm font-medium text-accent">中性</p>
        <p class="stat-num mt-1 text-lg font-semibold">
          {{ money(store.barbell.neutralValue) }}
        </p>
        <p class="mt-1 text-xs text-ink-muted">
          {{ percent(store.barbell.neutralRatio) }}
        </p>
        <ul class="mt-2 space-y-1 text-xs text-ink-muted">
          <li
            v-for="part in partsBySleeve.neutral"
            :key="part.id"
            class="flex justify-between gap-2"
          >
            <span>{{ part.name }}</span>
            <span class="stat-num shrink-0">{{ money(part.value) }}</span>
          </li>
          <li v-if="partsBySleeve.neutral.length === 0">暂无</li>
        </ul>
      </div>
      <div class="rounded-lg border border-risk/25 bg-risk-soft/50 px-4 py-3">
        <p class="text-sm font-medium text-risk">进取端</p>
        <p class="stat-num mt-1 text-lg font-semibold">
          {{ money(store.barbell.riskValue) }}
        </p>
        <p class="mt-1 text-xs text-ink-muted">
          {{ percent(store.barbell.riskRatio) }}
        </p>
        <ul class="mt-2 space-y-1 text-xs text-ink-muted">
          <li v-for="part in partsBySleeve.risk" :key="part.id" class="flex justify-between gap-2">
            <span>{{ part.name }}</span>
            <span class="stat-num shrink-0">{{ money(part.value) }}</span>
          </li>
          <li v-if="partsBySleeve.risk.length === 0">暂无</li>
        </ul>
      </div>
    </div>
  </section>
</template>
