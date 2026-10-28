<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import type { PoolAccount } from '@/types/finance'
import { formatMoney, formatPercent } from '@/utils/currency'
import { formatBeijingDateTime, todayBeijingDate } from '@/utils/datetime'
import {
  demandBalance,
  isTermLocked,
  lockedPrincipal,
  maturityInterest,
  TERM_SHORTCUTS,
  termDays,
  termDaysLeft,
  termLengthLabel,
  termMaturityFromShortcut,
  type TermShortcutId,
} from '@/utils/term-lock'
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
    /** 港币池：可设定期锁仓 */
    termLockable?: boolean
  }>(),
  {
    editable: false,
    editableYield: false,
    removable: false,
    renamable: false,
    transferTargets: () => [],
    termLockable: false,
  },
)

const emit = defineEmits<{
  saveAmount: [amount: number]
  saveYield: [yieldRate: number]
  remove: []
  rename: []
  transfer: [payload: { toId: string; amount: number; received?: number }]
  setTermLock: [payload: { start_date: string; maturity_date: string; rate: number }]
  breakTermLock: []
  creditTermMaturity: [interest: number]
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

/** in/out=存入或取出；transfer=转到池内其他账户；total=直接改总额；pnl=当日收益 */
const amountTab = ref<'in' | 'out' | 'transfer' | 'total' | 'pnl'>(
  props.account.type === 'gold' ? 'pnl' : 'in',
)
const amountMode = computed(() => {
  if (amountTab.value === 'total') return 'total' as const
  if (amountTab.value === 'pnl') return 'pnl' as const
  if (amountTab.value === 'transfer') return 'transfer' as const
  return 'delta' as const
})
const deltaSign = computed<1 | -1>(() => (amountTab.value === 'out' ? -1 : 1))
const draftDelta = ref(0)
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

watch(
  () => props.transferTargets,
  (targets) => {
    if (!targets.some((item) => item.id === transferToId.value)) {
      transferToId.value = targets[0]?.id ?? ''
    }
  },
  { immediate: true },
)

const transferTarget = computed(
  () => props.transferTargets.find((item) => item.id === transferToId.value) ?? null,
)
const transferCrossCurrency = computed(
  () => !!transferTarget.value && transferTarget.value.currency !== props.account.currency,
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

const termLock = computed(() => props.account.term_lock)
const termActive = computed(() => isTermLocked(termLock.value, now.value))
const termDayCount = computed(() =>
  termLock.value ? termDays(termLock.value.start_date, termLock.value.maturity_date) : 0,
)
const termDaysRemaining = computed(() =>
  termLock.value ? termDaysLeft(termLock.value, now.value) : 0,
)
const lockedPrincipalAmount = computed(() => lockedPrincipal(props.account.amount, termLock.value))
const demandAmount = computed(() => demandBalance(props.account.amount, termLock.value, now.value))
const termInterest = computed(() =>
  termLock.value?.rate
    ? maturityInterest(
        lockedPrincipalAmount.value,
        termLock.value.rate,
        termLock.value.start_date,
        termLock.value.maturity_date,
      )
    : 0,
)
const draftInterest = ref(0)
watch(
  termInterest,
  (value) => {
    draftInterest.value = value
  },
  { immediate: true },
)
watch(termActive, (locked) => {
  if (locked && (amountTab.value === 'total' || amountTab.value === 'pnl')) amountTab.value = 'in'
})
watch(amountTab, (tab) => {
  if (tab === 'total') draftAmount.value = props.account.amount
  else if (tab === 'pnl') draftDailyPnl.value = 0
  else if (tab === 'in' || tab === 'out') draftDelta.value = 0
})

const termSpanLabel = computed(() =>
  termLock.value
    ? termLengthLabel(termLock.value.start_date, termLock.value.maturity_date)
    : '定期',
)

const termDialogVisible = ref(false)
const termStart = ref('')
const termMaturity = ref('')
const termRatePct = ref(0)
const termShortcut = ref<TermShortcutId | ''>('')

const termDraftInterest = computed(() => {
  if (!termStart.value || !termMaturity.value || !(termRatePct.value > 0)) return null
  return maturityInterest(
    props.account.amount,
    div(termRatePct.value, 100),
    termStart.value,
    termMaturity.value,
  )
})

function openTermDialog() {
  termShortcut.value = ''
  termStart.value = todayBeijingDate()
  termMaturity.value = ''
  termRatePct.value = 0
  termDialogVisible.value = true
}

function applyTermShortcut(id: TermShortcutId) {
  if (!termStart.value) termStart.value = todayBeijingDate()
  termShortcut.value = id
  termMaturity.value = termMaturityFromShortcut(termStart.value, id)
}

watch(termStart, (start) => {
  if (!termShortcut.value || !start) return
  termMaturity.value = termMaturityFromShortcut(start, termShortcut.value)
})

function onTermMaturityChange() {
  if (!termShortcut.value || !termStart.value) return
  if (termMaturityFromShortcut(termStart.value, termShortcut.value) !== termMaturity.value) {
    termShortcut.value = ''
  }
}

function submitTermLock() {
  if (!termStart.value || !termMaturity.value) {
    ElMessage.warning('请填写起息日和到期日')
    return
  }
  if (!(termRatePct.value > 0) || termRatePct.value > 100) {
    ElMessage.warning('请填写大于 0 的定期年化')
    return
  }
  try {
    emit('setTermLock', {
      start_date: termStart.value,
      maturity_date: termMaturity.value,
      rate: div(round(termRatePct.value, 2), 100),
    })
    termDialogVisible.value = false
  } catch {
    /* 父组件已提示失败原因 */
  }
}

async function confirmBreak() {
  try {
    await ElMessageBox.confirm(
      `提前支取将解除锁仓，不计定期利息，余额保持 ${formatMoney(props.account.amount, props.account.currency)}。`,
      '提前支取',
      { confirmButtonText: '解除锁仓', cancelButtonText: '取消', type: 'warning' },
    )
    emit('breakTermLock')
  } catch {
    /* 取消，或父组件已提示失败原因 */
  }
}

async function confirmCredit() {
  const gain = round(draftInterest.value, 2)
  if (!(gain >= 0)) {
    ElMessage.warning('入账利息不能为负')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将 ${formatMoney(gain, props.account.currency)} 利息计入余额，并解除锁仓？`,
      '到期入账',
      { confirmButtonText: '确认入账', cancelButtonText: '取消', type: 'warning' },
    )
    emit('creditTermMaturity', gain)
  } catch {
    /* 取消，或父组件已提示失败原因 */
  }
}

function saveAmount() {
  const next = previewAmount.value
  if (next < 0) {
    ElMessage.warning('余额不能为负')
    return
  }
  if (termActive.value && amountMode.value === 'total') {
    ElMessage.warning('定期锁仓中不能改总额')
    return
  }
  if (termActive.value && next + 1e-9 < lockedPrincipalAmount.value) {
    ElMessage.warning(
      `活期只有 ${formatMoney(demandAmount.value, props.account.currency)}，定期本金不能取出`,
    )
    return
  }
  try {
    emit('saveAmount', next)
  } catch (error) {
    if (error instanceof Error && error.message) ElMessage.error(error.message)
    return
  }
  const delta = round(sub(next, props.account.amount), 2)
  const deltaText =
    Math.abs(delta) < 1e-9
      ? '无变动'
      : `${delta > 0 ? '+' : ''}${formatMoney(delta, props.account.currency)}`
  ElMessage.success(`${props.account.name} 已更新（${deltaText}）`)
  draftDelta.value = 0
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
  if (termActive.value && amount > demandAmount.value + 1e-9) {
    ElMessage.warning(
      `活期只有 ${formatMoney(demandAmount.value, props.account.currency)}，定期本金不能转出`,
    )
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
        <p v-if="isYulibao" class="text-xs text-ink-muted">
          改总额：增加额（利息/红包零头）进观察仓；减少额优先扣应急金
        </p>
      </div>

      <div
        v-if="termLock"
        class="rounded-lg border border-surface-line bg-surface px-3 py-2 text-xs"
      >
        <p class="font-medium">
          <template v-if="termActive">
            {{ termSpanLabel }}还剩 {{ termDaysRemaining }} 天到期
          </template>
          <template v-else>{{ termSpanLabel }}已于 {{ termLock.maturity_date }} 到期</template>
        </p>
        <p class="mt-1 text-ink-muted">
          定期 {{ formatMoney(lockedPrincipalAmount, account.currency) }} 锁至
          {{ termLock.maturity_date }} · 活期
          {{ formatMoney(demandAmount, account.currency) }} 可存入 / 取出
        </p>
        <p class="mt-1 text-safe">
          <FormulaTooltip>
            到期利息 {{ formatMoney(termInterest, account.currency) }}
            <template #content>
              <p>定期本金 × 年化 × 实际天数 / 365</p>
              <p class="font-mono">
                {{ formatMoney(lockedPrincipalAmount, account.currency) }} ×
                {{ formatPercent(termLock.rate ?? 0, 2) }} × {{ termDayCount }} / 365 =
                {{ formatMoney(termInterest, account.currency) }}
              </p>
            </template>
          </FormulaTooltip>
        </p>
        <div v-if="termActive" class="mt-2">
          <el-button size="small" type="danger" plain @click="confirmBreak">提前支取</el-button>
        </div>
        <div v-else class="mt-2 space-y-2">
          <label class="block text-xs text-ink-muted">入账利息（{{ account.currency }}）</label>
          <div class="flex flex-wrap items-center gap-2">
            <AmountInput v-model="draftInterest" :min="0" class="w-44!" />
            <el-button type="primary" size="small" @click="confirmCredit">到期入账</el-button>
          </div>
        </div>
      </div>

      <el-tabs v-model="amountTab" class="amount-tabs">
        <el-tab-pane v-if="isGold" label="当日收益" name="pnl" />
        <el-tab-pane label="存入" name="in" />
        <el-tab-pane label="取出" name="out" />
        <el-tab-pane v-if="transferTargets.length" label="转出" name="transfer" />
        <el-tab-pane v-if="!termActive" label="改总额" name="total" />
      </el-tabs>

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
        <label class="block text-xs text-ink-muted">
          {{ termActive ? '活期金额' : '本次金额' }}（{{ account.currency }}）
        </label>
        <div class="flex flex-wrap items-center gap-2">
          <AmountInput v-model="draftDelta" :min="0" class="w-44!" />
          <el-button type="primary" size="small" :disabled="!dirtyAmount" @click="saveAmount">
            {{ amountTab === 'out' ? '确认取出' : '确认存入' }}
          </el-button>
        </div>
        <p class="text-sm" :class="signedDelta >= 0 ? 'text-safe' : 'text-alert'">
          {{ deltaLabel }}
          <span class="text-ink-muted">
            → {{ termActive ? '活期' : '余额' }}
            {{
              formatMoney(
                termActive ? round(add(demandAmount, signedDelta), 2) : previewAmount,
                account.currency,
              )
            }}
          </span>
        </p>
        <p v-if="termActive" class="text-xs text-ink-muted">
          只动活期，定期本金 {{ formatMoney(lockedPrincipalAmount, account.currency) }} 不动。
        </p>
      </div>

      <div v-else-if="amountMode === 'transfer'" class="space-y-2">
        <p class="text-xs text-ink-muted">
          <template v-if="termActive">
            只能转出活期 {{ formatMoney(demandAmount, account.currency) }}，定期本金不动。
          </template>
          <template v-else>转到池内其他账户。同币种两边一起改；跨币种填银行实际到账。</template>
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
      <label class="block text-xs text-ink-muted">
        {{
          termLockable
            ? '活期年化（% · 只用于活期余额，与定期利率分开）'
            : '年化收益率（% · 业绩比较基准参考，非承诺）'
        }}
      </label>
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

    <div v-if="termLockable && !termLock" class="border-t border-surface-line pt-3">
      <el-button size="small" plain @click="openTermDialog">设为定期</el-button>
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
  <el-dialog
    v-model="termDialogVisible"
    title="设为定期"
    width="92%"
    class="max-w-md"
    append-to-body
  >
    <div class="space-y-4">
      <p class="text-xs text-ink-muted">
        定期利率单独填写，不改上面的活期年化。到期前不能改总额，也不能动定期本金。
      </p>
      <div>
        <p class="mb-1 text-xs text-ink-muted">期限</p>
        <div class="flex flex-wrap gap-2">
          <el-button
            v-for="shortcut in TERM_SHORTCUTS"
            :key="shortcut.id"
            size="small"
            :type="termShortcut === shortcut.id ? 'primary' : 'default'"
            plain
            @click="applyTermShortcut(shortcut.id)"
          >
            {{ shortcut.label }}
          </el-button>
        </div>
      </div>
      <div>
        <label class="mb-1 block text-xs text-ink-muted">起息日</label>
        <el-date-picker v-model="termStart" type="date" value-format="YYYY-MM-DD" class="w-full!" />
      </div>
      <div>
        <label class="mb-1 block text-xs text-ink-muted">到期日</label>
        <el-date-picker
          v-model="termMaturity"
          type="date"
          value-format="YYYY-MM-DD"
          class="w-full!"
          @change="onTermMaturityChange"
        />
      </div>
      <div>
        <label class="mb-1 block text-xs text-ink-muted">定期年化（%）</label>
        <el-input-number
          v-model="termRatePct"
          :min="0"
          :max="100"
          :step="0.01"
          :precision="2"
          controls-position="right"
          class="w-full!"
        />
      </div>
      <p v-if="termDraftInterest != null" class="text-sm text-safe">
        到期利息约
        {{ formatMoney(termDraftInterest, account.currency) }}
        （本金 {{ formatMoney(account.amount, account.currency) }} ×
        {{ formatPercent(div(termRatePct, 100), 2) }} × {{ termDays(termStart, termMaturity) }} /
        365）
      </p>
    </div>
    <template #footer>
      <el-button @click="termDialogVisible = false">取消</el-button>
      <el-button type="primary" @click="submitTermLock">锁仓</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.amount-tabs :deep(.el-tabs__header) {
  margin-bottom: 0;
}
.amount-tabs :deep(.el-tabs__content) {
  display: none;
}
</style>
