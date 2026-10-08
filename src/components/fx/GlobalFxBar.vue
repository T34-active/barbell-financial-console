<script setup lang="ts">
import dayjs from 'dayjs'
import { ElMessage } from 'element-plus'
import { useFinanceStore } from '@/stores/finance'

const store = useFinanceStore()
const refreshing = ref(false)

const fx = computed(() => store.settings.fx_live)
const cnyHkd = computed(() => fx.value?.cny_hkd ?? store.settings.fx_to_hkd.CNY)
const usdCnh = computed(() => fx.value?.usd_cnh ?? null)
const usdHkd = computed(() => fx.value?.usd_hkd ?? store.settings.fx_to_hkd.USD)
const sgdHkd = computed(() => fx.value?.sgd_hkd ?? store.settings.fx_to_hkd.SGD)

function formatTime(iso?: string | null) {
  if (!iso) return '待刷新'
  const d = dayjs(iso)
  if (!d.isValid()) return iso.slice(0, 16)
  return d.format('MM-DD HH:mm')
}

async function refresh() {
  refreshing.value = true
  try {
    const result = await store.refreshLiveFxRates(true)
    ElMessage.success(
      result.updated ? `全局汇率已更新 · USD/CNH ${result.quotes.usd_cnh}` : '全局汇率已是今日最新',
    )
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
    else ElMessage.error('汇率刷新失败')
  } finally {
    refreshing.value = false
  }
}
</script>

<template>
  <div class="border-b border-surface-line/70 bg-surface-tint/40 text-xs text-ink-muted">
    <div
      class="mx-auto flex container flex-wrap items-center justify-between gap-2 px-4 py-1.5 md:px-6"
    >
      <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span class="font-medium text-ink">全局汇率</span>
        <span>
          USD/CNH
          <span class="font-mono text-ink">
            {{ usdCnh != null ? usdCnh.toFixed(4) : '—' }}
          </span>
        </span>
        <span class="text-surface-line">|</span>
        <span>
          CNY/HKD
          <span class="font-mono text-ink">{{ cnyHkd.toFixed(4) }}</span>
        </span>
        <span class="text-surface-line">|</span>
        <span>
          USD/HKD
          <span class="font-mono text-ink">{{ usdHkd.toFixed(4) }}</span>
        </span>
        <span class="text-surface-line">|</span>
        <span>
          SGD/HKD
          <span class="font-mono text-ink">{{ sgdHkd.toFixed(4) }}</span>
        </span>
        <span class="hidden text-ink-muted sm:inline">· {{ formatTime(fx?.fetched_at) }}</span>
      </div>
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded-md border border-surface-line bg-surface-raised px-2 py-1 text-xs text-accent transition-colors hover:bg-accent-soft disabled:opacity-50"
        :disabled="refreshing"
        @click="refresh"
      >
        <span class="i-carbon-renew text-accent" :class="refreshing ? 'animate-spin' : ''" />
        {{ refreshing ? '刷新中' : '刷新' }}
      </button>
    </div>
  </div>
</template>
