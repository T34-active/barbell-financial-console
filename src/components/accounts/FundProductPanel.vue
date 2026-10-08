<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import FormulaTooltip from '@/components/accounts/FormulaTooltip.vue'
import { quoteToneClass } from '@/composables/useQuoteColor'
import { useFinanceStore } from '@/stores/finance'
import type { FundLot, PoolAccount } from '@/types/finance'
import {
  formatMoney,
  formatPercent,
  fundCostBasis,
  fundMarketValue,
  fundPnl,
} from '@/utils/currency'
import { isFutureBeijingDate, formatMonthDay, todayBeijingDate } from '@/utils/datetime'
import { add, div, mul, round, sub } from '@/utils/decimal'
import { derivePrevNav, lotDailyPnl } from '@/utils/fund-nav'

const props = defineProps<{
  account: PoolAccount
}>()

const store = useFinanceStore()
const currency = computed(() => props.account.currency)
const navRefreshing = ref(false)
const tradeMode = ref<'buy' | 'sell'>('buy')
const buyForm = ref({
  amount: 100,
  confirmNav: 0,
  confirmDate: todayBeijingDate(),
  note: '',
})
const sellForm = ref({
  shares: 0,
  redeemNav: 0,
  note: '',
})

const lots = computed<FundLot[]>(() => props.account.fund_lots ?? [])

const summary = computed(() => {
  const account = props.account
  const { pnl, rate } = fundPnl(account)
  const cost = fundCostBasis(account)
  const shares = account.shares ?? 0
  return {
    cost,
    market: fundMarketValue(account),
    pnl,
    rate,
    nav: account.nav ?? 0,
    costNav: shares > 0 && cost > 0 ? round(div(cost, shares), 4) : 0,
    shares,
    asOf: account.nav_updated_at?.slice(0, 10) ?? '',
  }
})

const daily = computed(() => {
  const account = props.account
  const nav = account.nav ?? 0
  const asOf = (account.nav_updated_at ?? '').slice(0, 10)
  const storedPrev = account.prev_nav ?? 0
  const prevNav = storedPrev > 0 ? storedPrev : derivePrevNav(nav, account.nav_day_change)
  const dayChange =
    account.nav_day_change ?? (prevNav > 0 && nav > 0 ? div(sub(nav, prevNav), prevNav) : 0)
  const pnl = lots.value.length
    ? round(
        lots.value.reduce((sum, lot) => add(sum, lotDailyPnl(lot, nav, prevNav, asOf)), 0),
        2,
      )
    : prevNav > 0
      ? round(mul(account.shares ?? 0, sub(nav, prevNav)), 2)
      : 0
  return {
    prevNav,
    dayChange,
    pnl,
    asOf,
    available: prevNav > 0 && nav > 0,
  }
})

const sharesText = computed(() => (summary.value.shares ? summary.value.shares.toFixed(4) : '—'))
const navText = computed(() => (summary.value.nav ? summary.value.nav.toFixed(4) : '—'))
const prevNavText = computed(() => (daily.value.available ? daily.value.prevNav.toFixed(4) : '—'))
const costNavText = computed(() => (summary.value.costNav ? summary.value.costNav.toFixed(4) : '—'))

function lotTodayPnl(lot: FundLot) {
  return lotDailyPnl(lot, summary.value.nav, daily.value.prevNav, daily.value.asOf)
}

const dailyLog = computed(() => props.account.daily_pnl ?? [])
const dailyPage = ref(1)
const dailyPageSize = ref(10)
const dailyPageRows = computed(() => {
  const start = (dailyPage.value - 1) * dailyPageSize.value
  return dailyLog.value.slice(start, start + dailyPageSize.value)
})
const dailyLogSum = computed(() =>
  round(
    dailyLog.value.reduce((sum, row) => add(sum, row.pnl), 0),
    2,
  ),
)

watch([() => dailyLog.value.length, dailyPageSize], () => {
  const maxPage = Math.max(1, Math.ceil(dailyLog.value.length / dailyPageSize.value) || 1)
  if (dailyPage.value > maxPage) dailyPage.value = maxPage
})

