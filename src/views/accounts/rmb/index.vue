<script setup lang="ts">
import dayjs from 'dayjs'
import { ElMessage, ElMessageBox } from 'element-plus'
import LoanPanel from '../components/LoanPanel.vue'
import { useFinanceStore } from '@/stores/finance'
import { formatMoney, formatPercent } from '@/utils/currency'
import { formatBeijingDateTime } from '@/utils/datetime'
import { div, mul, round } from '@/utils/decimal'
import type { PoolAccount } from '@/types/finance'

const store = useFinanceStore()

const safeRmb = computed(() =>
  store.accounts.rmb_pool.filter(
    (a) => !store.settings.asset_classification.neutral_assets.includes(a.id),
  ),
)

const loanPanel = ref<{ openCreate: () => void } | null>(null)
const rmbDialogVisible = ref(false)
const rmbEditingId = ref<string | null>(null)
const rmbForm = ref({
  name: '',
  amount: 0,
  yieldPct: 0,
  note: '',
})

function openAddRmb() {
  rmbEditingId.value = null
  rmbForm.value = { name: '', amount: 0, yieldPct: 0, note: '' }
  rmbDialogVisible.value = true
}

function openEditRmb(account: PoolAccount) {
  rmbEditingId.value = account.id
  rmbForm.value = {
    name: account.name,
    amount: account.amount,
    yieldPct: round(mul(account.yield_rate ?? 0, 100), 2),
    note: account.note ?? '',
  }
  rmbDialogVisible.value = true
}

function createRmbId(name: string) {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_\u4e00-\u9fff]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24) || `cny_${Date.now().toString(36)}`
  if (!store.accounts.rmb_pool.some((account) => account.id === base)) return base
  return `${base}_${Date.now().toString(36)}`.slice(0, 32)
}

function saveRmbAccount() {
  try {
    const name = rmbForm.value.name.trim()
    if (!name) throw new Error('请填写银行名称')
    const editingId = rmbEditingId.value
    const dup = safeRmb.value.find((account) => account.name === name && account.id !== editingId)
    if (dup) throw new Error(`已有人民币账户「${name}」`)
    const yieldPct = rmbForm.value.yieldPct
    if (editingId) {
      const current = store.accounts.rmb_pool.find((account) => account.id === editingId)
      if (!current) throw new Error('账户已不存在')
      store.upsertPoolAccount('rmb_pool', {
        ...current,
        name,
        note: rmbForm.value.note.trim() || undefined,
      })
      store.updatePoolAmount('rmb_pool', editingId, rmbForm.value.amount)
      savePoolYield(editingId, yieldPct > 0 ? div(yieldPct, 100) : 0)
      ElMessage.success(`已修改 ${name}`)
    } else {
      store.upsertPoolAccount('rmb_pool', {
        id: createRmbId(name),
        name,
        type: 'bank',
        amount: rmbForm.value.amount,
        currency: 'CNY',
        yield_rate: yieldPct > 0 ? div(yieldPct, 100) : undefined,
        note: rmbForm.value.note.trim() || undefined,
      })
      ElMessage.success(`已添加人民币账户：${name}`)
    }
    rmbDialogVisible.value = false
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  }
}

async function removeRmb(account: PoolAccount) {
  try {
    const extra =
      account.id === 'yulibao'
        ? '工资里的应急金、种子和观察仓仍留在分桶里，只是这张卡片不再显示。'
        : ''
    await ElMessageBox.confirm(
      `确定删除人民币账户「${account.name}」？余额 ${formatMoney(account.amount, account.currency)} 将不再计入资产。${extra}`,
      '删除人民币账户',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
    store.removeAccount('rmb_pool', account.id)
    ElMessage.success(`已删除 ${account.name}`)
  } catch {
    /* cancel */
  }
}

function savePoolYield(id: string, yieldRate: number) {
  try {
    if (typeof store.updatePoolYieldRate === 'function') {
      store.updatePoolYieldRate('rmb_pool', id, yieldRate)
      return
    }
    const target = store.accounts.rmb_pool.find((item) => item.id === id)
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

function yieldText(account: PoolAccount) {
  const rate = account.yield_rate
  if (!(rate != null && rate > 0)) return '—'
  return formatPercent(rate)
}

function updatedText(account: PoolAccount) {
  return account.amount_updated_at ? formatBeijingDateTime(account.amount_updated_at) : '—'
}
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-xs text-ink-muted">
        自己填银行或账户名称。按 App 账面改余额；表格方便一眼扫完全部账户。
      </p>
      <div class="flex flex-wrap gap-2">
        <el-button plain @click="loanPanel?.openCreate()">登记借出</el-button>
        <el-button type="primary" plain @click="openAddRmb">新增人民币账户</el-button>
      </div>
    </div>

    <div class="panel space-y-3 px-4 py-4 md:px-5">
      <div class="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p class="font-medium">人民币安全</p>
          <p class="mt-0.5 text-xs text-ink-muted">{{ safeRmb.length }} 个账户</p>
        </div>
      </div>
      <el-table
        :data="safeRmb"
        stripe
        size="small"
        empty-text="暂无人民币账户，点右上角新增"
        class="w-full"
        @row-click="openEditRmb"
      >
        <el-table-column prop="name" label="账户" min-width="140" show-overflow-tooltip />
        <el-table-column label="余额" min-width="120" align="right">
          <template #default="{ row }">
            <span class="stat-num">{{ formatMoney(row.amount, row.currency) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="年化" min-width="88" align="right">
          <template #default="{ row }">
            {{ yieldText(row) }}
          </template>
        </el-table-column>
        <el-table-column label="备注" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.note || '—' }}
          </template>
        </el-table-column>
        <el-table-column label="更新" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">
            {{ updatedText(row) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="132" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click.stop="openEditRmb(row)">
              修改
            </el-button>
            <el-button link type="danger" size="small" @click.stop="removeRmb(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <LoanPanel ref="loanPanel" />

    <el-dialog
      v-model="rmbDialogVisible"
      :title="rmbEditingId ? '修改人民币账户' : '新增人民币账户'"
      width="92%"
      class="max-w-md"
      destroy-on-close
    >
      <div class="space-y-4">
        <div>
          <label class="mb-1 block text-xs text-ink-muted">银行名称</label>
          <el-input v-model="rmbForm.name" placeholder="例如：招商银行、余额宝" maxlength="32" />
        </div>
        <div>
          <label class="mb-1 block text-xs text-ink-muted">余额（CNY）</label>
          <AmountInput v-model="rmbForm.amount" :min="0" class="w-full!" />
        </div>
        <div>
          <label class="mb-1 block text-xs text-ink-muted">年化收益率（%，可选）</label>
          <el-input-number
            v-model="rmbForm.yieldPct"
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
          <el-input v-model="rmbForm.note" placeholder="可选备注" maxlength="64" />
        </div>
      </div>
      <template #footer>
        <el-button @click="rmbDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveRmbAccount">
          {{ rmbEditingId ? '保存' : '添加' }}
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>
