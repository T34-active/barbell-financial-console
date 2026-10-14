<script setup lang="ts">
import { ElMessage } from 'element-plus'
import FundProductPanel from '../components/FundProductPanel.vue'
import YuanGouPanel from '../components/YuanGouPanel.vue'
import PoolAccountCard from '@/components/accounts/PoolAccountCard.vue'
import { useFinanceStore } from '@/stores/finance'
import { formatMoney } from '@/utils/currency'
import { isNavFundAccount, searchFunds, type FundProfile } from '@/utils/fund-nav'

const store = useFinanceStore()

const fundProducts = computed(() => {
  const ids = new Set(store.settings.asset_classification.neutral_assets)
  return store.accounts.rmb_pool.filter((a) => ids.has(a.id) && isNavFundAccount(a))
})
const otherNeutral = computed(() => {
  const ids = new Set(store.settings.asset_classification.neutral_assets)
  return store.accounts.rmb_pool.filter((a) => ids.has(a.id) && !isNavFundAccount(a))
})
const cryptoAssets = computed(() => {
  const ids = new Set(store.settings.asset_classification.crypto_assets ?? [])
  return store.accounts.crypto_pool.filter((a) => ids.has(a.id))
})

const addFundVisible = ref(false)
const fundForm = ref({
  name: '',
  fundCode: '',
})
const fundQuery = ref('')
const fundLookup = ref<FundProfile | null>(null)
const fundLookingUp = ref(false)
const fundSaving = ref(false)
let fundSuggestSeq = 0

interface FundSuggestItem extends FundProfile {
  value: string
}

function openAddFund() {
  fundForm.value = { name: '', fundCode: '' }
  fundQuery.value = ''
  fundLookup.value = null
  fundLookingUp.value = false
  addFundVisible.value = true
}

function applyFundPick(hit: FundProfile) {
  fundForm.value.fundCode = hit.fund_code
  fundForm.value.name = hit.name
  fundLookup.value = hit
  fundQuery.value = `${hit.fund_code} ${hit.name}`
}

async function queryFundSuggestions(query: string, cb: (items: FundSuggestItem[]) => void) {
  const key = query.trim()
  const seq = ++fundSuggestSeq
  if (!key) {
    fundLookingUp.value = false
    cb([])
    return
  }
  fundLookingUp.value = true
  try {
    const list = await searchFunds(key)
    if (seq !== fundSuggestSeq) return
    cb(
      list.map((item) => ({
        ...item,
        value: `${item.fund_code} ${item.name}`,
      })),
    )
  } catch {
    if (seq !== fundSuggestSeq) return
    cb([])
  } finally {
    if (seq === fundSuggestSeq) fundLookingUp.value = false
  }
}

function onFundSuggestSelect(item: Record<string, unknown>) {
  const fundCode = String(item.fund_code ?? '').trim()
  const name = String(item.name ?? '').trim()
  if (!fundCode || !name) return
  applyFundPick({
    fund_code: fundCode,
    name,
    fund_type: typeof item.fund_type === 'string' ? item.fund_type : undefined,
    company: typeof item.company === 'string' ? item.company : undefined,
  })
}

watch(fundQuery, (query) => {
  const selected = fundLookup.value
  if (!selected) return
  const label = `${selected.fund_code} ${selected.name}`
  if (query.trim() !== label && query.trim() !== selected.fund_code) {
    fundLookup.value = null
    fundForm.value.fundCode = ''
    fundForm.value.name = ''
  }
})

const sectionTab = ref<'crypto' | 'fund'>('crypto')
const cryptoVenue = ref('htx_earn_usdt')

watch(
  cryptoAssets,
  (list) => {
    if (!list.length) return
    if (!list.some((account) => account.id === cryptoVenue.value)) {
      cryptoVenue.value = list[0].id
    }
  },
  { immediate: true },
)

const activeCrypto = computed(
  () => cryptoAssets.value.find((account) => account.id === cryptoVenue.value) ?? null,
)

function cryptoTabLabel(id: string, name: string) {
  if (id === 'htx_earn_usdt') return 'HTX'
  if (id === 'okx_earn_usdt') return 'OKX'
  return name
}

const fundReady = computed(() => fundLookup.value != null)

const fundLookupHint = computed(() => {
  const hit = fundLookup.value
  if (!hit) return ''
  return [hit.fund_code, hit.name, hit.fund_type, hit.company].filter(Boolean).join(' · ')
})

