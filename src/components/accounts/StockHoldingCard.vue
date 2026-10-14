<script setup lang="ts">
import type { UsStockHolding } from '@/types/finance'
import { formatMoney, formatPercent, stockCostBasis, stockMarketValue } from '@/utils/currency'
import { div, sub } from '@/utils/decimal'
import { useFinanceFormat } from '@/composables/useFinanceFormat'
import { quoteToneClass } from '@/composables/useQuoteColor'
import { formatBeijingDateTime } from '@/utils/datetime'
import { usQuoteSessionLabel } from '@/utils/stock-prices'
import FormulaTooltip from '@/components/accounts/FormulaTooltip.vue'

const props = withDefaults(
  defineProps<{
    stock: UsStockHolding
    editable?: boolean
    removable?: boolean
  }>(),
  { editable: false, removable: false },
)

const emit = defineEmits<{
  topUp: []
  edit: []
  remove: []
}>()

const { moneyInBase } = useFinanceFormat()

const marketValue = computed(() => stockMarketValue(props.stock))
const costBasis = computed(() => stockCostBasis(props.stock))
const marketPrice = computed(() => props.stock.market_price ?? props.stock.cost_price)
const sessionLabel = computed(() => usQuoteSessionLabel(props.stock.price_session))
const regularClose = computed(() => {
  const regular = props.stock.regular_price
  if (props.stock.price_session === 'regular' || regular == null || !(regular > 0)) return null
  if (Math.abs(regular - marketPrice.value) < 0.001) return null
  return regular
})
const pnl = computed(() => sub(marketValue.value, costBasis.value))
const pnlRate = computed(() => {
  if (!costBasis.value) return 0
  return div(pnl.value, costBasis.value)
})
</script>

<template>
  <article class="panel flex flex-col gap-3 px-4 py-3">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-sm font-medium">
          <span class="font-mono">{{ stock.symbol }}</span>
          <span class="ml-2 text-ink-muted">{{ stock.name }}</span>
        </p>
        <p class="hint">
          美股 · USD
          <template v-if="stock.est_div_yield != null && stock.est_div_yield >= 0">
            ·
            <FormulaTooltip>
              <span class="text-safe">股息 {{ formatPercent(stock.est_div_yield) }}</span>
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
        <el-button v-if="editable" size="small" type="primary" plain @click="emit('topUp')">
          补仓
        </el-button>
        <el-button v-if="editable" size="small" @click="emit('edit')">修改</el-button>
        <el-button v-if="removable" size="small" type="danger" plain @click="emit('remove')">
          删除
        </el-button>
      </div>
    </div>

    <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
      <div>
        <dt class="stat-label">数量</dt>
        <dd class="stat-num mt-0.5 font-semibold">{{ stock.shares }} 股</dd>
      </div>
      <div>
        <dt class="stat-label">持仓价</dt>
        <dd class="stat-num mt-0.5 font-semibold">{{ formatMoney(stock.cost_price, 'USD') }}</dd>
      </div>
      <div>
        <dt class="stat-label">现价</dt>
        <dd class="stat-num mt-0.5 font-semibold">
          {{ formatMoney(marketPrice, 'USD') }}
          <span v-if="sessionLabel" class="ml-1 text-xs font-normal text-ink-muted">
            {{ sessionLabel }}
          </span>
        </dd>
        <dd v-if="stock.price_updated_at" class="hint">
          {{ formatBeijingDateTime(stock.price_updated_at) }}
        </dd>
        <dd v-if="regularClose != null" class="hint">
          盘中 {{ formatMoney(regularClose, 'USD') }}
        </dd>
      </div>
      <div>
        <dt class="stat-label">
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
        <dd class="stat-num mt-0.5 font-semibold">{{ formatMoney(costBasis, 'USD') }}</dd>
      </div>
    </dl>

    <div class="sub-section pt-2">
      <p class="stat-num text-lg font-semibold">
        {{ formatMoney(marketValue, 'USD') }}
      </p>
      <p class="hint stat-num">
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
        ≈ {{ moneyInBase(marketValue, 'USD') }}
        ·
        <FormulaTooltip>
          盈亏
          <template #content>
            <p>盈亏 = 市值 − 成本合计</p>
            <p>盈亏率 = 盈亏 ÷ 成本合计</p>
            <p class="font-mono">
              {{ formatMoney(marketValue, 'USD') }}
              − {{ formatMoney(costBasis, 'USD') }}
              =
              {{ pnl >= 0 ? '+' : '' }}{{ formatMoney(pnl, 'USD') }} （{{
                formatPercent(pnlRate)
              }}）
            </p>
          </template>
        </FormulaTooltip>
        <span :class="quoteToneClass(pnl)">
          {{ pnl >= 0 ? '+' : '' }}{{ formatMoney(pnl, 'USD') }} （{{ formatPercent(pnlRate) }}）
        </span>
      </p>
    </div>
  </article>
</template>
