import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeProject } from "../test/fixtures";
import PipelineSteps, { buildSteps } from "./PipelineSteps";

describe("buildSteps", () => {
  it("nunca marca como concluídas as etapas ainda não implementadas", () => {
    const steps = buildSteps(makeProject({ status: "ready" }));
    expect(steps.slice(0, 2).map((s) => s.state)).toEqual(["done", "done"]);
    expect(steps.slice(2).every((s) => s.state === "unavailable")).toBe(true);
  });

  it("reflete importação, verificação e falhas", () => {
    const importing = makeProject({ status: "importing", source: { ...makeProject().source, kind: "link", filename: null } });
    expect(buildSteps(importing).slice(0, 2).map((s) => s.state)).toEqual(["active", "pending"]);
    expect(buildSteps(makeProject({ status: "validating" }))[1]!.state).toBe("active");
    expect(buildSteps(makeProject({ status: "failed" }))[1]!.state).toBe("error");
    const failedDownload = makeProject({ status: "failed", source: { ...makeProject().source, kind: "link", filename: null } });
    expect(buildSteps(failedDownload)[0]!.state).toBe("error");
  });
});

describe("PipelineSteps", () => {
  it("renderiza rótulos acessíveis", () => {
    render(<PipelineSteps project={makeProject()} />);
    expect(screen.getByLabelText("Verificação do arquivo: concluída")).toBeInTheDocument();
    expect(screen.getByLabelText("Extração de áudio: disponível em breve")).toBeInTheDocument();
  });
});
