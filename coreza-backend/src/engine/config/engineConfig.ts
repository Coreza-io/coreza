export const ENGINE_CONFIG = {
  BACKTEST_INDICATOR_RETENTION_SECONDS: 86_400,
  DEFAULT_FLUSH_POLICY: "on-success" as const,
  BACKTEST_FLUSH_POLICY: "never" as const,
} as const;
