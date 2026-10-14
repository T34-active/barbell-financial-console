<script setup lang="ts">
import { useFinanceStore } from '@/stores/finance'
import { resolvePaydayStatus } from '@/utils/payday'
import { formatMoney, formatPercent } from '@/utils/currency'

const store = useFinanceStore()

const payday = computed(() =>
  resolvePaydayStatus({
    paydayDay: store.settings.rules.payday_day ?? 10,
    postponeWeekend: store.settings.rules.payday_postpone_weekend ?? true,
    isPeriodConfirmed: (periodYearMonth) =>
      !!store.getRecordByMonth(periodYearMonth),
  }),
)

const stat = computed(() =>
  store.savingsForPeriod(payday.value.periodYearMonth),
)
const isHealthy = computed(() => (stat.value?.rate ?? 0) >= 0.6)
</script>

<template>
  <section
    class="panel accent-bar flex flex-col gap-1 px-4 py-3"
    :class="!stat ? 'border-l-surface-line' : isHealthy ? 'border-l-safe' : 'border-l-risk'"
  >
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <p class="text-sm font-medium">储蓄率 · {{ payday.periodYearMonth }}</p>
      <template v-if="stat">
        <p
          class="stat-num text-xl font-semibold"
          :class="isHealthy ? 'text-safe' : 'text-risk'"
        >
          {{ formatPercent(stat.rate) }}
        </p>
        <p class="stat-num text-xs text-ink-muted">
          已储蓄 {{ formatMoney(stat.saved, 'CNY') }} / 收入 {{ formatMoney(stat.salary, 'CNY') }}
          <template v-if="stat.extra > 0">（含额外 {{ formatMoney(stat.extra, 'CNY') }}）</template>
        </p>
      </template>
      <p v-else class="text-sm text-ink-muted">本账期尚未入账</p>
    </div>
    <p v-if="stat" class="hint">目标 ≥ 60% · 口径：安全垫 + 美股种子 / 观察仓</p>
    <p v-else class="hint">发薪日在「工资」页确认入账后显示</p>
  </section>
</template>
