<script setup lang="ts">
import dayjs from 'dayjs'
import { ElMessage, ElMessageBox } from 'element-plus'
import PoolAccountCard from '@/components/accounts/PoolAccountCard.vue'
import FundProductPanel from '@/components/accounts/FundProductPanel.vue'
import StockHoldingCard from '@/components/accounts/StockHoldingCard.vue'
import FormulaTooltip from '@/components/accounts/FormulaTooltip.vue'
import LoanPanel from '@/components/accounts/LoanPanel.vue'
import YuanGouPanel from '@/components/accounts/YuanGouPanel.vue'
import { useFinanceStore } from '@/stores/finance'
import { useFinanceFormat } from '@/composables/useFinanceFormat'
import { quoteToneClass } from '@/composables/useQuoteColor'
import { formatMoney, formatPercent, stockCostBasis, stockMarketValue } from '@/utils/currency'
import { add, div, mul, round, sub } from '@/utils/decimal'
import { isNavFundAccount, searchFunds, type FundProfile } from '@/utils/fund-nav'
import { lookupStock, searchUsStocks, type StockProfile } from '@/utils/stock-prices'
import { findHkBank, hkBankLegacyIds, hkBanks } from '@/data/hk-banks'
import type { PoolAccount, UsStockHolding } from '@/types/finance'

const store = useFinanceStore()
const { money, moneyInBase } = useFinanceFormat()

const activeTab = ref<'rmb' | 'hkd' | 'us' | 'neutral'>('neutral')

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
const addFundVisible = ref(false)
const fundForm = ref({
  name: '',
  fundCode: '',
})
const fundQuery = ref('')
const fundLookup = ref<FundProfile | null>(null)
const fundLookingUp = ref(false)
const fundSaving = ref(false)
let fundSuggestSeq = 0
const editDialogVisible = ref(false)
const editingStock = ref<UsStockHolding | null>(null)
const editShares = ref(0)
const editCostPrice = ref(0)

/** 新增 / 修改人民币安全账户 */
const loanPanel = ref<{ openCreate: () => void } | null>(null)
const rmbDialogVisible = ref(false)
const rmbEditingId = ref<string | null>(null)
const rmbForm = ref({
  name: '',
  amount: 0,
  yieldPct: 0,
  note: '',
})

/** 新增港币账户 */
const addHkdVisible = ref(false)
const hkdForm = ref({
  code: '',
  amount: 0,
  yieldPct: 0,
  note: '',
})

/** 新增美股持仓 */
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

function openAddRmb() {
  rmbEditingId.value = null
  rmbForm.value = { name: '', amount: 0, yieldPct: 0, note: '' }
  rmbDialogVisible.value = true
}

function openEditRmb(account: PoolAccount) {
  rmbEditingId.value = account.id
  rmbForm.value = {
    name: account.name,
    amount: account.amount,
    yieldPct: round(mul(account.yield_rate ?? 0, 100), 2),
    note: account.note ?? '',
  }
  rmbDialogVisible.value = true
}

function createRmbId(name: string) {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_\u4e00-\u9fff]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24) || `cny_${Date.now().toString(36)}`
  if (!store.accounts.rmb_pool.some((account) => account.id === base)) return base
  return `${base}_${Date.now().toString(36)}`.slice(0, 32)
}

function saveRmbAccount() {
  try {
    const name = rmbForm.value.name.trim()
    if (!name) throw new Error('请填写银行名称')
    const editingId = rmbEditingId.value
    const dup = safeRmb.value.find((account) => account.name === name && account.id !== editingId)
    if (dup) throw new Error(`已有人民币账户「${name}」`)
    const yieldPct = rmbForm.value.yieldPct
    if (editingId) {
      const current = store.accounts.rmb_pool.find((account) => account.id === editingId)
      if (!current) throw new Error('账户已不存在')
      store.upsertPoolAccount('rmb_pool', {
        ...current,
        name,
        note: rmbForm.value.note.trim() || undefined,
      })
      ElMessage.success(`已修改 ${name}`)
    } else {
      store.upsertPoolAccount('rmb_pool', {
        id: createRmbId(name),
        name,
        type: 'bank',
        amount: rmbForm.value.amount,
        currency: 'CNY',
        yield_rate: yieldPct > 0 ? div(yieldPct, 100) : undefined,
        note: rmbForm.value.note.trim() || undefined,
      })
      ElMessage.success(`已添加人民币账户：${name}`)
    }
    rmbDialogVisible.value = false
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  }
}

