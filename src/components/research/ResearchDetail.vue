<script setup lang="ts">
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import type { Decision, JournalEvent, OrderIntent } from '@/types/research'
defineProps<{
  decision: Decision | null
  events: JournalEvent[]
  order: OrderIntent | null
  visible: boolean
  canApprove: boolean
}>()
const emit = defineEmits<{
  'update:visible': [value: boolean]
  approve: [id: string]
  cancel: [id: string]
}>()
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="decision ? `${decision.symbol} · ${decision.signal.signal}` : 'Research'"
    class="w-[95vw] max-w-4xl"
    @update:visible="emit('update:visible', $event)"
  >
    <div v-if="decision" class="space-y-5">
      <p class="text-sm text-muted-color">
        {{ decision.timestamp }} · Decision {{ decision.decisionId }}
      </p>
      <section>
        <h2 class="mb-2 font-semibold">Deterministic strategy</h2>
        <p class="mb-2">
          Score {{ decision.signal.overallScore.toFixed(1) }} · Market regime
          {{ decision.regime.regime }}
        </p>
        <ul class="list-inside list-disc">
          <li v-for="reason in decision.signal.reasons" :key="reason">{{ reason }}</li>
        </ul>
      </section>
      <section v-if="decision.report">
        <h2 class="mb-2 font-semibold">AI interpretation</h2>
        <p class="mb-2">
          Confidence {{ decision.report.confidence }} / 100 · Report data quality
          {{ decision.report.dataQuality.score }} / 100
        </p>
        <p><strong>Bull case:</strong> {{ decision.report.bullCase }}</p>
        <p class="mt-2"><strong>Bear case:</strong> {{ decision.report.bearCase }}</p>
        <h3 class="mt-3 font-medium">Catalysts</h3>
        <ul class="list-inside list-disc">
          <li v-for="item in decision.report.catalysts" :key="item">{{ item }}</li>
        </ul>
        <h3 class="mt-3 font-medium">Risks</h3>
        <ul class="list-inside list-disc">
          <li v-for="item in decision.report.risks" :key="item">{{ item }}</li>
        </ul>
        <h3 class="mt-3 font-medium">Cited news interpretation</h3>
        <ul>
          <li
            v-for="item in decision.report.newsAssessment.importantEvents"
            :key="item.headlineId"
            class="mt-2"
          >
            <a
              :href="item.headlineId"
              target="_blank"
              rel="noopener noreferrer"
              class="text-primary underline"
              >Supplied headline</a
            >: {{ item.interpretation }}
          </li>
        </ul>
      </section>
      <p v-else class="text-muted-color">{{ decision.error ?? 'Not selected for AI research.' }}</p>
      <section>
        <h2 class="mb-2 font-semibold">
          Risk manager at evaluation: {{ decision.risk.approved ? 'APPROVED' : 'REJECTED' }}
        </h2>
        <ul class="list-inside list-disc">
          <li v-for="reason in decision.risk.reasons" :key="reason">{{ reason }}</li>
        </ul>
        <p class="mt-2">
          Proposed size: ${{ decision.risk.approvedDollarAmount.toFixed(2) }} ·
          {{ decision.risk.qty }} shares. Approval rechecks current conditions.
        </p>
        <Button
          v-if="canApprove && !order && ['BUY', 'SELL'].includes(decision.signal.signal)"
          class="mt-3"
          label="Approve this paper trade"
          @click="emit('approve', decision.decisionId)"
        />
      </section>
      <section v-if="order">
        <h2 class="font-semibold">Paper order</h2>
        <p>
          {{ order.order?.status ?? order.status }} · ID
          {{ order.order?.id ?? order.clientOrderId }}
        </p>
        <p>
          Filled {{ order.order?.filledQty ?? 0 }} shares at
          {{ order.order?.filledAvgPrice ?? '—' }} · {{ order.order?.filledAt ?? 'Awaiting fill' }}
        </p>
        <Button
          v-if="order.status !== 'TERMINAL' && order.order"
          label="Cancel this paper order"
          severity="secondary"
          class="mt-2"
          @click="emit('cancel', decision.decisionId)"
        />
      </section>
      <details>
        <summary class="cursor-pointer font-medium">Immutable evidence and configuration</summary>
        <pre class="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{{
          JSON.stringify(
            {
              evidence: decision.evidence,
              config: decision.config,
              model: decision.model,
              promptVersion: decision.promptVersion,
            },
            null,
            2,
          )
        }}</pre>
      </details>
      <details>
        <summary class="cursor-pointer font-medium">Decision and execution event history</summary>
        <pre class="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{{
          JSON.stringify(events, null, 2)
        }}</pre>
      </details>
    </div>
  </Dialog>
</template>
