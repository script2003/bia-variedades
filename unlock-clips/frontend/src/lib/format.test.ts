import { describe, expect, it } from "vitest";
import { formatBytes, formatPercent, formatRelative } from "./format";

describe("formatBytes", () => {
  it("formata em unidades binárias com vírgula decimal", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1,5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5,0 MB");
    expect(formatBytes(250 * 1024 * 1024 * 1024)).toBe("250 GB");
  });

  it("trata valores ausentes ou inválidos", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });
});

describe("formatPercent", () => {
  it("limita entre 0% e 100%", () => {
    expect(formatPercent(0.456)).toBe("46%");
    expect(formatPercent(2)).toBe("100%");
    expect(formatPercent(null)).toBe("");
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-10-12T12:00:00Z");
  it("descreve intervalos recentes", () => {
    expect(formatRelative("2026-10-12T11:59:30Z", now)).toBe("agora mesmo");
    expect(formatRelative("2026-10-12T11:45:00Z", now)).toBe("há 15 min");
    expect(formatRelative("2026-10-12T09:00:00Z", now)).toBe("há 3 h");
    expect(formatRelative("2026-10-11T12:00:00Z", now)).toBe("há 1 dia");
    expect(formatRelative("2026-10-07T12:00:00Z", now)).toBe("há 5 dias");
  });
});
