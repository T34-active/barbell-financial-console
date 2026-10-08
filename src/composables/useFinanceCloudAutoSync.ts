import { useFinanceStore } from '@/stores/finance'
import { isCloudAutoSyncMuted } from '@/utils/finance-cloud'

const DEBOUNCE_MS = 700

/**
 * 任意财务操作后，防抖写入 public/pbfc-finance/（开发/预览中间件）。
 * 拉取云仓 / 导入期间会静音，避免回写循环。
 */
export function useFinanceCloudAutoSync() {
  const store = useFinanceStore()
  const paused = ref(true)
  const writing = ref(false)
  const lastWroteAt = ref<string | null>(null)
  const lastError = ref<string | null>(null)

  let timer: ReturnType<typeof setTimeout> | null = null
  let pending = false

  async function flush() {
    if (paused.value || isCloudAutoSyncMuted()) return
    if (writing.value) {
      pending = true
      return
    }
    writing.value = true
    try {
      const backup = await store.pushToGithubCloud('auto')
      lastWroteAt.value = backup.exported_at
      lastError.value = null
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : '云仓自动写入失败'
    } finally {
      writing.value = false
      if (pending) {
        pending = false
        schedule()
      }
    }
  }

  function schedule() {
    if (paused.value || isCloudAutoSyncMuted()) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      void flush()
    }, DEBOUNCE_MS)
  }

  function pause() {
    paused.value = true
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function resume() {
    paused.value = false
  }

  const stop = store.$subscribe(
    () => {
      schedule()
    },
    { detached: true },
  )

  onScopeDispose(() => {
    pause()
    stop()
  })

  return {
    paused,
    writing,
    lastWroteAt,
    lastError,
    pause,
    resume,
    flushNow: flush,
  }
}
