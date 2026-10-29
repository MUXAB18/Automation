const COMMON = [
  "America/Toronto",
  "America/Vancouver",
  "America/Edmonton",
  "America/Winnipeg",
  "America/Halifax",
  "America/St_Johns",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "UTC",
];

/** Common time zones first, then everything else alphabetically (so the list is usable without typing). */
export function orderedTimeZones(all: string[]): string[] {
  const common = COMMON.filter((z) => all.includes(z));
  return [...common, ...all.filter((z) => !common.includes(z))];
}
