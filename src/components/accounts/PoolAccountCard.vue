<script setup lang="ts">
import { ElMessage } from 'element-plus'
import type { PoolAccount } from '@/types/finance'
import { formatMoney, formatPercent } from '@/utils/currency'
import { formatBeijingDateTime } from '@/utils/datetime'
import { add, div, mul, round, sub } from '@/utils/decimal'
import { HTX_HOURS_PER_YEAR, htxHourlyRate } from '@/utils/htx-rebalance'
import { useFinanceFormat } from '@/composables/useFinanceFormat'
import { quoteToneClass } from '@/composables/useQuoteColor'
import { useFinanceStore } from '@/stores/finance'
import FormulaTooltip from '@/components/accounts/FormulaTooltip.vue'
import HtxDailyYieldDialog from '@/components/accounts/HtxDailyYieldDialog.vue'

const props = withDefaults(
  defineProps<{
    account: PoolAccount
    /** 是否允许编辑余额 */
    editable?: boolean
    /** 是否允许编辑年化收益率 */
    editableYield?: boolean
    /** 是否显示删除 */
    removable?: boolean
  }>(),
  { editable: false, editableYield: false, removable: false },
)

const emit = defineEmits<{
  saveAmount: [amount: number]
  saveYield: [yieldRate: number]
  remove: []
}>()

const { moneyInBase } = useFinanceFormat()
const store = useFinanceStore()
const now = useNow({ interval: 1000 })
const isYulibao = computed(() => props.account.id === 'yulibao')
const isGold = computed(() => props.account.type === 'gold')
const isHtxEarn = computed(() => props.account.id === 'htx_earn_usdt')
const htxYield = computed(() => (isHtxEarn.value ? store.htxYieldAt(now.value) : null))
const htxHourlyRateText = computed(() =>
  htxYield.value ? htxHourlyRate(htxYield.value.rate).toFixed(9) : '',
)
const yieldDialogVisible = ref(false)

const typeLabel: Record<PoolAccount['type'], string> = {
  cash: '现金',
  bank: '银行',
  gold: '黄金',
  crypto_earn: '加密赚币',
}

/** delta=按增减记一笔；total=直接改总额；pnl=当日收益（可正可负） */
const amountMode = ref<'delta' | 'total' | 'pnl'>(props.account.type === 'gold' ? 'pnl' : 'delta')
/** 本次变动金额（正数）；方向由 deltaSign 决定 */
const draftDelta = ref(0)
const deltaSign = ref<1 | -1>(1)
const draftAmount = ref(props.account.amount)
const draftDailyPnl = ref(0)
const draftYieldPct = ref(round(mul(props.account.yield_rate ?? 0, 100), 2))

watch(
  () => props.account.amount,
  (v) => {
    draftAmount.value = v
    draftDelta.value = 0
    draftDailyPnl.value = 0
  },
)

watch(
  () => props.account.yield_rate,
  (v) => {
    draftYieldPct.value = round(mul(v ?? 0, 100), 2)
  },
)

const signedDelta = computed(() => round(mul(draftDelta.value, deltaSign.value), 2))

const previewAmount = computed(() => {
  if (amountMode.value === 'total') {
    return round(draftAmount.value, 2)
  }
  if (amountMode.value === 'pnl') {
    return round(add(props.account.amount, draftDailyPnl.value), 2)
  }
  return round(add(props.account.amount, signedDelta.value), 2)
})

const dirtyAmount = computed(() => {
  if (amountMode.value === 'total') {
    return Math.abs(sub(draftAmount.value, props.account.amount)) > 1e-9
  }
  if (amountMode.value === 'pnl') {
    return Math.abs(draftDailyPnl.value) > 1e-9
  }
  return Math.abs(signedDelta.value) > 1e-9
})

const dirtyYield = computed(() => {
  const current = round(mul(props.account.yield_rate ?? 0, 100), 2)
  return Math.abs(sub(draftYieldPct.value, current)) > 1e-9
})

const deltaLabel = computed(() => {
  const d = signedDelta.value
  if (Math.abs(d) < 1e-9) return '本次无变动'
  const sign = d > 0 ? '+' : ''
  return `本次 ${sign}${formatMoney(d, props.account.currency)}`
})

function setDeltaSign(sign: 1 | -1) {
  deltaSign.value = sign
}

function switchAmountMode(mode: 'delta' | 'total' | 'pnl') {
  amountMode.value = mode
  if (mode === 'total') {
    draftAmount.value = props.account.amount
  } else if (mode === 'pnl') {
    draftDailyPnl.value = 0
  } else {
    draftDelta.value = 0
    deltaSign.value = 1
  }
}

function saveAmount() {
  const next = previewAmount.value
  if (next < 0) {
    ElMessage.warning('余额不能为负')
    return
  }
  emit('saveAmount', next)
  const delta = round(sub(next, props.account.amount), 2)
  const deltaText =
    Math.abs(delta) < 1e-9
      ? '无变动'
      : `${delta > 0 ? '+' : ''}${formatMoney(delta, props.account.currency)}`
  ElMessage.success(`${props.account.name} 已更新（${deltaText}）`)
  draftDelta.value = 0
  deltaSign.value = 1
  draftDailyPnl.value = 0
}

