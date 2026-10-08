<script setup lang="ts">
import { useFinanceStore } from '@/stores/finance'
import { useFinanceFormat } from '@/composables/useFinanceFormat'

const store = useFinanceStore()
const { money, percent } = useFinanceFormat()

const yieldBreakdown = computed(() => store.estimatedAnnualIncomeBreakdown)
</script>

<template>
  <section class="panel relative isolate overflow-hidden px-5 py-6 md:px-8 md:py-8">
    <div class="hero-glow hero-glow-a" aria-hidden="true" />
    <div class="hero-glow hero-glow-b" aria-hidden="true" />

    <div class="relative z-10">
      <p class="text-sm text-ink-muted">净资产 · {{ store.baseCurrency }}</p>
      <p class="stat-num mt-2 text-4xl font-semibold md:text-5xl">
        {{ money(store.netWorth) }}
      </p>

      <div class="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <div class="rounded-lg bg-surface px-3 py-3">
          <p class="text-xs text-ink-muted">人民币池</p>
          <p class="stat-num mt-1 text-sm font-medium md:text-base">
            {{ money(store.rmbPoolValue) }}
          </p>
        </div>
        <div class="rounded-lg bg-surface px-3 py-3">
          <p class="text-xs text-ink-muted">港币池</p>
          <p class="stat-num mt-1 text-sm font-medium md:text-base">
            {{ money(store.hkdPoolValue) }}
          </p>
        </div>
        <div class="rounded-lg bg-surface px-3 py-3">
          <p class="text-xs text-ink-muted">美股池</p>
          <p class="stat-num mt-1 text-sm font-medium md:text-base">
            {{ money(store.usStockValue) }}
          </p>
        </div>
        <div class="rounded-lg bg-surface px-3 py-3">
          <p class="text-xs text-ink-muted">借出应收</p>
          <p class="stat-num mt-1 text-sm font-medium text-accent md:text-base">
            {{ money(store.openLendReceivableValue) }}
          </p>
        </div>
        <div class="rounded-lg bg-surface px-3 py-3">
          <p class="text-xs text-ink-muted">预估年化收益</p>
          <p class="stat-num mt-1 text-sm font-medium text-safe md:text-base">
            {{ money(store.estimatedAnnualIncome) }}
          </p>
        </div>
      </div>

      <div class="mt-4 rounded-lg border border-surface-line bg-surface/70 px-3 py-3 md:px-4">
        <p class="text-xs font-medium">预估年化收益公式</p>
        <p class="mt-1 text-xs leading-5 text-ink-muted">
          Σ 余额 × 年化利率 + Σ 市值 × 预估股息率（单利、按当前存量；黄金涨跌与美股资本利得不计）
        </p>
        <p class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
          <span>人民币 {{ money(yieldBreakdown.cashYield) }}</span>
          <span>港币 {{ money(yieldBreakdown.hkdYield) }}</span>
          <span>加密 {{ money(yieldBreakdown.cryptoYield) }}</span>
          <span>股息 {{ money(yieldBreakdown.dividend) }}</span>
        </p>
        <ul v-if="yieldBreakdown.lines.length" class="mt-3 space-y-1.5">
          <li
            v-for="line in yieldBreakdown.lines"
            :key="line.id"
            class="flex items-baseline justify-between gap-3 text-xs"
          >
            <span class="min-w-0 truncate text-ink-muted">
              {{ line.name }}
              ·
              {{ line.kind === 'dividend' ? '市值' : '余额' }}
              {{ money(line.principal) }}
              ×
              {{ percent(line.rate, 2) }}
            </span>
            <span class="stat-num shrink-0 text-safe">{{ money(line.amount) }}</span>
          </li>
        </ul>
        <p v-else class="mt-2 text-xs text-ink-muted">暂无带利率 / 股息率的账户</p>
      </div>

      <p class="mt-4 text-xs text-ink-muted">
        哑铃占比 · 安全 {{ percent(store.barbell.safeRatio) }} /
        中性 {{ percent(store.barbell.neutralRatio) }} /
        进取 {{ percent(store.barbell.riskRatio) }}
      </p>
    </div>
  </section>
</template>
