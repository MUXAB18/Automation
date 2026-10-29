import { beforeEach, describe, expect, it } from "vitest";
import { forCustomer } from "./access";
import { ScopeViolationError } from "./errors";
import { makeCustomer, prisma, resetDb } from "../test/helpers";

describe("integration_connections tenant scoping", () => {
  beforeEach(resetDb);

  it("only returns and modifies the active customer's connection", async () => {
    const a = await makeCustomer("Alpha");
    const b = await makeCustomer("Beta");
    const dbA = forCustomer(a.id);
    await dbA.integrationConnection.create({
      data: {
        customerId: a.id,
        provider: "google",
        scopes: [],
        encryptedRefreshToken: "v1.cipher.a",
      },
    });
    await prisma().integrationConnection.create({
      data: {
        customerId: b.id,
        provider: "google",
        scopes: [],
        encryptedRefreshToken: "v1.cipher.b",
      },
    });

    const visible = await dbA.integrationConnection.findMany();
    expect(visible).toHaveLength(1);
    expect(visible[0]?.customerId).toBe(a.id);

    const touched = await dbA.integrationConnection.updateMany({
      data: { status: "disconnected" },
    });
    expect(touched.count).toBe(1);
    const other = await prisma().integrationConnection.findFirstOrThrow({
      where: { customerId: b.id },
    });
    expect(other.status).toBe("active");
  });

  it("refuses to create a connection for another customer", async () => {
    const a = await makeCustomer("Alpha");
    const b = await makeCustomer("Beta");
    await expect(
      forCustomer(a.id).integrationConnection.create({
        data: { customerId: b.id, provider: "google", scopes: [], encryptedRefreshToken: "x" },
      }),
    ).rejects.toThrow(ScopeViolationError);
  });

  it("allows one connection per provider per customer", async () => {
    const a = await makeCustomer("Alpha");
    const data = {
      customerId: a.id,
      provider: "google" as const,
      scopes: [],
      encryptedRefreshToken: "x",
    };
    const db = forCustomer(a.id);
    await db.integrationConnection.create({ data });
    await expect(db.integrationConnection.create({ data })).rejects.toThrow();
  });
});
