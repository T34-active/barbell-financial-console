<script setup lang="ts">
import NetWorthHero from '@/components/summary/NetWorthHero.vue'
import SafetyLineAlert from '@/components/summary/SafetyLineAlert.vue'
import SavingsRateBanner from '@/components/summary/SavingsRateBanner.vue'
import CryptoStakeBanner from '@/components/summary/CryptoStakeBanner.vue'
import BarbellGauge from '@/components/barbell/BarbellGauge.vue'
import PoolAccountCard from '@/components/accounts/PoolAccountCard.vue'
import StockHoldingCard from '@/components/accounts/StockHoldingCard.vue'
import { useFinanceStore } from '@/stores/finance'
import { isNavFundAccount } from '@/utils/fund-nav'
import { resolveNextPaydayHint } from '@/utils/payday'

const store = useFinanceStore()

const previewRmb = computed(() =>
  store.accounts.rmb_pool.filter((a) => !isNavFundAccount(a)).slice(0, 2),
)
const previewFunds = computed(() => {
  const ids = store.settings.asset_classification.neutral_assets
  return store.accounts.rmb_pool.filter((a) => ids.includes(a.id) && isNavFundAccount(a))
})
const previewStocks = computed(() => store.accounts.us_stock_pool.slice(0, 2))

const nextPayday = computed(() =>
  resolveNextPaydayHint({
    paydayDay: store.settings.rules.payday_day ?? 10,
    postponeWeekend: store.settings.rules.payday_postpone_weekend ?? true,
    isPeriodConfirmed: (periodYearMonth) => !!store.getRecordByMonth(periodYearMonth),
  }),
)
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h1 class="section-title">资产总览</h1>
      <p class="hint">
        <template v-if="nextPayday.isToday">
          今日发薪 · 账期 {{ nextPayday.periodYearMonth }}
        </template>
        <template v-else-if="nextPayday.isOverdue">
          工资应于 {{ nextPayday.label }} 到账，待补录
        </template>
        <template v-else>下次发薪 {{ nextPayday.label }}</template>
        <RouterLink to="/accounts" class="ml-3 text-ink hover:underline">全部账户 →</RouterLink>
      </p>
    </div>

    <NetWorthHero />
    <div class="grid gap-3 lg:grid-cols-3">
      <SafetyLineAlert />
      <SavingsRateBanner />
      <CryptoStakeBanner />
    </div>
    <BarbellGauge />

    <section class="grid gap-4 lg:grid-cols-2">
      <div>
        <div class="mb-2 flex items-baseline justify-between">
          <h2 class="text-sm font-semibold">安全端</h2>
          <span class="hint">不含基金 / 加密</span>
        </div>
        <div class="grid gap-3">
          <PoolAccountCard v-for="account in previewRmb" :key="account.id" :account="account" />
        </div>
      </div>

      <div>
        <div class="mb-2 flex items-baseline justify-between">
          <h2 class="text-sm font-semibold">进取端</h2>
          <span class="hint">{{ store.accounts.us_stock_pool.length }} 只标的</span>
        </div>
        <div class="grid gap-3">
          <StockHoldingCard v-for="stock in previewStocks" :key="stock.id" :stock="stock" />
        </div>
        <div v-if="previewFunds.length" class="mt-4">
          <h3 class="mb-2 text-sm font-semibold">中性 · 基金</h3>
          <div class="grid gap-3">
            <PoolAccountCard v-for="account in previewFunds" :key="account.id" :account="account" />
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
