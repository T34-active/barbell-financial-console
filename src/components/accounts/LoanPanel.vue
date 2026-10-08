<script setup lang="ts">
import dayjs from 'dayjs'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useFinanceStore } from '@/stores/finance'
import { formatMoney } from '@/utils/currency'
import type { LoanFundSource, LoanRecord } from '@/types/finance'

const store = useFinanceStore()

function todayKey() {
  return dayjs().format('YYYY-MM-DD')
}

function monthEndKey(base = dayjs()) {
  return dayjs(base).endOf('month').format('YYYY-MM-DD')
}

const form = ref({
  counterparty: '',
  amount: 800,
  lent_at: todayKey(),
  due_at: monthEndKey(),
  funded_from: 'yulibao' as LoanFundSource,
  note: '',
})

const showHistory = ref(false)
const repayVisible = ref(false)
const repayTarget = ref<LoanRecord | null>(null)
const repayForm = ref({
  amount: 0,
  to_account: 'yulibao' as LoanFundSource,
  repaid_at: todayKey(),
  note: '',
})

const openLoans = computed(() =>
  store.loans.items.filter((item) => item.status === 'open' || item.status === 'partial'),
)

const closedLoans = computed(() =>
  store.loans.items.filter((item) => item.status === 'repaid' || item.status === 'written_off'),
)

const fundOptions: Array<{ value: LoanFundSource; label: string }> = [
  { value: 'yulibao', label: '余利宝（应急金）' },
  { value: 'cash_rmb', label: '手头现金' },
]

function statusLabel(status: LoanRecord['status']) {
  if (status === 'open') return '待还'
  if (status === 'partial') return '部分还'
  if (status === 'repaid') return '已还清'
  return '已核销'
}

function statusClass(status: LoanRecord['status']) {
  if (status === 'open') return 'bg-alert-soft text-alert'
  if (status === 'partial') return 'bg-accent-soft text-accent'
  if (status === 'repaid') return 'bg-safe-soft text-safe'
  return 'bg-surface text-ink-muted'
}

function isOverdue(loan: LoanRecord) {
  if (loan.status === 'repaid' || loan.status === 'written_off') return false
  if (!loan.due_at) return false
  return loan.due_at < todayKey()
}

function daysHint(loan: LoanRecord) {
  if (!loan.due_at) return ''
  if (loan.status === 'repaid' || loan.status === 'written_off') return ''
  const due = dayjs(`${loan.due_at}T00:00:00`)
  const today = dayjs(`${todayKey()}T00:00:00`)
  const diff = Math.round(due.diff(today) / 86400000)
  if (diff < 0) return `逾期 ${-diff} 天`
  if (diff === 0) return '今天到期'
  return `还有 ${diff} 天`
}

async function submitLend() {
  try {
    const sourceLabel = store.fundSourceLabel(form.value.funded_from)
    await ElMessageBox.confirm(
      `从${sourceLabel}借出 ¥${form.value.amount} 给「${form.value.counterparty || '？'}」，约定 ${form.value.due_at} 还？\n现金减少，同时记一笔应收（净资产不变）。`,
      '确认借出',
      { confirmButtonText: '确认借出', cancelButtonText: '取消', type: 'warning' },
    )
    const record = store.lendOut({
      amount: form.value.amount,
      counterparty: form.value.counterparty,
      due_at: form.value.due_at,
      funded_from: form.value.funded_from,
      lent_at: form.value.lent_at,
      note: form.value.note,
    })
    ElMessage.success(`已借出 ¥${record.amount} 给 ${record.counterparty} · ${record.due_at} 到期`)
    form.value.counterparty = ''
    form.value.note = ''
    form.value.amount = 800
    form.value.lent_at = todayKey()
    form.value.due_at = monthEndKey()
    form.value.funded_from = 'yulibao'
  } catch (error) {
    if (error instanceof Error && error.message) {
      ElMessage.error(error.message)
    }
  }
}

function openRepay(loan: LoanRecord) {
  repayTarget.value = loan
  repayForm.value = {
    amount: loan.remaining,
    to_account: loan.funded_from,
    repaid_at: todayKey(),
    note: '',
  }
  repayVisible.value = true
}

async function submitRepay() {
  const loan = repayTarget.value
  if (!loan) return
  try {
    await ElMessageBox.confirm(
      `收回 ¥${repayForm.value.amount} 入账「${store.fundSourceLabel(repayForm.value.to_account)}」？`,
      '确认收款',
      { confirmButtonText: '确认', cancelButtonText: '取消', type: 'success' },
    )
    const next = store.repayLoan({
      id: loan.id,
      amount: repayForm.value.amount,
      to_account: repayForm.value.to_account,
      repaid_at: repayForm.value.repaid_at,
      note: repayForm.value.note,
    })
    repayVisible.value = false
    ElMessage.success(
      next.status === 'repaid' ? `${next.counterparty} 已还清` : `已收回，剩余 ¥${next.remaining}`,
    )
  } catch (error) {
    if (error instanceof Error && error.message) {
      ElMessage.error(error.message)
    }
  }
}

