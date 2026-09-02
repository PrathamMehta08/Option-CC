import { coveredCall } from './coveredCall';
import { cashSecuredPut } from './cashSecuredPut';
import type { StrategyDefinition, StrategyId } from './types';

export type { StrategyDefinition, StrategyId } from './types';

/**
 * The strategy registry. A new strategy is a new file plus one line here.
 */
export const STRATEGIES: Record<StrategyId, StrategyDefinition> = {
  'covered-call': coveredCall,
  'cash-secured-put': cashSecuredPut,
};

export const STRATEGY_IDS = Object.keys(STRATEGIES) as StrategyId[];

export const DEFAULT_STRATEGY_ID: StrategyId = 'covered-call';

export function isStrategyId(value: string | null | undefined): value is StrategyId {
  return !!value && value in STRATEGIES;
}

/** Resolve a strategy id from untrusted input, falling back to the default. */
export function getStrategy(value: string | null | undefined): StrategyDefinition {
  return STRATEGIES[isStrategyId(value) ? value : DEFAULT_STRATEGY_ID];
}
