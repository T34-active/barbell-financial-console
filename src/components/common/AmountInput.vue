<script setup lang="ts">
import { round } from '@/utils/decimal'

const model = defineModel<number>({ required: true })

const props = withDefaults(
  defineProps<{
    min?: number
    max?: number
    precision?: number
    allowNegative?: boolean
    disabled?: boolean
    placeholder?: string
  }>(),
  {
    precision: 2,
    allowNegative: false,
    disabled: false,
  },
)

const focused = ref(false)
const text = ref('')
const inputRef = ref<{ input?: HTMLInputElement } | null>(null)

function format(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return ''
  return round(value, props.precision).toFixed(props.precision)
}

function sanitize(raw: string) {
  let next = ''
  let seenDot = false
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') {
      next += ch
      continue
    }
    if (ch === '.') {
      if (props.precision <= 0) break
      if (!seenDot) {
        next += ch
        seenDot = true
      }
      continue
    }
    if (ch === '-' && props.allowNegative && next === '') next = '-'
  }
  if (props.precision > 0 && seenDot) {
    const negative = next.startsWith('-')
    const body = negative ? next.slice(1) : next
    const [intPart, frac = ''] = body.split('.')
    next = `${negative ? '-' : ''}${intPart}.${frac.slice(0, props.precision)}`
  }
  return next
}

function tryParse(raw: string) {
  const normalized = raw.endsWith('.') ? raw.slice(0, -1) : raw
  if (normalized === '' || normalized === '-') return null
  const value = Number(normalized)
  if (!Number.isFinite(value)) return null
  return value
}

function clamp(value: number) {
  let next = round(value, props.precision)
  const { min, max } = props
  if (min != null && max != null && max < min) return round(max, props.precision)
  if (min != null && next < min) next = round(min, props.precision)
  if (max != null && next > max) next = round(max, props.precision)
  return next
}

function same(value: number) {
  return round(value, props.precision) === round(model.value, props.precision)
}

function syncDom(next: string) {
  const el = inputRef.value?.input
  if (el && el.value !== next) el.value = next
}

function publish(raw: string) {
  const parsed = tryParse(raw)
  if (parsed == null) return
  const live = round(parsed, props.precision)
  if (!same(live)) model.value = live
}

function onInput(raw: string | number) {
  focused.value = true
  const incoming = String(raw ?? '')
  const next = sanitize(incoming)
  if (next === text.value) {
    if (incoming !== text.value) {
      text.value = `${next} `
      nextTick(() => {
        text.value = next
        syncDom(next)
      })
    }
    return
  }
  text.value = next
  syncDom(next)
  publish(next)
}

function onBlur() {
  focused.value = false
  const parsed = tryParse(text.value)
  if (parsed == null) {
    text.value = format(model.value)
    syncDom(text.value)
    return
  }
  const next = clamp(parsed)
  text.value = format(next)
  syncDom(text.value)
  if (!same(next)) model.value = next
}

let detachInput: (() => void) | null = null

function attachInput() {
  detachInput?.()
  detachInput = null
  const el = inputRef.value?.input
  if (!el) return
  const handleFocus = () => {
    focused.value = true
  }
  el.addEventListener('focus', handleFocus)
  el.addEventListener('blur', onBlur)
  detachInput = () => {
    el.removeEventListener('focus', handleFocus)
    el.removeEventListener('blur', onBlur)
  }
}

onMounted(() => {
  nextTick(attachInput)
})

onBeforeUnmount(() => {
  detachInput?.()
})

watch(
  model,
  (value) => {
    if (focused.value) return
    text.value = format(value)
  },
  { immediate: true },
)
</script>

<template>
  <el-input
    ref="inputRef"
    :model-value="text"
    :disabled="disabled"
    :placeholder="placeholder"
    inputmode="decimal"
    autocomplete="off"
    spellcheck="false"
    @update:model-value="onInput"
  />
</template>
