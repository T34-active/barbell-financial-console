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

const createVisible = ref(false)
const editVisible = ref(false)
const showHistory = ref(false)
const editingId = ref('')

const form = ref({
  counterparty: '',
  amount: 800,
  lent_at: todayKey(),
  due_at: monthEndKey(),
  funded_from: 'yulibao' as LoanFundSource,
  note: '',
})

const editForm = ref({
  counterparty: '',
  amount: 0,
  lent_at: todayKey(),
  due_at: monthEndKey(),
  note: '',
  repayAmount: 0,
  repayTo: 'yulibao' as LoanFundSource,
  repaidAt: todayKey(),
})

const openLoans = computed(() =>
  store.loans.items.filter((item) => item.status === 'open' || item.status === 'partial'),
)

const closedLoans = computed(() =>
  store.loans.items.filter((item) => item.status === 'repaid' || item.status === 'written_off'),
)

const editingLoan = computed(
  () => store.loans.items.find((item) => item.id === editingId.value) ?? null,
)

const canEditAmount = computed(() => {
  const loan = editingLoan.value
  if (!loan) return false
  return loan.status === 'open' && loan.repayments.length === 0
})

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

function resetCreateForm() {
  form.value = {
    counterparty: '',
    amount: 800,
    lent_at: todayKey(),
    due_at: monthEndKey(),
    funded_from: 'yulibao',
    note: '',
  }
}

function openCreate() {
  resetCreateForm()
  createVisible.value = true
}

function fillEditForm(loan: LoanRecord) {
  editForm.value = {
    counterparty: loan.counterparty,
    amount: loan.amount,
    lent_at: loan.lent_at,
    due_at: loan.due_at,
    note: loan.note,
    repayAmount: loan.remaining,
    repayTo: loan.funded_from,
    repaidAt: todayKey(),
  }
}

function openEdit(loan: LoanRecord) {
  editingId.value = loan.id
  fillEditForm(loan)
  editVisible.value = true
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
    createVisible.value = false
    ElMessage.success(`已借出 ¥${record.amount} 给 ${record.counterparty} · ${record.due_at} 到期`)
  } catch (error) {
    if (error instanceof Error && error.message && error.message !== 'cancel') {
      ElMessage.error(error.message)
    }
  }
}

async function saveEdit() {
  const loan = editingLoan.value
  if (!loan) return
  try {
    const next = store.updateLoan({
      id: loan.id,
      counterparty: editForm.value.counterparty,
      amount: canEditAmount.value ? editForm.value.amount : undefined,
      due_at: editForm.value.due_at,
      lent_at: editForm.value.lent_at,
      note: editForm.value.note,
    })
    fillEditForm(next)
    ElMessage.success(`已修改 ${next.counterparty}`)
  } catch (error) {
    if (error instanceof Error && error.message) ElMessage.error(error.message)
  }
}

async function submitRepay() {
  const loan = editingLoan.value
  if (!loan) return
  try {
    await ElMessageBox.confirm(
      `收回 ¥${editForm.value.repayAmount} 入账「${store.fundSourceLabel(editForm.value.repayTo)}」？`,
      '确认收款',
      { confirmButtonText: '确认', cancelButtonText: '取消', type: 'success' },
    )
    const next = store.repayLoan({
      id: loan.id,
      amount: editForm.value.repayAmount,
      to_account: editForm.value.repayTo,
      repaid_at: editForm.value.repaidAt,
    })
    if (next.status === 'repaid' || next.status === 'written_off') {
      editVisible.value = false
    } else {
      fillEditForm(next)
    }
    ElMessage.success(
      next.status === 'repaid' ? `${next.counterparty} 已还清` : `已收回，剩余 ¥${next.remaining}`,
    )
  } catch (error) {
    if (error instanceof Error && error.message && error.message !== 'cancel') {
      ElMessage.error(error.message)
    }
  }
}

async function submitWriteOff() {
  const loan = editingLoan.value
  if (!loan) return
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
    const remaining = loan.remaining
    store.writeOffLoan(loan.id, '坏账核销')
    editVisible.value = false
    ElMessage.warning(`已核销 ${loan.counterparty} ¥${remaining}`)
  } catch (error) {
    if (error instanceof Error && error.message && error.message !== 'cancel') {
      ElMessage.error(error.message)
    }
  }
}

defineExpose({ openCreate })
</script>

