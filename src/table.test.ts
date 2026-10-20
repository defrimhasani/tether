import { describe, expect, it } from "vitest";
import { columnsOf, columnWidth, findArrays, rowsOf, sortRows, toDelimited } from "./table";

describe("findArrays", () => {
  it("finds object arrays at the root and nested, largest first", () => {
    const body = { meta: { tags: ["a", "b"] }, data: { items: [{ id: 1 }, { id: 2 }, { id: 3 }] }, errors: [{ code: 1 }] };
    expect(findArrays(body).map((a) => a.path.join("."))).toEqual(["data.items", "errors"]);
    expect(findArrays([{ a: 1 }])[0]).toEqual({ path: [], length: 1 });
  });
  it("ignores arrays of primitives and ranks item-specific paths last", () => {
    expect(findArrays({ ids: [1, 2, 3] })).toEqual([]);
    const orders = { orders: [{ id: 1, lines: [{ sku: "a" }, { sku: "b" }, { sku: "c" }] }] };
    expect(findArrays(orders).map((a) => a.path.join("."))).toEqual(["orders", "orders.0.lines"]);
  });
});

describe("columns and sorting", () => {
  const rows = rowsOf([{ id: 2, name: "b" }, { id: 10, name: "A", extra: true }, { id: null, name: "c" }, { name: "d" }]);

  it("collects columns in order of first appearance", () => {
    expect(columnsOf(rows)).toEqual(["id", "name", "extra"]);
  });

  it("sorts numbers numerically and strings naturally, with missing values last", () => {
    expect(sortRows(rows, { col: "id", dir: "asc" }).map((r) => r.index)).toEqual([0, 1, 2, 3]);
    expect(sortRows(rows, { col: "id", dir: "desc" }).map((r) => r.index)).toEqual([1, 0, 2, 3]);
    expect(sortRows(rows, { col: "name", dir: "asc" }).map((r) => r.value.name)).toEqual(["A", "b", "c", "d"]);
    expect(sortRows(rowsOf([{ v: "item 10" }, { v: "item 9" }]), { col: "v", dir: "asc" }).map((r) => r.value.v)).toEqual(["item 9", "item 10"]);
  });
});

describe("toDelimited", () => {
  it("escapes CSV and flattens TSV", () => {
    const rows = rowsOf([{ a: 'say "hi", ok', b: { x: 1 } }, { a: "line\nbreak" }]);
    expect(toDelimited(rows, ["a", "b"], ",")).toBe('a,b\n"say ""hi"", ok","{""x"":1}"\n"line\nbreak",');
    expect(toDelimited(rows, ["a"], "\t")).toBe('a\nsay "hi", ok\nline break');
  });
});

describe("columnWidth", () => {
  it("accounts for longer values late in large arrays", () => {
    const rows = rowsOf(Array.from({ length: 5000 }, (_, i) => ({ name: `Item ${i + 1}` })));
    expect(columnWidth(rows, "name")).toBeGreaterThanOrEqual(Math.round("Item 5000".length * 7.4 + 24));
  });
});
