<script setup lang="ts">
import type { UsStockHolding } from '@/types/finance'
import { formatMoney, formatPercent, stockCostBasis, stockMarketValue } from '@/utils/currency'
import { div, sub } from '@/utils/decimal'
import { useFinanceFormat } from '@/composables/useFinanceFormat'
import { quoteToneClass } from '@/composables/useQuoteColor'
import { formatBeijingDateTime } from '@/utils/datetime'
import FormulaTooltip from '@/components/accounts/FormulaTooltip.vue'

const props = withDefaults(
  defineProps<{
    stock: UsStockHolding
    /** 是否允许改数量与持仓价 */
    editable?: boolean
    removable?: boolean
  }>(),
  { editable: false, removable: false },
)

const emit = defineEmits<{
  edit: []
  remove: []
}>()

const { moneyInBase } = useFinanceFormat()

const marketValue = computed(() => stockMarketValue(props.stock))
const costBasis = computed(() => stockCostBasis(props.stock))
const marketPrice = computed(() => props.stock.market_price ?? props.stock.cost_price)
const pnl = computed(() => sub(marketValue.value, costBasis.value))
const pnlRate = computed(() => {
  if (!costBasis.value) return 0
  return div(pnl.value, costBasis.value)
})

const hasDividend = computed(
  () => props.stock.est_div_yield != null && props.stock.est_div_yield >= 0,
)
</script>

<template>
  <article class="panel flex min-w-0 flex-col gap-3 px-4 py-4">
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div class="min-w-0">
        <p class="truncate font-medium">
          <span class="font-mono">{{ stock.symbol }}</span>
          <span class="ml-2 font-normal text-ink-muted">{{ stock.name }}</span>
        </p>
        <p class="mt-1 text-xs text-ink-muted">
          美股 · USD
          <template v-if="hasDividend">
            ·
            <FormulaTooltip>
              <span class="text-safe">股息 {{ formatPercent(stock.est_div_yield!) }}</span>
              <template #content>
                <p>TTM 股息率 = 近 12 个月分红 ÷ 现价</p>
                <p v-if="stock.div_yield_updated_at">
                  {{ formatBeijingDateTime(stock.div_yield_updated_at) }} 更新
                </p>
              </template>
            </FormulaTooltip>
          </template>
        </p>
      </div>
      <div v-if="editable || removable" class="flex shrink-0 items-center gap-2">
        <el-button v-if="editable" size="small" @click="emit('edit')">修改</el-button>
        <el-button v-if="removable" size="small" type="danger" plain @click="emit('remove')">
          删除
        </el-button>
      </div>
    </div>

    <div>
      <p class="text-xs text-ink-muted">
        <FormulaTooltip>
          市值
          <template #content>
            <p>市值 = 数量 × 现价</p>
            <p class="font-mono">
              {{ stock.shares }} × {{ formatMoney(marketPrice, 'USD') }} =
              {{ formatMoney(marketValue, 'USD') }}
            </p>
          </template>
        </FormulaTooltip>
      </p>
      <p class="stat-num mt-0.5 text-xl font-semibold">
        {{ formatMoney(marketValue, 'USD') }}
      </p>
      <p class="mt-0.5 text-xs text-ink-muted">≈ {{ moneyInBase(marketValue, 'USD') }}</p>
      <p class="stat-num mt-1 text-sm font-semibold" :class="quoteToneClass(pnl)">
        <FormulaTooltip>
          盈亏
          <template #content>
            <p>盈亏 = 市值 − 成本合计</p>
            <p>盈亏率 = 盈亏 ÷ 成本合计</p>
            <p class="font-mono">
              {{ formatMoney(marketValue, 'USD') }} − {{ formatMoney(costBasis, 'USD') }} =
              {{ pnl >= 0 ? '+' : '' }}{{ formatMoney(pnl, 'USD') }} （{{
                formatPercent(pnlRate)
              }}）
            </p>
          </template>
        </FormulaTooltip>
        {{ pnl >= 0 ? '+' : '' }}{{ formatMoney(pnl, 'USD') }} （{{ formatPercent(pnlRate) }}）
      </p>
    </div>

    <dl class="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-surface-line pt-3">
      <div class="min-w-0">
        <dt class="text-xs text-ink-muted">数量</dt>
        <dd class="stat-num mt-0.5 text-sm font-semibold">{{ stock.shares }} 股</dd>
      </div>
      <div class="min-w-0">
        <dt class="text-xs text-ink-muted">持仓价</dt>
        <dd class="stat-num mt-0.5 text-sm font-semibold">
          {{ formatMoney(stock.cost_price, 'USD') }}
        </dd>
      </div>
      <div class="min-w-0">
        <dt class="text-xs text-ink-muted">现价</dt>
        <dd class="stat-num mt-0.5 text-sm font-semibold">
          {{ formatMoney(marketPrice, 'USD') }}
        </dd>
      </div>
      <div class="min-w-0">
        <dt class="text-xs text-ink-muted">
          <FormulaTooltip>
            成本合计
            <template #content>
              <p>成本合计 = 数量 × 持仓价</p>
              <p class="font-mono">
                {{ stock.shares }} × {{ formatMoney(stock.cost_price, 'USD') }} =
                {{ formatMoney(costBasis, 'USD') }}
              </p>
            </template>
          </FormulaTooltip>
        </dt>
        <dd class="stat-num mt-0.5 text-sm font-semibold">{{ formatMoney(costBasis, 'USD') }}</dd>
      </div>
    </dl>

    <p v-if="stock.price_updated_at" class="text-[11px] text-ink-muted">
      现价更新于 {{ formatBeijingDateTime(stock.price_updated_at) }}（北京时间）
    </p>
  </article>
</template>
