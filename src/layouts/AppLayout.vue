<script setup lang="ts">
import GlobalFxBar from '@/components/fx/GlobalFxBar.vue'
import { useTheme } from '@/composables/useTheme'

const route = useRoute()
const { isDark, mode, setMode, toggleDark } = useTheme()

const navItems = [
  { name: 'dashboard', label: '总览', icon: 'i-carbon-dashboard', to: '/' },
  { name: 'accounts', label: '账户', icon: 'i-carbon-wallet', to: '/accounts' },
  { name: 'salary', label: '工资', icon: 'i-carbon-currency', to: '/salary' },
  { name: 'settings', label: '设置', icon: 'i-carbon-settings', to: '/settings' },
] as const

function cycleTheme() {
  if (mode.value === 'light') setMode('dark')
  else if (mode.value === 'dark') setMode('system')
  else setMode('light')
}

const themeTitle = computed(() => {
  if (mode.value === 'system') return `跟随系统（当前${isDark.value ? '暗' : '亮'}）`
  return mode.value === 'dark' ? '黑夜模式' : '白天模式'
})
</script>

<template>
  <div class="page-shell">
    <header
      class="sticky top-0 z-40 border-b border-surface-line/80 bg-surface-raised/85 backdrop-blur-md"
    >
      <div class="mx-auto flex container items-center justify-between gap-4 px-4 py-3 md:px-6">
        <RouterLink to="/" class="group flex min-w-0 items-center gap-3">
          <span
            class="grid h-9 w-9 place-items-center rounded-lg bg-ink text-surface-raised shadow-sm transition-transform duration-300 group-hover:-rotate-3"
          >
            <span class="i-carbon-chart-bar text-lg" />
          </span>
          <div class="min-w-0">
            <p class="truncate font-display text-base font-semibold leading-tight md:text-lg">
              Personal Barbell
            </p>
            <p class="truncate text-xs text-ink-muted">Financial Console</p>
          </div>
        </RouterLink>

        <div class="flex items-center gap-1 md:gap-2">
          <nav class="hidden items-center gap-1 md:flex">
            <RouterLink
              v-for="item in navItems"
              :key="item.name"
              :to="item.to"
              class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors"
              :class="
                route.name === item.name
                  ? 'bg-surface-tint text-ink font-medium'
                  : 'text-ink-muted hover:bg-surface-tint/70 hover:text-ink'
              "
            >
              <span :class="item.icon" />
              {{ item.label }}
            </RouterLink>
          </nav>

          <button
            type="button"
            class="grid h-9 w-9 place-items-center rounded-lg border border-surface-line bg-surface-raised text-ink transition-colors hover:bg-surface-tint hover:text-ink"
            :title="themeTitle"
            :aria-label="themeTitle"
            @click="cycleTheme"
            @contextmenu.prevent="toggleDark"
          >
            <span
              class="text-base"
              :class="
                mode === 'system'
                  ? 'i-carbon-laptop'
                  : isDark
                    ? 'i-carbon-moon'
                    : 'i-carbon-sun'
              "
            />
          </button>
        </div>
      </div>
      <GlobalFxBar />
    </header>

    <main class="mx-auto w-full container px-4 py-5 md:px-6 md:py-8">
      <slot />
    </main>

    <nav
      class="fixed inset-x-0 bottom-0 z-40 border-t border-surface-line bg-surface-raised/95 backdrop-blur-md md:hidden"
      style="padding-bottom: env(safe-area-inset-bottom)"
    >
      <div class="mx-auto grid max-w-lg grid-cols-4 gap-1 px-2 py-2">
        <RouterLink
          v-for="item in navItems"
          :key="item.name"
          :to="item.to"
          class="flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-xs transition-colors"
          :class="
            route.name === item.name
              ? 'bg-surface-tint text-ink font-medium'
              : 'text-ink-muted'
          "
        >
          <span :class="[item.icon, 'text-lg']" />
          {{ item.label }}
        </RouterLink>
      </div>
    </nav>

    <div class="h-20 md:hidden" />
  </div>
</template>
