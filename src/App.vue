<script setup lang="ts">
import { ElMessage } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import AppLayout from '@/layouts/AppLayout.vue'
import { useFinanceCloudAutoSync } from '@/composables/useFinanceCloudAutoSync'
import { useFinanceStore } from '@/stores/finance'
import { withCloudAutoSyncMuted } from '@/utils/finance-cloud'

const store = useFinanceStore()
const cloudAuto = useFinanceCloudAutoSync()

onMounted(() => {
  void (async () => {
    const sync = await withCloudAutoSyncMuted(() => store.syncGithubCloudOnBoot())
    if (sync.applied) {
      ElMessage.success('已从 GitHub 云仓同步最新财务数据')
    }
    cloudAuto.resume()
    await store.ensureDailyFxRates()
    await store.ensureDailyFundNav()
  })()
})
</script>

<template>
  <el-config-provider :locale="zhCn">
    <AppLayout>
      <RouterView v-slot="{ Component }">
        <Transition name="fade" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </AppLayout>
  </el-config-provider>
</template>
