<script setup lang="ts">
import NetWorthHero from './components/NetWorthHero.vue'
import SafetyLineAlert from './components/SafetyLineAlert.vue'
import SavingsRateBanner from './components/SavingsRateBanner.vue'
import CryptoStakeBanner from './components/CryptoStakeBanner.vue'
import BarbellGauge from './components/BarbellGauge.vue'
import OverviewPulse from './components/OverviewPulse.vue'
import { useFinanceStore } from '@/stores/finance'
import { useFinanceFormat } from '@/composables/useFinanceFormat'
import { isNavFundAccount } from '@/utils/fund-nav'
import {
  formatMoney,
  formatPercent,
  stockCostBasis,
  stockMarketValue,
} from '@/utils/currency'
import { resolveNextPaydayHint } from '@/utils/payday'
import { quoteToneClass } from '@/composables/useQuoteColor'
import { div, sub } from '@/utils/decimal'
import type { PoolAccount, UsStockHolding } from '@/types/finance'

const { money } = useFinanceFormat()

const store = useFinanceStore()

const safeRmb = computed(() =>
  store.accounts.rmb_pool.filter((a) => !isNavFundAccount(a)),
)
const previewFunds = computed(() => {
  const ids = store.settings.asset_classification.neutral_assets
  return store.accounts.rmb_pool.filter((a) => ids.includes(a.id) && isNavFundAccount(a))
})
const stocks = computed(() => store.accounts.us_stock_pool)
const openLoans = computed(() =>
  store.loans.items.filter((item) => item.status === 'open' || item.status === 'partial'),
)

const nextPayday = computed(() =>
  resolveNextPaydayHint({
    paydayDay: store.settings.rules.payday_day ?? 10,
    postponeWeekend: store.settings.rules.payday_postpone_weekend ?? true,
    isPeriodConfirmed: (periodYearMonth) => !!store.getRecordByMonth(periodYearMonth),
  }),
)

function stockPrice(stock: UsStockHolding) {
  return stock.market_price ?? stock.cost_price
}

function stockPnl(stock: UsStockHolding) {
  return sub(stockMarketValue(stock), stockCostBasis(stock))
}

function stockPnlRate(stock: UsStockHolding) {
  const cost = stockCostBasis(stock)
  return cost > 0 ? div(stockPnl(stock), cost) : 0
}

function yieldText(account: PoolAccount) {
  const rate = account.yield_rate
  if (!(rate != null && rate > 0)) return '—'
  return formatPercent(rate)
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h1 class="section-title">资产总览</h1>
      <p class="text-xs text-ink-muted">
        <template v-if="nextPayday.isToday">
          今日发薪 · 账期 {{ nextPayday.periodYearMonth }}
        </template>
        <template v-else-if="nextPayday.isOverdue">
          工资应于 {{ nextPayday.label }} 到账，待补录
        </template>
        <template v-else>下次发薪 {{ nextPayday.label }}</template>
        <RouterLink
          to="/accounts"
          class="ml-3 font-medium text-accent underline-offset-2 hover:underline"
        >
          全部账户 →
        </RouterLink>
      </p>
    </div>

    <NetWorthHero />
    <div class="grid gap-3 lg:grid-cols-3">
      <SafetyLineAlert />
      <SavingsRateBanner />
      <CryptoStakeBanner />
    </div>
    <OverviewPulse />
    <BarbellGauge />

    <section class="grid gap-4 xl:grid-cols-2">
      <div class="panel space-y-3 px-4 py-4">
        <div class="flex items-baseline justify-between gap-2">
          <h2 class="text-sm font-semibold">人民币安全</h2>
          <span class="hint">{{ safeRmb.length }} 个账户</span>
        </div>
        <el-table :data="safeRmb" stripe size="small" empty-text="暂无人民币账户" class="w-full">
          <el-table-column prop="name" label="账户" min-width="120" show-overflow-tooltip />
          <el-table-column label="余额" min-width="110" align="right">
            <template #default="{ row }">
              <span class="stat-num">{{ formatMoney(row.amount, row.currency) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="年化" min-width="80" align="right">
            <template #default="{ row }">
              {{ yieldText(row) }}
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="panel space-y-3 px-4 py-4">
        <div class="flex items-baseline justify-between gap-2">
          <h2 class="text-sm font-semibold">借出 / 应收</h2>
          <span class="hint">{{ openLoans.length }} 笔在途</span>
        </div>
        <el-table :data="openLoans" stripe size="small" empty-text="暂无在途借出" class="w-full">
          <el-table-column prop="counterparty" label="借款人" min-width="100" show-overflow-tooltip />
          <el-table-column label="未收回" min-width="100" align="right">
            <template #default="{ row }">
              <span class="stat-num">{{ formatMoney(row.remaining, 'CNY') }}</span>
            </template>
          </el-table-column>
          <el-table-column label="到期" min-width="110">
            <template #default="{ row }">
              {{ row.due_at || '—' }}
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="panel space-y-3 px-4 py-4 xl:col-span-2">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h2 class="text-sm font-semibold">美股持仓</h2>
          <p class="hint">
            券商现金 {{ formatMoney(store.accounts.us_broker_cash?.hkd ?? 0, 'HKD') }} ·
            {{ formatMoney(store.accounts.us_broker_cash?.usd ?? 0, 'USD') }} · 合计
            {{ money(store.usBrokerCashValue) }} · {{ stocks.length }} 只标的
          </p>
        </div>
        <el-table :data="stocks" stripe size="small" empty-text="暂无美股持仓" class="w-full">
          <el-table-column label="标的" min-width="140" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="font-mono font-medium">{{ row.symbol }}</span>
              <span class="ml-2 text-ink-muted">{{ row.name }}</span>
            </template>
          </el-table-column>
          <el-table-column label="数量" min-width="80" align="right">
            <template #default="{ row }">
              <span class="stat-num">{{ row.shares }}</span>
            </template>
          </el-table-column>
          <el-table-column label="现价" min-width="100" align="right">
            <template #default="{ row }">
              <span class="stat-num">{{ formatMoney(stockPrice(row), 'USD') }}</span>
            </template>
          </el-table-column>
          <el-table-column label="市值" min-width="110" align="right">
            <template #default="{ row }">
              <span class="stat-num">{{ formatMoney(stockMarketValue(row), 'USD') }}</span>
            </template>
          </el-table-column>
          <el-table-column label="盈亏" min-width="140" align="right">
            <template #default="{ row }">
              <span class="stat-num" :class="quoteToneClass(stockPnl(row))">
                {{ stockPnl(row) >= 0 ? '+' : '' }}{{ formatMoney(stockPnl(row), 'USD') }}
                （{{ formatPercent(stockPnlRate(row)) }}）
              </span>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div v-if="previewFunds.length" class="panel space-y-3 px-4 py-4 xl:col-span-2">
        <div class="flex items-baseline justify-between gap-2">
          <h2 class="text-sm font-semibold">中性 · 基金</h2>
          <span class="hint">{{ previewFunds.length }} 只</span>
        </div>
        <el-table :data="previewFunds" stripe size="small" class="w-full">
          <el-table-column prop="name" label="基金" min-width="160" show-overflow-tooltip />
          <el-table-column label="估值" min-width="120" align="right">
            <template #default="{ row }">
              <span class="stat-num">{{ formatMoney(row.amount, row.currency) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="备注" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.note || '—' }}
            </template>
          </el-table-column>
        </el-table>
      </div>
    </section>
  </div>
</template>
