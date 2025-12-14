export const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Asia/Kolkata",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Asia/Dubai",
  "Australia/Sydney",
];

export const getTimezoneOptions = (): { label: string; value: string }[] => {
  try {
    if (typeof Intl !== "undefined" && "supportedValuesOf" in Intl) {
      // @ts-expect-error supportedValuesOf is available in modern runtimes
      const timezones: string[] = Intl.supportedValuesOf("timeZone");
      if (Array.isArray(timezones) && timezones.length > 0) {
        return timezones.map((tz) => ({ label: tz, value: tz }));
      }
    }
  } catch (error) {
    console.warn("Falling back to common timezones list", error);
  }

  return COMMON_TIMEZONES.map((tz) => ({ label: tz, value: tz }));
};
