<script setup lang="ts">
import { ref } from 'vue'
import Button from 'primevue/button'
import Select from 'primevue/select'
import Tag from 'primevue/tag'
import type { AgentDashboard } from '@/types/agent'
import type { OperatingMode } from '@/types/research'
defineProps<{ dashboard: AgentDashboard; researching: boolean }>()
const emit = defineEmits<{
  run: []
  control: [action: string, mode?: OperatingMode]
  reconcile: []
  review: []
}>()
const mode = ref<OperatingMode>('RESEARCH_ONLY')
const modes: OperatingMode[] = ['RESEARCH_ONLY', 'MANUAL_APPROVAL', 'AUTO_PAPER']
</script>

<template>
  <div
    class="rounded-xl border border-surface-200 bg-surface-0 p-4 dark:border-surface-800 dark:bg-surface-900"
  >
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <Tag
        :value="dashboard.state.status"
        :severity="dashboard.state.status === 'ERROR' ? 'danger' : 'info'"
      />
      <span
        >Paper trading:
        <strong>{{
          dashboard.config.tradingMode === 'paper' ? 'ENABLED' : 'BLOCKED'
        }}</strong></span
      >
      <span
        >Automation:
        <strong>{{
          dashboard.state.automaticOrders &&
          dashboard.config.automaticOrders &&
          dashboard.state.status === 'RUNNING'
            ? 'ON'
            : 'OFF'
        }}</strong></span
      >
      <Tag :value="dashboard.state.mode" severity="secondary" />
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <Button
        label="Run Research Now"
        icon="pi pi-search"
        :loading="researching || dashboard.busy"
        @click="emit('run')"
      />
      <Button label="Pause Agent" severity="secondary" @click="emit('control', 'pause')" />
      <Button
        label="Resume Agent"
        severity="secondary"
        :disabled="dashboard.state.emergencyStop"
        @click="emit('control', 'resume')"
      />
      <Button
        label="Disable Automatic Paper Orders"
        severity="secondary"
        outlined
        @click="emit('control', 'disable-orders')"
      />
      <Button label="Emergency Stop" severity="danger" @click="emit('control', 'emergency-stop')" />
      <Button
        v-if="dashboard.state.emergencyStop"
        label="Clear Stop (stay paused)"
        severity="secondary"
        @click="emit('control', 'clear-stop')"
      />
    </div>
    <p class="my-3 text-sm text-muted-color">
      Emergency Stop blocks new agent orders. It does not liquidate positions or cancel orders
      already sent to Alpaca.
    </p>
    <div class="flex flex-wrap items-center gap-2">
      <label for="agent-mode" class="text-sm">Operating mode</label>
      <Select v-model="mode" input-id="agent-mode" :options="modes" />
      <Button
        label="Set mode and pause"
        severity="secondary"
        outlined
        @click="emit('control', 'mode', mode)"
      />
      <Button label="Reconcile orders" severity="secondary" text @click="emit('reconcile')" />
      <Button label="Create daily review" severity="secondary" text @click="emit('review')" />
    </div>
    <p class="mt-3 text-sm text-muted-color">
      Scheduled research {{ dashboard.config.enabled ? 'enabled' : 'disabled in configuration' }}.
      Model: {{ dashboard.config.model ?? 'not configured' }}. Universe:
      {{ dashboard.config.stockUniverse.join(', ') }}.
    </p>
  </div>
</template>
