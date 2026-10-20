import { describe, expect, it } from "vitest";
import { formatJsonTemplate, lexJsonTemplate } from "./jsonTemplate";

describe("lexJsonTemplate", () => {
  it("is lossless and classifies keys, values and references", () => {
    const src = '{\n  "user": "{{@login.body.user}}",\n  "id": {{user_id}},\n  "n": -1.5e3, "ok": true, "x": null, "s": "a\\"b"\n}';
    const segs = lexJsonTemplate(src);
    expect(segs.map((s) => s.s).join("")).toBe(src);
    const of = (t: string) => segs.filter((s) => s.t === t).map((s) => s.s);
    expect(of("key")).toEqual(['"user"', '"id"', '"n"', '"ok"', '"x"', '"s"']);
    expect(of("ref")).toEqual(["{{@login.body.user}}", "{{user_id}}"]);
    expect(of("number")).toEqual(["-1.5e3"]);
    expect(of("bool")).toEqual(["true"]);
    expect(of("null")).toEqual(["null"]);
    expect(of("string")).toEqual(['"', '"', '"a\\"b"']);
  });

  it("survives unterminated strings and stray text", () => {
    const src = '{"a": "unterminated\n  oops }';
    expect(lexJsonTemplate(src).map((s) => s.s).join("")).toBe(src);
  });
});

describe("formatJsonTemplate", () => {
  it("beautifies while keeping references, quoted and bare", () => {
    const src = '{"user":"{{@login.body.user}}","id":{{user_id}},"tags":["a","Bearer {{token}}"]}';
    const out = formatJsonTemplate(src);
    expect(out).toEqual({
      ok: true,
      text: '{\n  "user": "{{@login.body.user}}",\n  "id": {{user_id}},\n  "tags": [\n    "a",\n    "Bearer {{token}}"\n  ]\n}',
    });
  });

  it("minifies", () => {
    expect(formatJsonTemplate('{\n  "a": [1, 2],\n  "b": {{x}}\n}', "")).toEqual({ ok: true, text: '{"a":[1,2],"b":{{x}}}' });
  });

  it("reports where invalid JSON fails", () => {
    const r = formatJsonTemplate('{\n  "a": 1,\n  "b": \n}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.line).toBe(4);
  });

  it("leaves empty bodies alone", () => {
    expect(formatJsonTemplate("  ")).toEqual({ ok: true, text: "  " });
  });
});
