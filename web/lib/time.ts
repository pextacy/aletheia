// Shared day-bucketing used by both the RPC aggregator and the Neon reader, so
// the analytics series is computed one way regardless of data source.

const DAY_MS = 86_400_000;

/** Cap on the filled daily series so a wide time span can't explode the array. */
export const MAX_SERIES_DAYS = 120;

export interface DaySeriesPoint {
  /** UTC calendar day, YYYY-MM-DD. */
  day: string;
  /** Attestations sealed that day. */
  count: number;
  /** Total projects registered up to and including that day. */
  cumulativeProjects: number;
}

/** Unix seconds → UTC YYYY-MM-DD. */
export function dayOf(tsSeconds: number): string {
  return new Date(tsSeconds * 1000).toISOString().slice(0, 10);
}

/** Add `n` whole days to a YYYY-MM-DD string, returning YYYY-MM-DD. */
export function addDays(day: string, n: number): string {
  const base = new Date(`${day}T00:00:00Z`).getTime();
  return new Date(base + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole UTC days from one YYYY-MM-DD to another (can be negative). */
export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / DAY_MS);
}

/**
 * Build a continuous daily series from first to last activity, filling gaps with
 * zero-attestation days and carrying the cumulative project count forward.
 * `attByDay` / `regByDay` are day → count maps; timestamps are unix seconds.
 */
export function buildDaySeries(
  attByDay: Map<string, number>,
  regByDay: Map<string, number>,
  firstActivitySeconds: number | null,
  lastActivitySeconds: number | null
): DaySeriesPoint[] {
  if (firstActivitySeconds === null) return [];
  const startDay = dayOf(firstActivitySeconds);
  const endDay = dayOf(lastActivitySeconds ?? firstActivitySeconds);
  const span = Math.min(daysBetween(startDay, endDay), MAX_SERIES_DAYS - 1);
  const series: DaySeriesPoint[] = [];
  let cumulative = 0;
  for (let i = 0; i <= span; i++) {
    const day = addDays(startDay, i);
    cumulative += regByDay.get(day) ?? 0;
    series.push({ day, count: attByDay.get(day) ?? 0, cumulativeProjects: cumulative });
  }
  return series;
}
