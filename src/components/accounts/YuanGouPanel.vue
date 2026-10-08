<script setup lang="ts">
import dayjs from 'dayjs'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useFinanceStore } from '@/stores/finance'
import { formatMoney, formatPercent } from '@/utils/currency'
import { formatBeijingHourLabel } from '@/utils/datetime'
import { HTX_HOURS_PER_YEAR, htxHourlyRate } from '@/utils/htx-rebalance'
import { quoteToneClass } from '@/composables/useQuoteColor'
import { currentYearMonth, shiftYearMonth } from '@/utils/salary-allocation'
import type { YuanGouOutcome, YuanGouRecord } from '@/types/finance'
import FormulaTooltip from '@/components/accounts/FormulaTooltip.vue'
import HtxDailyYieldDialog from '@/components/accounts/HtxDailyYieldDialog.vue'

const store = useFinanceStore()
const now = useNow({ interval: 1000 })
const status = computed(() => store.htxYieldAt(now.value))
const htxHourlyRateText = computed(() => htxHourlyRate(status.value.rate).toFixed(9))
const yieldDialogVisible = ref(false)

function todayKey() {
  return dayjs().format('YYYY-MM-DD')
}

function lastDayOfMonth(monthKey: string) {
  return dayjs(`${monthKey}-01`).endOf('month').format('YYYY-MM-DD')
}

function defaultCheckInForMonth(monthKey: string) {
  if (monthKey === currentYearMonth()) return todayKey()
  return lastDayOfMonth(monthKey)
}

const selectedMonthKey = ref(currentYearMonth())
const checkInDate = ref(todayKey())
const htxDraft = ref(store.htxEarnUsdt)
const okxDraft = ref(store.okxEarnUsdt)

watch(
  () => store.htxEarnUsdt,
  (v) => {
    htxDraft.value = v
  },
)
watch(
  () => store.okxEarnUsdt,
  (v) => {
    okxDraft.value = v
  },
)

const period = computed(() => store.yuanGouStatsForMonth(selectedMonthKey.value))
const tableScope = ref<'month' | 'total'>('month')
const canGoNextMonth = computed(() => selectedMonthKey.value < currentYearMonth())

const isBackfill = computed(() => checkInDate.value !== todayKey())
const dateAlreadyRecorded = computed(() =>
  store.yuanGou.history.some((item) => item.date === checkInDate.value),
)

const yuanGouTable = computed(() => {
  const seen = new Set<string>()
  const prefix = selectedMonthKey.value
  return store.yuanGou.history.filter((item) => {
    if (tableScope.value === 'month' && !item.date.startsWith(prefix)) {
      return false
    }
    if (seen.has(item.date)) return false
    seen.add(item.date)
    return true
  })
})

const tableStats = computed(() =>
  tableScope.value === 'month' ? period.value.month : period.value.total,
)

function shiftSelectedMonth(delta: number) {
  const next = shiftYearMonth(selectedMonthKey.value, delta)
  if (delta > 0 && next > currentYearMonth()) return
  selectedMonthKey.value = next
  checkInDate.value = defaultCheckInForMonth(next)
  tableScope.value = 'month'
}

function disableFutureDate(d: Date) {
  if (d.getTime() > Date.now()) return true
  const key = currentYearMonth(d)
  return key !== selectedMonthKey.value
}

function asYuanGouRow(row: unknown): YuanGouRecord {
  return row as YuanGouRecord
}

function outcomeOf(row: unknown): YuanGouOutcome {
  const item = asYuanGouRow(row)
  if (!item.participated || item.cost_cny <= 0) return 'none'
  return 'hit'
}

function statusLabel(row: unknown) {
  return outcomeOf(row) === 'hit' ? '买了' : '未购买'
}

function noteLabel(row: unknown) {
  const item = asYuanGouRow(row)
  if (outcomeOf(row) === 'none') return '未购买'
  return `支付宝 ¥${item.cost_cny || 1} → +${item.got_usdt || 1}U`
}