async function removeRmb(account: PoolAccount) {
  try {
    const extra =
      account.id === 'yulibao'
        ? '工资里的应急金、种子和观察仓仍留在分桶里，只是这张卡片不再显示。'
        : ''
    await ElMessageBox.confirm(
      `确定删除人民币账户「${account.name}」？余额 ${formatMoney(account.amount, account.currency)} 将不再计入资产。${extra}`,
      '删除人民币账户',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
    store.removeAccount('rmb_pool', account.id)
    ElMessage.success(`已删除 ${account.name}`)
  } catch {
    /* cancel */
  }
}

function openAddHkd() {
  hkdForm.value = { code: '', amount: 0, yieldPct: 0, note: '' }
  addHkdVisible.value = true
}

function saveAddHkd() {
  try {
    const bank = findHkBank(hkdForm.value.code)
    if (!bank) throw new Error('请选择银行')
    const taken = new Set([bank.code, ...(hkBankLegacyIds[bank.code] ?? [])])
    const existing = store.accounts.hkd_pool.find((account) => taken.has(account.id))
    if (existing) throw new Error(`${bank.name}已在港币池（${existing.name}）`)
    const yieldPct = hkdForm.value.yieldPct
    store.upsertPoolAccount('hkd_pool', {
      id: bank.code,
      name: bank.name,
      type: 'bank',
      amount: hkdForm.value.amount,
      currency: 'HKD',
      yield_rate: yieldPct > 0 ? div(yieldPct, 100) : undefined,
      note: hkdForm.value.note.trim() || undefined,
    })
    addHkdVisible.value = false
    ElMessage.success(`已添加港币账户：${bank.name}`)
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

interface StockSuggestItem extends StockProfile {
  value: string
}

interface FundSuggestItem extends FundProfile {
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
    try {
      const live = await lookupStock(selected.symbol)
      if (live.price && live.price > 0) price = live.price
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

function openAddFund() {
  fundForm.value = { name: '', fundCode: '' }
  fundQuery.value = ''
  fundLookup.value = null
  fundLookingUp.value = false
  addFundVisible.value = true
}

function applyFundPick(hit: FundProfile) {
  fundForm.value.fundCode = hit.fund_code
  fundForm.value.name = hit.name
  fundLookup.value = hit
  fundQuery.value = `${hit.fund_code} ${hit.name}`
}

async function queryFundSuggestions(query: string, cb: (items: FundSuggestItem[]) => void) {
  const key = query.trim()
  const seq = ++fundSuggestSeq
  if (!key) {
    fundLookingUp.value = false
    cb([])
    return
  }
  fundLookingUp.value = true
  try {
    const list = await searchFunds(key)
    if (seq !== fundSuggestSeq) return
    cb(
      list.map((item) => ({
        ...item,
        value: `${item.fund_code} ${item.name}`,
      })),
    )
  } catch {
    if (seq !== fundSuggestSeq) return
    cb([])
  } finally {
    if (seq === fundSuggestSeq) fundLookingUp.value = false
  }
}

function onFundSuggestSelect(item: Record<string, unknown>) {
  const fundCode = String(item.fund_code ?? '').trim()
  const name = String(item.name ?? '').trim()
  if (!fundCode || !name) return
  applyFundPick({
    fund_code: fundCode,
    name,
    fund_type: typeof item.fund_type === 'string' ? item.fund_type : undefined,
    company: typeof item.company === 'string' ? item.company : undefined,
  })
}

watch(fundQuery, (query) => {
  const selected = fundLookup.value
  if (!selected) return
  const label = `${selected.fund_code} ${selected.name}`
  if (query.trim() !== label && query.trim() !== selected.fund_code) {
    fundLookup.value = null
    fundForm.value.fundCode = ''
    fundForm.value.name = ''
  }
})

const fundReady = computed(() => fundLookup.value != null)

const fundLookupHint = computed(() => {
  const hit = fundLookup.value
  if (!hit) return ''
  return [hit.fund_code, hit.name, hit.fund_type, hit.company].filter(Boolean).join(' · ')
})

async function saveAddFund() {
  const selected = fundLookup.value
  if (fundSaving.value || !selected) return
  fundSaving.value = true
  try {
    const account = store.addFundProduct({
      name: fundForm.value.name.trim() || selected.name,
      fundCode: selected.fund_code,
    })
    addFundVisible.value = false
    ElMessage.success(`已添加基金：${account.name}（${account.fund_code}）`)
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  } finally {
    fundSaving.value = false
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

function hkdTransferTargets(account: PoolAccount) {
  return store.accounts.hkd_pool.filter((item) => item.id !== account.id)
}

function transferHkd(
  from: PoolAccount,
  payload: { toId: string; amount: number; received?: number },
) {
  try {
    const result = store.transferPoolAmount({
      fromPool: 'hkd_pool',
      fromId: from.id,
      toPool: 'hkd_pool',
      toId: payload.toId,
      amount: payload.amount,
      received: payload.received,
    })
    const target = store.accounts.hkd_pool.find((item) => item.id === payload.toId)
    const receivedText =
      result.fromCurrency === result.toCurrency
        ? ''
        : ` → ${formatMoney(result.received, result.toCurrency)}`
    ElMessage.success(
      `已从 ${from.name} 转出 ${formatMoney(result.amount, result.fromCurrency)}${receivedText} 到 ${target?.name ?? payload.toId}`,
    )
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
    throw error
  }
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
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-xs text-ink-muted">
          自己填银行或账户名称。按 App 账面改余额，保存时显示这次加减了多少。
        </p>
        <div class="flex flex-wrap gap-2">
          <el-button plain @click="loanPanel?.openCreate()">登记借出</el-button>
          <el-button type="primary" plain @click="openAddRmb">新增人民币账户</el-button>
        </div>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <LoanPanel ref="loanPanel" />
        <PoolAccountCard
          v-for="account in safeRmb"
          :key="account.id"
          :account="account"
          editable
          editable-yield
          removable
          renamable
          @save-amount="(amount) => saveRmbAmount(account.id, amount)"
          @save-yield="(rate) => savePoolYield('rmb_pool', account.id, rate)"
          @rename="openEditRmb(account)"
          @remove="removeRmb(account)"
        />
      </div>
      <p v-if="!safeRmb.length" class="text-sm text-ink-muted">暂无人民币账户，点右上角新增</p>

      <el-dialog
        v-model="rmbDialogVisible"
        :title="rmbEditingId ? '修改人民币账户' : '新增人民币账户'"
        width="92%"
        class="max-w-md"
        destroy-on-close
      >
        <div class="space-y-4">
          <div>
            <label class="mb-1 block text-xs text-ink-muted">银行名称</label>
            <el-input v-model="rmbForm.name" placeholder="例如：招商银行、余额宝" maxlength="32" />
          </div>
          <div v-if="!rmbEditingId">
            <label class="mb-1 block text-xs text-ink-muted">初始余额（CNY）</label>
            <AmountInput v-model="rmbForm.amount" :min="0" class="w-full!" />
          </div>
          <div v-if="!rmbEditingId">
            <label class="mb-1 block text-xs text-ink-muted">年化收益率（%，可选）</label>
            <el-input-number
              v-model="rmbForm.yieldPct"
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
            <el-input v-model="rmbForm.note" placeholder="可选备注" maxlength="64" />
          </div>
        </div>
        <template #footer>
          <el-button @click="rmbDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="saveRmbAccount">
            {{ rmbEditingId ? '保存' : '添加' }}
          </el-button>
        </template>
      </el-dialog>
    </section>

    <section v-show="activeTab === 'hkd'" class="space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-xs text-ink-muted">
          按银行 App 改账面余额。转到池内其他账户会两边一起改；跨币种填实际到账。可新增账户。
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
          :transfer-targets="hkdTransferTargets(account)"
          @save-amount="(amount) => saveHkdAmount(account.id, amount)"
          @save-yield="(rate) => savePoolYield('hkd_pool', account.id, rate)"
          @transfer="(payload) => transferHkd(account, payload)"
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
            <label class="mb-1 block text-xs text-ink-muted">银行编号</label>
            <el-select
              v-model="hkdForm.code"
              filterable
              placeholder="输入编号或银行名，如 387 / 众安"
              class="w-full!"
            >
              <el-option
                v-for="bank in hkBanks"
                :key="bank.code"
                :label="`${bank.code} ${bank.name}`"
                :value="bank.code"
              />
            </el-select>
            <p class="mt-1 text-xs text-ink-muted">
              香港银行编号，例如 387 众安银行、012 中国银行（香港）
            </p>
          </div>
          <div>
            <label class="mb-1 block text-xs text-ink-muted">初始余额（HKD）</label>
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
      <div class="space-y-4">
        <div class="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 class="mb-1 text-sm font-medium text-accent">中性 · 基金</h3>
            <p class="text-xs text-ink-muted">
              每只公募基金独立份额、净值与 FIFO。买入只记份额，不从现金扣款。
            </p>
          </div>
          <el-button type="primary" plain @click="openAddFund">添加基金</el-button>
        </div>
        <p v-if="!fundProducts.length" class="text-sm text-ink-muted">暂无基金产品，点右上角添加</p>
        <FundProductPanel v-for="account in fundProducts" :key="account.id" :account="account" />
      </div>
      <div v-if="otherNeutral.length" class="grid gap-3 sm:grid-cols-2">
        <PoolAccountCard v-for="account in otherNeutral" :key="account.id" :account="account" />
      </div>

      <el-dialog
        v-model="addFundVisible"
        title="添加基金"
        width="92%"
        class="max-w-md"
        destroy-on-close
      >
        <div class="space-y-4">
          <div>
            <label class="mb-1 block text-xs text-ink-muted">搜索基金</label>
            <el-autocomplete
              v-model="fundQuery"
              :fetch-suggestions="queryFundSuggestions"
              :debounce="300"
              :trigger-on-focus="false"
              highlight-first-item
              placeholder="代码或名称，如 002611 / 黄金"
              class="w-full!"
              @select="onFundSuggestSelect"
            >
              <template #default="{ item }">
                <div class="flex min-w-0 items-center justify-between gap-3">
                  <span class="font-mono">{{ item.fund_code }}</span>
                  <span class="truncate text-ink-muted">{{ item.name }}</span>
                </div>
              </template>
            </el-autocomplete>
            <p v-if="fundLookingUp" class="mt-1 text-xs text-ink-muted">正在搜索…</p>
            <p v-else-if="fundLookup" class="mt-1 text-xs text-safe">已选 {{ fundLookupHint }}</p>
            <p v-else class="mt-1 text-xs text-ink-muted">输入后从候选里点选，方向键 + 回车也可</p>
          </div>
          <div>
            <label class="mb-1 block text-xs text-ink-muted">基金名称（可改）</label>
            <el-input v-model="fundForm.name" placeholder="选中候选后自动填入" maxlength="48" />
          </div>
        </div>
        <template #footer>
          <el-button @click="addFundVisible = false">取消</el-button>
          <el-button
            type="primary"
            :loading="fundSaving"
            :disabled="!fundReady"
            @click="saveAddFund"
          >
            添加
          </el-button>
        </template>
      </el-dialog>
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
