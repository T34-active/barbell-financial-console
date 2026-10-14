<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import StockHoldingCard from '@/components/accounts/StockHoldingCard.vue'
import FormulaTooltip from '@/components/accounts/FormulaTooltip.vue'
import { useFinanceStore } from '@/stores/finance'
import { useFinanceFormat } from '@/composables/useFinanceFormat'
import { quoteToneClass } from '@/composables/useQuoteColor'
import { formatMoney, formatPercent, stockCostBasis, stockMarketValue } from '@/utils/currency'
import { add, div, sub } from '@/utils/decimal'
import { holdingAfterBuy } from '@/utils/stock-holdings'
import {
  lookupStock,
  searchUsStocks,
  usQuoteSessionLabel,
  type StockProfile,
} from '@/utils/stock-prices'
import type { UsStockHolding } from '@/types/finance'

const store = useFinanceStore()
const { moneyInBase } = useFinanceFormat()

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
  if (!stock || !preview) return
  try {
    store.addToStockHolding(stock.id, topUpShares.value, topUpPrice.value)
    topUpVisible.value = false
    ElMessage.success(
      `${stock.symbol} 已补仓至 ${preview.shares} 股，持仓价 ${formatMoney(preview.cost_price, 'USD')}`,
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
</script>

<template>
  <section class="space-y-3">
    <div class="panel space-y-4 px-4 py-5 md:px-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-base font-semibold">美股持仓</h2>
          <p class="mt-1 text-xs text-ink-muted">
            补仓填买入股数和成交价，持仓价按成本摊薄。和券商不一致时，点「修改」按 App
            账面改。现价与股息率可一并拉取。
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <el-button type="primary" plain @click="openAddStock">新增持仓</el-button>
          <el-button :loading="quoteRefreshing" @click="refreshQuotes">拉取现价/股息</el-button>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3 border-t border-surface-line pt-4 text-xs sm:grid-cols-4">
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
                  {{ formatMoney(usHoldingPnl.cost, 'USD') }} = {{ usHoldingPnl.pnl >= 0 ? '+' : ''
                  }}{{ formatMoney(usHoldingPnl.pnl, 'USD') }}
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
    </div>

    <div class="grid gap-3 lg:grid-cols-2">
      <StockHoldingCard
        v-for="stock in store.accounts.us_stock_pool"
        :key="stock.id"
        :stock="stock"
        editable
        removable
        @top-up="openTopUpStock(stock)"
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
          {{ formatMoney(topUpStock.cost_price, 'USD') }}。不从现金扣款。
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
              </template>
            </FormulaTooltip>
          </p>
          <p v-else class="text-xs text-ink-muted">填写买入数量和成交价后显示新持仓价。</p>
          <p class="text-xs text-ink-muted">和券商持仓价差一分时，保存后用「修改」按 App 改。</p>
        </div>
      </template>
      <template #footer>
        <el-button @click="topUpVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!topUpPreview" @click="saveTopUpStock">
          确认补仓
        </el-button>
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
