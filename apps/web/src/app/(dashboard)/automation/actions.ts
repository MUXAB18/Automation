"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  applyTemplate,
  archiveRule,
  createRule,
  installRecommendedRules,
  runRuleNow,
  saveTemplate,
  setRuleEnabled,
  updateRule,
} from "@automation/db";
import { errorMessage, toFormState, type FormState } from "@/lib/action-state";
import { ruleInput } from "@/lib/automation-input";
import { text } from "@/lib/form-input";
import { requireActor } from "@/lib/session";

export type Result = { error?: string; success?: string };

const refresh = () => revalidatePath("/automation", "layout");

export async function createRuleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireActor();
  try {
    const input = ruleInput(formData);
    await createRule(actor, { clientId: text(formData, "clientId") ?? "", ...input });
  } catch (error) {
    return toFormState(error);
  }
  refresh();
  redirect("/automation");
}

export async function updateRuleAction(
  ruleId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor();
  try {
    const { projectId, payload } = ruleInput(formData);
    await updateRule(actor, ruleId, { projectId, payload });
  } catch (error) {
    return toFormState(error);
  }
  refresh();
  redirect("/automation");
}

export async function setRuleEnabledAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  const enabled = text(formData, "enabled") === "true";
  try {
    await setRuleEnabled(actor, text(formData, "ruleId") ?? "", enabled);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  refresh();
  return { success: enabled ? "Rule enabled" : "Rule paused" };
}

export async function runRuleNowAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  try {
    await runRuleNow(actor, text(formData, "ruleId") ?? "");
  } catch (error) {
    return { error: errorMessage(error) };
  }
  refresh();
  return { success: "Queued. The worker will run it within a minute" };
}

export async function archiveRuleAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  try {
    await archiveRule(actor, text(formData, "ruleId") ?? "");
  } catch (error) {
    return { error: errorMessage(error) };
  }
  refresh();
  return { success: "Rule deleted" };
}

export async function installRecommendedAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  try {
    const r = await installRecommendedRules(actor, text(formData, "clientId") ?? "");
    refresh();
    return {
      success: r.created
        ? `Added ${r.created} paused rule${r.created === 1 ? "" : "s"}. Review them, then enable`
        : "All recommended rules are already there",
    };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function createTemplateAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor();
  try {
    const { payload, enabled } = ruleInput(formData);
    await saveTemplate(actor, { agencyId: text(formData, "agencyId") ?? "", enabled, payload });
  } catch (error) {
    return toFormState(error);
  }
  refresh();
  redirect("/automation/templates");
}

export async function applyTemplateAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  try {
    const r = await applyTemplate(actor, text(formData, "templateId") ?? "");
    refresh();
    return {
      success: `${r.created} created, ${r.updated} updated, ${r.keptCustomized} kept (customised by the client)`,
    };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}
