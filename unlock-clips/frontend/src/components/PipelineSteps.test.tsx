import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Project } from "../api/types";
import { makeProject } from "../test/fixtures";
import PipelineSteps, { buildSteps } from "./PipelineSteps";

const states = (project: Project) => buildSteps(project).slice(0, 4).map((s) => s.state);
const base = makeProject();

describe("buildSteps", () => {
  it("marca as quatro etapas implementadas como concluídas e nunca as futuras", () => {
    const steps = buildSteps(base);
    expect(states(base)).toEqual(["done", "done", "done", "done"]);
    expect(steps.slice(4).every((s) => s.state === "unavailable")).toBe(true);
  });

  it("acompanha importação, verificação, leitura e extração", () => {
    const importing = makeProject({
      status: "importing",
      source: { ...base.source, kind: "link", filename: null, sha256: null },
      media: null,
      audio: null,
    });
    expect(states(importing)).toEqual(["active", "pending", "pending", "pending"]);
    const validating = makeProject({ status: "validating", media: null, audio: null });
    expect(states(validating)).toEqual(["done", "active", "pending", "pending"]);
    const probing = makeProject({ status: "extracting_audio", media: null, audio: null });
    expect(states(probing)).toEqual(["done", "done", "active", "pending"]);
    const extracting = makeProject({ status: "extracting_audio", audio: null });
    expect(states(extracting)).toEqual(["done", "done", "done", "active"]);
  });

  it("aponta a etapa que falhou", () => {
    expect(states(makeProject({ status: "failed", audio: null }))).toEqual(["done", "done", "done", "error"]);
    expect(states(makeProject({ status: "failed", media: null, audio: null }))).toEqual(["done", "done", "error", "pending"]);
    const badFile = makeProject({ status: "failed", source: { ...base.source, sha256: null }, media: null, audio: null });
    expect(states(badFile)).toEqual(["done", "error", "pending", "pending"]);
    const failedDownload = makeProject({
      status: "failed",
      source: { ...base.source, kind: "link", filename: null, sha256: null },
      media: null,
      audio: null,
    });
    expect(states(failedDownload)[0]).toBe("error");
  });
});

describe("PipelineSteps", () => {
  it("renderiza rótulos acessíveis", () => {
    render(<PipelineSteps project={base} />);
    expect(screen.getByLabelText("Extração de áudio: concluída")).toBeInTheDocument();
    expect(screen.getByLabelText("Transcrição com timestamps: disponível em breve")).toBeInTheDocument();
  });
});
