<script setup lang="ts">
import dayjs from 'dayjs'
import { ElMessage, ElMessageBox } from 'element-plus'
import PoolAccountCard from '@/components/accounts/PoolAccountCard.vue'
import StockHoldingCard from '@/components/accounts/StockHoldingCard.vue'
import FormulaTooltip from '@/components/accounts/FormulaTooltip.vue'
import LoanPanel from '@/components/accounts/LoanPanel.vue'
import YuanGouPanel from '@/components/accounts/YuanGouPanel.vue'
import { useFinanceStore } from '@/stores/finance'
import { useFinanceFormat } from '@/composables/useFinanceFormat'
import { quoteToneClass } from '@/composables/useQuoteColor'
import {
  formatMoney,
  formatPercent,
  fundCostBasis,
  fundMarketValue,
  fundPnl,
  stockCostBasis,
  stockMarketValue,
} from '@/utils/currency'
import { add, div, mul, round, sub } from '@/utils/decimal'
import { isFutureBeijingDate, todayBeijingDate, formatMonthDay } from '@/utils/datetime'
import { derivePrevNav, lotDailyPnl } from '@/utils/fund-nav'
import type { FundLot, PoolAccount, UsStockHolding } from '@/types/finance'

const store = useFinanceStore()
const { money, moneyInBase } = useFinanceFormat()

const activeTab = ref<'rmb' | 'hkd' | 'us' | 'neutral'>('neutral')

const safeRmb = computed(() =>
  store.accounts.rmb_pool.filter(
    (a) => !store.settings.asset_classification.neutral_assets.includes(a.id),
  ),
)
const goldNeutral = computed(() => {
  const ids = new Set(store.settings.asset_classification.neutral_assets)
  return store.accounts.rmb_pool.filter((a) => ids.has(a.id))
})
const cryptoAssets = computed(() => {
  const ids = new Set(store.settings.asset_classification.crypto_assets ?? [])
  return store.accounts.crypto_pool.filter((a) => ids.has(a.id))
})
const neutralAssets = computed(() => [...goldNeutral.value, ...cryptoAssets.value] as PoolAccount[])
const neutralValue = computed(() =>
  neutralAssets.value.reduce((sum, item) => add(sum, store.toBase(item.amount, item.currency)), 0),
)

const rmbSafeValue = computed(() =>
  safeRmb.value.reduce((sum, item) => add(sum, store.toBase(item.amount, item.currency)), 0),
)

const tabs = computed(() => [
  {
    key: 'rmb' as const,
    label: '人民币安全',
    value: rmbSafeValue.value,
    count: safeRmb.value.length,
  },
  {
    key: 'hkd' as const,
    label: '港币池',
    value: store.hkdPoolValue,
    count: store.accounts.hkd_pool.length,
  },
  {
    key: 'us' as const,
    label: '美股池',
    value: store.usStockValue,
    count: store.accounts.us_stock_pool.length,
  },
  {
    key: 'neutral' as const,
    label: '中性+加密赌注',
    value: neutralValue.value,
    count: neutralAssets.value.length,
  },
])

const quoteRefreshing = ref(false)
const goldNavRefreshing = ref(false)
const goldTradeMode = ref<'buy' | 'sell'>('buy')
const goldBuyForm = ref({
  amount: 100,
  confirmNav: 0,
  confirmDate: todayBeijingDate(),
  note: '',
})
const goldSellForm = ref({
  shares: 0,
  redeemNav: 0,
  note: '',
})
const editDialogVisible = ref(false)
const editingStock = ref<UsStockHolding | null>(null)
const editShares = ref(0)
const editCostPrice = ref(0)

/** 新增港币账户 */
const addHkdVisible = ref(false)
const hkdForm = ref({
  name: '',
  id: '',
  amount: 0,
  yieldPct: 0,
  note: '',
  currency: 'HKD' as 'HKD' | 'SGD',
})

/** 新增美股持仓 */
const addStockVisible = ref(false)
const stockForm = ref({
  symbol: '',
  name: '',
  shares: 1,
  costPrice: 0,
})

/** 美股持仓盈亏合计（USD） */
const usHoldingPnl = computed(() => {
  let cost = 0
  let market = 0
  for (const stock of store.accounts.us_stock_pool) {
    cost = add(cost, stockCostBasis(stock))
    market = add(market, stockMarketValue(stock))
  }
  const pnl = sub(market, cost)
  return {
    cost,
    market,
    pnl,
    rate: cost > 0 ? div(pnl, cost) : 0,
  }
})

const goldAccount = computed(() => store.accounts.rmb_pool.find((a) => a.id === 'gold_etf') ?? null)

const goldLots = computed<FundLot[]>(() => goldAccount.value?.fund_lots ?? [])