function saveYield() {
  if (draftYieldPct.value < 0 || draftYieldPct.value > 100) {
    ElMessage.warning('年化收益率须在 0%–100% 之间')
    return
  }
  emit('saveYield', div(round(draftYieldPct.value, 2), 100))
  ElMessage.success(`${props.account.name} 年化收益率已更新`)
}
</script>

<template>
  <article class="panel flex flex-col gap-3 px-4 py-4">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="font-medium">{{ account.name }}</p>
        <p class="mt-1 text-xs text-ink-muted">
          {{ typeLabel[account.type] }} · {{ account.currency }}
          <span v-if="account.is_safety_line" class="ml-1 text-alert">红线账户</span>
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <span
          class="rounded-md px-2 py-1 text-xs"
          :class="
            account.type === 'gold' || account.type === 'crypto_earn'
              ? 'bg-accent-soft text-accent'
              : 'bg-surface-tint text-ink-muted'
          "
        >
          {{ account.id }}
        </span>
        <el-button v-if="removable" size="small" type="danger" plain @click="emit('remove')">
          删除
        </el-button>
      </div>
    </div>

    <div v-if="editable" class="space-y-3">
      <div>
        <p class="text-xs text-ink-muted">当前余额</p>
        <p class="stat-num mt-0.5 text-xl font-semibold">
          {{ formatMoney(account.amount, account.currency) }}
        </p>
        <p class="mt-0.5 text-xs text-ink-muted">
          ≈ {{ moneyInBase(account.amount, account.currency) }}
        </p>
        <p v-if="isYulibao" class="mt-2 text-xs text-ink-muted">
          分桶：应急
          {{ formatMoney(store.emergencyReserve, 'CNY') }}
          + 美股种子
          {{ formatMoney(store.usSeedParking, 'CNY') }}
          <template v-if="store.travelFundPocket > 0">
            + 旅游
            {{ formatMoney(store.travelFundPocket, 'CNY') }}
          </template>
          <template v-if="store.cashObservation > 0">
            + 观察仓
            {{ formatMoney(store.cashObservation, 'CNY') }}
          </template>
        </p>
      </div>

      <div class="flex flex-wrap gap-2">
        <el-button
          v-if="isGold"
          size="small"
          :type="amountMode === 'pnl' ? 'primary' : 'default'"
          plain
          @click="switchAmountMode('pnl')"
        >
          当日收益
        </el-button>
        <el-button
          size="small"
          :type="amountMode === 'delta' ? 'primary' : 'default'"
          plain
          @click="switchAmountMode('delta')"
        >
          存入 / 取出
        </el-button>
        <el-button
          size="small"
          :type="amountMode === 'total' ? 'primary' : 'default'"
          plain
          @click="switchAmountMode('total')"
        >
          改总额
        </el-button>
      </div>

      <div v-if="amountMode === 'pnl'" class="space-y-2">
        <label class="block text-xs text-ink-muted">
          当日收益（{{ account.currency }}，亏了填负数）
        </label>
        <div class="flex flex-wrap items-center gap-2">
          <AmountInput v-model="draftDailyPnl" allow-negative class="w-44!" />
          <el-button type="primary" size="small" :disabled="!dirtyAmount" @click="saveAmount">
            计入收益
          </el-button>
        </div>
        <p class="text-sm" :class="quoteToneClass(draftDailyPnl)">
          {{ draftDailyPnl >= 0 ? '+' : '' }}{{ formatMoney(draftDailyPnl, account.currency) }}
          <span class="text-ink-muted">
            → 余额 {{ formatMoney(previewAmount, account.currency) }}
          </span>
        </p>
      </div>

      <div v-else-if="amountMode === 'delta'" class="space-y-2">
        <div class="flex flex-wrap gap-2">
          <el-button
            size="small"
            :type="deltaSign === 1 ? 'success' : 'default'"
            @click="setDeltaSign(1)"
          >
            存入 +
          </el-button>
          <el-button
            size="small"
            :type="deltaSign === -1 ? 'danger' : 'default'"
            @click="setDeltaSign(-1)"
          >
            取出 −
          </el-button>
        </div>
        <label class="block text-xs text-ink-muted">本次金额（{{ account.currency }}）</label>
        <div class="flex flex-wrap items-center gap-2">
          <AmountInput v-model="draftDelta" :min="0" class="w-44!" />
          <el-button type="primary" size="small" :disabled="!dirtyAmount" @click="saveAmount">
            确认变动
          </el-button>
        </div>
        <p class="text-sm" :class="signedDelta >= 0 ? 'text-safe' : 'text-alert'">
          {{ deltaLabel }}
          <span class="text-ink-muted">
            → 余额 {{ formatMoney(previewAmount, account.currency) }}
          </span>
        </p>
      </div>

      <div v-else class="space-y-2">
        <label class="block text-xs text-ink-muted">新总额（{{ account.currency }}）</label>
        <div class="flex flex-wrap items-center gap-2">
          <AmountInput v-model="draftAmount" :min="0" class="w-44!" />
          <el-button type="primary" size="small" :disabled="!dirtyAmount" @click="saveAmount">
            保存总额
          </el-button>
        </div>
        <p
          class="text-sm"
          :class="sub(previewAmount, account.amount) >= 0 ? 'text-safe' : 'text-alert'"
        >
          相对当前
          {{ sub(previewAmount, account.amount) >= 0 ? '+' : ''
          }}{{ formatMoney(sub(previewAmount, account.amount), account.currency) }}
        </p>
      </div>

      <p v-if="account.amount_updated_at" class="text-[11px] text-ink-muted">
        修改于 {{ formatBeijingDateTime(account.amount_updated_at) }}（北京时间）
      </p>
    </div>

    <div v-else>
      <p class="stat-num text-xl font-semibold">
        {{ formatMoney(account.amount, account.currency) }}
      </p>
      <p class="mt-1 text-xs text-ink-muted">
        ≈ {{ moneyInBase(account.amount, account.currency) }}
      </p>
      <p v-if="account.amount_updated_at" class="mt-1 text-[11px] text-ink-muted">
        修改于 {{ formatBeijingDateTime(account.amount_updated_at) }}（北京时间）
      </p>
    </div>

    <p v-if="account.note" class="text-xs text-ink-muted">
      {{ account.note }}
    </p>

    <div v-if="editableYield" class="space-y-2 border-t border-surface-line pt-3">
      <label class="block text-xs text-ink-muted">年化收益率（% · 业绩比较基准参考，非承诺）</label>
      <div class="flex flex-wrap items-center gap-2">
        <el-input-number
          v-model="draftYieldPct"
          :min="0"
          :max="100"
          :step="0.01"
          :precision="2"
          controls-position="right"
          class="w-36!"
        />
        <el-button type="primary" size="small" :disabled="!dirtyYield" @click="saveYield">
          保存年化
        </el-button>
      </div>
      <p class="text-xs text-safe">当前 {{ formatPercent(account.yield_rate ?? 0, 2) }}</p>
    </div>

    <div
      v-else-if="account.yield_rate || account.profit_rate != null"
      class="flex flex-wrap gap-x-2 text-xs"
    >
      <span v-if="account.yield_rate" class="text-safe">
        年化收益率 {{ formatPercent(account.yield_rate, 2) }}
      </span>
      <template v-if="htxYield">
        <span class="inline-flex flex-wrap items-baseline gap-x-1 text-safe">
          <FormulaTooltip>
            每小时收益
            <template #content>
              <p>时利率 = 年化 ÷ {{ HTX_HOURS_PER_YEAR }}，先四舍五入到 9 位</p>
              <p>每小时收益 = ROUND_UP(本金 × 时利率, 8 位)</p>
              <p class="font-mono">
                {{ formatPercent(htxYield.rate, 2) }} ÷ {{ HTX_HOURS_PER_YEAR }} =
                {{ htxHourlyRateText }}
              </p>
              <p class="font-mono">
                ROUND_UP({{ formatMoney(account.amount, account.currency) }} ×
                {{ htxHourlyRateText }}, 8) =
                {{
                  formatMoney(htxYield.hourly, account.currency, {
                    digits: 8,
                  })
                }}
              </p>
            </template>
          </FormulaTooltip>
          {{
            formatMoney(htxYield.hourly, account.currency, {
              digits: 8,
            })
          }}
        </span>
        <span class="inline-flex flex-wrap items-baseline gap-x-1 text-safe">
          <FormulaTooltip>
            今日收益
            <template #content>
              <p>北京时间当日 00:00–24:00 共 24 个整点，到账复投后的小时收益合计</p>
              <p class="font-mono">
                合计
                {{
                  formatMoney(htxYield.daily, account.currency, {
                    digits: 8,
                  })
                }}
                · 已到账
                {{
                  formatMoney(htxYield.creditedToday, account.currency, {
                    digits: 8,
                  })
                }}
              </p>
              <p>点击数字可看 24 小时明细</p>
            </template>
          </FormulaTooltip>
          <button
            type="button"
            class="cursor-pointer underline decoration-dotted underline-offset-2"
            @click="yieldDialogVisible = true"
          >
            {{
              formatMoney(htxYield.daily, account.currency, {
                digits: 8,
              })
            }}
          </button>
        </span>
      </template>
      <span v-if="account.profit_rate != null" :class="quoteToneClass(account.profit_rate)">
        {{ account.profit_rate >= 0 ? '浮盈' : '浮亏' }}
        {{ formatPercent(Math.abs(account.profit_rate)) }}
      </span>
    </div>
  </article>
  <HtxDailyYieldDialog
    v-if="htxYield"
    v-model:visible="yieldDialogVisible"
    :rows="htxYield.hourlyLedger"
    :total="htxYield.daily"
    :waiting-first-payout="htxYield.waitingFirstPayout"
  />
</template>
