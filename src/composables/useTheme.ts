export type ThemeMode = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'pbfc-theme'

const mode = ref<ThemeMode>(readStoredMode())
const isDark = ref(false)

let media: MediaQueryList | null = null
let mediaHandler: ((e: MediaQueryListEvent) => void) | null = null
let started = false

function readStoredMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  } catch {
    /* ignore */
  }
  return 'system'
}

function systemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyTheme(next: ThemeMode) {
  const dark = next === 'dark' || (next === 'system' && systemPrefersDark())
  isDark.value = dark
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', dark ? '#0f1419' : '#eef2f5')
}

function bindSystemListener() {
  media = window.matchMedia('(prefers-color-scheme: dark)')
  mediaHandler = () => {
    if (mode.value === 'system') applyTheme('system')
  }
  media.addEventListener('change', mediaHandler)
}

export function useTheme() {
  if (!started && typeof window !== 'undefined') {
    started = true
    applyTheme(mode.value)
    bindSystemListener()
  }

  function setMode(next: ThemeMode) {
    mode.value = next
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
    applyTheme(next)
  }

  function toggleDark() {
    setMode(isDark.value ? 'light' : 'dark')
  }

  return {
    mode,
    isDark,
    setMode,
    toggleDark,
  }
}

/** 尽早应用，避免首屏闪白 */
export function initTheme() {
  applyTheme(readStoredMode())
}
