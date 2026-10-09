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
    /** 是否允许修改名称 */
    renamable?: boolean
    /** 可转出的其他账户（港币池内） */
    transferTargets?: PoolAccount[]
  }>(),
  {
    editable: false,
    editableYield: false,
    removable: false,
    renamable: false,
    transferTargets: () => [],
  },
)

const emit = defineEmits<{
  saveAmount: [amount: number]
  saveYield: [yieldRate: number]
  remove: []
  rename: []
  transfer: [payload: { toId: string; amount: number; received?: number }]
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
  fund: '基金',
  crypto_earn: '加密赚币',
}

const draftAmount = ref(props.account.amount)
const draftDailyPnl = ref(0)
const draftYieldPct = ref(round(mul(props.account.yield_rate ?? 0, 100), 2))
const transferToId = ref('')
const transferAmount = ref(0)
const transferReceived = ref(0)

watch(
  () => props.account.amount,
  (v) => {
    draftAmount.value = v
    draftDailyPnl.value = 0
  },
)

watch(
  () => props.transferTargets,
  (targets) => {
    if (!targets.some((item) => item.id === transferToId.value)) {
      transferToId.value = targets[0]?.id ?? ''
    }
  },
  { immediate: true },
)

watch(
  () => props.account.yield_rate,
  (v) => {
    draftYieldPct.value = round(mul(v ?? 0, 100), 2)
  },
)

const previewAmount = computed(() => {
  if (isGold.value) return round(add(props.account.amount, draftDailyPnl.value), 2)
  return round(draftAmount.value, 2)
})

const balanceDelta = computed(() => round(sub(previewAmount.value, props.account.amount), 2))

const dirtyAmount = computed(() => Math.abs(balanceDelta.value) > 1e-9)

const transferTarget = computed(
  () => props.transferTargets.find((item) => item.id === transferToId.value) ?? null,
)
const transferCrossCurrency = computed(
  () => !!transferTarget.value && transferTarget.value.currency !== props.account.currency,
)

const dirtyYield = computed(() => {
  const current = round(mul(props.account.yield_rate ?? 0, 100), 2)
  return Math.abs(sub(draftYieldPct.value, current)) > 1e-9
})

function saveAmount() {
  const next = previewAmount.value
  if (next < 0) {
    ElMessage.warning('余额不能为负')
    return
  }
  emit('saveAmount', next)
  const delta = balanceDelta.value
  const deltaText =
    Math.abs(delta) < 1e-9
      ? '无变动'
      : `${delta > 0 ? '+' : ''}${formatMoney(delta, props.account.currency)}`
  ElMessage.success(`${props.account.name} 已更新（${deltaText}）`)
  draftDailyPnl.value = 0
}

function submitTransfer() {
  const target = transferTarget.value
  if (!target) {
    ElMessage.warning('请选择转入账户')
    return
  }
  const amount = round(transferAmount.value, 2)
  if (!(amount > 0)) {
    ElMessage.warning('转出金额须大于 0')
    return
  }
  if (props.account.amount + 1e-9 < amount) {
    ElMessage.warning('转出金额超过余额')
    return
  }
  const received = transferCrossCurrency.value ? round(transferReceived.value, 2) : undefined
  if (transferCrossCurrency.value && !(received! > 0)) {
    ElMessage.warning('跨币种请填写实际到账金额')
    return
  }
  try {
    emit('transfer', { toId: target.id, amount, received })
    transferAmount.value = 0
    transferReceived.value = 0
  } catch {
    /* 父组件已提示失败原因 */
  }
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
            account.type === 'gold' || account.type === 'fund' || account.type === 'crypto_earn'
              ? 'bg-accent-soft text-accent'
              : 'bg-surface-tint text-ink-muted'
          "
        >
          {{ account.id }}
        </span>
        <el-button v-if="renamable" size="small" plain @click="emit('rename')">修改</el-button>
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

      <div v-if="isGold" class="space-y-2">
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

      <div v-else class="space-y-2">
        <label class="block text-xs text-ink-muted">账面余额（{{ account.currency }}）</label>
        <div class="flex flex-wrap items-center gap-2">
          <AmountInput v-model="draftAmount" :min="0" class="w-44!" />
          <el-button type="primary" size="small" :disabled="!dirtyAmount" @click="saveAmount">
            保存余额
          </el-button>
        </div>
        <p class="text-sm" :class="balanceDelta >= 0 ? 'text-safe' : 'text-alert'">
          相对当前
          {{ balanceDelta >= 0 ? '+' : '' }}{{ formatMoney(balanceDelta, account.currency) }}
        </p>
      </div>

      <div v-if="transferTargets.length" class="space-y-2 border-t border-surface-line pt-3">
        <p class="text-xs text-ink-muted">
          转到池内其他账户。同币种两边一起改；跨币种填银行实际到账。
        </p>
        <el-select v-model="transferToId" class="w-full!" placeholder="转入账户">
          <el-option
            v-for="target in transferTargets"
            :key="target.id"
            :label="`${target.name} · ${target.currency}`"
            :value="target.id"
          />
        </el-select>
        <div class="flex flex-wrap items-center gap-2">
          <AmountInput v-model="transferAmount" :min="0" class="w-44!" />
          <span class="text-xs text-ink-muted">{{ account.currency }}</span>
        </div>
        <div v-if="transferCrossCurrency" class="flex flex-wrap items-center gap-2">
          <AmountInput v-model="transferReceived" :min="0" class="w-44!" />
          <span class="text-xs text-ink-muted">到账 {{ transferTarget?.currency }}</span>
        </div>
        <el-button type="primary" size="small" plain @click="submitTransfer">确认转出</el-button>
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
