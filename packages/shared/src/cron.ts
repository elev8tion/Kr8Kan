/**
 * Minimal 5-field cron parser: `minute hour day-of-month month day-of-week`.
 * Supports `*`, plain numbers, comma lists, ranges (a-b), and steps
 * (*\/n or a-b/n). No seconds, no names, no @keywords — deliberately
 * small; validated at workflow save time.
 */

interface CronField {
  matches(value: number): boolean;
}

function parseField(spec: string, min: number, max: number): CronField {
  const values = new Set<number>();
  for (const part of spec.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`invalid step in "${part}"`);
    }
    let lo: number;
    let hi: number;
    if (rangePart === "*" || rangePart === "") {
      lo = min;
      hi = max;
    } else if (rangePart!.includes("-")) {
      const [a, b] = rangePart!.split("-").map(Number);
      lo = a!;
      hi = b!;
    } else {
      lo = hi = Number(rangePart);
    }
    if (
      !Number.isInteger(lo) ||
      !Number.isInteger(hi) ||
      lo < min ||
      hi > max ||
      lo > hi
    ) {
      throw new Error(`field "${part}" out of range ${min}-${max}`);
    }
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return { matches: (v) => values.has(v) };
}

export interface CronExpr {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

export function parseCron(expr: string): CronExpr {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error("cron needs 5 fields: minute hour day month weekday");
  }
  return {
    minute: parseField(fields[0]!, 0, 59),
    hour: parseField(fields[1]!, 0, 23),
    dayOfMonth: parseField(fields[2]!, 1, 31),
    month: parseField(fields[3]!, 1, 12),
    dayOfWeek: parseField(fields[4]!, 0, 6),
  };
}

export function cronMatches(expr: CronExpr, date: Date): boolean {
  return (
    expr.minute.matches(date.getMinutes()) &&
    expr.hour.matches(date.getHours()) &&
    expr.dayOfMonth.matches(date.getDate()) &&
    expr.month.matches(date.getMonth() + 1) &&
    expr.dayOfWeek.matches(date.getDay())
  );
}

/**
 * Was this cron due at any minute in (since, until]? Used by the hourly
 * scheduler tick — scans minutes so a 09:00 schedule fires even when the
 * tick lands at 09:41. Bounded scan (max 25h).
 */
export function cronDueBetween(expr: CronExpr, since: Date, until: Date): boolean {
  const start = new Date(since.getTime());
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);
  const boundedUntil = Math.min(until.getTime(), since.getTime() + 25 * 3600_000);
  for (let t = start.getTime(); t <= boundedUntil; t += 60_000) {
    if (cronMatches(expr, new Date(t))) return true;
  }
  return false;
}

export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}
