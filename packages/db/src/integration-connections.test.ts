import { beforeEach, describe, expect, it } from "vitest";
import { forClient } from "./access";
import { ScopeViolationError } from "./errors";
import { makeClient, prisma, resetDb } from "../test/helpers";

describe("integration_connections tenant scoping", () => {
  beforeEach(resetDb);

  it("only returns and modifies the active client's connection", async () => {
    const a = await makeClient("Alpha");
    const b = await makeClient("Beta");
    const dbA = forClient(a.id);
    await dbA.integrationConnection.create({
      data: {
        clientId: a.id,
        provider: "google",
        scopes: [],
        encryptedRefreshToken: "v1.cipher.a",
      },
    });
    await prisma().integrationConnection.create({
      data: {
        clientId: b.id,
        provider: "google",
        scopes: [],
        encryptedRefreshToken: "v1.cipher.b",
      },
    });

    const visible = await dbA.integrationConnection.findMany();
    expect(visible).toHaveLength(1);
    expect(visible[0]?.clientId).toBe(a.id);

    const touched = await dbA.integrationConnection.updateMany({
      data: { status: "disconnected" },
    });
    expect(touched.count).toBe(1);
    const other = await prisma().integrationConnection.findFirstOrThrow({
      where: { clientId: b.id },
    });
    expect(other.status).toBe("active");
  });

  it("refuses to create a connection for another client", async () => {
    const a = await makeClient("Alpha");
    const b = await makeClient("Beta");
    await expect(
      forClient(a.id).integrationConnection.create({
        data: { clientId: b.id, provider: "google", scopes: [], encryptedRefreshToken: "x" },
      }),
    ).rejects.toThrow(ScopeViolationError);
  });

  it("allows one connection per provider per client", async () => {
    const a = await makeClient("Alpha");
    const data = {
      clientId: a.id,
      provider: "google" as const,
      scopes: [],
      encryptedRefreshToken: "x",
    };
    const db = forClient(a.id);
    await db.integrationConnection.create({ data });
    await expect(db.integrationConnection.create({ data })).rejects.toThrow();
  });
});
