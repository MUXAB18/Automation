import { getClientContext, requirePermission, type Actor } from "../access";
import { recordAudit } from "../audit";
import { brandGuidelineSchema, parseInput, type BrandGuidelineInput } from "../schemas";

/**
 * Client-specific brand guidelines. One logical guideline per client; every save creates a NEW
 * version (and marks it active), so earlier wording stays available and content can say which version
 * it was written against. Reading needs client.view, writing needs client.update.
 */
const NAME = "Brand guidelines";

export async function getBrandGuidelines(actor: Actor, clientId: string) {
  const ctx = await getClientContext(actor, clientId);
  const versions = await ctx.db.brandGuideline.findMany({
    where: { name: NAME },
    orderBy: { version: "desc" },
    take: 20,
    include: { createdBy: { select: { name: true } } },
  });
  return {
    active: versions.find((v) => v.isActive) ?? null,
    history: versions,
    canEdit: ctx.access.permissions.has("client.update"),
  };
}

export async function saveBrandGuideline(
  actor: Actor,
  clientId: string,
  input: BrandGuidelineInput,
) {
  const ctx = await requirePermission(actor, clientId, "client.update");
  const data = parseInput(brandGuidelineSchema, input);
  return ctx.db.$transaction(async (tx) => {
    const latest = await tx.brandGuideline.findFirst({
      where: { name: NAME },
      orderBy: { version: "desc" },
    });
    const now = new Date();
    // Only one version is active at a time.
    await tx.brandGuideline.updateMany({
      where: { name: NAME, isActive: true },
      data: { isActive: false },
    });
    const created = await tx.brandGuideline.create({
      data: {
        agencyId: ctx.agencyId,
        clientId,
        name: NAME,
        version: (latest?.version ?? 0) + 1,
        toneOfVoice: data.toneOfVoice ?? null,
        audience: data.audience ?? null,
        styleNotes: data.styleNotes ?? null,
        dos: data.dos,
        donts: data.donts,
        bannedTerms: data.bannedTerms,
        isActive: true,
        publishedAt: now,
        createdById: actor.userId,
      },
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId,
      action: "brand_guideline.saved",
      entityType: "brand_guideline",
      entityId: created.id,
      before: latest ? { version: latest.version } : null,
      after: { version: created.version, bannedTerms: created.bannedTerms.length },
    });
    return created;
  });
}
