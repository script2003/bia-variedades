import { describe, expect, it } from "vitest";
import { parseDomains } from "./SettingsPage";

describe("parseDomains", () => {
  it("aceita um domínio por linha, vírgulas ou espaços", () => {
    expect(parseDomains("a.com\n b.com , c.com;d.com\n\n")).toEqual(["a.com", "b.com", "c.com", "d.com"]);
    expect(parseDomains("   ")).toEqual([]);
  });
});
