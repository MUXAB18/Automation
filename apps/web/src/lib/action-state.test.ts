import { describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@automation/db";
import { toFormState } from "./action-state";

describe("toFormState", () => {
  it("maps validation errors to field errors", () => {
    const state = toFormState(new ValidationError({ name: ["Name is required"] }));
    expect(state.fieldErrors).toEqual({ name: ["Name is required"] });
    expect(state.error).toBeTruthy();
  });

  it("maps expected domain errors to a message", () => {
    expect(toFormState(new ConflictError("slug in use")).error).toBe("slug in use");
    expect(toFormState(new ForbiddenError()).error).toMatch(/permission/);
    expect(toFormState(new NotFoundError()).error).toBe("Not found");
  });

  it("rethrows unexpected errors", () => {
    expect(() => toFormState(new Error("boom"))).toThrow("boom");
  });
});
