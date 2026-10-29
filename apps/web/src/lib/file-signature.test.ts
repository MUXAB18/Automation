import { describe, expect, it } from "vitest";
import { fileMatchesType } from "./file-signature";

const bytes = (...b: number[]) => new Uint8Array(b);
const text = (s: string) => new TextEncoder().encode(s);

describe("fileMatchesType", () => {
  it("accepts files that start like their claimed type", () => {
    expect(
      fileMatchesType("image/png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1)),
    ).toBe(true);
    expect(fileMatchesType("image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(fileMatchesType("image/gif", text("GIF89a...."))).toBe(true);
    expect(fileMatchesType("image/webp", text("RIFF\0\0\0\0WEBPVP8 "))).toBe(true);
    expect(fileMatchesType("application/pdf", text("%PDF-1.7"))).toBe(true);
    expect(fileMatchesType("application/zip", bytes(0x50, 0x4b, 0x03, 0x04))).toBe(true);
    expect(fileMatchesType("text/plain", text("hello — wörld"))).toBe(true);
    expect(fileMatchesType("text/csv", text("a,b\n1,2\n"))).toBe(true);
  });

  it("rejects mislabelled content, e.g. a script or executable renamed to .png or .pdf", () => {
    expect(fileMatchesType("image/png", text("<script>alert(1)</script>"))).toBe(false);
    expect(fileMatchesType("application/pdf", bytes(0x4d, 0x5a, 0x90, 0x00))).toBe(false); // Windows executable
    expect(fileMatchesType("image/jpeg", text("GIF89a"))).toBe(false);
    expect(fileMatchesType("text/plain", bytes(0x4d, 0x5a, 0x00, 0x01))).toBe(false); // binary with NUL
    expect(fileMatchesType("text/plain", bytes(0xff, 0xfe, 0xfd))).toBe(false); // invalid UTF-8
  });

  it("rejects types it does not know", () => {
    expect(fileMatchesType("application/x-msdownload", bytes(0x4d, 0x5a))).toBe(false);
    expect(fileMatchesType("", bytes())).toBe(false);
  });
});