function lotMarketValue(lot: FundLot) {
  const nav = props.account.nav
  if (!(nav! > 0)) return 0
  return round(mul(lot.shares, nav!), 2)
}

function lotPnl(lot: FundLot) {
  return sub(lotMarketValue(lot), lot.amount)
}

function lotPnlRate(lot: FundLot) {
  if (!(lot.amount > 0)) return 0
  return div(lotPnl(lot), lot.amount)
}

const buyPreviewShares = computed(() => {
  const amount = buyForm.value.amount
  const nav = buyForm.value.confirmNav
  if (!(amount > 0) || !(nav > 0)) return 0
  return round(div(amount, nav), 4)
})

const sellPreview = computed(() => {
  const shares = sellForm.value.shares
  const nav = sellForm.value.redeemNav
  const costNav = summary.value.costNav
  if (!(shares > 0)) return { proceeds: 0, cost: 0, realized: 0 }
  const proceeds = nav > 0 ? round(mul(shares, nav), 2) : 0
  const cost = costNav > 0 ? round(mul(shares, costNav), 2) : 0
  return {
    proceeds,
    cost,
    realized: round(sub(proceeds, cost), 2),
  }
})

watch(
  () => props.account.nav,
  (nav) => {
    if (!(nav && nav > 0)) return
    if (!(buyForm.value.confirmNav > 0)) buyForm.value.confirmNav = nav
    if (!(sellForm.value.redeemNav > 0)) sellForm.value.redeemNav = nav
  },
  { immediate: true },
)

async function refreshNav() {
  navRefreshing.value = true
  try {
    const result = await store.refreshFundNav(props.account.id)
    const sign = result.pnl >= 0 ? '+' : ''
    const dailySign = daily.value.pnl >= 0 ? '+' : ''
    const dailyText = daily.value.available
      ? ` · 今日盈亏 ${dailySign}${formatMoney(daily.value.pnl, currency.value)}（${formatPercent(daily.value.dayChange)}）`
      : ''
    ElMessage.success(
      `${props.account.name} 净值 ${result.nav}（${result.as_of}）· 市值 ${formatMoney(result.amount, currency.value)}${dailyText} · 浮${result.pnl >= 0 ? '盈' : '亏'} ${sign}${formatMoney(result.pnl, currency.value)}（${formatPercent(result.profit_rate)}）`,
    )
    if (!(buyForm.value.confirmNav > 0)) buyForm.value.confirmNav = result.nav
    if (!(sellForm.value.redeemNav > 0)) sellForm.value.redeemNav = result.nav
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  } finally {
    navRefreshing.value = false
  }
}

function saveBuy() {
  try {
    const lot = store.addFundLot(props.account.id, {
      amount: buyForm.value.amount,
      confirmNav: buyForm.value.confirmNav,
      confirmDate: buyForm.value.confirmDate,
      note: buyForm.value.note,
    })
    ElMessage.success(
      `已加仓 ${formatMoney(lot.amount, currency.value)} → ${lot.shares.toFixed(4)} 份（净值 ${lot.confirm_nav.toFixed(4)}）`,
    )
    buyForm.value.amount = 100
    buyForm.value.note = ''
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  }
}

function saveSell() {
  try {
    const result = store.sellFundShares(props.account.id, {
      shares: sellForm.value.shares,
      redeemNav: sellForm.value.redeemNav,
      note: sellForm.value.note,
    })
    const sign = result.realized_pnl >= 0 ? '+' : ''
    ElMessage.success(
      `已卖出 ${result.sold_shares.toFixed(4)} 份 · 估到账 ${formatMoney(result.proceeds, currency.value)} · 实现盈亏 ${sign}${formatMoney(result.realized_pnl, currency.value)}（FIFO）`,
    )
    sellForm.value.shares = 0
    sellForm.value.note = ''
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  }
}

