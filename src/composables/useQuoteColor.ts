export type QuoteColorScheme = 'cn' | 'us'

const STORAGE_KEY = 'pbfc-quote-color'

const scheme = ref<QuoteColorScheme>(readStoredScheme())

let started = false

function readStoredScheme(): QuoteColorScheme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'cn' || raw === 'us') return raw
  } catch {
    /* ignore */
  }
  return 'cn'
}

function applyScheme(next: QuoteColorScheme) {
  document.documentElement.setAttribute('data-quote-color', next)
}

export function quoteToneClass(value: number): string {
  return value >= 0 ? 'text-up' : 'text-down'
}

export function useQuoteColor() {
  if (!started && typeof window !== 'undefined') {
    started = true
    applyScheme(scheme.value)
  }

  function setScheme(next: QuoteColorScheme) {
    scheme.value = next
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
    applyScheme(next)
  }

  function toggleScheme() {
    setScheme(scheme.value === 'cn' ? 'us' : 'cn')
  }

  const label = computed(() => (scheme.value === 'cn' ? '红涨绿跌' : '绿涨红跌'))

  return {
    scheme,
    label,
    setScheme,
    toggleScheme,
  }
}

/** 尽早应用，避免首屏涨跌色闪一下 */
export function initQuoteColor() {
  applyScheme(readStoredScheme())
}