async function submitWriteOff(loan: LoanRecord) {
  try {
    await ElMessageBox.confirm(
      `核销「${loan.counterparty}」剩余 ¥${loan.remaining}？\n视为收不回，净资产会减少。`,
      '核销坏账',
      {
        confirmButtonText: '确认核销',
        cancelButtonText: '取消',
        type: 'error',
      },
    )
    store.writeOffLoan(loan.id, '坏账核销')
    ElMessage.warning(`已核销 ${loan.counterparty} ¥${loan.remaining}`)
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
        <h2 class="text-base font-semibold">借出 / 应收</h2>
        <p class="mt-1 text-xs text-ink-muted">
          借给朋友会扣现金并记应收；还回来再入账。净资产先不变，核销才算损失。
        </p>
      </div>
      <div class="rounded-lg bg-surface px-3 py-2 text-right">
        <p class="text-xs text-ink-muted">未收回</p>
        <p class="stat-num text-lg font-semibold text-accent">
          {{ formatMoney(store.openLendReceivableCny, 'CNY') }}
        </p>
      </div>
    </div>

    <div class="rounded-lg border border-surface-line bg-surface/60 px-3 py-3">
      <p class="mb-3 text-sm font-medium">登记借出</p>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label class="mb-1 block text-xs text-ink-muted">借款人</label>
          <el-input v-model="form.counterparty" placeholder="朋友姓名" maxlength="32" />
        </div>
        <div>
          <label class="mb-1 block text-xs text-ink-muted">金额（CNY）</label>
          <AmountInput v-model="form.amount" :min="0.01" class="w-full!" />
        </div>
        <div>
          <label class="mb-1 block text-xs text-ink-muted">扣款来源</label>
          <el-select v-model="form.funded_from" class="w-full">
            <el-option
              v-for="opt in fundOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </div>
        <div>
          <label class="mb-1 block text-xs text-ink-muted">借出日</label>
          <el-date-picker
            v-model="form.lent_at"
            type="date"
            value-format="YYYY-MM-DD"
            class="w-full!"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs text-ink-muted">约定还款日</label>
          <el-date-picker
            v-model="form.due_at"
            type="date"
            value-format="YYYY-MM-DD"
            class="w-full!"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs text-ink-muted">备注</label>
          <el-input v-model="form.note" placeholder="可选" maxlength="64" />
        </div>
      </div>
      <div class="mt-3 flex justify-end">
        <el-button type="primary" @click="submitLend">确认借出</el-button>
      </div>
    </div>

    <div class="space-y-2">
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-sm font-medium">进行中（{{ openLoans.length }}）</h3>
      </div>
      <p v-if="!openLoans.length" class="text-xs text-ink-muted">暂无未收回借出</p>
      <div
        v-for="loan in openLoans"
        :key="loan.id"
        class="rounded-lg border border-surface-line px-3 py-3"
      >
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-medium">{{ loan.counterparty }}</p>
              <span class="rounded px-1.5 py-0.5 text-xs" :class="statusClass(loan.status)">
                {{ statusLabel(loan.status) }}
              </span>
              <span
                v-if="isOverdue(loan)"
                class="rounded bg-alert-soft px-1.5 py-0.5 text-xs text-alert"
              >
                逾期
              </span>
            </div>
            <p class="mt-1 text-xs text-ink-muted">
              借出 {{ loan.lent_at }} · 到期 {{ loan.due_at || '—' }}
              <span v-if="daysHint(loan)">· {{ daysHint(loan) }}</span>
            </p>
            <p class="mt-0.5 text-xs text-ink-muted">
              来源 {{ store.fundSourceLabel(loan.funded_from) }}
              <span v-if="loan.note">· {{ loan.note }}</span>
            </p>
          </div>
          <div class="text-right">
            <p class="stat-num text-lg font-semibold">
              {{ formatMoney(loan.remaining, 'CNY') }}
            </p>
            <p class="text-xs text-ink-muted">/ 本金 {{ formatMoney(loan.amount, 'CNY') }}</p>
          </div>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          <el-button type="primary" size="small" @click="openRepay(loan)">收回</el-button>
          <el-button type="danger" plain size="small" @click="submitWriteOff(loan)">核销</el-button>
        </div>
      </div>
    </div>

    <div v-if="closedLoans.length">
      <button
        type="button"
        class="text-xs text-ink-muted underline-offset-2 hover:underline"
        @click="showHistory = !showHistory"
      >
        {{ showHistory ? '收起' : '展开' }}已结束（{{ closedLoans.length }}）
      </button>
      <div v-if="showHistory" class="mt-2 space-y-2">
        <div
          v-for="loan in closedLoans"
          :key="loan.id"
          class="rounded-lg bg-surface px-3 py-2 text-xs text-ink-muted"
        >
          <span class="font-medium text-ink">{{ loan.counterparty }}</span>
          · {{ statusLabel(loan.status) }} · {{ formatMoney(loan.amount, 'CNY') }} · 到期
          {{ loan.due_at || '—' }}
        </div>
      </div>
    </div>

    <el-dialog
      v-model="repayVisible"
      title="收回借出"
      width="92%"
      class="max-w-md"
      destroy-on-close
    >
      <div v-if="repayTarget" class="space-y-4">
        <p class="text-sm text-ink-muted">
          {{ repayTarget.counterparty }} · 剩余
          {{ formatMoney(repayTarget.remaining, 'CNY') }}
        </p>
        <div>
          <label class="mb-1 block text-xs text-ink-muted">收回金额</label>
          <AmountInput
            v-model="repayForm.amount"
            :min="0.01"
            :max="repayTarget.remaining"
            class="w-full!"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs text-ink-muted">入账账户</label>
          <el-select v-model="repayForm.to_account" class="w-full">
            <el-option
              v-for="opt in fundOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </div>
        <div>
          <label class="mb-1 block text-xs text-ink-muted">收款日</label>
          <el-date-picker
            v-model="repayForm.repaid_at"
            type="date"
            value-format="YYYY-MM-DD"
            class="w-full!"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs text-ink-muted">备注</label>
          <el-input v-model="repayForm.note" maxlength="64" />
        </div>
      </div>
      <template #footer>
        <el-button @click="repayVisible = false">取消</el-button>
        <el-button type="primary" @click="submitRepay">确认收回</el-button>
      </template>
    </el-dialog>
  </section>
</template>
