export function logEvent(
  event: string,
  symbol: string | null = null,
  decisionId: string | null = null,
  metadata: Record<string, string | number | boolean | null> = {},
) {
  // Call sites provide only controlled metadata; never pass raw provider errors, headers or environment.
  console.log(
    JSON.stringify({ timestamp: new Date().toISOString(), event, symbol, decisionId, metadata }),
  )
}
