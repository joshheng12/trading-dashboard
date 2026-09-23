import type { AgentDashboard } from '@/types/agent'
import type { Decision, JournalEvent, OperatingMode, RiskDecision } from '@/types/research'
import { AuthRequiredError } from './marketData'

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/agent${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload: unknown = await response.json()
  if (!response.ok) {
    const message = (payload as { error?: string }).error ?? 'Agent request failed'
    if (response.status === 401) throw new AuthRequiredError(message)
    throw new Error(message)
  }
  return payload as T
}
export const researchApi = {
  status: () => request<AgentDashboard>('/status'),
  run: () => request<AgentDashboard>('/research', {}),
  control: (action: string, mode?: OperatingMode) => request('/controls', { action, mode }),
  detail: (id: string) =>
    request<{ decision: Decision; events: JournalEvent[] }>(`/decisions/${encodeURIComponent(id)}`),
  approve: (id: string) =>
    request<RiskDecision>(`/decisions/${encodeURIComponent(id)}/approve`, {}),
  cancel: (id: string) => request(`/decisions/${encodeURIComponent(id)}/cancel`, {}),
  reconcile: () => request('/reconcile', {}),
  review: () => request('/review', {}),
}
