export interface NormalizedTimestamp {
  iso: string;
  localDate: string;
}

export const REWE_TIMEZONE = "Europe/Berlin";

const ISO_DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const GERMAN_DATE_ONLY_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/;
const GERMAN_DATETIME_RE = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/;
const EXPLICIT_TZ_RE = /(Z|[+-]\d{2}:?\d{2})$/i;
const NAIVE_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/;

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  });
}

function parseOffsetString(rawOffset: string): string {
  if (!rawOffset || rawOffset === "GMT" || rawOffset === "UTC") {
    return "+00:00";
  }
  const match = rawOffset.match(/^(?:GMT|UTC)([+-]\d{2}):?(\d{2})$/);
  if (match) {
    return `${match[1]}:${match[2]}`;
  }
  const shortMatch = rawOffset.match(/^(?:GMT|UTC)([+-]\d)$/);
  if (shortMatch) {
    return `${shortMatch[1][0]}0${shortMatch[1][1]}:00`;
  }
  return "+00:00";
}

function offsetToMinutes(offset: string): number {
  const match = offset.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

function extractParts(
  date: Date,
  timeZone: string
): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
  offset: string;
} {
  const parts = getFormatter(timeZone).formatToParts(date);
  const byType: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      byType[part.type] = part.value;
    }
  }
  const hour = byType.hour === "24" ? "00" : byType.hour || "00";
  return {
    year: byType.year || "1970",
    month: byType.month || "01",
    day: byType.day || "01",
    hour,
    minute: byType.minute || "00",
    second: byType.second || "00",
    offset: parseOffsetString(byType.timeZoneName || "GMT"),
  };
}

export function formatInTimeZone(
  date: Date,
  timeZone: string = REWE_TIMEZONE
): NormalizedTimestamp {
  const p = extractParts(date, timeZone);
  const localDate = `${p.year}-${p.month}-${p.day}`;
  return {
    iso: `${localDate}T${p.hour}:${p.minute}:${p.second}${p.offset}`,
    localDate,
  };
}

function resolveNaiveLocalDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  timeZone: string
): Date {
  const wallAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const pass1Offset = offsetToMinutes(
    extractParts(new Date(wallAsUtcMs), timeZone).offset
  );
  const candidate1 = wallAsUtcMs - pass1Offset * 60_000;
  const pass2Offset = offsetToMinutes(
    extractParts(new Date(candidate1), timeZone).offset
  );
  return new Date(wallAsUtcMs - pass2Offset * 60_000);
}

/**
 * Normalize upstream REWE timestamps (ISO-8601, German dd.MM.yyyy, or naive local datetimes)
 * into consistent ISO-8601 with explicit Europe/Berlin offset + YYYY-MM-DD localDate.
 */
export function normalizeReweTimestamp(
  raw?: string | null,
  timeZone: string = REWE_TIMEZONE
): NormalizedTimestamp | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const isoDateOnly = trimmed.match(ISO_DATE_ONLY_RE);
  if (isoDateOnly) {
    const [, y, m, d] = isoDateOnly;
    const instant = resolveNaiveLocalDate(
      Number(y),
      Number(m),
      Number(d),
      0,
      0,
      0,
      0,
      timeZone
    );
    return formatInTimeZone(instant, timeZone);
  }

  const deDateOnly = trimmed.match(GERMAN_DATE_ONLY_RE);
  if (deDateOnly) {
    const [, d, m, y] = deDateOnly;
    const instant = resolveNaiveLocalDate(
      Number(y),
      Number(m),
      Number(d),
      0,
      0,
      0,
      0,
      timeZone
    );
    return formatInTimeZone(instant, timeZone);
  }

  const deDateTime = trimmed.match(GERMAN_DATETIME_RE);
  if (deDateTime) {
    const [, d, m, y, hh, mm, ss] = deDateTime;
    const instant = resolveNaiveLocalDate(
      Number(y),
      Number(m),
      Number(d),
      Number(hh),
      Number(mm),
      Number(ss ?? 0),
      0,
      timeZone
    );
    return formatInTimeZone(instant, timeZone);
  }

  if (EXPLICIT_TZ_RE.test(trimmed)) {
    const normalizedInput = trimmed.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    const parsed = new Date(normalizedInput);
    if (!Number.isNaN(parsed.getTime())) {
      return formatInTimeZone(parsed, timeZone);
    }
  }

  const naive = trimmed.match(NAIVE_DATETIME_RE);
  if (naive) {
    const ms = naive[7] ? Number(naive[7].slice(0, 3).padEnd(3, "0")) : 0;
    const instant = resolveNaiveLocalDate(
      Number(naive[1]),
      Number(naive[2]),
      Number(naive[3]),
      Number(naive[4]),
      Number(naive[5]),
      Number(naive[6]),
      ms,
      timeZone
    );
    return formatInTimeZone(instant, timeZone);
  }

  const fallback = new Date(trimmed);
  if (!Number.isNaN(fallback.getTime())) {
    return formatInTimeZone(fallback, timeZone);
  }
  return undefined;
}
