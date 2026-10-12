import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Project } from "../api/types";
import { makeProject } from "../test/fixtures";
import PipelineSteps, { buildSteps } from "./PipelineSteps";

const states = (project: Project) => buildSteps(project).slice(0, 4).map((s) => s.state);
const transcriptState = (project: Project) => buildSteps(project)[4]!.state;
const base = makeProject();

describe("buildSteps", () => {
  it("marca as cinco etapas implementadas como concluídas e nunca as futuras", () => {
    const steps = buildSteps(base);
    expect(states(base)).toEqual(["done", "done", "done", "done"]);
    expect(transcriptState(base)).toBe("done");
    expect(steps[4]!.description).toBe("9 palavras · modelo small");
    expect(steps.slice(5).every((s) => s.state === "unavailable")).toBe(true);
  });

  it("acompanha a transcrição", () => {
    expect(transcriptState(makeProject({ status: "transcribing", transcript: null }))).toBe("active");
    expect(transcriptState(makeProject({ status: "ready", transcript: null }))).toBe("pending");
    const failed = makeProject({
      status: "failed",
      transcript: null,
      job: {
        id: "j",
        kind: "transcribe",
        status: "failed",
        progress: 0.4,
        message: "Falhou",
        error: "x",
        created_at: base.created_at,
        started_at: base.created_at,
        finished_at: base.created_at,
      },
    });
    expect(transcriptState(failed)).toBe("error");
    expect(states(failed)).toEqual(["done", "done", "done", "done"]);
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
    expect(screen.getByLabelText("Transcrição com timestamps: concluída")).toBeInTheDocument();
    expect(screen.getByLabelText("Identificação de cortes: disponível em breve")).toBeInTheDocument();
  });
});