async function removeProduct() {
  const account = props.account
  const shares = account.shares ?? 0
  const hasHolding = (account.fund_lots?.length ?? 0) > 0 || shares > 0
  const detail = hasHolding
    ? `「${account.name}」持有 ${shares.toFixed(4)} 份，市值 ${formatMoney(fundMarketValue(account), account.currency)}。删除后不再计入资产。`
    : `确定删除「${account.name}」？暂无持仓，删除后不再计入资产。`
  try {
    await ElMessageBox.confirm(detail, '删除基金', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    store.removeAccount('rmb_pool', account.id)
    ElMessage.success(`已删除 ${account.name}`)
  } catch {
    /* cancel */
  }
}
</script>

<template>
  <section class="space-y-3">
    <div class="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h3 class="mb-1 text-sm font-medium text-accent">
          {{ account.name }}
          <span v-if="account.fund_code" class="font-normal text-ink-muted">
            · {{ account.fund_code }}
          </span>
        </h3>
        <p class="text-xs text-ink-muted">
          加仓/卖出按份额记账（卖出 FIFO）；勿再手改总额。点问号看公式。
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <el-button type="primary" plain :loading="navRefreshing" @click="refreshNav">
          刷新净值/浮盈
        </el-button>
        <el-button type="danger" plain @click="removeProduct">删除</el-button>
      </div>
    </div>
    <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
      <div class="panel min-w-0 space-y-3 px-4 py-3 text-xs md:px-5">
        <p class="font-medium text-ink-muted">
          今日盈亏统计
          <span v-if="daily.asOf">（净值日 {{ daily.asOf }}）</span>
        </p>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <p class="text-ink-muted">
              <FormulaTooltip>
                成本
                <template #content>
                  <p>加仓明细未卖出部分的投入合计（FIFO 成本）</p>
                  <p class="font-mono">{{ formatMoney(summary.cost, currency) }}</p>
                </template>
              </FormulaTooltip>
            </p>
            <p class="stat-num mt-0.5 font-semibold">
              {{ formatMoney(summary.cost, currency) }}
            </p>
          </div>
          <div>
            <p class="text-ink-muted">
              <FormulaTooltip>
                市值
                <template #content>
                  <p>市值 = 总份额 × 最新净值</p>
                  <p class="font-mono">
                    {{ sharesText }} × {{ navText }} =
                    {{ formatMoney(summary.market, currency) }}
                  </p>
                </template>
              </FormulaTooltip>
            </p>
            <p class="stat-num mt-0.5 font-semibold">
              {{ formatMoney(summary.market, currency) }}
            </p>
          </div>
          <div>
            <p class="text-ink-muted">
              <FormulaTooltip>
                持仓份额
                <template #content>
                  <p>加仓明细未卖出份额合计</p>
                </template>
              </FormulaTooltip>
            </p>
            <p class="stat-num mt-0.5 font-semibold">{{ sharesText }}</p>
          </div>
          <div>
            <p class="text-ink-muted">
              <FormulaTooltip>
                成本净值
                <template #content>
                  <p>持仓成本净值 = 总成本 ÷ 总份额</p>
                  <p class="font-mono">
                    {{ formatMoney(summary.cost, currency) }}
                    ÷ {{ sharesText }} = {{ costNavText }}
                  </p>
                </template>
              </FormulaTooltip>
            </p>
            <p class="stat-num mt-0.5 font-semibold">
              {{ summary.costNav ? summary.costNav.toFixed(4) : '—' }}
            </p>
          </div>
          <div>
            <p class="text-ink-muted">
              <FormulaTooltip>
                最新净值
                <template #content>
                  <p>已公布单位净值（刷新净值后写入）</p>
                  <p class="font-mono">{{ navText }}</p>
                </template>
              </FormulaTooltip>
            </p>
            <p class="stat-num mt-0.5 font-semibold">
              {{ summary.nav ? summary.nav.toFixed(4) : '—' }}
            </p>
            <p v-if="summary.asOf" class="mt-0.5 text-[10px] text-ink-muted">
              {{ summary.asOf }}
            </p>
          </div>
          <div>
            <p class="text-ink-muted">
              <FormulaTooltip>
                上日净值
                <template #content>
                  <p>上一交易日单位净值</p>
                </template>
              </FormulaTooltip>
            </p>
            <p class="stat-num mt-0.5 font-semibold">{{ prevNavText }}</p>
          </div>
          <div>
            <p class="text-ink-muted">
              <FormulaTooltip>
                日涨跌幅
                <template #content>
                  <p>日涨跌幅 = (最新净值 − 上日净值) ÷ 上日净值</p>
                  <p v-if="daily.available" class="font-mono">
                    ({{ navText }} − {{ prevNavText }}) ÷ {{ prevNavText }}
                    =
                    {{ daily.dayChange >= 0 ? '+' : '' }}{{ formatPercent(daily.dayChange) }}
                  </p>
                </template>
              </FormulaTooltip>
            </p>
            <p
              class="stat-num mt-0.5 font-semibold"
              :class="daily.available ? quoteToneClass(daily.dayChange) : 'text-ink-muted'"
            >
              {{
                daily.available
                  ? `${daily.dayChange >= 0 ? '+' : ''}${formatPercent(daily.dayChange)}`
                  : '—'
              }}
            </p>
          </div>
          <div>
            <p class="text-ink-muted">
              <FormulaTooltip>
                今日盈亏
                <template #content>
                  <p>今日盈亏 = 份额 × (最新净值 − 上日净值)</p>
                  <p>净值当日新确认的份额从确认净值起算</p>
                  <p v-if="daily.available" class="font-mono">
                    {{ sharesText }} × ({{ navText }} − {{ prevNavText }}) =
                    {{ daily.pnl >= 0 ? '+' : '' }}{{ formatMoney(daily.pnl, currency) }} （{{
                      daily.dayChange >= 0 ? '+' : ''
                    }}{{ formatPercent(daily.dayChange) }}）
                  </p>
                  <p v-else>刷新净值后显示</p>
                </template>
              </FormulaTooltip>
            </p>
            <p
              v-if="daily.available"
              class="stat-num mt-0.5 font-semibold"
              :class="quoteToneClass(daily.pnl)"
            >
              {{ daily.pnl >= 0 ? '+' : '' }}{{ formatMoney(daily.pnl, currency) }}
            </p>
            <p v-else class="mt-0.5 text-ink-muted">刷新净值后显示</p>
          </div>
          <div>
            <p class="text-ink-muted">
              <FormulaTooltip>
                浮盈亏
                <template #content>
                  <p>浮盈亏 = 市值 − 成本</p>
                  <p class="font-mono">
                    {{ sharesText }} × {{ navText }} −
                    {{ formatMoney(summary.cost, currency) }}
                    =
                    {{ summary.pnl >= 0 ? '+' : '' }}{{ formatMoney(summary.pnl, currency) }}
                  </p>
                </template>
              </FormulaTooltip>
            </p>
            <p class="stat-num mt-0.5 font-semibold" :class="quoteToneClass(summary.pnl)">
              {{ summary.pnl >= 0 ? '+' : '' }}{{ formatMoney(summary.pnl, currency) }}
            </p>
          </div>
          <div>
            <p class="text-ink-muted">
              <FormulaTooltip>
                浮盈亏率
                <template #content>
                  <p>浮盈亏率 = 浮盈亏 ÷ 成本</p>
                  <p class="font-mono">
                    {{ summary.pnl >= 0 ? '+' : '' }}{{ formatMoney(summary.pnl, currency) }} ÷
                    {{ formatMoney(summary.cost, currency) }}
                    =
                    {{ summary.rate >= 0 ? '+' : '' }}{{ formatPercent(summary.rate) }}
                  </p>
                </template>
              </FormulaTooltip>
            </p>
            <p class="stat-num mt-0.5 font-semibold" :class="quoteToneClass(summary.rate)">
              {{ summary.rate >= 0 ? '+' : '' }}{{ formatPercent(summary.rate) }}
            </p>
          </div>
        </div>
      </div>

      <div class="panel min-w-0 overflow-x-auto px-3 py-3 md:px-4">
        <p class="mb-1 text-xs font-medium text-ink-muted">每日盈亏</p>
        <p class="mb-2 text-[11px] text-ink-muted">
          每个净值日记一笔（如
          8-25、8-26）；刷新净值后自动追加。已记下的历史日冻结，不随之后买卖改写。
        </p>
        <div v-if="dailyLog.length" class="overflow-x-auto">
          <table class="w-full min-w-[560px] border-collapse text-left text-xs">
            <thead>
              <tr class="border-b border-surface-line text-ink-muted">
                <th class="px-2 py-2 font-medium">日期</th>
                <th class="px-2 py-2 font-medium">
                  <FormulaTooltip>
                    当日盈亏
                    <template #content>
                      <p>当日盈亏 = 当日份额 × (当日净值 − 上日净值)</p>
                      <p>记下后冻结，不随之后买卖改写</p>
                    </template>
                  </FormulaTooltip>
                </th>
                <th class="px-2 py-2 font-medium">
                  <FormulaTooltip>
                    日涨跌
                    <template #content>
                      <p>日涨跌 = (当日净值 − 上日净值) ÷ 上日净值</p>
                    </template>
                  </FormulaTooltip>
                </th>
                <th class="px-2 py-2 font-medium">净值</th>
                <th class="px-2 py-2 font-medium">上日净值</th>
                <th class="px-2 py-2 font-medium">当日份额</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in dailyPageRows"
                :key="row.date"
                class="border-b border-surface-line/60"
                :class="row.date === daily.asOf ? 'bg-surface-tint/50' : ''"
              >
                <td class="px-2 py-2 font-medium">
                  {{ formatMonthDay(row.date) }}
                  <span class="ml-1 font-normal text-ink-muted">
                    {{ row.date.slice(0, 4) }}
                  </span>
                </td>
                <td class="px-2 py-2 font-medium" :class="quoteToneClass(row.pnl)">
                  {{ row.pnl >= 0 ? '+' : '' }}{{ formatMoney(row.pnl, currency) }}
                </td>
                <td class="px-2 py-2 font-mono" :class="quoteToneClass(row.day_change)">
                  {{ row.day_change >= 0 ? '+' : '' }}{{ formatPercent(row.day_change) }}
                </td>
                <td class="px-2 py-2 font-mono">{{ row.nav.toFixed(4) }}</td>
                <td class="px-2 py-2 font-mono">{{ row.prev_nav.toFixed(4) }}</td>
                <td class="px-2 py-2 font-mono">{{ row.shares.toFixed(4) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="font-medium">
                <td class="px-2 py-2">合计 {{ dailyLog.length }} 天</td>
                <td class="px-2 py-2" :class="quoteToneClass(dailyLogSum)">
                  {{ dailyLogSum >= 0 ? '+' : '' }}{{ formatMoney(dailyLogSum, currency) }}
                </td>
                <td class="px-2 py-2" colspan="4" />
              </tr>
            </tfoot>
          </table>
        </div>
        <div v-if="dailyLog.length" class="mt-3 flex justify-end">
          <el-pagination
            v-model:current-page="dailyPage"
            v-model:page-size="dailyPageSize"
            :page-sizes="[10, 20, 30]"
            :total="dailyLog.length"
            layout="total, sizes, prev, pager, next"
            size="small"
            background
          />
        </div>
        <p v-else class="text-xs text-ink-muted">
          尚无每日记录。点「刷新净值/浮盈」后会按持仓补齐各净值日盈亏。
        </p>
      </div>

      <div class="panel min-w-0 space-y-3 px-4 py-3 md:px-5">
        <div class="flex flex-wrap gap-2">
          <el-button
            size="small"
            :type="tradeMode === 'buy' ? 'primary' : 'default'"
            plain
            @click="tradeMode = 'buy'"
          >
            加仓
          </el-button>
          <el-button
            size="small"
            :type="tradeMode === 'sell' ? 'danger' : 'default'"
            plain
            @click="tradeMode = 'sell'"
          >
            卖出
          </el-button>
        </div>

        <div v-if="tradeMode === 'buy'" class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="mb-1 block text-xs text-ink-muted">投入金额（{{ currency }}）</label>
            <AmountInput v-model="buyForm.amount" :min="0.01" class="w-full!" />
          </div>
          <div>
            <label class="mb-1 block text-xs text-ink-muted">确认净值</label>
            <el-input-number
              v-model="buyForm.confirmNav"
              :min="0.0001"
              :step="0.0001"
              :precision="4"
              controls-position="right"
              class="w-full!"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs text-ink-muted">确认日</label>
            <el-date-picker
              v-model="buyForm.confirmDate"
              type="date"
              value-format="YYYY-MM-DD"
              :disabled-date="isFutureBeijingDate"
              placeholder="选择确认日"
              class="w-full!"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs text-ink-muted">备注（可选）</label>
            <el-input v-model="buyForm.note" maxlength="32" placeholder="如：支付宝买入" />
          </div>
          <div class="sm:col-span-2 flex flex-wrap items-center gap-3">
            <p class="text-xs text-ink-muted">
              <FormulaTooltip>
                预估份额
                <template #content>
                  <p>加仓：份额 = 投入金额 ÷ 确认净值（写入明细）</p>
                  <p class="font-mono">
                    {{ formatMoney(buyForm.amount, currency) }}
                    ÷ {{ buyForm.confirmNav ? buyForm.confirmNav.toFixed(4) : '—' }}
                    =
                    {{ buyPreviewShares ? buyPreviewShares.toFixed(4) : '—' }}
                  </p>
                </template>
              </FormulaTooltip>
              =
              <span class="font-mono text-ink">
                {{ buyPreviewShares ? buyPreviewShares.toFixed(4) : '—' }}
              </span>
            </p>
            <el-button type="primary" @click="saveBuy">确认加仓</el-button>
          </div>
        </div>

        <div v-else class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="mb-1 block text-xs text-ink-muted">卖出份额</label>
            <el-input-number
              v-model="sellForm.shares"
              :min="0.0001"
              :max="summary.shares || undefined"
              :step="0.01"
              :precision="4"
              controls-position="right"
              class="w-full!"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs text-ink-muted">赎回净值（估到账）</label>
            <el-input-number
              v-model="sellForm.redeemNav"
              :min="0.0001"
              :step="0.0001"
              :precision="4"
              controls-position="right"
              class="w-full!"
            />
          </div>
          <div class="sm:col-span-2">
            <label class="mb-1 block text-xs text-ink-muted">备注（可选）</label>
            <el-input v-model="sellForm.note" maxlength="32" placeholder="如：支付宝赎回" />
          </div>
          <div class="sm:col-span-2 flex flex-wrap items-center gap-3">
            <p class="text-xs text-ink-muted">
              <FormulaTooltip>
                FIFO 估到账
                <template #content>
                  <p>卖出按确认日 FIFO 扣份额与对应成本</p>
                  <p>估到账 = 卖出份额 × 赎回净值</p>
                  <p>实现盈亏预览按平均成本净值，实际按明细 FIFO</p>
                  <p class="font-mono">
                    {{ sellForm.shares ? sellForm.shares.toFixed(4) : '—' }}
                    × {{ sellForm.redeemNav ? sellForm.redeemNav.toFixed(4) : '—' }} =
                    {{ formatMoney(sellPreview.proceeds, currency) }}
                  </p>
                </template>
              </FormulaTooltip>
              {{ formatMoney(sellPreview.proceeds, currency) }}
              · 实现盈亏
              <span :class="quoteToneClass(sellPreview.realized)">
                {{ sellPreview.realized >= 0 ? '+' : ''
                }}{{ formatMoney(sellPreview.realized, currency) }}
              </span>
            </p>
            <el-button type="danger" @click="saveSell">确认卖出</el-button>
          </div>
        </div>
      </div>

      <div class="panel min-w-0 overflow-x-auto px-3 py-3 md:px-4">
        <p class="mb-2 text-xs font-medium text-ink-muted">加仓明细（FIFO 卖出从最早一笔扣）</p>
        <table v-if="lots.length" class="w-full min-w-[720px] border-collapse text-left text-xs">
          <thead>
            <tr class="border-b border-surface-line text-ink-muted">
              <th class="px-2 py-2 font-medium">确认日</th>
              <th class="px-2 py-2 font-medium">投入</th>
              <th class="px-2 py-2 font-medium">确认净值</th>
              <th class="px-2 py-2 font-medium">
                <FormulaTooltip>
                  份额
                  <template #content>
                    <p>份额 = 投入金额 ÷ 确认净值</p>
                  </template>
                </FormulaTooltip>
              </th>
              <th class="px-2 py-2 font-medium">
                <FormulaTooltip>
                  现市值
                  <template #content>
                    <p>现市值 = 该笔份额 × 最新净值</p>
                  </template>
                </FormulaTooltip>
              </th>
              <th class="px-2 py-2 font-medium">
                <FormulaTooltip>
                  今日盈亏
                  <template #content>
                    <p>该笔份额 × (最新净值 − 上日净值)</p>
                    <p>确认日当天从确认净值起算</p>
                  </template>
                </FormulaTooltip>
              </th>
              <th class="px-2 py-2 font-medium">
                <FormulaTooltip>
                  浮盈亏
                  <template #content>
                    <p>浮盈亏 = 现市值 − 该笔投入</p>
                  </template>
                </FormulaTooltip>
              </th>
              <th class="px-2 py-2 font-medium">备注</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="lot in lots" :key="lot.id" class="border-b border-surface-line/60">
              <td class="px-2 py-2 font-mono">{{ lot.confirm_date }}</td>
              <td class="px-2 py-2">{{ formatMoney(lot.amount, currency) }}</td>
              <td class="px-2 py-2 font-mono">{{ lot.confirm_nav.toFixed(4) }}</td>
              <td class="px-2 py-2 font-mono">{{ lot.shares.toFixed(4) }}</td>
              <td class="px-2 py-2">{{ formatMoney(lotMarketValue(lot), currency) }}</td>
              <td
                class="px-2 py-2"
                :class="daily.available ? quoteToneClass(lotTodayPnl(lot)) : 'text-ink-muted'"
              >
                <template v-if="daily.available">
                  {{ lotTodayPnl(lot) >= 0 ? '+' : ''
                  }}{{ formatMoney(lotTodayPnl(lot), currency) }}
                </template>
                <template v-else>—</template>
              </td>
              <td class="px-2 py-2" :class="quoteToneClass(lotPnl(lot))">
                {{ lotPnl(lot) >= 0 ? '+' : '' }}{{ formatMoney(lotPnl(lot), currency) }} （{{
                  formatPercent(lotPnlRate(lot))
                }}）
              </td>
              <td class="px-2 py-2 text-ink-muted">{{ lot.note || '—' }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="font-medium">
              <td class="px-2 py-2">合计</td>
              <td class="px-2 py-2">{{ formatMoney(summary.cost, currency) }}</td>
              <td class="px-2 py-2">—</td>
              <td class="px-2 py-2 font-mono">
                {{ summary.shares ? summary.shares.toFixed(4) : '—' }}
              </td>
              <td class="px-2 py-2">{{ formatMoney(summary.market, currency) }}</td>
              <td
                class="px-2 py-2"
                :class="daily.available ? quoteToneClass(daily.pnl) : 'text-ink-muted'"
              >
                <template v-if="daily.available">
                  {{ daily.pnl >= 0 ? '+' : '' }}{{ formatMoney(daily.pnl, currency) }}
                </template>
                <template v-else>—</template>
              </td>
              <td class="px-2 py-2" :class="quoteToneClass(summary.pnl)">
                {{ summary.pnl >= 0 ? '+' : '' }}{{ formatMoney(summary.pnl, currency) }} （{{
                  formatPercent(summary.rate)
                }}）
              </td>
              <td class="px-2 py-2" />
            </tr>
          </tfoot>
        </table>
        <p v-else class="text-xs text-ink-muted">暂无加仓明细</p>
      </div>
    </div>
  </section>
</template>
