<script setup lang="ts">
import {
  FEAR_GREED_BANDS,
  FEAR_GREED_GRADIENT,
  fearGreedBandZh,
} from '@/utils/fear-greed'

const props = withDefaults(
  defineProps<{
    score: number
    label?: string
    compact?: boolean
  }>(),
  { compact: false },
)

const uid = useId().replace(/\W/g, '')

const VB_W = 360
const VB_H = 210
const CX = 180
const CY = 178
const R = 118
const STROKE = 16

const clampedScore = computed(() =>
  Math.min(100, Math.max(0, Number.isFinite(props.score) ? props.score : 50)),
)

const displayLabel = computed(
  () => props.label || fearGreedBandZh(clampedScore.value),
)

const currentBand = computed(
  () =>
    FEAR_GREED_BANDS.find(
      (band) =>
        clampedScore.value >= band.min && clampedScore.value <= band.max,
    ) ?? FEAR_GREED_BANDS[2],
)

const activeColor = computed(() => currentBand.value.color)

const gradId = computed(() => `fg-grad-${uid}`)

const gradientStops = computed(() =>
  FEAR_GREED_GRADIENT.map((stop) => ({
    offset: stop.offset,
    color: stop.color,
  })),
)

function angleOf(score: number) {
  return (180 - (score / 100) * 180) * (Math.PI / 180)
}

function point(radius: number, score: number) {
  const a = angleOf(score)
  return {
    x: CX + radius * Math.cos(a),
    y: CY - radius * Math.sin(a),
  }
}

function arcPath(fromScore: number, toScore: number, radius = R) {
  const start = point(radius, fromScore)
  const end = point(radius, toScore)
  // SVG y 轴向下：sweep=1 为顺时针，从左端画到右端走的是上半圆
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 0 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`
}

const trackPath = computed(() => arcPath(0, 100, R))

const ticks = computed(() =>
  Array.from({ length: 11 }, (_, i) => {
    const score = i * 10
    const inner = point(R - STROKE / 2 - 1, score)
    const outer = point(R - STROKE / 2 + 6, score)
    return {
      score,
      x1: inner.x,
      y1: inner.y,
      x2: outer.x,
      y2: outer.y,
    }
  }),
)

const rimLabels = computed(() =>
  FEAR_GREED_BANDS.map((band) => {
    const mid = (band.min + (band.max + 1)) / 2
    const pos = point(R + 26, mid)
    let anchor: 'start' | 'middle' | 'end' = 'middle'
    if (mid < 28) anchor = 'end'
    else if (mid > 72) anchor = 'start'
    return {
      name: band.name,
      x: pos.x,
      y: pos.y,
      anchor,
    }
  }),
)

const pointer = computed(() => {
  const score = clampedScore.value
  const a = angleOf(score)
  const perpX = Math.sin(a)
  const perpY = Math.cos(a)
  const tip = point(R - STROKE / 2 + 1, score)
  const base = point(R - STROKE / 2 - 12, score)
  const half = 5
  return {
    points: [
      `${tip.x.toFixed(1)},${tip.y.toFixed(1)}`,
      `${(base.x + perpX * half).toFixed(1)},${(base.y + perpY * half).toFixed(1)}`,
      `${(base.x - perpX * half).toFixed(1)},${(base.y - perpY * half).toFixed(1)}`,
    ].join(' '),
  }
})
</script>

<template>
  <div
    class="relative mx-auto w-full min-w-0 overflow-visible"
    :class="compact ? 'max-w-60' : 'max-w-80'"
    :style="{ aspectRatio: `${VB_W} / ${VB_H}` }"
  >
    <svg
      class="absolute inset-0 h-full w-full overflow-visible"
      :viewBox="`0 0 ${VB_W} ${VB_H}`"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      :aria-label="`恐贪指数 ${clampedScore.toFixed(1)} ${displayLabel}`"
    >
      <title>恐贪指数 {{ clampedScore.toFixed(1) }} · {{ displayLabel }}</title>
      <defs>
        <linearGradient :id="gradId" x1="0" y1="0" x2="1" y2="0">
          <stop
            v-for="stop in gradientStops"
            :key="stop.offset"
            :offset="stop.offset"
            :stop-color="stop.color"
          />
        </linearGradient>
      </defs>

      <path
        :d="trackPath"
        fill="none"
        :stroke="`url(#${gradId})`"
        :stroke-width="STROKE"
        stroke-linecap="butt"
      />

      <line
        v-for="tick in ticks"
        :key="tick.score"
        :x1="tick.x1"
        :y1="tick.y1"
        :x2="tick.x2"
        :y2="tick.y2"
        class="fg-tick"
        stroke-width="1"
      />

      <polygon :points="pointer.points" class="fg-pointer" />

      <text
        v-if="!compact"
        v-for="item in rimLabels"
        :key="item.name"
        :x="item.x"
        :y="item.y"
        :text-anchor="item.anchor"
        dominant-baseline="middle"
        class="fg-rim-label"
      >
        {{ item.name }}
      </text>
    </svg>

    <div
      class="pointer-events-none absolute inset-x-0 flex flex-col items-center"
      style="top: 46%"
    >
      <p
        class="stat-num font-semibold leading-none tracking-tight"
        :class="compact ? 'text-2xl' : 'text-3xl'"
      >
        {{ Math.round(clampedScore) }}
      </p>
      <p
        class="mt-1.5 text-sm font-medium"
        :style="{ color: activeColor }"
      >
        {{ displayLabel }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.fg-rim-label {
  fill: var(--ink-muted);
  font-size: 10px;
  letter-spacing: 0.02em;
}

.fg-tick {
  stroke: color-mix(in srgb, var(--ink) 42%, transparent);
}

.fg-pointer {
  fill: var(--ink);
}
</style>
