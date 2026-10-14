<script setup lang="ts">
import dayjs from 'dayjs'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useFinanceStore } from '@/stores/finance'
import type { FunFundCarryoverRule, FunFundChargePayment } from '@/types/finance'
import { useFinanceFormat } from '@/composables/useFinanceFormat'
import { formatMoney } from '@/utils/currency'
import { beijingWallTime, todayBeijingDate } from '@/utils/datetime'
import { formatPaydayZh, formatPaydayWithWeekday } from '@/utils/payday'
import { add, round, sub } from '@/utils/decimal'
import { FUN_FUND_CARRYOVER_OPTIONS, funFundCarryoverLabel } from '@/utils/salary-allocation'

const store = useFinanceStore()
const { moneyInBase } = useFinanceFormat()

const funSpendAmount = ref(0)
const showCarryDialog = ref(false)
const carryRule = ref<FunFundCarryoverRule>(store.settings.rules.carryover_rule)
const yearMonth = computed(() => store.openFunFundPeriod() ?? store.salary.history[0]?.year_month)
const funPeriod = computed(() => store.openFunFundPeriod() ?? yearMonth.value ?? '')
const funAllocated = computed(() =>
  funPeriod.value ? store.funFundAllocatedForMonth(funPeriod.value) : 0,
)
const funSpentRecorded = computed(
  () => store.getRecordByMonth(funPeriod.value)?.fun_fund_spent ?? 0,
)
const reserve = computed(() => store.funFundReserve)
const spendable = computed(() => store.funFundSpendable)
const remainingAfterSpend = computed(() =>
  round(sub(spendable.value, funSpendAmount.value || 0), 2),
)
const alreadyCarried = computed(
  () => store.getRecordByMonth(funPeriod.value)?.fun_fund_carried ?? false,
)
const primaryLine = computed(() => reserve.value.lines[0] ?? null)

const pendingReimbursements = computed(() => {
  const charges = store.salary.settings.fun_fund_charges ?? []
  return (store.salary.fun_fund_charge_history ?? [])
    .filter((item) => item.reimburse_due && !item.reimbursed_at)
    .map((payment) => ({
      payment,
      label: charges.find((item) => item.id === payment.charge_id)?.label ?? '订阅',
    }))
})

function fridayDateKeyOfBeijingWeek(now = new Date()) {
  const todayKey = todayBeijingDate(now)
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
  }).format(dayjs(`${todayKey}T12:00:00+08:00`).toDate())
  const index = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday)
  const delta = 5 - (index < 0 ? 0 : index)
  return dayjs(todayKey).add(delta, 'day').format('YYYY-MM-DD')
}

function reimbursementText(payment: FunFundChargePayment, label: string) {
  const due = payment.reimburse_due ?? ''
  const [year, month, day] = due.split('-')
  const periodMonth = Number(payment.period.split('-')[1] || month)
  const when =
    due === fridayDateKeyOfBeijingWeek()
      ? `本周五 ${Number(month)}月${Number(day)}日`
      : formatPaydayWithWeekday(beijingWallTime(year, month, day))
  const amountDigits = Number.isInteger(payment.amount) ? 0 : 2
  return `${label} ${periodMonth}月月费已扣 ${formatMoney(payment.amount, payment.currency, { digits: amountDigits })}（约 ${moneyInBase(payment.amount_cny, 'CNY')}），${when}可向公司报销`
}

async function handleFunSpend() {
  if (funSpendAmount.value <= 0) {
    ElMessage.warning('请输入本次花了多少')
    return
  }
  try {
    await ElMessageBox.confirm(
      `本次花销 ${moneyInBase(funSpendAmount.value, 'CNY')}，扣完可支配还剩 ${moneyInBase(remainingAfterSpend.value, 'CNY')}？`,
      '记入花销',
      {
        confirmButtonText: '确认扣除',
        cancelButtonText: '取消',
        type: 'info',
      },
    )
    store.spendFunFund(funSpendAmount.value, funPeriod.value)
    funSpendAmount.value = 0
    ElMessage.success('已从快乐基金扣除')
  } catch (error) {
    if (error instanceof Error && error.message) {
      ElMessage.error(error.message)
    }
  }
}

