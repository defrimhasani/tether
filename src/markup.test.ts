import { describe, expect, it } from "vitest";
import { detectKind, formatMarkup, maskHeader, tokenizeMarkup } from "./markup";
import { matchingPaths } from "./JsonTree";

const ct = (v: string): [string, string][] => [["Content-Type", v]];

describe("detectKind", () => {
  it("trusts content-type first", () => {
    expect(detectKind(ct("application/json; charset=utf-8"), "x")).toBe("json");
    expect(detectKind(ct("application/problem+json"), "{}")).toBe("json");
    expect(detectKind(ct("text/html"), "")).toBe("html");
    expect(detectKind(ct("image/svg+xml"), "<svg/>")).toBe("xml");
    expect(detectKind(ct("image/png"), "")).toBe("binary");
  });
  it("sniffs bodies without a useful content-type", () => {
    expect(detectKind([], '{"a":1}')).toBe("json");
    expect(detectKind([], "{not json")).toBe("text");
    expect(detectKind(ct("text/plain"), "<!DOCTYPE html><html>")).toBe("html");
    expect(detectKind([], '<?xml version="1.0"?><a/>')).toBe("xml");
    expect(detectKind([], "\uFFFD".repeat(20))).toBe("binary");
  });
});

describe("formatMarkup", () => {
  it("indents nested elements and keeps short text inline", () => {
    expect(formatMarkup("<root><item id=\"1\"><name>A</name><br/></item></root>")).toBe(
      ["<root>", '  <item id="1">', "    <name>A</name>", "    <br/>", "  </item>", "</root>"].join("\n"),
    );
  });
  it("leaves script contents alone and handles void elements", () => {
    const out = formatMarkup("<html><head><meta charset=utf-8><script>if (a<b) x()</script></head></html>");
    expect(out).toContain("    <meta charset=utf-8>\n    <script>");
    expect(out).toContain("if (a<b) x()");
  });
});

describe("tokenizeMarkup", () => {
  it("splits tags, attributes and values and round-trips the source", () => {
    const src = '<a href="/x" data-y=1>hi</a><!-- c -->';
    const toks = tokenizeMarkup(src);
    expect(toks.map((t) => t.s).join("")).toBe(src);
    expect(toks.filter((t) => t.t === "attr").map((t) => t.s)).toEqual(["href", "data-y"]);
    expect(toks.find((t) => t.t === "comment")?.s).toBe("<!-- c -->");
  });
});

describe("maskHeader", () => {
  it("masks credentials but keeps the scheme and ends", () => {
    expect(maskHeader("Authorization", "Bearer abcdefghijklmnop")).toBe("Bearer abcd••••••mnop");
    expect(maskHeader("X-Api-Key", "1234567890")).toBe("1234••••••7890");
    expect(maskHeader("Accept", "application/json")).toBe("application/json");
  });
});

describe("matchingPaths", () => {
  it("keeps matches and their ancestors", () => {
    const hits = matchingPaths({ user: { name: "Ada", id: 7 }, list: ["x", "ada"] }, "ada");
    expect([...hits].sort()).toEqual(["", "list", "list.1", "user", "user.name"]);
  });
});
