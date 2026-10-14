<script setup lang="ts">
import { useFinanceStore } from '@/stores/finance'
import { formatMoney } from '@/utils/currency'
import { sub } from '@/utils/decimal'
import { isTermLocked } from '@/utils/term-lock'

const store = useFinanceStore()
const hsbcLock = computed(() => store.hsbcAccount?.term_lock)
const hsbcLocked = computed(() => isTermLocked(hsbcLock.value))
</script>

<template>
  <section
    class="panel accent-bar flex flex-col gap-1 px-4 py-3"
    :class="store.isSafetyLineBreached ? 'border-l-alert' : 'border-l-safe'"
  >
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <p class="text-sm font-medium">
        汇丰安全红线
        <span class="stat-num text-ink-muted">
          {{ formatMoney(store.settings.hsbc_safety_line, 'HKD', { digits: 0 }) }}
        </span>
      </p>
      <p class="stat-num text-xs text-ink-muted">
        当前 {{ formatMoney(store.hsbcAccount?.amount ?? 0, 'HKD', { digits: 0 }) }}
        <template v-if="store.isSafetyLineBreached">
          · 尚缺 {{ formatMoney(store.safetyGap, 'HKD', { digits: 0 }) }}
        </template>
        <template v-else>
          · 高于红线
          {{
            formatMoney(
              sub(store.hsbcAccount?.amount ?? 0, store.settings.hsbc_safety_line),
              'HKD',
              { digits: 0 },
            )
          }}
        </template>
      </p>
    </div>
    <p
      class="flex items-center gap-1.5 text-xs font-medium"
      :class="store.isSafetyLineBreached ? 'text-alert' : 'text-safe'"
    >
      <span class="status-dot bg-current" />
      {{ store.isSafetyLineBreached ? '预警触发' : '红线安全' }}
    </p>
    <p v-if="hsbcLock && hsbcLocked" class="text-xs text-ink-muted">
      锁仓至 {{ hsbcLock.maturity_date }}，到期前不可动用
    </p>
    <p v-else-if="hsbcLock" class="text-xs text-ink-muted">
      定期已于 {{ hsbcLock.maturity_date }} 到期，入账后可动用
    </p>
  </section>
</template>
