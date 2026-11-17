import { describe, expect, it } from "vitest";
import { resolveCorsOrigins } from "./app";

describe("resolveCorsOrigins", () => {
  it("allows no cross-origin calls unless origins are configured", () => {
    expect(resolveCorsOrigins(undefined)).toBe(false);
    expect(resolveCorsOrigins(" ")).toBe(false);
    expect(
      resolveCorsOrigins("https://forsa.example, https://demo.example"),
    ).toEqual(["https://forsa.example", "https://demo.example"]);
  });
});
