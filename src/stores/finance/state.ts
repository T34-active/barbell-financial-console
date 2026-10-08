import { ref, type Ref } from 'vue'
import type {
  AccountsState,
  AppSettings,
  CryptoOpsState,
  LoansState,
  SalaryState,
  YuanGouState,
} from '@/types/finance'
import { cloneSeed } from './normalize'

export interface FinanceRefs {
  settings: Ref<AppSettings>
  accounts: Ref<AccountsState>
  salary: Ref<SalaryState>
  yuanGou: Ref<YuanGouState>
  cryptoOps: Ref<CryptoOpsState>
  loans: Ref<LoansState>
}

export function createFinanceRefs(): FinanceRefs {
  const boot = cloneSeed()
  return {
    settings: ref(boot.settings),
    accounts: ref(boot.accounts),
    salary: ref(boot.salary),
    yuanGou: ref(boot.yuan_gou),
    cryptoOps: ref(boot.crypto_ops),
    loans: ref(boot.loans),
  }
}
