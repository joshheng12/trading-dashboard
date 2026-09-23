<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Message from 'primevue/message'
import StatCard from '@/components/common/StatCard.vue'
import AgentControls from '@/components/research/AgentControls.vue'
import ResearchDetail from '@/components/research/ResearchDetail.vue'
import { useResearchStore } from '@/stores/research'
import { useAuthStore } from '@/stores/auth'
import { researchApi } from '@/services/research'
import type { Decision, JournalEvent, OperatingMode } from '@/types/research'
const store = useResearchStore()
const auth = useAuthStore()
const detail = ref<Decision | null>(null)
const events = ref<JournalEvent[]>([])
const visible = ref(false)
const notice = ref<string | null>(null)
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  if (auth.isAuthenticated) void store.load()
  timer = setInterval(() => {
    if (auth.isAuthenticated) void store.load()
  }, 10000)
})
onUnmounted(() => clearInterval(timer))
const dashboard = computed(() => store.dashboard)
const metrics = computed(() => dashboard.value?.performance)
const percent = (n: number | null | undefined) => (n == null ? '—' : `${(n * 100).toFixed(2)}%`)
const money = (n: number | null | undefined) => (n == null ? '—' : `$${n.toFixed(2)}`)
async function open(decision: Decision) {
  await store.perform(async () => {
    const response = await researchApi.detail(decision.decisionId)
    detail.value = response.decision
    events.value = response.events
    visible.value = true
  })
}
async function approve(id: string) {
  await store.perform(async () => {
    const result = await researchApi.approve(id)
    notice.value = result.approved
      ? 'Paper order submitted. Fill status may still be pending.'
      : result.reasons.join('; ')
  })
  if (detail.value) await open(detail.value)
}
async function cancel(id: string) {
  await store.perform(() => researchApi.cancel(id))
  if (detail.value) await open(detail.value)
}
const control = (action: string, mode?: OperatingMode) =>
  store.perform(() => researchApi.control(action, mode))
</script>