async function saveAddFund() {
  const selected = fundLookup.value
  if (fundSaving.value || !selected) return
  fundSaving.value = true
  try {
    const account = store.addFundProduct({
      name: fundForm.value.name.trim() || selected.name,
      fundCode: selected.fund_code,
    })
    addFundVisible.value = false
    ElMessage.success(`已添加基金：${account.name}（${account.fund_code}）`)
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  } finally {
    fundSaving.value = false
  }
}
</script>

<template>
  <section class="space-y-4">
    <el-tabs v-model="sectionTab" class="section-tabs">
      <el-tab-pane label="加密赌注池" name="crypto">
        <div class="space-y-4">
          <el-tabs v-if="cryptoAssets.length" v-model="cryptoVenue" class="venue-tabs">
            <el-tab-pane
              v-for="account in cryptoAssets"
              :key="account.id"
              :label="cryptoTabLabel(account.id, account.name)"
              :name="account.id"
            />
          </el-tabs>
          <YuanGouPanel :venue-id="cryptoVenue" />
          <div v-if="activeCrypto">
            <div class="mb-2 flex flex-wrap items-end justify-between gap-2">
              <h3 class="text-sm font-medium text-alert">持仓账户</h3>
              <p class="text-xs text-ink-muted">
                本月一元购花费
                {{ formatMoney(store.yuanGouPeriodStats.month.spendCny, 'CNY') }}
                · 累计
                {{ formatMoney(store.yuanGouPeriodStats.total.spendCny, 'CNY') }}
                · 抢到
                {{ formatMoney(store.yuanGouPeriodStats.total.gotUsdt, 'USDT') }}
              </p>
            </div>
            <PoolAccountCard :account="activeCrypto" />
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="中性 · 基金" name="fund">
        <div class="space-y-4">
          <div class="flex flex-wrap items-end justify-between gap-2">
            <p class="text-xs text-ink-muted">
              每只公募基金独立份额、净值与 FIFO。买入只记份额，不从现金扣款。
            </p>
            <el-button type="primary" plain @click="openAddFund">添加基金</el-button>
          </div>
          <p v-if="!fundProducts.length" class="text-sm text-ink-muted">
            暂无基金产品，点右上角添加
          </p>
          <FundProductPanel v-for="account in fundProducts" :key="account.id" :account="account" />
          <div v-if="otherNeutral.length" class="grid gap-3 sm:grid-cols-2">
            <PoolAccountCard v-for="account in otherNeutral" :key="account.id" :account="account" />
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-dialog
      v-model="addFundVisible"
      title="添加基金"
      width="92%"
      class="max-w-md"
      destroy-on-close
    >
      <div class="space-y-4">
        <div>
          <label class="mb-1 block text-xs text-ink-muted">搜索基金</label>
          <el-autocomplete
            v-model="fundQuery"
            :fetch-suggestions="queryFundSuggestions"
            :debounce="300"
            :trigger-on-focus="false"
            highlight-first-item
            placeholder="代码或名称，如 002611 / 黄金"
            class="w-full!"
            @select="onFundSuggestSelect"
          >
            <template #default="{ item }">
              <div class="flex min-w-0 items-center justify-between gap-3">
                <span class="font-mono">{{ item.fund_code }}</span>
                <span class="truncate text-ink-muted">{{ item.name }}</span>
              </div>
            </template>
          </el-autocomplete>
          <p v-if="fundLookingUp" class="mt-1 text-xs text-ink-muted">正在搜索…</p>
          <p v-else-if="fundLookup" class="mt-1 text-xs text-safe">已选 {{ fundLookupHint }}</p>
          <p v-else class="mt-1 text-xs text-ink-muted">输入后从候选里点选，方向键 + 回车也可</p>
        </div>
        <div>
          <label class="mb-1 block text-xs text-ink-muted">基金名称（可改）</label>
          <el-input v-model="fundForm.name" placeholder="选中候选后自动填入" maxlength="48" />
        </div>
      </div>
      <template #footer>
        <el-button @click="addFundVisible = false">取消</el-button>
        <el-button type="primary" :loading="fundSaving" :disabled="!fundReady" @click="saveAddFund">
          添加
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.section-tabs :deep(.el-tabs__header) {
  margin-bottom: 16px;
}
.venue-tabs :deep(.el-tabs__header) {
  margin-bottom: 0;
}
.venue-tabs :deep(.el-tabs__content) {
  display: none;
}
</style>
