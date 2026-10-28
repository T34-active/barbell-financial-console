<script setup lang="ts">
import { useFinanceStore } from '@/stores/finance'
import { useFinanceFormat } from '@/composables/useFinanceFormat'
import { formatBeijingDateTime } from '@/utils/datetime'
import type { ExtraIncomeRecord, SalaryAllocationRecord, UsSeedRemitRecord } from '@/types/finance'

type LedgerKind = 'salary' | 'extra' | 'remit'

interface LedgerRow {
  id: string
  kind: LedgerKind
  direction: 'in' | 'out'
  at: string
  period: string
  typeLabel: string
  amount: number
  detail: string
  tags: string[]
}

const store = useFinanceStore()
const { moneyInBase } = useFinanceFormat()

function extraModeLabel(mode: ExtraIncomeRecord['mode']) {
  const map: Record<ExtraIncomeRecord['mode'], string> = {
    salary_split: '按工资比例',
    skip_parents: '不给爸妈',
    to_safety: '全部进安全垫',
    to_seed: '全部进美股种子',
    to_fun: '全部进快乐基金',
    to_travel: '全部进旅游基金',
    to_cash: '全部进手头现金',
  }
  return map[mode]
}

function salaryLine(row: SalaryAllocationRecord, key: SalaryAllocationRecord['lines'][number]['key']) {
  return row.lines.find((line) => line.key === key)?.amount ?? 0
}

function salaryDetail(row: SalaryAllocationRecord) {
  return [
    `爸妈 ${moneyInBase(salaryLine(row, 'parents'), 'CNY')}`,
    `安全垫 ${moneyInBase(salaryLine(row, 'safety_pad'), 'CNY')}`,
    `进攻 ${moneyInBase(salaryLine(row, 'us_seed'), 'CNY')}`,
    `快乐 ${moneyInBase(salaryLine(row, 'fun_fund'), 'CNY')}`,
    `旅游 ${moneyInBase(salaryLine(row, 'travel_fund'), 'CNY')}`,
  ].join(' · ')
}

function salaryTags(row: SalaryAllocationRecord) {
  const tags: string[] = [row.mode === 'divert_to_seed' ? '转美股种子' : '补安全垫']
  if (row.pe_guard_active) tags.push('观察仓')
  if (row.fun_fund_carried) tags.push('快乐已结转')
  return tags
}

const rows = computed<LedgerRow[]>(() => {
  const salaryRows: LedgerRow[] = store.salary.history.map((item) => ({
    id: item.id,
    kind: 'salary',
    direction: 'in',
    at: item.created_at,
    period: item.year_month,
    typeLabel: '工资入账',
    amount: item.salary,
    detail: salaryDetail(item),
    tags: salaryTags(item),
  }))
  const extraRows: LedgerRow[] = (store.salary.extra_income_history ?? []).map((item) => ({
    id: item.id,
    kind: 'extra',
    direction: 'in',
    at: item.created_at,
    period: item.year_month,
    typeLabel: '额外收入',
    amount: item.amount,
    detail: `${item.note} · ${extraModeLabel(item.mode)}`,
    tags: [],
  }))
  const remitRows: LedgerRow[] = (store.salary.remit_history ?? []).map((item: UsSeedRemitRecord) => ({
    id: item.id,
    kind: 'remit',
    direction: 'out',
    at: item.remitted_at,
    period: item.remitted_at.slice(0, 7),
    typeLabel: '美股种子汇出',
    amount: item.amount,
    detail: item.note,
    tags: ['出账'],
  }))
  return [...salaryRows, ...extraRows, ...remitRows].sort((a, b) =>
    a.at < b.at ? 1 : a.at > b.at ? -1 : 0,
  )
})
</script>

<template>
  <section class="panel px-4 py-5 md:px-5">
    <h2 class="text-base font-semibold">出入账历史</h2>
    <p class="mt-1 text-xs text-ink-muted">工资、额外收入为入账；美股种子汇出为出账。</p>
    <el-table
      :data="rows"
      stripe
      size="small"
      empty-text="暂无记录。入账或汇出后将显示在这里。"
      class="mt-3 w-full"
    >
      <el-table-column label="日期" min-width="150">
        <template #default="{ row }">
          {{ formatBeijingDateTime(row.at) }}
        </template>
      </el-table-column>
      <el-table-column prop="period" label="账期" min-width="90" />
      <el-table-column label="方向" min-width="70">
        <template #default="{ row }">
          <span
            class="rounded px-2 py-0.5 text-xs"
            :class="row.direction === 'in' ? 'bg-safe-soft text-safe' : 'bg-risk-soft text-risk'"
          >
            {{ row.direction === 'in' ? '入账' : '出账' }}
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="typeLabel" label="类型" min-width="120" />
      <el-table-column label="金额" min-width="120" align="right">
        <template #default="{ row }">
          <span :class="row.direction === 'out' ? 'text-risk' : ''">
            {{ row.direction === 'out' ? '−' : '+' }}{{ moneyInBase(row.amount, 'CNY') }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="明细" min-width="280" show-overflow-tooltip>
        <template #default="{ row }">
          {{ row.detail }}
        </template>
      </el-table-column>
      <el-table-column label="标记" min-width="160">
        <template #default="{ row }">
          <div class="flex flex-wrap gap-1">
            <span
              v-for="tag in row.tags"
              :key="tag"
              class="rounded bg-surface-tint px-2 py-0.5 text-xs text-ink-muted"
            >
              {{ tag }}
            </span>
          </div>
        </template>
      </el-table-column>
    </el-table>
  </section>
</template>
