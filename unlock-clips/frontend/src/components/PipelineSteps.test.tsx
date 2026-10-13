import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Project } from "../api/types";
import { makeProject } from "../test/fixtures";
import PipelineSteps, { buildSteps } from "./PipelineSteps";

const states = (project: Project) => buildSteps(project).slice(0, 4).map((s) => s.state);
const transcriptState = (project: Project) => buildSteps(project)[4]!.state;
const base = makeProject();

describe("buildSteps", () => {
  it("mostra o estado real de cada etapa", () => {
    const steps = buildSteps(base);
    expect(states(base)).toEqual(["done", "done", "done", "done"]);
    expect(transcriptState(base)).toBe("done");
    expect(steps[4]!.description).toBe("9 palavras · modelo small");
    expect(steps[5]!.state).toBe("done");
    expect(steps[5]!.description).toBe("2 corte(s) sugerido(s) · 1 aprovado(s)");
    expect(steps[6]!.state).toBe("done"); // um corte aprovado
    expect(steps[7]!.state).toBe("pending"); // nenhum vídeo gerado ainda
    expect(steps).toHaveLength(8);
    const noneApproved = buildSteps(makeProject({ clips: { ...base.clips!, approved: 0 } }));
    expect(noneApproved[6]!.state).toBe("pending");
  });

  it("acompanha a geração dos vídeos", () => {
    const renderState = (project: Project) => buildSteps(project)[7]!.state;
    const summary = base.clips!;
    expect(renderState(makeProject({ status: "rendering" }))).toBe("active");
    expect(renderState(makeProject({ clips: { ...summary, rendered: 2 } }))).toBe("done");
    expect(buildSteps(makeProject({ clips: { ...summary, rendered: 2 } }))[7]!.description).toBe("2 vídeo(s) MP4 com legendas exportado(s)");
    const failed = makeProject({
      status: "failed",
      job: {
        id: "j",
        kind: "render_clips",
        status: "failed",
        progress: 0.5,
        message: "Falhou",
        error: "x",
        created_at: base.created_at,
        started_at: base.created_at,
        finished_at: base.created_at,
      },
    });
    expect(renderState(failed)).toBe("error");
  });

  it("acompanha a detecção de cortes", () => {
    const clipsState = (project: Project) => buildSteps(project)[5]!.state;
    expect(clipsState(makeProject({ status: "detecting_clips", clips: null }))).toBe("active");
    expect(clipsState(makeProject({ status: "ready", clips: null }))).toBe("pending");
    const failed = makeProject({
      status: "failed",
      clips: null,
      job: {
        id: "j",
        kind: "detect_clips",
        status: "failed",
        progress: 0.4,
        message: "Falhou",
        error: "x",
        created_at: base.created_at,
        started_at: base.created_at,
        finished_at: base.created_at,
      },
    });
    expect(clipsState(failed)).toBe("error");
    expect(transcriptState(failed)).toBe("done");
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
    expect(screen.getByLabelText("Identificação de cortes: concluída")).toBeInTheDocument();
    expect(screen.getByLabelText("Revisão e edição: concluída")).toBeInTheDocument();
    expect(screen.getByLabelText("Legendas, formato e MP4: aguardando")).toBeInTheDocument();
  });

  it("conclui revisão e exportação só com cortes aprovados e vídeos gerados", () => {
    const summary = { filename: "clips.json", count: 3, approved: 1, generated_at: "2026-10-10T12:31:00Z", rendered: 2 };
    render(<PipelineSteps project={{ ...base, clips: summary }} />);
    expect(screen.getByLabelText("Revisão e edição: concluída")).toHaveTextContent("1 corte(s) aprovado(s)");
    expect(screen.getByLabelText("Legendas, formato e MP4: concluída")).toHaveTextContent("2 vídeo(s) MP4");
  });
});
