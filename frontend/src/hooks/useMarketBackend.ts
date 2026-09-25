import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import type { Market } from '@/lib/markets';

export type MarketSource = 'deriv' | 'market-qx-observer-v2';
export interface LiveCandle { open: number; high: number; low: number; close: number; epoch: number }
export interface MarketState { state: string; source: MarketSource; symbol: string; candles: LiveCandle[]; price: number | null; timestamp?: number; reason?: string }
export interface Runtime { database: string; ticksReceived: number; analysisCycles: number; analysisError?: string; providers: { source: MarketSource; state: string; symbolCount?: number; ageSeconds?: number; error?: string }[]; agents: { configuredSlots: number; registered: number; active: number; reason: string }; training: { state: string }; masterAgent: { state: string; reason: string } }
export interface Analysis { state: string; candleCount?: number; quality?: { score: number; reasons: string[] }; indicators?: { count: number; values: Record<string, number> }; signal: { direction: 'NO_SIGNAL' | 'CALL' | 'PUT'; reason: string; createdAt?: string; modelAgreement?: number } }
export const sourceFor = (pair: Pick<Market, 'session'>): MarketSource => pair.session === 'OTC' ? 'market-qx-observer-v2' : 'deriv';
export const symbolFor = (pair: Pick<Market, 'session' | 'symbol'>) => `${pair.symbol}${pair.session === 'OTC' ? ' (OTC)' : ''}`;
export function useRuntime(enabled = true) {
  return useQuery({ queryKey: ['runtime'], queryFn: () => apiGet<Runtime>('/v1/runtime'), refetchInterval: enabled ? 5000 : false, enabled, retry: 1 });
}
export function useMarketState(pair: Pick<Market, 'session' | 'symbol'>, timeframe: string, enabled = true) {
  const source = sourceFor(pair), symbol = symbolFor(pair);
  return useQuery({ queryKey: ['market', source, symbol, timeframe], queryFn: () => apiGet<MarketState>(`/v1/market/state?${new URLSearchParams({ source, symbol, timeframe })}`), refetchInterval: enabled ? 2000 : false, enabled, retry: 1 });
}
export function useLatestAnalysis(pair: Market, timeframe: string) {
  return useQuery({ queryKey: ['analysis', sourceFor(pair), symbolFor(pair), timeframe], queryFn: () => apiGet<Analysis>(`/v1/analysis/latest?${new URLSearchParams({ source: sourceFor(pair), symbol: symbolFor(pair), timeframe })}`), refetchInterval: 10000 });
}
export function analyzePair(pair: Market, timeframe: string) {
  return apiPost<Analysis>('/v1/analysis', { source: sourceFor(pair), symbol: symbolFor(pair), timeframe });
}
export function useBackendEvents() {
  return useQuery({ queryKey: ['events'], queryFn: () => apiGet<{items: {time: string; level: string; source: string; message: string}[]}>('/v1/events'), refetchInterval: 5000 });
}