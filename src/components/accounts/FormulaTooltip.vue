<script setup lang="ts">
withDefaults(
  defineProps<{
    placement?: 'top' | 'top-start' | 'bottom' | 'bottom-start'
  }>(),
  { placement: 'top' },
)
</script>

<template>
  <span class="inline-flex items-center gap-0.5">
    <slot />
    <el-tooltip
      :placement="placement"
      :trigger="['hover', 'click']"
      :show-after="0"
      :hide-after="0"
      enterable
    >
      <template #content>
        <div class="max-w-[280px] space-y-1 text-left text-xs leading-5 whitespace-normal">
          <slot name="content" />
        </div>
      </template>
      <button
        type="button"
        class="inline-flex shrink-0 items-center text-ink-muted hover:text-accent"
        aria-label="查看公式"
        @click.stop
        @mousedown.stop
      >
        <span class="i-carbon-help h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </el-tooltip>
  </span>
</template>