<template>
  <section class="space-y-5">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold">AI Research &amp; Paper Trading</h1>
        <p class="mt-1 text-sm text-muted-color">
          AI researches. Deterministic strategy decides. Risk controls approve. Paper broker
          executes.
        </p>
      </div>
      <Button
        label="Refresh"
        icon="pi pi-refresh"
        severity="secondary"
        :loading="store.loading"
        @click="store.load"
      />
    </div>
    <div v-if="!auth.isAuthenticated">
      <p class="mb-3">Sign in to view research, journal and agent controls.</p>
      <Button label="Sign in" @click="auth.promptVisible = true" />
    </div>
    <Message v-if="store.error" severity="error" :closable="false">{{ store.error }}</Message>
    <Message v-if="notice" severity="info" @close="notice = null">{{ notice }}</Message>
    <template v-if="dashboard && auth.isAuthenticated">
      <Message v-if="dashboard.state.error" severity="error" :closable="false">{{
        dashboard.state.error
      }}</Message>
      <AgentControls
        :dashboard="dashboard"
        :researching="store.researching"
        @run="store.run"
        @control="control"
        @reconcile="store.perform(researchApi.reconcile)"
        @review="store.perform(researchApi.review)"
      />
      <div v-if="metrics" class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Starting equity"
          :value="money(metrics.startingEquity)"
          icon="pi pi-wallet"
        />
        <StatCard
          label="Current account equity"
          :value="money(metrics.currentEquity)"
          icon="pi pi-wallet"
        />
        <StatCard
          label="Agent return"
          :value="percent(metrics.botReturn)"
          icon="pi pi-chart-line"
        />
        <StatCard
          label="SPY / difference"
          :value="`${percent(metrics.spyReturn)} / ${percent(metrics.difference)}`"
          icon="pi pi-chart-line"
        />
      </div>
      <details
        v-if="metrics"
        class="rounded-xl border border-surface-200 p-4 dark:border-surface-800"
      >
        <summary class="cursor-pointer font-medium">Performance statistics</summary>
        <dl class="mt-3 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
          <div
            v-for="[label, value] in [
              ['Daily agent return', percent(metrics.dailyReturn)],
              ['Realized P/L', money(metrics.realizedPnl)],
              ['Unrealized P/L', money(metrics.unrealizedPnl)],
              ['Trades', metrics.numberOfTrades],
              ['Winners / losers', `${metrics.winningTrades} / ${metrics.losingTrades}`],
              ['Win rate', percent(metrics.winRate)],
              ['Average winner', money(metrics.averageWinner)],
              ['Average loser', money(metrics.averageLoser)],
              ['Profit factor', metrics.profitFactor?.toFixed(2) ?? '—'],
              ['Maximum drawdown', percent(metrics.maximumDrawdown)],
              ['Largest win', money(metrics.largestWin)],
              ['Largest loss', money(metrics.largestLoss)],
            ]"
            :key="String(label)"
          >
            <dt class="text-muted-color">{{ label }}</dt>
            <dd class="tabular-nums">{{ value }}</dd>
          </div>
        </dl>
        <p class="mt-3 text-sm text-muted-color">{{ metrics.methodology }}</p>
        <p v-for="warning in metrics.warnings" :key="warning" class="mt-2">{{ warning }}</p>
      </details>
      <div class="overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
        <h2 class="p-4 font-semibold">Research and decision journal</h2>
        <DataTable
          :value="dashboard.decisions"
          paginator
          :rows="10"
          data-key="decisionId"
          table-style="min-width: 65rem"
        >
          <template #empty
            >Run research to record the first decisions. Provider failures are also
            recorded.</template
          >
          <Column header="Ticker"
            ><template #body="{ data }"
              ><Button :label="data.symbol" text @click="open(data)" /></template
          ></Column>
          <Column header="Price"
            ><template #body="{ data }">{{ money(data.evidence?.market?.price) }}</template></Column
          >
          <Column header="Overall"
            ><template #body="{ data }">{{ data.signal.overallScore.toFixed(1) }}</template></Column
          >
          <Column header="Technical"
            ><template #body="{ data }">{{ data.signal.technicalScore }}</template></Column
          >
          <Column header="Fundamental"
            ><template #body="{ data }">{{ data.signal.fundamentalScore }}</template></Column
          >
          <Column header="News"
            ><template #body="{ data }">{{ data.signal.newsScore }}</template></Column
          >
          <Column header="Market"
            ><template #body="{ data }">{{ data.signal.marketScore }}</template></Column
          >
          <Column header="Confidence"
            ><template #body="{ data }">{{ data.report?.confidence ?? '—' }}</template></Column
          >
          <Column header="Data quality"
            ><template #body="{ data }">{{ data.signal.riskScore }}</template></Column
          >
          <Column header="Signal"
            ><template #body="{ data }">{{ data.signal.signal }}</template></Column
          >
          <Column header="Risk"
            ><template #body="{ data }">{{
              data.risk.approved ? 'APPROVED' : 'REJECTED'
            }}</template></Column
          >
        </DataTable>
      </div>
      <details class="rounded-xl border border-surface-200 p-4 dark:border-surface-800">
        <summary class="cursor-pointer font-medium">Latest stock scan</summary>
        <div
          v-for="row in dashboard.scan ?? []"
          :key="row.symbol"
          class="mt-2 flex flex-wrap gap-3 text-sm"
        >
          <strong>{{ row.symbol }}</strong
          ><span>Rank {{ row.rank.toFixed(1) }}</span
          ><span>{{
            row.selected
              ? 'Selected for research'
              : row.reasons.join('; ') || 'Below candidate cutoff'
          }}</span>
        </div>
      </details>
      <section
        v-if="dashboard.dailyReview"
        class="rounded-xl border border-surface-200 p-4 dark:border-surface-800"
      >
        <h2 class="font-semibold">Daily report · {{ dashboard.dailyReview.date }}</h2>
        <p class="mt-2">
          Equity {{ money(dashboard.dailyReview.startingEquity) }} →
          {{ money(dashboard.dailyReview.endingEquity) }} · Agent P/L
          {{ money(dashboard.dailyReview.dailyAgentPnl) }} · SPY
          {{ percent(dashboard.dailyReview.benchmarkReturn) }}
        </p>
        <p>Rejected evaluations: {{ dashboard.dailyReview.rejectedTrades }}</p>
        <p>Closed trade lots: {{ dashboard.dailyReview.trades.length }}</p>
        <p v-if="dashboard.dailyReview.bestTrade">
          Best trade: {{ dashboard.dailyReview.bestTrade.symbol }} ·
          {{ money(dashboard.dailyReview.bestTrade.pnl) }}
        </p>
        <p v-if="dashboard.dailyReview.worstTrade">
          Worst trade: {{ dashboard.dailyReview.worstTrade.symbol }} ·
          {{ money(dashboard.dailyReview.worstTrade.pnl) }}
        </p>
        <p
          v-for="item in [
            ...dashboard.dailyReview.strategyObservations,
            ...dashboard.dailyReview.riskObservations,
          ]"
          :key="item"
          class="mt-2 text-sm"
        >
          {{ item }}
        </p>
      </section>
      <details>
        <summary class="cursor-pointer font-medium">Recent agent events</summary>
        <ul class="mt-2 space-y-1 text-xs">
          <li v-for="event in dashboard.events" :key="event.id">
            {{ event.timestamp }} · {{ event.event }} · {{ event.symbol ?? '' }}
          </li>
        </ul>
      </details>
    </template>
    <ResearchDetail
      v-model:visible="visible"
      :decision="detail"
      :events="events"
      :order="dashboard?.orders.find((order) => order.decisionId === detail?.decisionId) ?? null"
      :can-approve="
        dashboard?.state.mode === 'MANUAL_APPROVAL' && dashboard.state.status === 'RUNNING'
      "
      @approve="approve"
      @cancel="cancel"
    />
  </section>
</template>
