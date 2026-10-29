import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

const request = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost:3000${path}`, { headers: cookie ? { cookie } : {} });

describe("proxy", () => {
  it("sends signed-out visitors to /login", () => {
    const res = proxy(request("/clients"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fclients");
  });

  it("lets signed-out visitors see /login", () => {
    expect(proxy(request("/login")).headers.get("location")).toBeNull();
  });

  it("lets visitors with a session cookie through and bounces them off /login", () => {
    const cookie = "better-auth.session_token=abc.def";
    expect(proxy(request("/clients", cookie)).headers.get("location")).toBeNull();
    expect(proxy(request("/login", cookie)).headers.get("location")).toBe("http://localhost:3000/");
  });

  it("keeps the requested page so sign-in can return to it", () => {
    const res = proxy(request("/team?agency=a1"));
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Fteam%3Fagency%3Da1",
    );
  });

  it("lets signed-out visitors reach password reset and invitation pages", () => {
    for (const path of ["/forgot-password", "/reset-password", "/invite/some-token"]) {
      expect(proxy(request(path)).headers.get("location"), path).toBeNull();
    }
  });

  it("does not bounce a signed-in visitor off an invitation link", () => {
    const cookie = "better-auth.session_token=abc.def";
    expect(proxy(request("/invite/some-token", cookie)).headers.get("location")).toBeNull();
  });
});
