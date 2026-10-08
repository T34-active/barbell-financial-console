<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import SafetyPadStatus from '@/components/salary/SafetyPadStatus.vue'
import SalaryAllocationTable from '@/components/salary/SalaryAllocationTable.vue'
import PaydayStatusBanner from '@/components/salary/PaydayStatusBanner.vue'
import FunFundPocket from '@/components/salary/FunFundPocket.vue'
import { useFinanceStore } from '@/stores/finance'
import { resolvePaydayStatus } from '@/utils/payday'
import { formatMoney, formatPercent } from '@/utils/currency'
import { mul, round, sub } from '@/utils/decimal'
import type { ExtraIncomeMode, SalaryAllocationRecord } from '@/types/finance'

const store = useFinanceStore()

const extraModes = computed<Array<{ value: ExtraIncomeMode; label: string; hint: string }>>(() => {
  const parentsPct = round(mul(store.salary.settings.ratios.parents, 100), 0)
  return [
    {
      value: 'salary_split',
      label: '按工资比例',
      hint: `含给爸妈 ${parentsPct}%`,
    },
    {
      value: 'skip_parents',
      label: '不给爸妈',
      hint: '安全垫 / 种子 / 快乐 / 旅游按原相对权重拆',
    },
    { value: 'to_safety', label: '全部进安全垫', hint: '余利宝应急金' },
    { value: 'to_seed', label: '全部进美股种子', hint: '高估时进观察仓' },
    { value: 'to_fun', label: '全部进快乐基金', hint: '当月口袋' },
    {
      value: 'to_travel',
      label: '全部进旅游基金',
      hint: '暂存余利宝吃利息，出行时再花',
    },
    { value: 'to_cash', label: '全部进手头现金', hint: '不进余利宝' },
  ]
})

const extraAmount = ref(2500)
const extraNote = ref('保险项目')
const extraMode = ref<ExtraIncomeMode>('skip_parents')
const extraPreview = computed(() =>
  extraMode.value === 'salary_split' || extraMode.value === 'skip_parents'
    ? store.previewExtraIncome(extraAmount.value || 0, extraMode.value)
    : null,
)
const extraHistory = computed(() => store.salary.extra_income_history ?? [])

const salaryInput = ref(10000)
const withdrawAmount = ref(0)
const travelSpendAmount = ref(0)
const showRemitDialog = ref(false)

const payday = computed(() =>
  resolvePaydayStatus({
    paydayDay: store.settings.rules.payday_day ?? 10,
    postponeWeekend: store.settings.rules.payday_postpone_weekend ?? true,
    isPeriodConfirmed: (periodYearMonth) => !!store.getRecordByMonth(periodYearMonth),
  }),
)

/** 账期按名义发薪月归属；周末顺延跨月仍记原月 */
const yearMonth = computed(() => payday.value.periodYearMonth)
const preview = computed(() => store.previewAllocation(salaryInput.value || 0, yearMonth.value))
const existingRecord = computed(() => store.getRecordByMonth(yearMonth.value))
const travelRemainingAfterSpend = computed(() =>
  round(sub(store.travelFundPocket, travelSpendAmount.value || 0), 2),
)

const remitPrices = ref(
  store.accounts.us_stock_pool.map((s) => ({
    id: s.id,
    symbol: s.symbol,
    market_price: s.market_price ?? s.cost_price,
  })),
)
const remitQuoteRefreshing = ref(false)

function syncRemitPricesFromStore() {
  remitPrices.value = store.accounts.us_stock_pool.map((s) => ({
    id: s.id,
    symbol: s.symbol,
    market_price: s.market_price ?? s.cost_price,
  }))
}

function extraModeLabel(mode: ExtraIncomeMode) {
  return extraModes.value.find((item) => item.value === mode)?.label ?? mode
}

function salaryLineAmount(row: unknown, key: SalaryAllocationRecord['lines'][number]['key']) {
  const record = row as SalaryAllocationRecord
  return record.lines.find((line) => line.key === key)?.amount ?? 0
}

