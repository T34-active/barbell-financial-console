<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import FormulaTooltip from '@/components/accounts/FormulaTooltip.vue'
import { useFinanceStore } from '@/stores/finance'
import { useFinanceFormat } from '@/composables/useFinanceFormat'
import { quoteToneClass } from '@/composables/useQuoteColor'
import {
  convertCurrency,
  formatMoney,
  formatPercent,
  stockCostBasis,
  stockMarketValue,
} from '@/utils/currency'
import { add, div, round, sub } from '@/utils/decimal'
import { formatBeijingDateTime } from '@/utils/datetime'
import { holdingAfterBuy } from '@/utils/stock-holdings'
import {
  lookupStock,
  searchUsStocks,
  usQuoteSessionLabel,
  type StockProfile,
} from '@/utils/stock-prices'
import type { UsStockHolding } from '@/types/finance'

const store = useFinanceStore()
const { money, moneyInBase } = useFinanceFormat()

const brokerCash = computed(() => store.accounts.us_broker_cash ?? { hkd: 0, usd: 0 })
const cashDialogVisible = ref(false)
const cashHkd = ref(0)
const cashUsd = ref(0)
const showCashBaseLine = computed(() => {
  const base = store.baseCurrency
  return base !== 'HKD' && base !== 'USD'
})
const usdHkdRate = computed(() => store.settings.fx_to_hkd.USD)

function brokerCashFx(hkd: number, usd: number) {
  const fx = store.settings.fx_to_hkd
  const hkdAsUsd = convertCurrency(hkd, 'HKD', 'USD', fx)
  const usdAsHkd = convertCurrency(usd, 'USD', 'HKD', fx)
  return {
    hkdAsUsd,
    usdAsHkd,
    totalUsd: add(hkdAsUsd, usd),
    totalHkd: add(hkd, usdAsHkd),
    totalBase: add(store.toBase(hkd, 'HKD'), store.toBase(usd, 'USD')),
  }
}

const cashFx = computed(() => brokerCashFx(brokerCash.value.hkd, brokerCash.value.usd))
const cashDraftFx = computed(() => brokerCashFx(cashHkd.value, cashUsd.value))

function openEditCash() {
  cashHkd.value = brokerCash.value.hkd
  cashUsd.value = brokerCash.value.usd
  cashDialogVisible.value = true
}

function saveBrokerCash() {
  try {
    store.updateUsBrokerCash({ hkd: cashHkd.value, usd: cashUsd.value })
    cashDialogVisible.value = false
    ElMessage.success('券商现金已保存')
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  }
}

const quoteRefreshing = ref(false)
const editDialogVisible = ref(false)
const editingStock = ref<UsStockHolding | null>(null)
const editShares = ref(0)
const editCostPrice = ref(0)

const addStockVisible = ref(false)
const stockForm = ref({
  symbol: '',
  name: '',
  shares: 1,
  costPrice: 0,
})
const stockQuery = ref('')
const stockLookup = ref<StockProfile | null>(null)
const stockLookingUp = ref(false)
const stockSaving = ref(false)
let stockSuggestSeq = 0

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

interface StockSuggestItem extends StockProfile {
  value: string
}

function openAddStock() {
  stockForm.value = { symbol: '', name: '', shares: 1, costPrice: 0 }
  stockQuery.value = ''
  stockLookup.value = null
  stockLookingUp.value = false
  addStockVisible.value = true
}

function applyStockPick(hit: StockProfile) {
  stockForm.value.symbol = hit.symbol
  stockForm.value.name = hit.name
  stockLookup.value = hit
  stockQuery.value = `${hit.symbol} ${hit.name}`
}

async function queryStockSuggestions(query: string, cb: (items: StockSuggestItem[]) => void) {
  const key = query.trim()
  const seq = ++stockSuggestSeq
  if (!key) {
    stockLookingUp.value = false
    cb([])
    return
  }
  stockLookingUp.value = true
  try {
    const list = await searchUsStocks(key)
    if (seq !== stockSuggestSeq) return
    cb(
      list.map((item) => ({
        ...item,
        value: `${item.symbol} ${item.name}`,
      })),
    )
  } catch {
    if (seq !== stockSuggestSeq) return
    cb([])
  } finally {
    if (seq === stockSuggestSeq) stockLookingUp.value = false
  }
}

