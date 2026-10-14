<script setup lang="ts">
import { useFinanceStore } from '@/stores/finance'
import { useFinanceFormat } from '@/composables/useFinanceFormat'
import { isNavFundAccount } from '@/utils/fund-nav'
import { add } from '@/utils/decimal'
import type { PoolAccount } from '@/types/finance'

const route = useRoute()
const store = useFinanceStore()
const { money } = useFinanceFormat()

const safeRmb = computed(() =>
  store.accounts.rmb_pool.filter(
    (a) => !store.settings.asset_classification.neutral_assets.includes(a.id),
  ),
)
const fundProducts = computed(() => {
  const ids = new Set(store.settings.asset_classification.neutral_assets)
  return store.accounts.rmb_pool.filter((a) => ids.has(a.id) && isNavFundAccount(a))
})
const otherNeutral = computed(() => {
  const ids = new Set(store.settings.asset_classification.neutral_assets)
  return store.accounts.rmb_pool.filter((a) => ids.has(a.id) && !isNavFundAccount(a))
})
const cryptoAssets = computed(() => {
  const ids = new Set(store.settings.asset_classification.crypto_assets ?? [])
  return store.accounts.crypto_pool.filter((a) => ids.has(a.id))
})
const neutralAssets = computed(
  () => [...fundProducts.value, ...otherNeutral.value, ...cryptoAssets.value] as PoolAccount[],
)
const neutralValue = computed(() =>
  neutralAssets.value.reduce((sum, item) => add(sum, store.toBase(item.amount, item.currency)), 0),
)

const rmbSafeValue = computed(() =>
  safeRmb.value.reduce((sum, item) => add(sum, store.toBase(item.amount, item.currency)), 0),
)

const tabs = computed(() => [
  {
    name: 'accounts-rmb',
    label: '人民币安全',
    value: rmbSafeValue.value,
    count: safeRmb.value.length,
  },
  {
    name: 'accounts-hkd',
    label: '港币池',
    value: store.hkdPoolValue,
    count: store.accounts.hkd_pool.length,
  },
  {
    name: 'accounts-us',
    label: '美股池',
    value: store.usStockValue,
    count: store.accounts.us_stock_pool.length,
  },
  {
    name: 'accounts-neutral',
    label: '中性+加密赌注',
    value: neutralValue.value,
    count: neutralAssets.value.length,
  },
])
</script>

<template>
  <div class="space-y-5">
    <div>
      <h1 class="section-title">账户明细</h1>
      <p class="mt-1 text-sm text-ink-muted">
        安全 / 进取 / 中性分池；公募基金为中性，HTX/OKX 为加密赌注池（非安全）
      </p>
    </div>

    <div class="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
      <RouterLink
        v-for="tab in tabs"
        :key="tab.name"
        :to="{ name: tab.name }"
        class="panel px-3 py-3 text-left transition-colors md:px-4"
        :class="
          route.name === tab.name
            ? 'border-accent/40 ring-2 ring-accent/20'
            : 'hover:bg-surface-tint/40'
        "
      >
        <p class="text-xs text-ink-muted">{{ tab.label }}</p>
        <p class="stat-num mt-1 text-sm font-semibold md:text-base">
          {{ money(tab.value) }}
        </p>
        <p class="mt-1 text-xs text-ink-muted">{{ tab.count }} 项</p>
      </RouterLink>
    </div>

    <RouterView />
  </div>
</template>