const goldSummary = computed(() => {
  const account = goldAccount.value
  if (!account) {
    return {
      cost: 0,
      market: 0,
      pnl: 0,
      rate: 0,
      nav: 0,
      costNav: 0,
      shares: 0,
      asOf: '',
    }
  }
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

const goldDaily = computed(() => {
  const account = goldAccount.value
  const nav = account?.nav ?? 0
  const asOf = (account?.nav_updated_at ?? '').slice(0, 10)
  const storedPrev = account?.prev_nav ?? 0
  const prevNav = storedPrev > 0 ? storedPrev : derivePrevNav(nav, account?.nav_day_change)
  const dayChange =
    account?.nav_day_change ?? (prevNav > 0 && nav > 0 ? div(sub(nav, prevNav), prevNav) : 0)
  const lots = goldLots.value
  const pnl = lots.length
    ? round(
        lots.reduce((sum, lot) => add(sum, lotDailyPnl(lot, nav, prevNav, asOf)), 0),
        2,
      )
    : prevNav > 0
      ? round(mul(account?.shares ?? 0, sub(nav, prevNav)), 2)
      : 0
  return {
    prevNav,
    dayChange,
    pnl,
    asOf,
    available: prevNav > 0 && nav > 0,
  }
})

const goldSharesText = computed(() =>
  goldSummary.value.shares ? goldSummary.value.shares.toFixed(4) : '—',
)
const goldNavText = computed(() => (goldSummary.value.nav ? goldSummary.value.nav.toFixed(4) : '—'))
const goldPrevNavText = computed(() =>
  goldDaily.value.available ? goldDaily.value.prevNav.toFixed(4) : '—',
)
const goldCostNavText = computed(() =>
  goldSummary.value.costNav ? goldSummary.value.costNav.toFixed(4) : '—',
)

function lotTodayPnl(lot: FundLot) {
  return lotDailyPnl(lot, goldSummary.value.nav, goldDaily.value.prevNav, goldDaily.value.asOf)
}

const goldDailyLog = computed(() => goldAccount.value?.daily_pnl ?? [])

const goldDailyPage = ref(1)
const goldDailyPageSize = ref(10)

const goldDailyPageRows = computed(() => {
  const start = (goldDailyPage.value - 1) * goldDailyPageSize.value
  return goldDailyLog.value.slice(start, start + goldDailyPageSize.value)
})

const goldDailyLogSum = computed(() =>
  round(
    goldDailyLog.value.reduce((sum, row) => add(sum, row.pnl), 0),
    2,
  ),
)

watch([() => goldDailyLog.value.length, goldDailyPageSize], () => {
  const maxPage = Math.max(1, Math.ceil(goldDailyLog.value.length / goldDailyPageSize.value) || 1)
  if (goldDailyPage.value > maxPage) goldDailyPage.value = maxPage
})

function lotMarketValue(lot: FundLot) {
  const nav = goldAccount.value?.nav
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

function slugifyId(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\u4e00-\u9fff]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)
}

/** 名称自动生成 id 时记录，避免覆盖用户手改的 id */
const hkdIdAuto = ref(true)

function openAddHkd() {
  hkdForm.value = { name: '', id: '', amount: 0, yieldPct: 0, note: '', currency: 'HKD' }
  hkdIdAuto.value = true
  addHkdVisible.value = true
}

function onHkdNameInput() {
  if (hkdIdAuto.value) {
    hkdForm.value.id = slugifyId(hkdForm.value.name)
  }
}

function onHkdIdInput() {
  hkdIdAuto.value = !hkdForm.value.id.trim()
}

function saveAddHkd() {
  try {
    const name = hkdForm.value.name.trim()
    if (!name) throw new Error('请填写账户名称')
    let id = hkdForm.value.id.trim() || slugifyId(name)
    id = slugifyId(id) || `hkd_${Date.now().toString(36)}`
    if (store.accounts.hkd_pool.some((a) => a.id === id)) {
      throw new Error(`账户 id「${id}」已存在`)
    }
    const yieldPct = hkdForm.value.yieldPct
    store.upsertPoolAccount('hkd_pool', {
      id,
      name,
      type: 'bank',
      amount: hkdForm.value.amount,
      currency: hkdForm.value.currency,
      yield_rate: yieldPct > 0 ? div(yieldPct, 100) : undefined,
      note: hkdForm.value.note.trim() || undefined,
    })
    addHkdVisible.value = false
    ElMessage.success(`已添加港币账户：${name}`)
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  }
}

async function removeHkd(account: PoolAccount) {
  try {
    await ElMessageBox.confirm(
      `确定删除港币账户「${account.name}」？余额 ${formatMoney(account.amount, account.currency)} 将不再计入资产。`,
      '删除港币账户',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
    store.removeAccount('hkd_pool', account.id)
    ElMessage.success(`已删除 ${account.name}`)
  } catch {
    /* cancel */
  }
}

function openAddStock() {
  stockForm.value = { symbol: '', name: '', shares: 1, costPrice: 0 }
  addStockVisible.value = true
}

function saveAddStock() {
  try {
    const symbol = stockForm.value.symbol.trim().toUpperCase()
    if (!symbol) throw new Error('请填写股票代码')
    const name = stockForm.value.name.trim() || symbol
    store.upsertStock({
      id: symbol.toLowerCase(),
      symbol,
      name,
      shares: stockForm.value.shares,
      cost_price: stockForm.value.costPrice,
      currency: 'USD',
      market_price: stockForm.value.costPrice,
    })
    addStockVisible.value = false
    ElMessage.success(`已添加 ${symbol}`)
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  }
}

async function removeStock(stock: UsStockHolding) {
  try {
    await ElMessageBox.confirm(
      `确定删除 ${stock.symbol}（${stock.name}）？将从美股池移除，不可恢复。`,
      '删除美股持仓',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
    store.removeAccount('us_stock_pool', stock.id)
    ElMessage.success(`已删除 ${stock.symbol}`)
  } catch {
    /* cancel */
  }
}

async function refreshQuotes() {
  quoteRefreshing.value = true
  try {
    const result = await store.refreshStockQuotesAndYields()
    const msg = `已拉取 ${result.priceUpdated} 只现价、${result.yieldUpdated} 只股息率`
    if (result.errors.length) {
      ElMessage.warning(`${msg}；部分失败：${result.errors.join('；')}`)
    } else {
      ElMessage.success(msg)
    }
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  } finally {
    quoteRefreshing.value = false
  }
}

async function refreshGoldNav() {
  goldNavRefreshing.value = true
  try {
    const result = await store.refreshGoldFundNav()
    const sign = result.pnl >= 0 ? '+' : ''
    const dailySign = goldDaily.value.pnl >= 0 ? '+' : ''
    const dailyText = goldDaily.value.available
      ? ` · 今日盈亏 ${dailySign}${formatMoney(goldDaily.value.pnl, 'CNY')}（${formatPercent(goldDaily.value.dayChange)}）`
      : ''
    ElMessage.success(
      `净值 ${result.nav}（${result.as_of}）· 市值 ${formatMoney(result.amount, 'CNY')}${dailyText} · 浮${result.pnl >= 0 ? '盈' : '亏'} ${sign}${formatMoney(result.pnl, 'CNY')}（${formatPercent(result.profit_rate)}）`,
    )
    if (!(goldBuyForm.value.confirmNav > 0)) {
      goldBuyForm.value.confirmNav = result.nav
    }
    if (!(goldSellForm.value.redeemNav > 0)) {
      goldSellForm.value.redeemNav = result.nav
    }
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  } finally {
    goldNavRefreshing.value = false
  }
}

watch(
  goldAccount,
  (account) => {
    if (!account) return
    if (!(goldBuyForm.value.confirmNav > 0) && account.nav) {
      goldBuyForm.value.confirmNav = account.nav
    }
    if (!(goldSellForm.value.redeemNav > 0) && account.nav) {
      goldSellForm.value.redeemNav = account.nav
    }
  },
  { immediate: true },
)

const goldBuyPreviewShares = computed(() => {
  const amount = goldBuyForm.value.amount
  const nav = goldBuyForm.value.confirmNav
  if (!(amount > 0) || !(nav > 0)) return 0
  return round(div(amount, nav), 4)
})

const goldSellPreview = computed(() => {
  const shares = goldSellForm.value.shares
  const nav = goldSellForm.value.redeemNav
  const costNav = goldSummary.value.costNav
  if (!(shares > 0)) return { proceeds: 0, cost: 0, realized: 0 }
  const proceeds = nav > 0 ? round(mul(shares, nav), 2) : 0
  const cost = costNav > 0 ? round(mul(shares, costNav), 2) : 0
  return {
    proceeds,
    cost,
    realized: round(sub(proceeds, cost), 2),
  }
})

function saveGoldBuy() {
  try {
    const lot = store.addGoldFundLot({
      amount: goldBuyForm.value.amount,
      confirmNav: goldBuyForm.value.confirmNav,
      confirmDate: goldBuyForm.value.confirmDate,
      note: goldBuyForm.value.note,
    })
    ElMessage.success(
      `已加仓 ${formatMoney(lot.amount, 'CNY')} → ${lot.shares.toFixed(4)} 份（净值 ${lot.confirm_nav.toFixed(4)}）`,
    )
    goldBuyForm.value.amount = 100
    goldBuyForm.value.note = ''
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  }
}

function saveGoldSell() {
  try {
    const result = store.sellGoldFundShares({
      shares: goldSellForm.value.shares,
      redeemNav: goldSellForm.value.redeemNav,
      note: goldSellForm.value.note,
    })
    const sign = result.realized_pnl >= 0 ? '+' : ''
    ElMessage.success(
      `已卖出 ${result.sold_shares.toFixed(4)} 份 · 估到账 ${formatMoney(result.proceeds, 'CNY')} · 实现盈亏 ${sign}${formatMoney(result.realized_pnl, 'CNY')}（FIFO）`,
    )
    goldSellForm.value.shares = 0
    goldSellForm.value.note = ''
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  }
}

function openEditStock(stock: UsStockHolding) {
  editingStock.value = stock
  editShares.value = stock.shares
  editCostPrice.value = stock.cost_price
  editDialogVisible.value = true
}

function saveEditStock() {
  const stock = editingStock.value
  if (!stock) return
  try {
    store.updateStockHoldings([
      {
        id: stock.id,
        shares: editShares.value,
        cost_price: editCostPrice.value,
      },
    ])
    editDialogVisible.value = false
    ElMessage.success(`${stock.symbol} 持仓已保存`)
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  }
}

function saveHkdAmount(id: string, amount: number) {
  store.updatePoolAmount('hkd_pool', id, amount)
}

function savePoolYield(
  pool: 'rmb_pool' | 'hkd_pool' | 'crypto_pool',
  id: string,
  yieldRate: number,
) {
  try {
    if (typeof store.updatePoolYieldRate === 'function') {
      store.updatePoolYieldRate(pool, id, yieldRate)
      return
    }
    // HMR 热更新偶发丢方法时的兜底
    const target = store.accounts[pool].find((item) => item.id === id)
    if (!target) throw new Error(`未找到账户 ${id}`)
    if (!(yieldRate >= 0) || yieldRate > 1) {
      throw new Error('年化收益率须在 0%–100% 之间')
    }
    target.yield_rate = round(yieldRate, 4)
    target.amount_updated_at = dayjs().toISOString()
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  }
}

function saveRmbAmount(id: string, amount: number) {
  try {
    store.updatePoolAmount('rmb_pool', id, amount)
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  }
}

function isRmbEditable(id: string) {
  return id === 'yulibao' || id === 'cash_rmb'
}
</script>

<template>
  <div class="space-y-5">
    <div>
      <h1 class="section-title">账户明细</h1>
      <p class="mt-1 text-sm text-ink-muted">
        安全 / 进取 / 中性分池；黄金为中性，HTX/OKX 为加密赌注池（非安全）
      </p>
    </div>

    <div class="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="panel px-3 py-3 text-left transition-colors md:px-4"
        :class="
          activeTab === tab.key
            ? 'border-accent/40 ring-2 ring-accent/20'
            : 'hover:bg-surface-tint/40'
        "
        @click="activeTab = tab.key"
      >
        <p class="text-xs text-ink-muted">{{ tab.label }}</p>
        <p class="stat-num mt-1 text-sm font-semibold md:text-base">
          {{ money(tab.value) }}
        </p>
        <p class="mt-1 text-xs text-ink-muted">{{ tab.count }} 项</p>
      </button>
    </div>

    <section v-show="activeTab === 'rmb'" class="space-y-3">
      <p class="text-xs text-ink-muted">
        余利宝 / 手头现金默认按「存入 / 取出」记变动，也会显示加减了多少；需要时再切「改总额」。
      </p>
      <LoanPanel />
      <div class="grid gap-3 sm:grid-cols-2">
        <PoolAccountCard
          v-for="account in safeRmb"
          :key="account.id"
          :account="account"
          :editable="isRmbEditable(account.id)"
          :editable-yield="account.id === 'yulibao'"
          @save-amount="(amount) => saveRmbAmount(account.id, amount)"
          @save-yield="(rate) => savePoolYield('rmb_pool', account.id, rate)"
        />
      </div>
    </section>

    <section v-show="activeTab === 'hkd'" class="space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-xs text-ink-muted">
          港币账户支持「存入 / 取出」或改总额；可新增银行账户（如渣打），年化可手改。
        </p>
        <el-button type="primary" plain @click="openAddHkd">新增港币账户</el-button>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <PoolAccountCard
          v-for="account in store.accounts.hkd_pool"
          :key="account.id"
          :account="account"
          editable
          editable-yield
          removable
          @save-amount="(amount) => saveHkdAmount(account.id, amount)"
          @save-yield="(rate) => savePoolYield('hkd_pool', account.id, rate)"
          @remove="removeHkd(account)"
        />
      </div>
      <p v-if="!store.accounts.hkd_pool.length" class="text-sm text-ink-muted">
        暂无港币账户，点右上角新增
      </p>

      <el-dialog
        v-model="addHkdVisible"
        title="新增港币账户"
        width="92%"
        class="max-w-md"
        destroy-on-close
      >
        <div class="space-y-4">
          <div>
            <label class="mb-1 block text-xs text-ink-muted">账户名称</label>
            <el-input
              v-model="hkdForm.name"
              placeholder="例如：渣打银行"
              maxlength="32"
              @input="onHkdNameInput"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs text-ink-muted">账户 id（英文/数字，唯一）</label>
            <el-input
              v-model="hkdForm.id"
              placeholder="例如：scb"
              maxlength="32"
              @input="onHkdIdInput"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs text-ink-muted">币种</label>
            <el-radio-group v-model="hkdForm.currency">
              <el-radio-button value="HKD">HKD</el-radio-button>
              <el-radio-button value="SGD">SGD</el-radio-button>
            </el-radio-group>
          </div>
          <div>
            <label class="mb-1 block text-xs text-ink-muted">
              初始余额（{{ hkdForm.currency }}）
            </label>
            <AmountInput v-model="hkdForm.amount" :min="0" class="w-full!" />
          </div>
          <div>
            <label class="mb-1 block text-xs text-ink-muted">年化收益率（%，可选）</label>
            <el-input-number
              v-model="hkdForm.yieldPct"
              :min="0"
              :max="100"
              :step="0.01"
              :precision="2"
              controls-position="right"
              class="w-full!"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs text-ink-muted">备注（可选）</label>
            <el-input v-model="hkdForm.note" placeholder="可选备注" maxlength="64" />
          </div>
        </div>
        <template #footer>
          <el-button @click="addHkdVisible = false">取消</el-button>
          <el-button type="primary" @click="saveAddHkd">添加</el-button>
        </template>
      </el-dialog>
    </section>

    <section v-show="activeTab === 'neutral'" class="space-y-4">
      <YuanGouPanel />
      <div v-if="goldNeutral.length" class="space-y-3">
        <div class="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 class="mb-1 text-sm font-medium text-accent">中性 · 黄金</h3>
            <p class="text-xs text-ink-muted">
              加仓/卖出按份额记账（卖出 FIFO）；勿再手改总额。点问号看公式。
            </p>
          </div>
          <el-button type="primary" plain :loading="goldNavRefreshing" @click="refreshGoldNav">
            刷新净值/浮盈
          </el-button>
        </div>

        <div v-if="goldAccount" class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div class="panel min-w-0 space-y-3 px-4 py-3 text-xs md:px-5">
            <p class="font-medium text-ink-muted">
              今日盈亏统计
              <span v-if="goldDaily.asOf">（净值日 {{ goldDaily.asOf }}）</span>
            </p>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <p class="text-ink-muted">
                  <FormulaTooltip>
                    成本
                    <template #content>
                      <p>加仓明细未卖出部分的投入合计（FIFO 成本）</p>
                      <p class="font-mono">{{ formatMoney(goldSummary.cost, 'CNY') }}</p>
                    </template>
                  </FormulaTooltip>
                </p>
                <p class="stat-num mt-0.5 font-semibold">
                  {{ formatMoney(goldSummary.cost, 'CNY') }}
                </p>
              </div>
              <div>
                <p class="text-ink-muted">
                  <FormulaTooltip>
                    市值
                    <template #content>
                      <p>市值 = 总份额 × 最新净值</p>
                      <p class="font-mono">
                        {{ goldSharesText }} × {{ goldNavText }} =
                        {{ formatMoney(goldSummary.market, 'CNY') }}
                      </p>
                    </template>
                  </FormulaTooltip>
                </p>
                <p class="stat-num mt-0.5 font-semibold">
                  {{ formatMoney(goldSummary.market, 'CNY') }}
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
                <p class="stat-num mt-0.5 font-semibold">{{ goldSharesText }}</p>
              </div>
              <div>
                <p class="text-ink-muted">
                  <FormulaTooltip>
                    成本净值
                    <template #content>
                      <p>持仓成本净值 = 总成本 ÷ 总份额</p>
                      <p class="font-mono">
                        {{ formatMoney(goldSummary.cost, 'CNY') }}
                        ÷ {{ goldSharesText }} = {{ goldCostNavText }}
                      </p>
                    </template>
                  </FormulaTooltip>
                </p>
                <p class="stat-num mt-0.5 font-semibold">
                  {{ goldSummary.costNav ? goldSummary.costNav.toFixed(4) : '—' }}
                </p>
              </div>
              <div>
                <p class="text-ink-muted">
                  <FormulaTooltip>
                    最新净值
                    <template #content>
                      <p>已公布单位净值（刷新净值后写入）</p>
                      <p class="font-mono">{{ goldNavText }}</p>
                    </template>
                  </FormulaTooltip>
                </p>
                <p class="stat-num mt-0.5 font-semibold">
                  {{ goldSummary.nav ? goldSummary.nav.toFixed(4) : '—' }}
                </p>
                <p v-if="goldSummary.asOf" class="mt-0.5 text-[10px] text-ink-muted">
                  {{ goldSummary.asOf }}
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
                <p class="stat-num mt-0.5 font-semibold">{{ goldPrevNavText }}</p>
              </div>
              <div>
                <p class="text-ink-muted">
                  <FormulaTooltip>
                    日涨跌幅
                    <template #content>
                      <p>日涨跌幅 = (最新净值 − 上日净值) ÷ 上日净值</p>
                      <p v-if="goldDaily.available" class="font-mono">
                        ({{ goldNavText }} − {{ goldPrevNavText }}) ÷ {{ goldPrevNavText }}
                        =
                        {{ goldDaily.dayChange >= 0 ? '+' : ''
                        }}{{ formatPercent(goldDaily.dayChange) }}
                      </p>
                    </template>
                  </FormulaTooltip>
                </p>
                <p
                  class="stat-num mt-0.5 font-semibold"
                  :class="
                    goldDaily.available ? quoteToneClass(goldDaily.dayChange) : 'text-ink-muted'
                  "
                >
                  {{
                    goldDaily.available
                      ? `${goldDaily.dayChange >= 0 ? '+' : ''}${formatPercent(goldDaily.dayChange)}`
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
                      <p v-if="goldDaily.available" class="font-mono">
                        {{ goldSharesText }} × ({{ goldNavText }} − {{ goldPrevNavText }}) =
                        {{ goldDaily.pnl >= 0 ? '+' : ''
                        }}{{ formatMoney(goldDaily.pnl, 'CNY') }} （{{
                          goldDaily.dayChange >= 0 ? '+' : ''
                        }}{{ formatPercent(goldDaily.dayChange) }}）
                      </p>
                      <p v-else>刷新净值后显示</p>
                    </template>
                  </FormulaTooltip>
                </p>
                <p
                  v-if="goldDaily.available"
                  class="stat-num mt-0.5 font-semibold"
                  :class="quoteToneClass(goldDaily.pnl)"
                >
                  {{ goldDaily.pnl >= 0 ? '+' : '' }}{{ formatMoney(goldDaily.pnl, 'CNY') }}
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
                        {{ goldSharesText }} × {{ goldNavText }} −
                        {{ formatMoney(goldSummary.cost, 'CNY') }}
                        =
                        {{ goldSummary.pnl >= 0 ? '+' : ''
                        }}{{ formatMoney(goldSummary.pnl, 'CNY') }}
                      </p>
                    </template>
                  </FormulaTooltip>
                </p>
                <p class="stat-num mt-0.5 font-semibold" :class="quoteToneClass(goldSummary.pnl)">
                  {{ goldSummary.pnl >= 0 ? '+' : '' }}{{ formatMoney(goldSummary.pnl, 'CNY') }}
                </p>
              </div>
              <div>
                <p class="text-ink-muted">
                  <FormulaTooltip>
                    浮盈亏率
                    <template #content>
                      <p>浮盈亏率 = 浮盈亏 ÷ 成本</p>
                      <p class="font-mono">
                        {{ goldSummary.pnl >= 0 ? '+' : ''
                        }}{{ formatMoney(goldSummary.pnl, 'CNY') }} ÷
                        {{ formatMoney(goldSummary.cost, 'CNY') }}
                        =
                        {{ goldSummary.rate >= 0 ? '+' : '' }}{{ formatPercent(goldSummary.rate) }}
                      </p>
                    </template>
                  </FormulaTooltip>
                </p>
                <p class="stat-num mt-0.5 font-semibold" :class="quoteToneClass(goldSummary.rate)">
                  {{ goldSummary.rate >= 0 ? '+' : '' }}{{ formatPercent(goldSummary.rate) }}
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
            <div v-if="goldDailyLog.length" class="overflow-x-auto">
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
                    v-for="row in goldDailyPageRows"
                    :key="row.date"
                    class="border-b border-surface-line/60"
                    :class="row.date === goldDaily.asOf ? 'bg-surface-tint/50' : ''"
                  >
                    <td class="px-2 py-2 font-medium">
                      {{ formatMonthDay(row.date) }}
                      <span class="ml-1 font-normal text-ink-muted">
                        {{ row.date.slice(0, 4) }}
                      </span>
                    </td>
                    <td class="px-2 py-2 font-medium" :class="quoteToneClass(row.pnl)">
                      {{ row.pnl >= 0 ? '+' : '' }}{{ formatMoney(row.pnl, 'CNY') }}
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
                    <td class="px-2 py-2">合计 {{ goldDailyLog.length }} 天</td>
                    <td class="px-2 py-2" :class="quoteToneClass(goldDailyLogSum)">
                      {{ goldDailyLogSum >= 0 ? '+' : '' }}{{ formatMoney(goldDailyLogSum, 'CNY') }}
                    </td>
                    <td class="px-2 py-2" colspan="4" />
                  </tr>
                </tfoot>
              </table>
            </div>
            <div v-if="goldDailyLog.length" class="mt-3 flex justify-end">
              <el-pagination
                v-model:current-page="goldDailyPage"
                v-model:page-size="goldDailyPageSize"
                :page-sizes="[10, 20, 30]"
                :total="goldDailyLog.length"
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
                :type="goldTradeMode === 'buy' ? 'primary' : 'default'"
                plain
                @click="goldTradeMode = 'buy'"
              >
                加仓
              </el-button>
              <el-button
                size="small"
                :type="goldTradeMode === 'sell' ? 'danger' : 'default'"
                plain
                @click="goldTradeMode = 'sell'"
              >
                卖出
              </el-button>
            </div>

            <div v-if="goldTradeMode === 'buy'" class="grid gap-3 sm:grid-cols-2">
              <div>
                <label class="mb-1 block text-xs text-ink-muted">投入金额（CNY）</label>
                <AmountInput v-model="goldBuyForm.amount" :min="0.01" class="w-full!" />
              </div>
              <div>
                <label class="mb-1 block text-xs text-ink-muted">确认净值</label>
                <el-input-number
                  v-model="goldBuyForm.confirmNav"
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
                  v-model="goldBuyForm.confirmDate"
                  type="date"
                  value-format="YYYY-MM-DD"
                  :disabled-date="isFutureBeijingDate"
                  placeholder="选择确认日"
                  class="w-full!"
                />
              </div>
              <div>
                <label class="mb-1 block text-xs text-ink-muted">备注（可选）</label>
                <el-input v-model="goldBuyForm.note" maxlength="32" placeholder="如：支付宝买入" />
              </div>
              <div class="sm:col-span-2 flex flex-wrap items-center gap-3">
                <p class="text-xs text-ink-muted">
                  <FormulaTooltip>
                    预估份额
                    <template #content>
                      <p>加仓：份额 = 投入金额 ÷ 确认净值（写入明细）</p>
                      <p class="font-mono">
                        {{ formatMoney(goldBuyForm.amount, 'CNY') }}
                        ÷ {{ goldBuyForm.confirmNav ? goldBuyForm.confirmNav.toFixed(4) : '—' }}
                        =
                        {{ goldBuyPreviewShares ? goldBuyPreviewShares.toFixed(4) : '—' }}
                      </p>
                    </template>
                  </FormulaTooltip>
                  =
                  <span class="font-mono text-ink">
                    {{ goldBuyPreviewShares ? goldBuyPreviewShares.toFixed(4) : '—' }}
                  </span>
                </p>
                <el-button type="primary" @click="saveGoldBuy">确认加仓</el-button>
              </div>
            </div>

            <div v-else class="grid gap-3 sm:grid-cols-2">
              <div>
                <label class="mb-1 block text-xs text-ink-muted">卖出份额</label>
                <el-input-number
                  v-model="goldSellForm.shares"
                  :min="0.0001"
                  :max="goldSummary.shares || undefined"
                  :step="0.01"
                  :precision="4"
                  controls-position="right"
                  class="w-full!"
                />
              </div>
              <div>
                <label class="mb-1 block text-xs text-ink-muted">赎回净值（估到账）</label>
                <el-input-number
                  v-model="goldSellForm.redeemNav"
                  :min="0.0001"
                  :step="0.0001"
                  :precision="4"
                  controls-position="right"
                  class="w-full!"
                />
              </div>
              <div class="sm:col-span-2">
                <label class="mb-1 block text-xs text-ink-muted">备注（可选）</label>
                <el-input v-model="goldSellForm.note" maxlength="32" placeholder="如：支付宝赎回" />
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
                        {{ goldSellForm.shares ? goldSellForm.shares.toFixed(4) : '—' }}
                        × {{ goldSellForm.redeemNav ? goldSellForm.redeemNav.toFixed(4) : '—' }} =
                        {{ formatMoney(goldSellPreview.proceeds, 'CNY') }}
                      </p>
                    </template>
                  </FormulaTooltip>
                  {{ formatMoney(goldSellPreview.proceeds, 'CNY') }}
                  · 实现盈亏
                  <span :class="quoteToneClass(goldSellPreview.realized)">
                    {{ goldSellPreview.realized >= 0 ? '+' : ''
                    }}{{ formatMoney(goldSellPreview.realized, 'CNY') }}
                  </span>
                </p>
                <el-button type="danger" @click="saveGoldSell">确认卖出</el-button>
              </div>
            </div>
          </div>

          <div class="panel min-w-0 overflow-x-auto px-3 py-3 md:px-4">
            <p class="mb-2 text-xs font-medium text-ink-muted">加仓明细（FIFO 卖出从最早一笔扣）</p>
            <table
              v-if="goldLots.length"
              class="w-full min-w-[720px] border-collapse text-left text-xs"
            >
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
                <tr v-for="lot in goldLots" :key="lot.id" class="border-b border-surface-line/60">
                  <td class="px-2 py-2 font-mono">{{ lot.confirm_date }}</td>
                  <td class="px-2 py-2">{{ formatMoney(lot.amount, 'CNY') }}</td>
                  <td class="px-2 py-2 font-mono">{{ lot.confirm_nav.toFixed(4) }}</td>
                  <td class="px-2 py-2 font-mono">{{ lot.shares.toFixed(4) }}</td>
                  <td class="px-2 py-2">{{ formatMoney(lotMarketValue(lot), 'CNY') }}</td>
                  <td
                    class="px-2 py-2"
                    :class="
                      goldDaily.available ? quoteToneClass(lotTodayPnl(lot)) : 'text-ink-muted'
                    "
                  >
                    <template v-if="goldDaily.available">
                      {{ lotTodayPnl(lot) >= 0 ? '+' : ''
                      }}{{ formatMoney(lotTodayPnl(lot), 'CNY') }}
                    </template>
                    <template v-else>—</template>
                  </td>
                  <td class="px-2 py-2" :class="quoteToneClass(lotPnl(lot))">
                    {{ lotPnl(lot) >= 0 ? '+' : '' }}{{ formatMoney(lotPnl(lot), 'CNY') }} （{{
                      formatPercent(lotPnlRate(lot))
                    }}）
                  </td>
                  <td class="px-2 py-2 text-ink-muted">{{ lot.note || '—' }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr class="font-medium">
                  <td class="px-2 py-2">合计</td>
                  <td class="px-2 py-2">{{ formatMoney(goldSummary.cost, 'CNY') }}</td>
                  <td class="px-2 py-2">—</td>
                  <td class="px-2 py-2 font-mono">
                    {{ goldSummary.shares ? goldSummary.shares.toFixed(4) : '—' }}
                  </td>
                  <td class="px-2 py-2">{{ formatMoney(goldSummary.market, 'CNY') }}</td>
                  <td
                    class="px-2 py-2"
                    :class="goldDaily.available ? quoteToneClass(goldDaily.pnl) : 'text-ink-muted'"
                  >
                    <template v-if="goldDaily.available">
                      {{ goldDaily.pnl >= 0 ? '+' : '' }}{{ formatMoney(goldDaily.pnl, 'CNY') }}
                    </template>
                    <template v-else>—</template>
                  </td>
                  <td class="px-2 py-2" :class="quoteToneClass(goldSummary.pnl)">
                    {{ goldSummary.pnl >= 0 ? '+' : ''
                    }}{{ formatMoney(goldSummary.pnl, 'CNY') }} （{{
                      formatPercent(goldSummary.rate)
                    }}）
                  </td>
                  <td class="px-2 py-2" />
                </tr>
              </tfoot>
            </table>
            <p v-else class="text-xs text-ink-muted">暂无加仓明细</p>
          </div>
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          <PoolAccountCard v-for="account in goldNeutral" :key="account.id" :account="account" />
        </div>
      </div>
      <div v-if="cryptoAssets.length">
        <div class="mb-2 flex flex-wrap items-end justify-between gap-2">
          <h3 class="text-sm font-medium text-alert">加密赌注池（投机级）· 持仓账户</h3>
          <p class="text-xs text-ink-muted">
            本月一元购花费
            {{ formatMoney(store.yuanGouPeriodStats.month.spendCny, 'CNY') }}
            · 累计
            {{ formatMoney(store.yuanGouPeriodStats.total.spendCny, 'CNY') }}
            · 抢到
            {{ formatMoney(store.yuanGouPeriodStats.total.gotUsdt, 'USDT') }}
          </p>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <PoolAccountCard v-for="account in cryptoAssets" :key="account.id" :account="account" />
        </div>
      </div>
      <p v-if="!neutralAssets.length" class="text-sm text-ink-muted">暂无中性 / 加密资产</p>
    </section>

    <section v-show="activeTab === 'us'" class="space-y-3">
      <div class="panel space-y-4 px-4 py-5 md:px-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="text-base font-semibold">美股持仓</h2>
            <p class="mt-1 text-xs text-ink-muted">
              点「修改」改数量与持仓价。现价与股息率可一并拉取。
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <el-button type="primary" plain @click="openAddStock">新增持仓</el-button>
            <el-button :loading="quoteRefreshing" @click="refreshQuotes">拉取现价/股息</el-button>
          </div>
        </div>

        <div
          class="grid grid-cols-2 gap-3 border-t border-surface-line pt-4 text-xs sm:grid-cols-4"
        >
          <div class="min-w-0">
            <p class="text-ink-muted">
              <FormulaTooltip>
                成本合计
                <template #content>
                  <p>成本合计 = Σ 数量 × 持仓价</p>
                  <p class="font-mono">{{ formatMoney(usHoldingPnl.cost, 'USD') }}</p>
                </template>
              </FormulaTooltip>
            </p>
            <p class="stat-num mt-0.5 text-sm font-semibold">
              {{ formatMoney(usHoldingPnl.cost, 'USD') }}
            </p>
          </div>
          <div class="min-w-0">
            <p class="text-ink-muted">
              <FormulaTooltip>
                市值合计
                <template #content>
                  <p>市值合计 = Σ 数量 × 现价</p>
                  <p class="font-mono">{{ formatMoney(usHoldingPnl.market, 'USD') }}</p>
                </template>
              </FormulaTooltip>
            </p>
            <p class="stat-num mt-0.5 text-sm font-semibold">
              {{ formatMoney(usHoldingPnl.market, 'USD') }}
            </p>
            <p class="mt-0.5 text-ink-muted">≈ {{ moneyInBase(usHoldingPnl.market, 'USD') }}</p>
          </div>
          <div class="min-w-0">
            <p class="text-ink-muted">
              <FormulaTooltip>
                持仓盈亏
                <template #content>
                  <p>持仓盈亏 = 市值合计 − 成本合计</p>
                  <p class="font-mono">
                    {{ formatMoney(usHoldingPnl.market, 'USD') }} −
                    {{ formatMoney(usHoldingPnl.cost, 'USD') }} =
                    {{ usHoldingPnl.pnl >= 0 ? '+' : '' }}{{ formatMoney(usHoldingPnl.pnl, 'USD') }}
                  </p>
                </template>
              </FormulaTooltip>
            </p>
            <p
              class="stat-num mt-0.5 text-sm font-semibold"
              :class="quoteToneClass(usHoldingPnl.pnl)"
            >
              {{ usHoldingPnl.pnl >= 0 ? '+' : '' }}{{ formatMoney(usHoldingPnl.pnl, 'USD') }}
            </p>
          </div>
          <div class="min-w-0">
            <p class="text-ink-muted">
              <FormulaTooltip>
                盈亏比例
                <template #content>
                  <p>盈亏比例 = 持仓盈亏 ÷ 成本合计</p>
                  <p class="font-mono">
                    {{ usHoldingPnl.pnl >= 0 ? '+' : ''
                    }}{{ formatMoney(usHoldingPnl.pnl, 'USD') }} ÷
                    {{ formatMoney(usHoldingPnl.cost, 'USD') }} =
                    {{ usHoldingPnl.rate >= 0 ? '+' : '' }}{{ formatPercent(usHoldingPnl.rate) }}
                  </p>
                </template>
              </FormulaTooltip>
            </p>
            <p
              class="stat-num mt-0.5 text-sm font-semibold"
              :class="quoteToneClass(usHoldingPnl.rate)"
            >
              {{ usHoldingPnl.rate >= 0 ? '+' : '' }}{{ formatPercent(usHoldingPnl.rate) }}
            </p>
          </div>
        </div>
      </div>

      <div class="grid gap-3 lg:grid-cols-2">
        <StockHoldingCard
          v-for="stock in store.accounts.us_stock_pool"
          :key="stock.id"
          :stock="stock"
          editable
          removable
          @edit="openEditStock(stock)"
          @remove="removeStock(stock)"
        />
      </div>
      <p v-if="!store.accounts.us_stock_pool.length" class="text-sm text-ink-muted">
        暂无美股持仓，点「新增持仓」添加
      </p>

      <el-dialog
        v-model="addStockVisible"
        title="新增美股持仓"
        width="92%"
        class="max-w-md"
        destroy-on-close
      >
        <div class="space-y-4">
          <div>
            <label class="mb-1 block text-xs text-ink-muted">股票代码</label>
            <el-input
              v-model="stockForm.symbol"
              placeholder="例如：AAPL"
              maxlength="12"
              class="font-mono"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs text-ink-muted">名称（可选）</label>
            <el-input v-model="stockForm.name" placeholder="例如：苹果" maxlength="32" />
          </div>
          <div>
            <label class="mb-1 block text-xs text-ink-muted">数量（股）</label>
            <el-input-number
              v-model="stockForm.shares"
              :min="0.0001"
              :step="1"
              :precision="4"
              controls-position="right"
              class="w-full!"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs text-ink-muted">持仓价（USD）</label>
            <AmountInput v-model="stockForm.costPrice" :min="0.01" class="w-full!" />
          </div>
          <p class="text-xs text-ink-muted">添加后可用「拉取现价/股息」更新市价与股息率。</p>
        </div>
        <template #footer>
          <el-button @click="addStockVisible = false">取消</el-button>
          <el-button type="primary" @click="saveAddStock">添加</el-button>
        </template>
      </el-dialog>

      <el-dialog
        v-model="editDialogVisible"
        :title="editingStock ? `修改 ${editingStock.symbol}` : '修改持仓'"
        width="92%"
        class="max-w-md"
        destroy-on-close
      >
        <template v-if="editingStock">
          <p class="mb-4 text-sm text-ink-muted">
            {{ editingStock.name }} · 仅可改数量与持仓价；现价
            {{ formatMoney(editingStock.market_price ?? editingStock.cost_price, 'USD') }}
            （行情）
          </p>
          <div class="space-y-4">
            <div>
              <label class="mb-1 block text-xs text-ink-muted">数量（股）</label>
              <el-input-number
                v-model="editShares"
                :min="0.0001"
                :step="1"
                :precision="4"
                controls-position="right"
                class="w-full!"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs text-ink-muted">持仓价（USD）</label>
              <AmountInput v-model="editCostPrice" :min="0.01" class="w-full!" />
            </div>
          </div>
        </template>
        <template #footer>
          <el-button @click="editDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="saveEditStock">保存</el-button>
        </template>
      </el-dialog>
    </section>
  </div>
</template>