async function handlePayCharge(chargeId: string) {
  const line = reserve.value.lines.find((item) => item.charge.id === chargeId)
  if (!line) return
  try {
    await ElMessageBox.confirm(
      `从快乐基金扣除 ${line.charge.label} ${formatMoney(line.charge.amount, line.charge.currency)}（约 ${moneyInBase(line.reserveCny, 'CNY')}）？`,
      line.due ? '扣除订阅' : '预扣订阅',
      {
        confirmButtonText: line.due ? '确认扣除' : '确认预扣',
        cancelButtonText: '取消',
        type: line.due ? 'warning' : 'info',
      },
    )
    const result = store.payFunFundCharge(chargeId, funPeriod.value)
    ElMessage.success(
      `已扣 ${moneyInBase(result.amountCny, 'CNY')}，口袋剩 ${moneyInBase(result.remaining, 'CNY')}`,
    )
  } catch (error) {
    if (error instanceof Error && error.message) {
      ElMessage.error(error.message)
    }
  }
}

async function handleMarkReimbursed(paymentId: string) {
  const row = pendingReimbursements.value.find((item) => item.payment.id === paymentId)
  if (!row) return
  try {
    const pocketAfter = round(add(store.funFundPocket, row.payment.amount_cny), 2)
    await ElMessageBox.confirm(
      `公司退回 ${moneyInBase(row.payment.amount_cny, 'CNY')}。退回快乐基金口袋（之后约 ${moneyInBase(pocketAfter, 'CNY')}），并冲掉这笔已记花销。`,
      '报销到账',
      {
        confirmButtonText: '确认到账',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
    const result = store.markFunFundChargeReimbursed(paymentId)
    ElMessage.success(
      `已退回 ${moneyInBase(result.amountCny, 'CNY')}，口袋剩 ${moneyInBase(result.remaining, 'CNY')}`,
    )
  } catch (error) {
    if (error instanceof Error && error.message) {
      ElMessage.error(error.message)
    }
  }
}

function openCarryDialog() {
  carryRule.value = store.settings.rules.carryover_rule
  showCarryDialog.value = true
}

function carryoverSummary(result: {
  toSafety: number
  toSeed: number
  toParents: number
  toTravel: number
  toFun: number
}) {
  const parts: string[] = []
  if (result.toParents > 0) parts.push(`给爸妈 ${moneyInBase(result.toParents, 'CNY')}`)
  if (result.toSafety > 0) parts.push(`安全垫 ${moneyInBase(result.toSafety, 'CNY')}`)
  if (result.toSeed > 0) parts.push(`进攻 ${moneyInBase(result.toSeed, 'CNY')}`)
  if (result.toTravel > 0) parts.push(`旅游 ${moneyInBase(result.toTravel, 'CNY')}`)
  if (result.toFun > 0) parts.push(`留在口袋 ${moneyInBase(result.toFun, 'CNY')}`)
  return parts.join(' / ') || '无剩余'
}

async function handleCarryOver() {
  try {
    const result = store.carryOverFunFund(funPeriod.value, carryRule.value)
    showCarryDialog.value = false
    ElMessage.success(`已结转 ${moneyInBase(result.amount, 'CNY')}（${carryoverSummary(result)}）`)
  } catch (error) {
    if (error instanceof Error && error.message) {
      ElMessage.error(error.message)
    }
  }
}

function countdownText(days: number) {
  if (days > 0) return `还剩 ${days} 天`
  if (days === 0) return '今日扣款'
  return `已过期 ${Math.abs(days)} 天`
}
</script>

<template>
  <div class="panel px-4 py-4 md:px-5">
    <h2 class="text-sm font-semibold">快乐基金口袋</h2>
    <p class="stat-num mt-1 text-2xl font-semibold">
      {{ moneyInBase(store.funFundPocket, 'CNY') }}
    </p>
    <p class="hint">口袋总额 · 含已锁订阅</p>

    <div
      v-for="row in pendingReimbursements"
      :key="row.payment.id"
      class="accent-bar mt-3 border-l-accent pl-3"
    >
      <div class="flex items-start justify-between gap-2">
        <p class="text-xs leading-5 text-ink">
          {{ reimbursementText(row.payment, row.label) }}
        </p>
        <el-button size="small" plain @click="handleMarkReimbursed(row.payment.id)">
          已报销
        </el-button>
      </div>
    </div>

    <div
      v-if="primaryLine"
      class="accent-bar mt-3 pl-3"
      :class="reserve.shortfallCny > 0 || primaryLine.due ? 'border-l-risk' : 'border-l-accent'"
    >
      <div class="flex items-start justify-between gap-2">
        <div>
          <p class="text-sm font-medium">
            已锁 {{ primaryLine.charge.label }}
            <span class="stat-num">
              {{ formatMoney(primaryLine.charge.amount, primaryLine.charge.currency) }}
            </span>
          </p>
          <p class="hint">
            约 {{ moneyInBase(primaryLine.reserveCny, 'CNY') }} ·
            {{ formatPaydayZh(primaryLine.billingDate) }} ·
            {{ countdownText(primaryLine.daysUntil) }}
          </p>
        </div>
        <el-button
          size="small"
          :type="primaryLine.due ? 'warning' : 'default'"
          :disabled="reserve.shortfallCny > 0"
          @click="handlePayCharge(primaryLine.charge.id)"
        >
          {{ primaryLine.due ? '扣除月费' : '预扣月费' }}
        </el-button>
      </div>
      <p v-if="reserve.shortfallCny > 0" class="hint text-risk">
        差额 {{ moneyInBase(reserve.shortfallCny, 'CNY') }} 未补齐，暂不可结转
      </p>
    </div>

    <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
      <div>
        <dt class="stat-label">账期额度</dt>
        <dd class="stat-num mt-0.5 font-semibold">{{ moneyInBase(funAllocated, 'CNY') }}</dd>
      </div>
      <div>
        <dt class="stat-label">已记花销</dt>
        <dd class="stat-num mt-0.5 font-semibold">{{ moneyInBase(funSpentRecorded, 'CNY') }}</dd>
      </div>
      <div>
        <dt class="stat-label">可支配</dt>
        <dd class="stat-num mt-0.5 font-semibold">{{ moneyInBase(spendable, 'CNY') }}</dd>
      </div>
      <div>
        <dt class="stat-label">账期</dt>
        <dd class="stat-num mt-0.5 font-semibold">{{ funPeriod || '—' }}</dd>
      </div>
    </dl>

    <p class="hint mt-2">
      订阅先锁后花，未扣前不可结转；默认去向：{{
        funFundCarryoverLabel(store.settings.rules.carryover_rule)
      }}
    </p>
    <div class="mt-3 space-y-1.5">
      <label class="stat-label block">本次花销（CNY）</label>
      <div class="flex flex-wrap items-center gap-2">
        <AmountInput v-model="funSpendAmount" :min="0" :max="spendable" class="w-44!" />
        <el-button
          type="primary"
          plain
          :disabled="(funSpendAmount || 0) <= 0"
          @click="handleFunSpend"
        >
          记入
        </el-button>
        <el-button
          plain
          :disabled="alreadyCarried || store.funFundPocket <= 0 || reserve.reserveCny > 0"
          @click="openCarryDialog"
        >
          月末结转
        </el-button>
      </div>
      <p
        v-if="(funSpendAmount || 0) > 0"
        class="hint stat-num"
        :class="remainingAfterSpend >= 0 ? '' : 'text-alert'"
      >
        扣后可支配 {{ moneyInBase(remainingAfterSpend, 'CNY') }}
      </p>
    </div>

    <el-dialog v-model="showCarryDialog" title="月末结转" width="92%" class="max-w-md">
      <p class="mb-3 text-sm text-ink-muted">
        将剩余 {{ moneyInBase(store.funFundPocket, 'CNY') }} 转到哪一项？
      </p>
      <el-select v-model="carryRule" placeholder="选择结转去向" class="w-full!">
        <el-option
          v-for="item in FUN_FUND_CARRYOVER_OPTIONS"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        >
          <div class="flex flex-col py-0.5">
            <span>{{ item.label }}</span>
            <span class="text-xs text-ink-muted">{{ item.hint }}</span>
          </div>
        </el-option>
      </el-select>
      <p class="mt-2 text-xs text-ink-muted">
        {{ FUN_FUND_CARRYOVER_OPTIONS.find((item) => item.value === carryRule)?.hint }}
      </p>
      <template #footer>
        <el-button @click="showCarryDialog = false">取消</el-button>
        <el-button type="warning" @click="handleCarryOver">确认结转</el-button>
      </template>
    </el-dialog>
  </div>
</template>