function onStockSuggestSelect(item: Record<string, unknown>) {
  const symbol = String(item.symbol ?? '').toUpperCase()
  const name = String(item.name ?? '').trim()
  if (!symbol || !name) return
  applyStockPick({
    symbol,
    name,
    exchange: typeof item.exchange === 'string' ? item.exchange : undefined,
    price: typeof item.price === 'number' ? item.price : undefined,
  })
}

watch(stockQuery, (query) => {
  const selected = stockLookup.value
  if (!selected) return
  const label = `${selected.symbol} ${selected.name}`
  if (query.trim() !== label && query.trim().toUpperCase() !== selected.symbol) {
    stockLookup.value = null
    stockForm.value.symbol = ''
    stockForm.value.name = ''
  }
})

const stockReady = computed(() => stockLookup.value != null)

const stockLookupHint = computed(() => {
  const hit = stockLookup.value
  if (!hit) return ''
  return [hit.symbol, hit.name, hit.exchange].filter(Boolean).join(' · ')
})

async function saveAddStock() {
  const selected = stockLookup.value
  if (stockSaving.value || !selected) return
  stockSaving.value = true
  try {
    let price = selected.price
    let priceSession = selected.price_session
    let priceAsOf = selected.price_as_of
    let regularPrice = selected.regular_price
    try {
      const live = await lookupStock(selected.symbol)
      if (live.price && live.price > 0) {
        price = live.price
        priceSession = live.price_session
        priceAsOf = live.price_as_of
        regularPrice = live.regular_price
      }
    } catch {
      /* 候选已选中，现价失败仍可按持仓价入账 */
    }
    const name = stockForm.value.name.trim() || selected.name
    store.upsertStock({
      id: selected.symbol.toLowerCase(),
      symbol: selected.symbol,
      name,
      shares: stockForm.value.shares,
      cost_price: stockForm.value.costPrice,
      currency: 'USD',
      market_price: price && price > 0 ? price : stockForm.value.costPrice,
      price_session: priceSession,
      regular_price: regularPrice,
      price_updated_at: priceAsOf,
    })
    addStockVisible.value = false
    ElMessage.success(`已添加 ${name}（${selected.symbol}）`)
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  } finally {
    stockSaving.value = false
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
    const sessions = [...new Set(result.quotes.map((quote) => quote.session))]
    const sessionText = sessions.length === 1 ? usQuoteSessionLabel(sessions[0]) : '盘中/盘前盘后'
    const msg = `已拉取 ${result.priceUpdated} 只现价（${sessionText}）、${result.yieldUpdated} 只股息率`
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

const topUpVisible = ref(false)
const topUpStock = ref<UsStockHolding | null>(null)
const topUpShares = ref(0)
const topUpPrice = ref(0)

const topUpPreview = computed(() => {
  const stock = topUpStock.value
  if (!stock || !(topUpShares.value > 0) || !(topUpPrice.value > 0)) return null
  return holdingAfterBuy(stock.shares, stock.cost_price, topUpShares.value, topUpPrice.value)
})

const topUpUsdAfter = computed(() => {
  const preview = topUpPreview.value
  if (!preview) return null
  return round(sub(brokerCash.value.usd, preview.buy_amount), 2)
})

const topUpCashShort = computed(() => topUpUsdAfter.value != null && topUpUsdAfter.value < 0)

function openTopUpStock(stock: UsStockHolding) {
  topUpStock.value = stock
  topUpShares.value = 0
  topUpPrice.value =
    stock.market_price != null && stock.market_price > 0 ? stock.market_price : stock.cost_price
  topUpVisible.value = true
}

function saveTopUpStock() {
  const stock = topUpStock.value
  const preview = topUpPreview.value
  if (!stock || !preview || topUpCashShort.value) return
  try {
    store.addToStockHolding(stock.id, topUpShares.value, topUpPrice.value)
    topUpVisible.value = false
    ElMessage.success(
      `${stock.symbol} 已补仓至 ${preview.shares} 股，持仓价 ${formatMoney(preview.cost_price, 'USD')}，扣现金 ${formatMoney(preview.buy_amount, 'USD')}`,
    )
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

function stockMarketPrice(stock: UsStockHolding) {
  return stock.market_price ?? stock.cost_price
}

function stockRowPnl(stock: UsStockHolding) {
  return sub(stockMarketValue(stock), stockCostBasis(stock))
}

function stockRowPnlRate(stock: UsStockHolding) {
  const cost = stockCostBasis(stock)
  return cost > 0 ? div(stockRowPnl(stock), cost) : 0
}

function stockSessionText(stock: UsStockHolding) {
  return usQuoteSessionLabel(stock.price_session)
}
</script>

<template>
  <section class="space-y-3">
    <div class="panel space-y-4 px-4 py-5 md:px-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-base font-semibold">美股持仓</h2>
          <p class="mt-1 text-xs text-ink-muted">
            已入账的港币、美元现金计入美股池，并按全局汇率互折。补仓按成交额扣美元现金，并摊薄持仓价。现价与股息率可一并拉取。
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <el-button type="primary" plain @click="openAddStock">新增持仓</el-button>
          <el-button plain @click="openEditCash">修改现金</el-button>
          <el-button :loading="quoteRefreshing" @click="refreshQuotes">拉取现价/股息</el-button>
        </div>
      </div>

      <div
        class="grid gap-5 border-t border-surface-line pt-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(17rem,0.85fr)] lg:gap-8"
      >
        <div class="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4 lg:grid-cols-2">
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
                    {{ usHoldingPnl.pnl >= 0 ? '+' : '' }}{{ formatMoney(usHoldingPnl.pnl, 'USD') }} ÷
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

        <div class="space-y-3 border-t border-surface-line pt-4 text-xs lg:border-t-0 lg:pt-0">
          <div class="flex items-start justify-between gap-3">
            <p class="text-ink-muted">
              <FormulaTooltip>
                港币现金
                <template #content>
                  <p>港币现金按全局 USD/HKD 折成美元，对照可买美股的购买力。</p>
                  <p class="font-mono">
                    {{ formatMoney(brokerCash.hkd, 'HKD') }} ÷ {{ usdHkdRate.toFixed(4) }} =
                    {{ formatMoney(cashFx.hkdAsUsd, 'USD') }}
                  </p>
                </template>
              </FormulaTooltip>
            </p>
            <div class="min-w-0 text-right">
              <p class="stat-num text-sm font-semibold">
                {{ formatMoney(brokerCash.hkd, 'HKD') }}
              </p>
              <p class="mt-0.5 text-ink-muted">≈ {{ formatMoney(cashFx.hkdAsUsd, 'USD') }}</p>
              <p v-if="showCashBaseLine" class="mt-0.5 text-ink-muted">
                ≈ {{ moneyInBase(brokerCash.hkd, 'HKD') }}
              </p>
            </div>
          </div>
          <div class="flex items-start justify-between gap-3">
            <p class="text-ink-muted">
              <FormulaTooltip>
                美元现金
                <template #content>
                  <p>美元现金按全局 USD/HKD 折成港币。</p>
                  <p class="font-mono">
                    {{ formatMoney(brokerCash.usd, 'USD') }} × {{ usdHkdRate.toFixed(4) }} =
                    {{ formatMoney(cashFx.usdAsHkd, 'HKD') }}
                  </p>
                </template>
              </FormulaTooltip>
            </p>
            <div class="min-w-0 text-right">
              <p class="stat-num text-sm font-semibold">
                {{ formatMoney(brokerCash.usd, 'USD') }}
              </p>
              <p class="mt-0.5 text-ink-muted">≈ {{ formatMoney(cashFx.usdAsHkd, 'HKD') }}</p>
              <p v-if="showCashBaseLine" class="mt-0.5 text-ink-muted">
                ≈ {{ moneyInBase(brokerCash.usd, 'USD') }}
              </p>
            </div>
          </div>
          <div class="flex items-start justify-between gap-3">
            <p class="text-ink-muted">
              <FormulaTooltip>
                现金合计
                <template #content>
                  <p>现金合计 = 港币折美元 + 美元现金</p>
                  <p class="font-mono">
                    {{ formatMoney(cashFx.hkdAsUsd, 'USD') }} +
                    {{ formatMoney(brokerCash.usd, 'USD') }} =
                    {{ formatMoney(cashFx.totalUsd, 'USD') }}
                  </p>
                  <p>现金合计 = 港币现金 + 美元折港币</p>
                  <p class="font-mono">
                    {{ formatMoney(brokerCash.hkd, 'HKD') }} +
                    {{ formatMoney(cashFx.usdAsHkd, 'HKD') }} =
                    {{ formatMoney(cashFx.totalHkd, 'HKD') }}
                  </p>
                </template>
              </FormulaTooltip>
            </p>
            <div class="min-w-0 text-right">
              <p class="stat-num text-sm font-semibold">
                {{ formatMoney(cashFx.totalUsd, 'USD') }}
              </p>
              <p class="mt-0.5 text-ink-muted">≈ {{ formatMoney(cashFx.totalHkd, 'HKD') }}</p>
              <p v-if="showCashBaseLine" class="mt-0.5 text-ink-muted">
                ≈ {{ money(store.usBrokerCashValue) }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div
        class="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-t border-surface-line pt-4 text-xs"
      >
        <div class="min-w-0">
          <p class="text-ink-muted">
            <FormulaTooltip>
              美股池合计
              <template #content>
                <p>美股池合计 = 持仓市值 + 港币现金 + 美元现金（都折成基准币）</p>
                <p class="font-mono">
                  市值 {{ moneyInBase(usHoldingPnl.market, 'USD') }} + 现金
                  {{ money(store.usBrokerCashValue) }} =
                  {{ money(store.usStockValue) }}
                </p>
              </template>
            </FormulaTooltip>
          </p>
          <p class="mt-0.5 text-ink-muted">
            持仓 {{ moneyInBase(usHoldingPnl.market, 'USD') }} + 现金
            {{ money(store.usBrokerCashValue) }}
          </p>
        </div>
        <p class="stat-num text-base font-semibold sm:text-lg">
          {{ money(store.usStockValue) }}
        </p>
      </div>
    </div>

    <div class="panel overflow-hidden px-0 py-0 md:px-0">
      <el-table
        :data="store.accounts.us_stock_pool"
        stripe
        size="small"
        empty-text="暂无美股持仓，点「新增持仓」添加"
        class="w-full"
        @row-click="openEditStock"
      >
        <el-table-column label="标的" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="min-w-0 py-0.5">
              <p class="font-mono font-medium">{{ row.symbol }}</p>
              <p class="truncate text-xs text-ink-muted">{{ row.name }}</p>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="数量" min-width="88" align="right">
          <template #default="{ row }">
            <span class="stat-num">{{ row.shares }}</span>
          </template>
        </el-table-column>
        <el-table-column label="持仓价" min-width="100" align="right">
          <template #default="{ row }">
            <span class="stat-num">{{ formatMoney(row.cost_price, 'USD') }}</span>
          </template>
        </el-table-column>
        <el-table-column label="现价" min-width="120" align="right">
          <template #default="{ row }">
            <p class="stat-num">{{ formatMoney(stockMarketPrice(row), 'USD') }}</p>
            <p v-if="stockSessionText(row)" class="text-[11px] text-ink-muted">
              {{ stockSessionText(row) }}
            </p>
            <p v-if="row.price_updated_at" class="text-[11px] text-ink-muted">
              {{ formatBeijingDateTime(row.price_updated_at) }}
            </p>
          </template>
        </el-table-column>
        <el-table-column label="市值" min-width="110" align="right">
          <template #default="{ row }">
            <span class="stat-num">{{ formatMoney(stockMarketValue(row), 'USD') }}</span>
          </template>
        </el-table-column>
        <el-table-column label="成本" min-width="110" align="right">
          <template #default="{ row }">
            <span class="stat-num">{{ formatMoney(stockCostBasis(row), 'USD') }}</span>
          </template>
        </el-table-column>
        <el-table-column label="盈亏" min-width="140" align="right">
          <template #default="{ row }">
            <span class="stat-num" :class="quoteToneClass(stockRowPnl(row))">
              {{ stockRowPnl(row) >= 0 ? '+' : '' }}{{ formatMoney(stockRowPnl(row), 'USD') }}
              （{{ formatPercent(stockRowPnlRate(row)) }}）
            </span>
          </template>
        </el-table-column>
        <el-table-column label="股息" min-width="88" align="right">
          <template #default="{ row }">
            <span v-if="row.est_div_yield != null && row.est_div_yield >= 0" class="text-safe">
              {{ formatPercent(row.est_div_yield) }}
            </span>
            <span v-else class="text-ink-muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click.stop="openTopUpStock(row)">
              补仓
            </el-button>
            <el-button link type="primary" size="small" @click.stop="openEditStock(row)">
              修改
            </el-button>
            <el-button link type="danger" size="small" @click.stop="removeStock(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog
      v-model="addStockVisible"
      title="新增美股持仓"
      width="92%"
      class="max-w-md"
      destroy-on-close
    >
      <div class="space-y-4">
        <div>
          <label class="mb-1 block text-xs text-ink-muted">搜索美股</label>
          <el-autocomplete
            v-model="stockQuery"
            :fetch-suggestions="queryStockSuggestions"
            :debounce="300"
            :trigger-on-focus="false"
            highlight-first-item
            placeholder="代码或名称，如 AAPL / 苹果"
            class="w-full!"
            @select="onStockSuggestSelect"
          >
            <template #default="{ item }">
              <div class="flex min-w-0 items-center justify-between gap-3">
                <span class="font-mono">{{ item.symbol }}</span>
                <span class="truncate text-ink-muted">{{ item.name }}</span>
              </div>
            </template>
          </el-autocomplete>
          <p v-if="stockLookingUp" class="mt-1 text-xs text-ink-muted">正在搜索…</p>
          <p v-else-if="stockLookup" class="mt-1 text-xs text-safe">已选 {{ stockLookupHint }}</p>
          <p v-else class="mt-1 text-xs text-ink-muted">输入后从候选里点选，方向键 + 回车也可</p>
        </div>
        <div>
          <label class="mb-1 block text-xs text-ink-muted">名称（可改）</label>
          <el-input v-model="stockForm.name" placeholder="选中候选后自动填入" maxlength="48" />
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
        <el-button
          type="primary"
          :loading="stockSaving"
          :disabled="!stockReady"
          @click="saveAddStock"
        >
          添加
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="topUpVisible"
      :title="topUpStock ? `补仓 ${topUpStock.symbol}` : '补仓'"
      width="92%"
      class="max-w-md"
      destroy-on-close
    >
      <template v-if="topUpStock">
        <p class="mb-4 text-sm text-ink-muted">
          {{ topUpStock.name }} · 当前 {{ topUpStock.shares }} 股 ×
          {{ formatMoney(topUpStock.cost_price, 'USD') }}。成交额从美元现金扣除。
        </p>
        <div class="space-y-4">
          <div>
            <label class="mb-1 block text-xs text-ink-muted">买入数量（股）</label>
            <el-input-number
              v-model="topUpShares"
              :min="0"
              :step="1"
              :precision="4"
              controls-position="right"
              class="w-full!"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs text-ink-muted">成交价（USD）</label>
            <AmountInput v-model="topUpPrice" :min="0.01" class="w-full!" />
          </div>
          <p v-if="topUpPreview" class="text-sm">
            <FormulaTooltip>
              补仓后 {{ topUpPreview.shares }} 股 · 持仓价
              {{ formatMoney(topUpPreview.cost_price, 'USD') }}
              <template #content>
                <p>新持仓价 = (原数量 × 原持仓价 + 买入数量 × 成交价) / 新数量</p>
                <p class="font-mono">
                  ({{ topUpStock.shares }} × {{ formatMoney(topUpStock.cost_price, 'USD') }} +
                  {{ topUpShares }} × {{ formatMoney(topUpPrice, 'USD') }}) /
                  {{ topUpPreview.shares }} =
                  {{ formatMoney(topUpPreview.cost_price, 'USD') }}
                </p>
                <p>本次成交额 {{ formatMoney(topUpPreview.buy_amount, 'USD') }}</p>
                <p>
                  美元现金 {{ formatMoney(brokerCash.usd, 'USD') }} −
                  {{ formatMoney(topUpPreview.buy_amount, 'USD') }} =
                  {{ formatMoney(topUpUsdAfter ?? 0, 'USD') }}
                </p>
              </template>
            </FormulaTooltip>
          </p>
          <p
            v-if="topUpPreview"
            class="text-xs"
            :class="topUpCashShort ? 'text-alert' : 'text-ink-muted'"
          >
            扣现金 {{ formatMoney(topUpPreview.buy_amount, 'USD') }} · 美元现金
            {{ formatMoney(brokerCash.usd, 'USD') }}
            →
            {{ formatMoney(topUpUsdAfter ?? 0, 'USD') }}
            <template v-if="topUpCashShort">（不足）</template>
          </p>
          <p v-else class="text-xs text-ink-muted">填写买入数量和成交价后显示新持仓价。</p>
          <p class="text-xs text-ink-muted">和券商持仓价差一分时，保存后用「修改」按 App 改。</p>
        </div>
      </template>
      <template #footer>
        <el-button @click="topUpVisible = false">取消</el-button>
        <el-button
          type="primary"
          :disabled="!topUpPreview || topUpCashShort"
          @click="saveTopUpStock"
        >
          确认补仓
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="cashDialogVisible"
      title="修改券商现金"
      width="92%"
      class="max-w-md"
      destroy-on-close
    >
      <p class="mb-4 text-sm text-ink-muted">
        按券商 App 里还没买成股票的余额填写。补仓会自动扣美元现金；换汇或入金后再改这两笔。
      </p>
      <div class="space-y-4">
        <div>
          <label class="mb-1 block text-xs text-ink-muted">港币现金（HKD）</label>
          <AmountInput v-model="cashHkd" :min="0" class="w-full!" />
          <p class="mt-1 text-xs text-ink-muted">
            ≈ {{ formatMoney(cashDraftFx.hkdAsUsd, 'USD') }}
            <template v-if="showCashBaseLine">
              · {{ moneyInBase(cashHkd, 'HKD') }}
            </template>
          </p>
        </div>
        <div>
          <label class="mb-1 block text-xs text-ink-muted">美元现金（USD）</label>
          <AmountInput v-model="cashUsd" :min="0" class="w-full!" />
          <p class="mt-1 text-xs text-ink-muted">
            ≈ {{ formatMoney(cashDraftFx.usdAsHkd, 'HKD') }}
            <template v-if="showCashBaseLine">
              · {{ moneyInBase(cashUsd, 'USD') }}
            </template>
          </p>
        </div>
        <p class="text-xs text-ink-muted">
          现金合计 {{ formatMoney(cashDraftFx.totalUsd, 'USD') }} ·
          {{ formatMoney(cashDraftFx.totalHkd, 'HKD') }}
          <template v-if="showCashBaseLine"> · {{ money(cashDraftFx.totalBase) }}</template>
        </p>
      </div>
      <template #footer>
        <el-button @click="cashDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveBrokerCash">保存</el-button>
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
</template>
