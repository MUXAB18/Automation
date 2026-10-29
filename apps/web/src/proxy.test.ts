import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

const request = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost:3000${path}`, { headers: cookie ? { cookie } : {} });

describe("proxy", () => {
  it("sends signed-out visitors to /login", () => {
    const res = proxy(request("/customers"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("lets signed-out visitors see /login", () => {
    expect(proxy(request("/login")).headers.get("location")).toBeNull();
  });

  it("lets visitors with a session cookie through and bounces them off /login", () => {
    const cookie = "better-auth.session_token=abc.def";
    expect(proxy(request("/customers", cookie)).headers.get("location")).toBeNull();
    expect(proxy(request("/login", cookie)).headers.get("location")).toBe("http://localhost:3000/");
  });
});
