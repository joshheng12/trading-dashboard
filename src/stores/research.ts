import { defineStore } from 'pinia'
import { ref } from 'vue'
import { researchApi } from '@/services/research'
import { AuthRequiredError } from '@/services/marketData'
import { useAuthStore } from './auth'
import type { AgentDashboard } from '@/types/agent'

export const useResearchStore = defineStore('research', () => {
  const dashboard = ref<AgentDashboard | null>(null)
  const error = ref<string | null>(null)
  const researching = ref(false)
  const loading = ref(false)
  async function perform(action: () => Promise<unknown>) {
    error.value = null
    try {
      await action()
      dashboard.value = await researchApi.status()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Agent unavailable'
      if (e instanceof AuthRequiredError) {
        const auth = useAuthStore()
        auth.isAuthenticated = false
        auth.promptVisible = true
      }
    }
  }
  async function load() {
    if (loading.value) return
    loading.value = true
    try {
      await perform(async () => {})
    } finally {
      loading.value = false
    }
  }
  async function run() {
    researching.value = true
    try {
      await perform(researchApi.run)
    } finally {
      researching.value = false
    }
  }
  return { dashboard, error, researching, loading, perform, load, run }
})
