"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  requestReport,
  resendDelivery,
  retryReport,
  reviewReport,
  saveReportTemplate,
  saveSchedule,
  sendReport,
} from "@automation/db";
import { errorMessage, toFormState, type FormState } from "@/lib/action-state";
import { text } from "@/lib/form-input";
import { requireActor } from "@/lib/session";

export type Result = { error?: string; success?: string };
const refresh = (id?: string) => {
  revalidatePath("/reports", "layout");
  revalidatePath("/portal", "layout");
  if (id) revalidatePath(`/reports/${id}`);
};
const emails = (raw: string | undefined) =>
  (raw ?? "")
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);

export async function generateReportAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  try {
    await requestReport(actor, {
      clientId: text(formData, "clientId") ?? "",
      periodStart: text(formData, "periodStart") || undefined,
      periodEnd: text(formData, "periodEnd") || undefined,
    });
  } catch (error) {
    return { error: errorMessage(error) };
  }
  refresh();
  return { success: "Queued. The worker builds it within a minute" };
}

export async function retryReportAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  const id = text(formData, "reportId") ?? "";
  try {
    await retryReport(actor, id);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  refresh(id);
  return { success: "Queued again" };
}

export async function reviewReportAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  const id = text(formData, "reportId") ?? "";
  const decision = text(formData, "decision");
  try {
    await reviewReport(actor, id, {
      decision: decision === "approve" ? "approve" : "request_changes",
      note: text(formData, "note"),
    });
  } catch (error) {
    return { error: errorMessage(error) };
  }
  refresh(id);
  return { success: decision === "approve" ? "Approved" : "Sent back" };
}

export async function sendReportAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  const id = text(formData, "reportId") ?? "";
  try {
    const r = await sendReport(actor, id, emails(text(formData, "recipients")));
    refresh(id);
    return {
      success: `${r.added} queued${r.skipped ? `, ${r.skipped} already had it (use Resend)` : ""}`,
    };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function resendAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  try {
    await resendDelivery(actor, text(formData, "deliveryId") ?? "", {
      confirmNotReceived: text(formData, "confirm") === "yes",
    });
  } catch (error) {
    return { error: errorMessage(error) };
  }
  refresh(text(formData, "reportId"));
  return { success: "Queued to send again" };
}

export async function saveScheduleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireActor();
  try {
    await saveSchedule(actor, text(formData, "clientId") ?? "", {
      enabled: formData.get("enabled") === "on",
      intervalDays: Number(text(formData, "intervalDays") ?? 15),
      anchorDate: text(formData, "anchorDate") || undefined,
      sendHour: Number(text(formData, "sendHour") ?? 9),
      recipients: emails(text(formData, "recipients")),
      deliverOnApproval: formData.get("deliverOnApproval") === "on",
    });
  } catch (error) {
    return toFormState(error);
  }
  refresh();
  return { ok: true, message: "Schedule saved" };
}

export async function saveTemplateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireActor();
  try {
    const keys = [
      "summary",
      "seo",
      "search_traffic",
      "social",
      "work",
      "issues",
      "recommendations",
      "data_sources",
    ];
    await saveReportTemplate(actor, text(formData, "agencyId") ?? "", {
      sections: keys.map((key) => ({ key, enabled: formData.get(`section.${key}`) === "on" })),
      defaultIntervalDays: Number(text(formData, "defaultIntervalDays") ?? 15),
      useAi: formData.get("useAi") === "on",
      titlePattern: text(formData, "titlePattern") ?? "",
    });
  } catch (error) {
    return toFormState(error);
  }
  refresh();
  redirect("/reports/schedule");
}
