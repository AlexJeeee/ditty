import { describe, expect, it } from "vitest";
import { extractUrlCandidate, normalizeHttpUrl } from "./url-action";

describe("url-action", () => {
  it("extracts a requested website from a natural language goal", () => {
    expect(extractUrlCandidate("请打开新网页 https://example.com/docs，然后继续")).toBe("https://example.com/docs");
    expect(extractUrlCandidate("打开 localhost:5173")).toBe("localhost:5173");
  });

  it("normalizes url-like input to http or https urls", () => {
    expect(normalizeHttpUrl("example.com")).toEqual({
      ok: true,
      url: "https://example.com/"
    });
    expect(normalizeHttpUrl("http://localhost:5173")).toEqual({
      ok: true,
      url: "http://localhost:5173/"
    });
  });

  it("blocks non-web protocols", () => {
    expect(normalizeHttpUrl("javascript:alert(1)")).toEqual({
      ok: false,
      message: "仅支持打开 http 或 https 网页。"
    });
  });
});