function formatRecordTime(iso: string) {
  if (!iso) return '—'
  const d = dayjs(iso)
  if (!d.isValid()) return iso.slice(0, 16)
  return d.format('YYYY-MM-DD HH:mm')
}

function fundedLabel(from: YuanGouRecord['funded_from'] | string) {
  if (from === 'none') return '—'
  if (from === 'alipay') return '支付宝'
  if (from === 'cash_rmb') return '支付宝'
  if (from === 'htx_earn') return '支付宝'
  return '支付宝'
}

async function checkIn(outcome: YuanGouOutcome) {
  try {
    const cost = period.value.dailyCostCny
    const reward = period.value.rewardUsdt
    const verb = isBackfill.value ? '补录' : '打卡'
    const confirmText =
      outcome === 'none'
        ? `${verb}「未购买」：当天没买，不计花费？`
        : `${verb}「买了」：支付宝付 ¥${cost}，HTX +${reward}U？`
    await ElMessageBox.confirm(confirmText, '一元购确认', {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      type: outcome === 'hit' ? 'success' : 'info',
    })

    const result = store.recordYuanGou({
      date: checkInDate.value,
      outcome,
    })
    let msg =
      result.outcome === 'none'
        ? `${result.isBackfill ? '已补录' : '已打卡'} ${result.date}：未购买`
        : `${result.isBackfill ? '已补录' : '已打卡'} ${result.date}：支付宝 ¥${result.costCny} → +${result.gotUsdt}U`
    if (result.overflow?.executed) {
      msg += ` · 已溢流 ${result.overflow.transferAmount} U → OKX`
    } else if (result.overflow?.needsAction && !result.overflow.canExecute) {
      msg += ` · ${result.overflow.reason}`
    }
    ElMessage.success(msg)
  } catch (error) {
    if (error instanceof Error && error.message) {
      ElMessage.error(error.message)
    }
  }
}

async function reviseRow(row: unknown, outcome: YuanGouOutcome) {
  const item = asYuanGouRow(row)
  const label = outcome === 'none' ? '未购买' : '买了'
  try {
    await ElMessageBox.confirm(
      `将 ${item.date} 改为「${label}」？${
        outcome === 'none' ? '将回滚误记的 HTX +U，且不计花费。' : '将按支付宝购买补记 HTX +U。'
      }`,
      '修正打卡',
      { confirmButtonText: '确认修正', cancelButtonText: '取消', type: 'warning' },
    )
    const result = store.reviseYuanGou(item.date, outcome)
    ElMessage.success(
      result.changed ? `${item.date} 已改为「${label}」` : `${item.date} 已是「${label}」`,
    )
  } catch (error) {
    if (error instanceof Error && error.message) {
      ElMessage.error(error.message)
    }
  }
}

function saveBalances() {
  try {
    store.updateHtxEarnAmount(htxDraft.value)
    store.updateOkxEarnAmount(okxDraft.value)
    ElMessage.success('HTX / OKX 余额已更新')
    if (store.htxYieldStatus.plan.canExecute) {
      ElMessage.warning('HTX 已触达降息线，请执行溢流转存')
    }
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  }
}

async function handleOverflow() {
  try {
    const plan = store.htxYieldStatus.plan
    if (!plan.needsAction) {
      ElMessage.info(plan.reason)
      return
    }
    if (!plan.canExecute) {
      ElMessage.warning(plan.reason)
      store.rebalanceHtxOverflow(false)
      return
    }
    await ElMessageBox.confirm(
      `将溢出 ${plan.transferAmount} USDT 转至 OKX，HTX 锁定为 ${plan.htxAfter} U？`,
      '执行溢流转存',
      { confirmButtonText: '确认转存', cancelButtonText: '取消', type: 'warning' },
    )
    const result = store.rebalanceHtxOverflow()
    if (result.executed) {
      ElMessage.success(`已转存 ${result.transferAmount} USDT → OKX`)
    } else {
      ElMessage.warning(result.reason)
    }
  } catch (error) {
    if (error instanceof Error && error.message) {
      ElMessage.error(error.message)
    }
  }
}
</script>

