/**
 * Browser form fields -> service input. Pure functions (no server-only code), so they can be unit
 * tested against the real validation schemas. The services validate and normalise everything again;
 * this file only knows how the forms name their fields.
 */

export const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
};

/** Form fields -> the service input. The service validates everything again (and normalises lists). */
export function clientInput(formData: FormData) {
  return {
    name: text(formData, "name") ?? "",
    slug: text(formData, "slug"),
    agencyId: text(formData, "agencyId"),
    primaryDomain: text(formData, "primaryDomain"),
    industry: text(formData, "industry"),
    goals: text(formData, "goals"),
    targetLocations: text(formData, "targetLocations") ?? "",
    timezone: text(formData, "timezone") ?? "UTC",
    locale: text(formData, "locale") ?? "en-CA",
    reportEmail: text(formData, "reportEmail"),
    reportIntervalDays: text(formData, "reportIntervalDays"),
    preferences: {
      reportDelivery: text(formData, "preferences.reportDelivery") ?? "email",
      reportWeekday: text(formData, "preferences.reportWeekday"),
      weeklySummary: formData.get("preferences.weeklySummary") === "on",
    },
  } as never;
}

/** Form fields -> service input. Optional sections are sent only when switched on; the service validates everything. */
export function projectInput(formData: FormData) {
  return {
    name: text(formData, "name") ?? "",
    kind: text(formData, "kind") ?? "general",
    status: text(formData, "status") ?? "active",
    description: text(formData, "description"),
    goals: text(formData, "goals"),
    startsOn: text(formData, "startsOn"),
    endsOn: text(formData, "endsOn"),
    memberIds: formData.getAll("memberIds").filter((v): v is string => typeof v === "string"),
    seo:
      formData.get("seoEnabled") === "on"
        ? {
            websiteId: text(formData, "seo.websiteId") ?? "",
            targetCountry: text(formData, "seo.targetCountry") ?? "CA",
            targetLanguage: text(formData, "seo.targetLanguage") ?? "en",
            keywords: text(formData, "seo.keywords") ?? "",
            organicSessionsGoal: text(formData, "seo.organicSessionsGoal"),
            topTenKeywordsGoal: text(formData, "seo.topTenKeywordsGoal"),
          }
        : undefined,
    social:
      formData.get("socialEnabled") === "on"
        ? {
            channels: formData.getAll("social.channels"),
            postsPerWeek: text(formData, "social.postsPerWeek") ?? "3",
            requirements: text(formData, "social.requirements"),
          }
        : undefined,
  };
}

/** The task create/edit form. The estimate is typed in hours (e.g. 1.5) and stored in minutes. */
export function taskInput(formData: FormData) {
  const hours = text(formData, "estimateHours")?.trim();
  const estimate = hours ? Math.round(Number(hours.replace(",", ".")) * 60) : undefined;
  return {
    title: text(formData, "title") ?? "",
    description: text(formData, "description"),
    acceptanceCriteria: text(formData, "acceptanceCriteria"),
    type: text(formData, "type") ?? "general",
    priority: text(formData, "priority") ?? "medium",
    projectId: text(formData, "projectId"),
    dueDate: text(formData, "dueDate"),
    estimateMinutes: Number.isNaN(estimate) ? -1 : estimate,
    assigneeId: text(formData, "assigneeId"),
    contentItemId: text(formData, "contentItemId"),
    seoIssueIds: formData.getAll("seoIssueIds").filter((v): v is string => typeof v === "string"),
    labels: text(formData, "labels") ?? "",
  };
}