async function handleExtraIncome() {
  if ((extraAmount.value || 0) <= 0) {
    ElMessage.warning('请输入有效金额')
    return
  }
  if (!extraNote.value.trim()) {
    ElMessage.warning('请填写来源，例如「保险项目」')
    return
  }
  try {
    const modeText = extraModeLabel(extraMode.value)
    await ElMessageBox.confirm(
      `确认记入额外收入 ${formatMoney(extraAmount.value, 'CNY')}（${extraNote.value.trim()}）？\n去向：${modeText}`,
      '额外收入入账',
      {
        confirmButtonText: '确认入账',
        cancelButtonText: '取消',
        type: 'info',
      },
    )
    store.recordExtraIncome({
      amount: extraAmount.value,
      note: extraNote.value,
      mode: extraMode.value,
    })
    ElMessage.success('额外收入已入账')
  } catch (error) {
    if (error instanceof Error && error.message) {
      ElMessage.error(error.message)
    }
  }
}

async function handleRevokeExtra(id: string) {
  try {
    await ElMessageBox.confirm('撤销这笔额外收入并回滚对应分桶 / 现金？', '撤销额外收入', {
      confirmButtonText: '撤销',
      cancelButtonText: '取消',
      type: 'warning',
    })
    store.revokeExtraIncome(id)
    ElMessage.success('已撤销额外收入')
  } catch {
    /* cancelled */
  }
}

async function handleConfirm() {
  if (!payday.value.canConfirm) {
    ElMessage.warning(
      payday.value.status === 'waiting'
        ? `尚未到发薪日，请等待至 ${payday.value.message}`
        : '本月已入账，无需重复确认',
    )
    return
  }

  if ((salaryInput.value || 0) <= 0) {
    ElMessage.warning('请输入有效工资金额')
    return
  }

  try {
    const isCatchUp = payday.value.status === 'overdue'
    await ElMessageBox.confirm(
      isCatchUp
        ? `补录模式（账期 ${yearMonth.value}）：确认按 ${formatMoney(salaryInput.value, 'CNY')} 入账？\n将按此刻应急备用金余额判定安全垫/进攻比例。\n预期储蓄率 ${formatPercent(preview.value.projectedSavingsRate)}`
        : `今日发薪日（账期 ${yearMonth.value}）：确认按 ${formatMoney(salaryInput.value, 'CNY')} 入账？\n安全垫是否满额以确认瞬间余额为准。\n预期储蓄率 ${formatPercent(preview.value.projectedSavingsRate)}`,
      isCatchUp ? '补录本月入账' : '确认入账',
      {
        confirmButtonText: isCatchUp ? '确认补录' : '确认',
        cancelButtonText: '取消',
        type: isCatchUp ? 'warning' : 'info',
      },
    )

    store.confirmAllocation(salaryInput.value, yearMonth.value)
    ElMessage.success(isCatchUp ? '本月工资已补录入账' : '本月工资分配已入账')
  } catch (error) {
    if (error instanceof Error && error.message) {
      ElMessage.error(error.message)
    }
  }
}

