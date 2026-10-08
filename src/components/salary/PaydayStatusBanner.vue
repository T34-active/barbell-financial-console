<script setup lang="ts">
import type { PaydayStatus } from '@/utils/payday'

defineProps<{
  payday: PaydayStatus
}>()

const toneClass: Record<PaydayStatus['status'], string> = {
  payday_today: 'border-l-safe',
  waiting: 'border-l-surface-line',
  overdue: 'border-l-risk',
  confirmed: 'border-l-accent',
}

const iconWrapClass: Record<PaydayStatus['status'], string> = {
  payday_today: 'text-safe',
  waiting: 'text-ink-muted',
  overdue: 'text-risk',
  confirmed: 'text-accent',
}

const iconClass: Record<PaydayStatus['status'], string> = {
  payday_today: 'i-carbon-checkmark-filled',
  waiting: 'i-carbon-time',
  overdue: 'i-carbon-warning-alt-filled',
  confirmed: 'i-carbon-document',
}

const titleMap: Record<PaydayStatus['status'], string> = {
  payday_today: '今日发薪日',
  waiting: '等待发薪',
  overdue: '待补录',
  confirmed: '本月已入账',
}

const badgeClass: Record<PaydayStatus['status'], string> = {
  payday_today: 'text-safe',
  waiting: 'text-ink-muted',
  overdue: 'text-risk',
  confirmed: 'text-accent',
}

function badgeText(payday: PaydayStatus) {
  if (payday.status === 'waiting') return `D-${payday.daysUntilNext}`
  if (payday.status === 'overdue') return `逾期 ${payday.daysOverdue} 天`
  if (payday.status === 'payday_today') return '请确认入账'
  return '已完成'
}
</script>

<template>
  <section
    class="panel accent-bar flex items-center gap-3 px-4 py-3 md:px-5"
    :class="toneClass[payday.status]"
  >
    <span :class="[iconClass[payday.status], iconWrapClass[payday.status], 'shrink-0 text-base']" />
    <div class="min-w-0 flex-1">
      <p class="text-sm font-medium">
        {{ titleMap[payday.status] }}
        <span class="ml-2 text-xs font-normal text-ink-muted">账期 {{ payday.periodYearMonth }}</span>
      </p>
      <p class="hint mt-0.5">
        {{ payday.message }}
        <template v-if="payday.allocationDeferred">· 下方比例为模拟，确认入账前不改桶</template>
      </p>
    </div>
    <span class="stat-num shrink-0 text-xs font-medium" :class="badgeClass[payday.status]">
      {{ badgeText(payday) }}
    </span>
  </section>
</template>
