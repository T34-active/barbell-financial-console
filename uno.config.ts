import {
  defineConfig,
  presetAttributify,
  presetIcons,
  presetUno,
} from 'unocss'

export default defineConfig({
  presets: [
    presetUno(),
    presetAttributify(),
    presetIcons({
      scale: 1.1,
      warn: true,
      collections: {
        carbon: () =>
          import('@iconify-json/carbon/icons.json').then((m) => m.default),
      },
    }),
  ],
  theme: {
    colors: {
      ink: {
        DEFAULT: 'var(--ink)',
        soft: 'var(--ink-soft)',
        muted: 'var(--ink-muted)',
      },
      surface: {
        DEFAULT: 'var(--surface)',
        raised: 'var(--surface-raised)',
        line: 'var(--surface-line)',
        tint: 'var(--surface-tint)',
      },
      safe: {
        DEFAULT: 'var(--safe)',
        soft: 'var(--safe-soft)',
      },
      risk: {
        DEFAULT: 'var(--risk)',
        soft: 'var(--risk-soft)',
      },
      alert: {
        DEFAULT: 'var(--alert)',
        soft: 'var(--alert-soft)',
      },
      accent: {
        DEFAULT: 'var(--accent)',
        soft: 'var(--accent-soft)',
      },
      up: {
        DEFAULT: 'var(--up)',
        soft: 'var(--up-soft)',
      },
      down: {
        DEFAULT: 'var(--down)',
        soft: 'var(--down-soft)',
      },
    },
    fontFamily: {
      display: '"Fraunces", "Songti SC", serif',
      sans: '"Outfit", "PingFang SC", "Noto Sans SC", sans-serif',
      mono: '"IBM Plex Mono", "SF Mono", monospace',
    },
  },
  safelist: ['text-up', 'text-down', 'bg-up-soft', 'bg-down-soft'],
  shortcuts: {
    // 不铺实色底，让 body 的亮/暗径向渐变透出来
    'page-shell': 'min-h-screen bg-transparent text-ink font-sans',
    'panel': 'bg-surface-raised border border-surface-line rounded-xl',
    'stat-num': 'font-mono tabular-nums tracking-tight',
    'section-title': 'font-display text-xl md:text-2xl font-semibold tracking-tight',
  },
})
