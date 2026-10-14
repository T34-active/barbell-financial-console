<script setup lang="ts">
import dayjs from 'dayjs'
import { ElMessage, ElMessageBox } from 'element-plus'
import PoolAccountCard from '@/components/accounts/PoolAccountCard.vue'
import { useFinanceStore } from '@/stores/finance'
import { formatMoney } from '@/utils/currency'
import { div, round } from '@/utils/decimal'
import { findHkBank, hkBankLegacyIds, hkBanks } from '@/data/hk-banks'
import type { PoolAccount } from '@/types/finance'

const store = useFinanceStore()

const addHkdVisible = ref(false)
const hkdForm = ref({
  code: '',
  amount: 0,
  yieldPct: 0,
  note: '',
})

function openAddHkd() {
  hkdForm.value = { code: '', amount: 0, yieldPct: 0, note: '' }
  addHkdVisible.value = true
}

function saveAddHkd() {
  try {
    const bank = findHkBank(hkdForm.value.code)
    if (!bank) throw new Error('请选择银行')
    const taken = new Set([bank.code, ...(hkBankLegacyIds[bank.code] ?? [])])
    const existing = store.accounts.hkd_pool.find((account) => taken.has(account.id))
    if (existing) throw new Error(`${bank.name}已在港币池（${existing.name}）`)
    const yieldPct = hkdForm.value.yieldPct
    store.upsertPoolAccount('hkd_pool', {
      id: bank.code,
      name: bank.name,
      type: 'bank',
      amount: hkdForm.value.amount,
      currency: 'HKD',
      yield_rate: yieldPct > 0 ? div(yieldPct, 100) : undefined,
      note: hkdForm.value.note.trim() || undefined,
    })
    addHkdVisible.value = false
    ElMessage.success(`已添加港币账户：${bank.name}`)
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  }
}

async function removeHkd(account: PoolAccount) {
  try {
    await ElMessageBox.confirm(
      `确定删除港币账户「${account.name}」？余额 ${formatMoney(account.amount, account.currency)} 将不再计入资产。`,
      '删除港币账户',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
    store.removeAccount('hkd_pool', account.id)
    ElMessage.success(`已删除 ${account.name}`)
  } catch (error) {
    if (error instanceof Error && error.message) ElMessage.error(error.message)
  }
}

function saveHkdAmount(id: string, amount: number) {
  store.updatePoolAmount('hkd_pool', id, amount)
}

function setHkdTermLock(
  account: PoolAccount,
  payload: { start_date: string; maturity_date: string; rate: number },
) {
  try {
    store.setTermLock('hkd_pool', account.id, payload)
    ElMessage.success(`${account.name} 已锁仓至 ${payload.maturity_date}`)
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
    throw error
  }
}

function breakHkdTermLock(account: PoolAccount) {
  try {
    store.breakTermLock('hkd_pool', account.id)
    ElMessage.success(`${account.name} 已提前支取，未计入定期利息`)
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
    throw error
  }
}

function creditHkdTerm(account: PoolAccount, interest: number) {
  try {
    store.creditTermMaturity('hkd_pool', account.id, interest)
    ElMessage.success(
      `${account.name} 已入账利息 ${formatMoney(interest, account.currency)}，锁仓已解除`,
    )
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
    throw error
  }
}

function hkdTransferTargets(account: PoolAccount) {
  return store.accounts.hkd_pool.filter((item) => item.id !== account.id)
}

function transferHkd(
  from: PoolAccount,
  payload: { toId: string; amount: number; received?: number },
) {
  try {
    const result = store.transferPoolAmount({
      fromPool: 'hkd_pool',
      fromId: from.id,
      toPool: 'hkd_pool',
      toId: payload.toId,
      amount: payload.amount,
      received: payload.received,
    })
    const target = store.accounts.hkd_pool.find((item) => item.id === payload.toId)
    const receivedText =
      result.fromCurrency === result.toCurrency
        ? ''
        : ` → ${formatMoney(result.received, result.toCurrency)}`
    ElMessage.success(
      `已从 ${from.name} 转出 ${formatMoney(result.amount, result.fromCurrency)}${receivedText} 到 ${target?.name ?? payload.toId}`,
    )
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
    throw error
  }
}

function savePoolYield(id: string, yieldRate: number) {
  try {
    if (typeof store.updatePoolYieldRate === 'function') {
      store.updatePoolYieldRate('hkd_pool', id, yieldRate)
      return
    }
    const target = store.accounts.hkd_pool.find((item) => item.id === id)
    if (!target) throw new Error(`未找到账户 ${id}`)
    if (!(yieldRate >= 0) || yieldRate > 1) {
      throw new Error('年化收益率须在 0%–100% 之间')
    }
    target.yield_rate = round(yieldRate, 4)
    target.amount_updated_at = dayjs().toISOString()
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  }
}
</script>

<template>
  <section class="space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-xs text-ink-muted">
        按银行 App 改账面余额。转到池内其他账户会两边一起改；跨币种填实际到账。可新增账户。
      </p>
      <el-button type="primary" plain @click="openAddHkd">新增港币账户</el-button>
    </div>
    <div class="grid gap-3 sm:grid-cols-2">
      <PoolAccountCard
        v-for="account in store.accounts.hkd_pool"
        :key="account.id"
        :account="account"
        editable
        editable-yield
        removable
        :transfer-targets="hkdTransferTargets(account)"
        term-lockable
        @save-amount="(amount) => saveHkdAmount(account.id, amount)"
        @save-yield="(rate) => savePoolYield(account.id, rate)"
        @transfer="(payload) => transferHkd(account, payload)"
        @set-term-lock="(payload) => setHkdTermLock(account, payload)"
        @break-term-lock="breakHkdTermLock(account)"
        @credit-term-maturity="(interest) => creditHkdTerm(account, interest)"
        @remove="removeHkd(account)"
      />
    </div>
    <p v-if="!store.accounts.hkd_pool.length" class="text-sm text-ink-muted">
      暂无港币账户，点右上角新增
    </p>

    <el-dialog
      v-model="addHkdVisible"
      title="新增港币账户"
      width="92%"
      class="max-w-md"
      destroy-on-close
    >
      <div class="space-y-4">
        <div>
          <label class="mb-1 block text-xs text-ink-muted">银行编号</label>
          <el-select
            v-model="hkdForm.code"
            filterable
            placeholder="输入编号或银行名，如 387 / 众安"
            class="w-full!"
          >
            <el-option
              v-for="bank in hkBanks"
              :key="bank.code"
              :label="`${bank.code} ${bank.name}`"
              :value="bank.code"
            />
          </el-select>
          <p class="mt-1 text-xs text-ink-muted">
            香港银行编号，例如 387 众安银行、012 中国银行（香港）
          </p>
        </div>
        <div>
          <label class="mb-1 block text-xs text-ink-muted">初始余额（HKD）</label>
          <AmountInput v-model="hkdForm.amount" :min="0" class="w-full!" />
        </div>
        <div>
          <label class="mb-1 block text-xs text-ink-muted">年化收益率（%，可选）</label>
          <el-input-number
            v-model="hkdForm.yieldPct"
            :min="0"
            :max="100"
            :step="0.01"
            :precision="2"
            controls-position="right"
            class="w-full!"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs text-ink-muted">备注（可选）</label>
          <el-input v-model="hkdForm.note" placeholder="可选备注" maxlength="64" />
        </div>
      </div>
      <template #footer>
        <el-button @click="addHkdVisible = false">取消</el-button>
        <el-button type="primary" @click="saveAddHkd">添加</el-button>
      </template>
    </el-dialog>
  </section>
</template>