async function handleRevoke() {
  if (!existingRecord.value) return
  try {
    await ElMessageBox.confirm(
      `撤销 ${yearMonth.value} 的入账并回滚余利宝分桶与快乐基金口袋？`,
      '撤销本月',
      {
        confirmButtonText: '撤销',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
    store.revokeAllocation(yearMonth.value)
    ElMessage.success('已撤销本月入账')
  } catch {
    /* cancelled */
  }
}

async function handleWithdraw() {
  if (withdrawAmount.value <= 0) {
    ElMessage.warning('请输入取用金额')
    return
  }
  try {
    await ElMessageBox.confirm(
      `从应急备用金取用 ${formatMoney(withdrawAmount.value, 'CNY')}？若跌破目标，下月将自动回溯补仓。`,
      '应急取用',
      {
        confirmButtonText: '确认取用',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
    store.withdrawEmergency(withdrawAmount.value)
    withdrawAmount.value = 0
    ElMessage.success('已从应急备用金扣除')
  } catch (error) {
    if (error instanceof Error && error.message) {
      ElMessage.error(error.message)
    }
  }
}

async function openRemitDialog() {
  if (store.usSeedParking <= 0) {
    ElMessage.warning('美股种子暂存余额为 0')
    return
  }
  syncRemitPricesFromStore()
  showRemitDialog.value = true
  await refreshRemitQuotes()
}

async function refreshRemitQuotes() {
  remitQuoteRefreshing.value = true
  try {
    const result = await store.refreshStockMarketPrices()
    syncRemitPricesFromStore()
    const msg = `已拉取 ${result.updated} 只现价`
    if (result.errors.length) {
      ElMessage.warning(`${msg}；部分失败：${result.errors.join('；')}`)
    } else {
      ElMessage.success(msg)
    }
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  } finally {
    remitQuoteRefreshing.value = false
  }
}

async function confirmRemit() {
  try {
    syncRemitPricesFromStore()
    const amount = store.markUsSeedRemitted(remitPrices.value)
    showRemitDialog.value = false
    ElMessage.success(`已标记汇出 ${formatMoney(amount, 'CNY')}，市价已写入`)
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  }
}

async function handleTravelSpend() {
  if (travelSpendAmount.value <= 0) {
    ElMessage.warning('请输入本次花了多少')
    return
  }
  try {
    await ElMessageBox.confirm(
      `本次花销 ${formatMoney(travelSpendAmount.value, 'CNY')}，扣完剩余 ${formatMoney(travelRemainingAfterSpend.value, 'CNY')}？`,
      '记入旅游花销',
      {
        confirmButtonText: '确认扣除',
        cancelButtonText: '取消',
        type: 'info',
      },
    )
    store.spendTravelFund(travelSpendAmount.value)
    travelSpendAmount.value = 0
    ElMessage.success('已从旅游基金扣除')
  } catch (error) {
    if (error instanceof Error && error.message) {
      ElMessage.error(error.message)
    }
  }
}

async function handleReleaseObservation() {
  try {
    await ElMessageBox.confirm(
      `将观察仓 ${formatMoney(store.cashObservation, 'CNY')} 释放至美股种子？`,
      '释放观察仓',
      { confirmButtonText: '释放', cancelButtonText: '取消', type: 'info' },
    )
    const amount = store.releaseObservationToSeed()
    ElMessage.success(`已释放 ${formatMoney(amount, 'CNY')} 至美股种子`)
  } catch (error) {
    if (error instanceof Error && error.message) {
      ElMessage.error(error.message)
    }
  }
}
</script>

<template>
  <div class="space-y-5 md:space-y-6">
    <div class="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 class="section-title">工资分配</h1>
        <p class="mt-1 text-sm text-ink-muted">
          百分比拆分 · 安全垫保险丝 · PE 观察仓 · {{ yearMonth }}
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <p
          v-if="store.isPeGuardActive"
          class="rounded-lg bg-risk-soft px-3 py-1.5 text-xs text-risk"
        >
          高估保险丝开启 · PE {{ store.settings.rules.nasdaq_pe_current }}
        </p>
        <p v-if="existingRecord" class="rounded-lg bg-accent-soft px-3 py-1.5 text-xs text-accent">
          本月已入账 · {{ formatMoney(existingRecord.salary, 'CNY') }}
        </p>
      </div>
    </div>

    <PaydayStatusBanner :payday="payday" />
    <SafetyPadStatus />

    <section class="panel space-y-4 px-4 py-5 md:px-6">
      <div>
        <h2 class="text-base font-semibold">额外收入</h2>
        <p class="mt-1 text-sm text-ink-muted">
          兼职、项目费、红包等，不走发薪日。例如朋友叫你做保险项目给 2,500。
        </p>
      </div>
      <div class="grid gap-4 md:grid-cols-2">
        <div>
          <label class="mb-2 block text-sm text-ink-muted">金额（CNY）</label>
          <AmountInput v-model="extraAmount" :min="0" class="w-full! max-w-xs" />
        </div>
        <div>
          <label class="mb-2 block text-sm text-ink-muted">来源备注</label>
          <el-input
            v-model="extraNote"
            placeholder="例如：保险项目"
            maxlength="40"
            show-word-limit
          />
        </div>
      </div>
      <div>
        <label class="mb-2 block text-sm text-ink-muted">入账去向</label>
        <el-select v-model="extraMode" placeholder="选择入账去向" class="w-full! max-w-md">
          <el-option
            v-for="item in extraModes"
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
        <p class="mt-1 text-xs text-ink-muted">
          {{ extraModes.find((item) => item.value === extraMode)?.hint }}
        </p>
      </div>
      <el-button type="primary" @click="handleExtraIncome">记入额外收入</el-button>
      <SalaryAllocationTable v-if="extraPreview && extraAmount > 0" :preview="extraPreview" />
      <div v-if="extraHistory.length" class="space-y-2 border-t border-surface-line pt-3">
        <p class="text-sm font-medium">已记额外收入</p>
        <el-table :data="extraHistory" stripe size="small" class="w-full">
          <el-table-column prop="year_month" label="账期" min-width="90" />
          <el-table-column prop="note" label="来源" min-width="120" show-overflow-tooltip />
          <el-table-column label="金额" min-width="110" align="right">
            <template #default="{ row }">
              {{ formatMoney(row.amount, 'CNY') }}
            </template>
          </el-table-column>
          <el-table-column label="去向" min-width="110">
            <template #default="{ row }">
              {{ extraModeLabel(row.mode) }}
            </template>
          </el-table-column>
          <el-table-column label="操作" min-width="80" fixed="right">
            <template #default="{ row }">
              <el-button link type="danger" size="small" @click="handleRevokeExtra(row.id)">
                撤销
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </section>

    <section class="panel grid gap-4 px-4 py-5 md:grid-cols-[1fr_auto] md:items-end md:px-6">
      <div>
        <label class="mb-2 block text-sm text-ink-muted">本月工资（CNY）</label>
        <AmountInput
          v-model="salaryInput"
          :min="0"
          class="w-full! max-w-xs"
          :disabled="payday.status === 'waiting'"
        />
        <p class="mt-2 text-xs text-ink-muted">
          预期储蓄率
          <span class="font-medium text-safe">
            {{ formatPercent(preview.projectedSavingsRate) }}
          </span>
          · 快乐基金不进净资产，Cursor 60 USD 先锁再花；旅游基金暂存余利宝吃利息
        </p>
        <p v-if="payday.status === 'overdue'" class="mt-2 text-xs font-medium text-risk">
          当前为补录模式：发薪日已过，请尽快确认入账。
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <el-button
          :type="payday.buttonTone === 'warning' ? 'warning' : 'primary'"
          :disabled="!payday.canConfirm"
          :class="payday.status === 'payday_today' ? 'shadow-md ring-2 ring-safe/30' : ''"
          @click="handleConfirm"
        >
          {{ payday.buttonLabel }}
        </el-button>
        <el-button v-if="existingRecord" type="danger" plain @click="handleRevoke">
          撤销本月
        </el-button>
      </div>
    </section>

    <SalaryAllocationTable :preview="preview" :deferred="payday.allocationDeferred" />

    <section class="grid gap-4 lg:grid-cols-3">
      <FunFundPocket />

      <div class="panel px-4 py-5 md:px-5">
        <h2 class="text-base font-semibold">旅游基金暂存</h2>
        <p class="stat-num mt-2 text-2xl font-semibold">
          {{ formatMoney(store.travelFundPocket, 'CNY') }}
        </p>
        <p class="mt-1 text-xs text-ink-muted">当前在余利宝</p>
        <p class="mt-2 text-xs text-ink-muted">先暂存余利宝吃利息，出行时再花。不计入储蓄率。</p>
        <div class="mt-4 space-y-2">
          <label class="block text-sm text-ink-muted">本次花了（CNY）</label>
          <div class="flex flex-wrap items-center gap-2">
            <AmountInput
              v-model="travelSpendAmount"
              :min="0"
              :max="store.travelFundPocket"
              class="w-44!"
            />
            <el-button
              type="primary"
              plain
              :disabled="(travelSpendAmount || 0) <= 0"
              @click="handleTravelSpend"
            >
              记入花销
            </el-button>
          </div>
          <p
            v-if="(travelSpendAmount || 0) > 0"
            class="text-xs"
            :class="travelRemainingAfterSpend >= 0 ? 'text-ink-muted' : 'text-alert'"
          >
            扣完还剩
            {{ formatMoney(travelRemainingAfterSpend, 'CNY') }}
          </p>
        </div>
      </div>

      <div class="panel px-4 py-5 md:px-5">
        <h2 class="text-base font-semibold">现金观察仓</h2>
        <p class="stat-num mt-2 text-2xl font-semibold">
          {{ formatMoney(store.cashObservation, 'CNY') }}
        </p>
        <p class="mt-2 text-xs text-ink-muted">
          纳指高估时进攻份额暂扣于此（仍属储蓄/安全现金），PE 回落后再释放到美股种子。
        </p>
        <el-button
          class="mt-4"
          type="primary"
          plain
          :disabled="store.cashObservation <= 0 || store.isPeGuardActive"
          @click="handleReleaseObservation"
        >
          释放至美股种子
        </el-button>
      </div>
    </section>

    <section class="grid gap-4 lg:grid-cols-2">
      <div class="panel px-4 py-5 md:px-5">
        <h2 class="text-base font-semibold">美股种子暂存</h2>
        <p class="stat-num mt-2 text-2xl font-semibold">
          {{ formatMoney(store.usSeedParking, 'CNY') }}
        </p>
        <p class="mt-2 text-xs text-ink-muted">
          汇出周期 {{ store.salary.settings.us_seed_remit_months }} 个月 · 已计入
          {{ store.monthsSinceLastRemit }} 个月 · 还需 {{ store.monthsUntilRemit }} 个月
        </p>
        <el-button class="mt-4" plain @click="openRemitDialog">
          标记已汇出（强制刷新市价）
        </el-button>
      </div>

      <div class="panel px-4 py-5 md:px-5">
        <h2 class="text-base font-semibold">应急取用</h2>
        <p class="mt-1 text-xs text-ink-muted">突发支出从安全垫扣除；跌破目标后自动回溯补仓。</p>
        <div class="mt-4 flex flex-wrap items-center gap-2">
          <AmountInput
            v-model="withdrawAmount"
            :min="0"
            :max="store.emergencyReserve"
            class="w-44!"
          />
          <el-button type="warning" plain @click="handleWithdraw">确认取用</el-button>
        </div>
      </div>
    </section>

    <section class="panel px-4 py-5 md:px-5">
      <h2 class="text-base font-semibold">入账历史</h2>
      <el-table
        :data="store.salary.history"
        stripe
        size="small"
        empty-text="暂无记录。确认入账后将显示在这里。"
        class="mt-3 w-full"
      >
        <el-table-column prop="year_month" label="账期" min-width="90" />
        <el-table-column label="工资" min-width="110" align="right">
          <template #default="{ row }">
            {{ formatMoney(row.salary, 'CNY') }}
          </template>
        </el-table-column>
        <el-table-column label="爸妈" min-width="100" align="right">
          <template #default="{ row }">
            {{ formatMoney(salaryLineAmount(row, 'parents'), 'CNY') }}
          </template>
        </el-table-column>
        <el-table-column label="安全垫" min-width="100" align="right">
          <template #default="{ row }">
            {{ formatMoney(salaryLineAmount(row, 'safety_pad'), 'CNY') }}
          </template>
        </el-table-column>
        <el-table-column label="进攻" min-width="100" align="right">
          <template #default="{ row }">
            {{ formatMoney(salaryLineAmount(row, 'us_seed'), 'CNY') }}
          </template>
        </el-table-column>
        <el-table-column label="快乐" min-width="100" align="right">
          <template #default="{ row }">
            {{ formatMoney(salaryLineAmount(row, 'fun_fund'), 'CNY') }}
          </template>
        </el-table-column>
        <el-table-column label="旅游" min-width="100" align="right">
          <template #default="{ row }">
            {{ formatMoney(salaryLineAmount(row, 'travel_fund'), 'CNY') }}
          </template>
        </el-table-column>
        <el-table-column label="已花" min-width="90" align="right">
          <template #default="{ row }">
            {{ formatMoney(row.fun_fund_spent, 'CNY') }}
          </template>
        </el-table-column>
        <el-table-column label="状态" min-width="160">
          <template #default="{ row }">
            <div class="flex flex-wrap gap-1">
              <span
                class="rounded px-2 py-0.5 text-xs"
                :class="
                  row.mode === 'divert_to_seed'
                    ? 'bg-safe-soft text-safe'
                    : 'bg-risk-soft text-risk'
                "
              >
                {{ row.mode === 'divert_to_seed' ? '转美股种子' : '补安全垫' }}
              </span>
              <span
                v-if="row.pe_guard_active"
                class="rounded bg-risk-soft px-2 py-0.5 text-xs text-risk"
              >
                观察仓
              </span>
              <span
                v-if="row.fun_fund_carried"
                class="rounded bg-surface-tint px-2 py-0.5 text-xs text-ink-muted"
              >
                快乐已结转
              </span>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <el-dialog v-model="showRemitDialog" title="标记美股种子已汇出" width="92%" class="max-w-lg">
      <p class="mb-4 text-sm text-ink-muted">
        汇出前自动拉取现价（不可手改），避免静默侵蚀总览估值。
      </p>
      <div
        v-for="row in remitPrices"
        :key="row.id"
        class="mb-3 flex items-center justify-between gap-3"
      >
        <span class="w-16 font-mono text-accent">{{ row.symbol }}</span>
        <span class="stat-num font-semibold">
          {{ formatMoney(row.market_price, 'USD') }}
        </span>
      </div>
      <template #footer>
        <el-button @click="showRemitDialog = false">取消</el-button>
        <el-button :loading="remitQuoteRefreshing" @click="refreshRemitQuotes">
          重新拉取现价
        </el-button>
        <el-button type="primary" :disabled="remitQuoteRefreshing" @click="confirmRemit">
          确认汇出
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>