<template>
  <article
    v-if="!openLoans.length"
    class="panel flex cursor-pointer flex-col gap-3 px-4 py-4"
    @click="openCreate"
  >
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="font-medium">借出 / 应收</p>
        <p class="mt-1 text-xs text-ink-muted">别人欠我的钱，点这里登记</p>
      </div>
      <el-button size="small" plain @click.stop="openCreate">登记</el-button>
    </div>
    <div>
      <p class="text-xs text-ink-muted">未收回</p>
      <p class="stat-num mt-0.5 text-xl font-semibold">
        {{ formatMoney(store.openLendReceivableCny, 'CNY') }}
      </p>
    </div>
  </article>

  <article
    v-for="loan in openLoans"
    :key="loan.id"
    class="panel flex cursor-pointer flex-col gap-3 px-4 py-4"
    @click="openEdit(loan)"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="font-medium">{{ loan.counterparty }}</p>
        <p class="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
          <span>借出 / 应收</span>
          <span class="rounded px-1.5 py-0.5" :class="statusClass(loan.status)">
            {{ statusLabel(loan.status) }}
          </span>
          <span
            v-if="isOverdue(loan)"
            class="rounded bg-alert-soft px-1.5 py-0.5 text-alert"
          >
            逾期
          </span>
        </p>
      </div>
      <el-button size="small" plain @click.stop="openEdit(loan)">修改</el-button>
    </div>
    <div>
      <p class="text-xs text-ink-muted">未收回</p>
      <p class="stat-num mt-0.5 text-xl font-semibold">
        {{ formatMoney(loan.remaining, 'CNY') }}
      </p>
      <p class="mt-1 text-xs text-ink-muted">
        本金 {{ formatMoney(loan.amount, 'CNY') }} · 到期 {{ loan.due_at || '—' }}
        <span v-if="daysHint(loan)">· {{ daysHint(loan) }}</span>
      </p>
      <p class="mt-0.5 text-xs text-ink-muted">
        来源 {{ store.fundSourceLabel(loan.funded_from) }}
        <span v-if="loan.note">· {{ loan.note }}</span>
      </p>
    </div>
  </article>

  <div v-if="closedLoans.length" class="order-last sm:col-span-2">
    <button
      type="button"
      class="text-xs text-ink-muted underline-offset-2 hover:underline"
      @click="showHistory = !showHistory"
    >
      {{ showHistory ? '收起' : '展开' }}已结束（{{ closedLoans.length }}）
    </button>
    <div v-if="showHistory" class="mt-2 space-y-2">
      <button
        v-for="loan in closedLoans"
        :key="loan.id"
        type="button"
        class="block w-full rounded-lg bg-surface px-3 py-2 text-left text-xs text-ink-muted"
        @click="openEdit(loan)"
      >
        <span class="font-medium text-ink">{{ loan.counterparty }}</span>
        · {{ statusLabel(loan.status) }} · {{ formatMoney(loan.amount, 'CNY') }} · 到期
        {{ loan.due_at || '—' }}
      </button>
    </div>
  </div>

  <el-dialog
    v-model="createVisible"
    title="登记借出"
    width="92%"
    class="max-w-md"
    append-to-body
    destroy-on-close
  >
    <div class="space-y-4">
      <p class="text-xs text-ink-muted">
        借给朋友会扣现金并记应收。净资产先不变，核销才算损失。
      </p>
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
    <template #footer>
      <el-button @click="createVisible = false">取消</el-button>
      <el-button type="primary" @click="submitLend">确认借出</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="editVisible"
    :title="editingLoan ? `修改 ${editingLoan.counterparty}` : '修改借出'"
    width="92%"
    class="max-w-md"
    append-to-body
    destroy-on-close
  >
    <div v-if="editingLoan" class="space-y-4">
      <div>
        <label class="mb-1 block text-xs text-ink-muted">借款人</label>
        <el-input v-model="editForm.counterparty" maxlength="32" />
      </div>
      <div>
        <label class="mb-1 block text-xs text-ink-muted">本金（CNY）</label>
        <AmountInput
          v-model="editForm.amount"
          :min="0.01"
          :disabled="!canEditAmount"
          class="w-full!"
        />
        <p class="mt-1 text-xs text-ink-muted">
          <template v-if="canEditAmount">
            还没收回过，改金额会从{{ store.fundSourceLabel(editingLoan.funded_from) }}补扣或退回。
          </template>
          <template v-else>
            未收回 {{ formatMoney(editingLoan.remaining, 'CNY') }} · 来源
            {{ store.fundSourceLabel(editingLoan.funded_from) }}
          </template>
        </p>
      </div>
      <div>
        <label class="mb-1 block text-xs text-ink-muted">借出日</label>
        <el-date-picker
          v-model="editForm.lent_at"
          type="date"
          value-format="YYYY-MM-DD"
          class="w-full!"
        />
      </div>
      <div>
        <label class="mb-1 block text-xs text-ink-muted">约定还款日</label>
        <el-date-picker
          v-model="editForm.due_at"
          type="date"
          value-format="YYYY-MM-DD"
          class="w-full!"
        />
      </div>
      <div>
        <label class="mb-1 block text-xs text-ink-muted">备注</label>
        <el-input v-model="editForm.note" maxlength="64" />
      </div>

      <div
        v-if="editingLoan.status === 'open' || editingLoan.status === 'partial'"
        class="space-y-3 border-t border-surface-line pt-4"
      >
        <p class="text-sm font-medium">收回</p>
        <div>
          <label class="mb-1 block text-xs text-ink-muted">收回金额</label>
          <AmountInput
            v-model="editForm.repayAmount"
            :min="0.01"
            :max="editingLoan.remaining"
            class="w-full!"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs text-ink-muted">入账账户</label>
          <el-select v-model="editForm.repayTo" class="w-full">
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
            v-model="editForm.repaidAt"
            type="date"
            value-format="YYYY-MM-DD"
            class="w-full!"
          />
        </div>
      </div>
    </div>
    <template #footer>
      <el-button
        v-if="editingLoan && (editingLoan.status === 'open' || editingLoan.status === 'partial')"
        type="danger"
        plain
        @click="submitWriteOff"
      >
        核销
      </el-button>
      <el-button @click="editVisible = false">关闭</el-button>
      <el-button type="primary" plain @click="saveEdit">保存</el-button>
      <el-button
        v-if="editingLoan && (editingLoan.status === 'open' || editingLoan.status === 'partial')"
        type="primary"
        @click="submitRepay"
      >
        确认收回
      </el-button>
    </template>
  </el-dialog>
</template>