<template>
  <section class="panel space-y-4 px-4 py-5 md:px-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-base font-semibold">加密赌注池 · HTX / OKX</h2>
        <p class="mt-1 text-xs text-ink-muted">
          一元购：支付宝 ¥{{ period.dailyCostCny }} → {{ period.rewardUsdt }}U · 仅「买了 /
          未购买」两态
        </p>
      </div>
      <p
        class="rounded-lg px-2 py-1 text-xs font-medium"
        :class="status.highYield ? 'bg-safe-soft text-safe' : 'bg-alert-soft text-alert'"
      >
        {{ status.highYield ? '🟢' : '🔴' }} {{ status.label }}
      </p>
    </div>

    <div class="grid gap-3 sm:grid-cols-3">
      <div class="rounded-lg bg-surface px-3 py-3">
        <p class="text-xs text-ink-muted">HTX 赚币（持仓）</p>
        <p class="stat-num mt-1 text-xl font-semibold">
          {{ formatMoney(store.htxEarnUsdt, 'USDT') }}
        </p>
        <p class="mt-1 text-xs text-safe">当前年化 {{ formatPercent(status.rate) }} · 收益复投</p>
        <div class="mt-2 grid grid-cols-2 gap-2">
          <div>
            <p class="text-xs text-ink-muted">
              <FormulaTooltip>
                每小时收益
                <template #content>
                  <p>时利率 = 年化 ÷ {{ HTX_HOURS_PER_YEAR }}，先四舍五入到 9 位</p>
                  <p>每小时收益 = ROUND_UP(本金 × 时利率, 8 位)</p>
                  <p class="font-mono">
                    {{ formatPercent(status.rate, 2) }} ÷ {{ HTX_HOURS_PER_YEAR }} =
                    {{ htxHourlyRateText }}
                  </p>
                  <p class="font-mono">
                    ROUND_UP({{ formatMoney(store.htxEarnUsdt, 'USDT') }} × {{ htxHourlyRateText }},
                    8) =
                    {{ formatMoney(status.hourly, 'USDT', { digits: 8 }) }}
                  </p>
                </template>
              </FormulaTooltip>
            </p>
            <p class="stat-num mt-0.5 text-sm font-semibold text-safe">
              {{ formatMoney(status.hourly, 'USDT', { digits: 8 }) }}
            </p>
          </div>
          <div>
            <p class="text-xs text-ink-muted">
              <FormulaTooltip>
                今日收益
                <template #content>
                  <p>北京时间当日 00:00–24:00 共 24 个整点，到账复投后的小时收益合计</p>
                  <p class="font-mono">
                    合计 {{ formatMoney(status.daily, 'USDT', { digits: 8 }) }}
                    · 已到账
                    {{ formatMoney(status.creditedToday, 'USDT', { digits: 8 }) }}
                  </p>
                  <p>点击数字可看 24 小时明细</p>
                </template>
              </FormulaTooltip>
            </p>
            <button
              type="button"
              class="cursor-pointer rounded-md text-left hover:bg-surface-raised/60"
              @click="yieldDialogVisible = true"
            >
              <p
                class="stat-num mt-0.5 text-sm font-semibold text-safe underline decoration-dotted underline-offset-2"
              >
                {{ formatMoney(status.daily, 'USDT', { digits: 8 }) }}
              </p>
              <p class="mt-0.5 text-[11px] text-ink-muted">
                {{
                  `已到账 ${formatMoney(status.creditedToday, 'USDT', { digits: 8 })} · 点击查看`
                }}
              </p>
            </button>
          </div>
        </div>
        <p class="mt-1 text-[11px] text-ink-muted">
          <template v-if="status.interestStartAt && status.firstPayoutAt">
            起息 {{ formatBeijingHourLabel(status.interestStartAt) }}
            ·
            {{ status.waitingFirstPayout ? '初次发放' : '下一笔' }}
            {{
              formatBeijingHourLabel(
                status.waitingFirstPayout ? status.firstPayoutAt : status.nextPayoutAt,
              )
            }}
          </template>
          <template v-else>下一笔发放 {{ formatBeijingHourLabel(status.nextPayoutAt) }}</template>
        </p>
      </div>
      <div class="rounded-lg bg-surface px-3 py-3">
        <p class="text-xs text-ink-muted">OKX 活期（持仓）</p>
        <p class="stat-num mt-1 text-xl font-semibold">
          {{ formatMoney(store.okxEarnUsdt, 'USDT') }}
        </p>
        <p class="mt-1 text-xs text-ink-muted">
          年化
          {{ formatPercent(store.settings.rules.okx_yield_rate) }}
        </p>
      </div>
      <div class="rounded-lg bg-surface px-3 py-3">
        <p class="text-xs text-ink-muted">持仓合计</p>
        <p class="stat-num mt-1 text-xl font-semibold">
          {{ formatMoney(period.holdingsUsdt, 'USDT') }}
        </p>
        <p class="mt-1 text-xs text-ink-muted">
          支付宝 ¥{{ period.dailyCostCny }} → {{ period.rewardUsdt }}U
        </p>
      </div>
    </div>

    <div class="grid gap-3 md:grid-cols-2">
      <div class="rounded-lg border border-accent/25 bg-accent-soft/30 px-3 py-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-sm font-semibold text-accent">
            {{ period.isCurrentMonth ? '本月' : '账期' }} · {{ period.monthLabel }}（{{
              period.monthKey
            }}）
          </p>
          <div class="flex items-center gap-1">
            <el-button size="small" plain @click="shiftSelectedMonth(-1)">上月</el-button>
            <el-button
              size="small"
              plain
              :disabled="!canGoNextMonth"
              @click="shiftSelectedMonth(1)"
            >
              下月
            </el-button>
          </div>
        </div>
        <p v-if="!period.isCurrentMonth" class="mt-1 text-xs text-ink-muted">
          补录模式：日期限定在 {{ period.monthKey }}，打卡会写入该月
        </p>
        <div class="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div>
            <p class="text-ink-muted">
              <FormulaTooltip>
                花费
                <template #content>
                  <p>花费 = Σ 当天「买了」的支付宝金额</p>
                </template>
              </FormulaTooltip>
            </p>
            <p class="stat-num mt-0.5 font-semibold">
              {{ formatMoney(period.month.spendCny, 'CNY') }}
            </p>
          </div>
          <div>
            <p class="text-ink-muted">
              <FormulaTooltip>
                买到 USDT
                <template #content>
                  <p>买到 USDT = Σ 当天「买了」到账的 U</p>
                </template>
              </FormulaTooltip>
            </p>
            <p class="stat-num mt-0.5 font-semibold">
              {{ formatMoney(period.month.gotUsdt, 'USDT') }}
            </p>
          </div>
          <div>
            <p class="text-ink-muted">
              <FormulaTooltip>
                净盈亏（折合 CNY）
                <template #content>
                  <p>净盈亏 = 买到 USDT 按汇率折合 CNY − 花费</p>
                  <p class="font-mono">
                    {{ formatMoney(period.month.gotUsdt, 'USDT') }} 折合 CNY −
                    {{ formatMoney(period.month.spendCny, 'CNY') }} =
                    {{ formatMoney(period.month.netCny, 'CNY') }}
                  </p>
                </template>
              </FormulaTooltip>
            </p>
            <p class="stat-num mt-0.5 font-semibold" :class="quoteToneClass(period.month.netCny)">
              {{ formatMoney(period.month.netCny, 'CNY') }}
            </p>
          </div>
          <div>
            <p class="text-ink-muted">买了 / 未购买</p>
            <p class="stat-num mt-0.5 font-semibold">
              {{ period.month.hitDays }} / {{ period.month.noneDays }}
            </p>
          </div>
        </div>
      </div>

      <div class="rounded-lg border border-surface-line bg-surface px-3 py-3">
        <p class="text-sm font-semibold">累计总和</p>
        <div class="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div>
            <p class="text-ink-muted">
              <FormulaTooltip>
                花费
                <template #content>
                  <p>花费 = Σ 当天「买了」的支付宝金额</p>
                </template>
              </FormulaTooltip>
            </p>
            <p class="stat-num mt-0.5 font-semibold">
              {{ formatMoney(period.total.spendCny, 'CNY') }}
            </p>
          </div>
          <div>
            <p class="text-ink-muted">
              <FormulaTooltip>
                买到 USDT
                <template #content>
                  <p>买到 USDT = Σ 当天「买了」到账的 U</p>
                </template>
              </FormulaTooltip>
            </p>
            <p class="stat-num mt-0.5 font-semibold">
              {{ formatMoney(period.total.gotUsdt, 'USDT') }}
            </p>
          </div>
          <div>
            <p class="text-ink-muted">
              <FormulaTooltip>
                净盈亏（折合 CNY）
                <template #content>
                  <p>净盈亏 = 买到 USDT 按汇率折合 CNY − 花费</p>
                  <p class="font-mono">
                    {{ formatMoney(period.total.gotUsdt, 'USDT') }} 折合 CNY −
                    {{ formatMoney(period.total.spendCny, 'CNY') }} =
                    {{ formatMoney(period.total.netCny, 'CNY') }}
                  </p>
                </template>
              </FormulaTooltip>
            </p>
            <p class="stat-num mt-0.5 font-semibold" :class="quoteToneClass(period.total.netCny)">
              {{ formatMoney(period.total.netCny, 'CNY') }}
            </p>
          </div>
          <div>
            <p class="text-ink-muted">买了 / 未购买</p>
            <p class="stat-num mt-0.5 font-semibold">
              {{ period.total.hitDays }} / {{ period.total.noneDays }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <div class="flex flex-wrap items-end gap-2">
      <div>
        <label class="mb-1 block text-xs text-ink-muted">HTX 余额</label>
        <AmountInput v-model="htxDraft" :min="0" class="w-36!" />
      </div>
      <div>
        <label class="mb-1 block text-xs text-ink-muted">OKX 余额</label>
        <AmountInput v-model="okxDraft" :min="0" class="w-36!" />
      </div>
      <el-button plain @click="saveBalances">保存余额</el-button>
      <el-button type="warning" :disabled="!status.plan.needsAction" @click="handleOverflow">
        执行溢流转存
      </el-button>
    </div>

    <p v-if="status.plan.needsAction" class="text-xs text-ink-muted">
      {{ status.plan.reason }}
    </p>

    <div class="space-y-3 border-t border-surface-line pt-3">
      <div>
        <label class="mb-1 block text-xs text-ink-muted">打卡 / 补录日期</label>
        <el-date-picker
          v-model="checkInDate"
          type="date"
          value-format="YYYY-MM-DD"
          :disabled-date="disableFutureDate"
          placeholder="选择日期"
          class="w-44!"
        />
        <p class="mt-1 text-xs text-ink-muted">
          每日一次：买了 = 支付宝 ¥{{ period.dailyCostCny }}→+{{ period.rewardUsdt }}U；未购买 =
          不计花费
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <span
          v-if="dateAlreadyRecorded"
          class="rounded-lg bg-safe-soft px-2 py-1 text-xs text-safe"
        >
          {{ checkInDate }} 已打卡
        </span>
        <span v-else class="rounded-lg bg-risk-soft px-2 py-1 text-xs text-risk">
          {{ isBackfill ? '待补录' : '今日未打卡' }} · {{ checkInDate }}
        </span>

        <el-button :disabled="dateAlreadyRecorded" @click="checkIn('none')">
          {{ isBackfill ? '补录：未购买' : '未购买' }}
        </el-button>
        <el-button type="primary" :disabled="dateAlreadyRecorded" @click="checkIn('hit')">
          {{ isBackfill ? '补录：买了' : '买了（支付宝¥1→+1U）' }}
        </el-button>
      </div>

      <div class="space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-xs font-medium text-ink">一元购记录 · 最近打卡</p>
          <div class="flex flex-wrap items-center gap-2">
            <el-radio-group v-model="tableScope" size="small">
              <el-radio-button value="month">
                {{ period.monthKey }}（{{ period.monthLabel }}）
              </el-radio-button>
              <el-radio-button value="total">累计总和</el-radio-button>
            </el-radio-group>
            <p class="text-xs text-ink-muted">
              {{ tableScope === 'month' ? period.monthKey : '全部' }}
              {{ yuanGouTable.length }} 天 · 花费 {{ formatMoney(tableStats.spendCny, 'CNY') }} ·
              买到
              {{ formatMoney(tableStats.gotUsdt, 'USDT') }}
            </p>
          </div>
        </div>
        <el-table
          :data="yuanGouTable"
          stripe
          size="small"
          empty-text="暂无打卡记录"
          max-height="360"
          class="w-full"
        >
          <el-table-column prop="date" label="日期" min-width="110" sortable />
          <el-table-column label="状态" min-width="96">
            <template #default="{ row }">
              <span :class="outcomeOf(row) === 'hit' ? 'text-safe' : 'text-ink-muted'">
                {{ statusLabel(row) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="花费" min-width="80" align="right">
            <template #default="{ row }">
              {{ outcomeOf(row) === 'none' ? '—' : `¥${asYuanGouRow(row).cost_cny}` }}
            </template>
          </el-table-column>
          <el-table-column label="到账" min-width="80" align="right">
            <template #default="{ row }">
              {{ outcomeOf(row) === 'none' ? '—' : `${asYuanGouRow(row).got_usdt} U` }}
            </template>
          </el-table-column>
          <el-table-column label="扣款来源" min-width="96">
            <template #default="{ row }">
              {{ outcomeOf(row) === 'none' ? '—' : fundedLabel(asYuanGouRow(row).funded_from) }}
            </template>
          </el-table-column>
          <el-table-column label="登记时间" min-width="140">
            <template #default="{ row }">
              {{ formatRecordTime(asYuanGouRow(row).created_at) }}
            </template>
          </el-table-column>
          <el-table-column label="备注" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">
              {{
                noteLabel(row) +
                (String(asYuanGouRow(row).note).includes('补录') && !noteLabel(row).includes('补录')
                  ? '（补录）'
                  : '')
              }}
            </template>
          </el-table-column>
          <el-table-column label="修正" min-width="110" fixed="right">
            <template #default="{ row }">
              <el-button
                v-if="outcomeOf(row) === 'hit'"
                link
                type="warning"
                size="small"
                @click="reviseRow(row, 'none')"
              >
                改为未购买
              </el-button>
              <el-button v-else link type="primary" size="small" @click="reviseRow(row, 'hit')">
                改为买了
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <ul
      v-if="store.cryptoOps.overflow_log.length"
      class="space-y-2 border-t border-surface-line pt-3"
    >
      <li class="text-xs font-medium text-ink">溢流日志</li>
      <li
        v-for="item in store.cryptoOps.overflow_log.slice(0, 5)"
        :key="item.id"
        class="flex flex-wrap justify-between gap-2 text-xs text-ink-muted"
      >
        <span>
          {{ item.created_at.slice(0, 10) }} ·
          {{ item.executed ? `转 ${item.amount} U` : '暂缓' }}
        </span>
        <span>HTX {{ item.htx_before }} → {{ item.htx_after }}</span>
      </li>
    </ul>

    <HtxDailyYieldDialog
      v-model:visible="yieldDialogVisible"
      :rows="status.hourlyLedger"
      :total="status.daily"
      :waiting-first-payout="status.waitingFirstPayout"
    />
  </section>
</template>
