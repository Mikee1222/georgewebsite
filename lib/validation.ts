/**
 * Validation helpers for API payloads. Used to avoid sending invalid select options to Airtable.
 */

import type { ModelForecastScenario, ModelForecastSourceType } from './types';

export const WEEKLY_FORECAST_SCENARIOS: ModelForecastScenario[] = ['expected', 'conservative', 'aggressive'];
export const WEEKLY_FORECAST_SOURCE_TYPES: ModelForecastSourceType[] = ['auto', 'manual', 'hybrid'];

const scenarioSet = new Set<string>(WEEKLY_FORECAST_SCENARIOS);
const sourceTypeSet = new Set<string>(WEEKLY_FORECAST_SOURCE_TYPES);

export function isValidWeeklyForecastScenario(value: unknown): value is ModelForecastScenario {
  return typeof value === 'string' && scenarioSet.has(value);
}

export function isValidWeeklyForecastSourceType(value: unknown): value is ModelForecastSourceType {
  return typeof value === 'string' && sourceTypeSet.has(value);
}
