const NZ_TZ = "Pacific/Auckland";

/** Format a date as "5 Sept 2026" in NZ timezone. */
export function formatNZDate(date: string | Date | null | undefined): string {
  if (!date) return "—";

  const value = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(value.getTime())) return "—";

  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: NZ_TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
}

/** morning / afternoon / evening from current NZ time. */
export function getNZTimeOfDay(): "morning" | "afternoon" | "evening" {
  const hourPart = new Intl.DateTimeFormat("en-NZ", {
    timeZone: NZ_TZ,
    hour: "numeric",
    hourCycle: "h23",
  })
    .formatToParts(new Date())
    .find((part) => part.type === "hour");

  const hour = Number(hourPart?.value ?? 0);

  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}
