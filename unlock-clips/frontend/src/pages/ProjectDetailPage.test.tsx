import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { makeProject, mockFetch, sampleTranscript } from "../test/fixtures";
import ProjectDetailPage from "./ProjectDetailPage";

function renderPage(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/projetos/${id}`]}>
      <Routes>
        <Route path="/projetos/:projectId" element={<ProjectDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProjectDetailPage", () => {
  it("mostra mídia, áudio extraído e miniatura de um projeto pronto", async () => {
    const project = makeProject();
    vi.stubGlobal(
      "fetch",
      mockFetch({
        [`GET /api/projects/${project.id}`]: () => ({ body: project }),
        [`GET /api/projects/${project.id}/transcript`]: () => ({ body: sampleTranscript }),
      }).fn,
    );
    renderPage(project.id);
    expect(await screen.findByText(/Vídeo transcrito\./)).toBeInTheDocument();
    expect(await screen.findByText("Hoje vamos falar de educação.")).toBeInTheDocument();
    expect(screen.getByLabelText("Áudio extraído")).toBeInTheDocument();
    expect(document.querySelector("video")?.getAttribute("poster")).toContain("/thumbnail?v=");
    expect(screen.queryByRole("button", { name: /Extrair áudio/ })).not.toBeInTheDocument();
  });

  it("oferece 'Extrair áudio' para projetos da Etapa 1 e inicia o processamento", async () => {
    const legacy = makeProject({ media: null, audio: null, thumbnail: null });
    const processing = makeProject({
      ...legacy,
      status: "validating",
      job: {
        id: "j1",
        kind: "process",
        status: "running",
        progress: 0.1,
        message: "Verificando integridade do arquivo",
        error: null,
        created_at: legacy.created_at,
        started_at: legacy.created_at,
        finished_at: null,
      },
    });
    const { fn, calls } = mockFetch({
      [`GET /api/projects/${legacy.id}`]: () => ({ body: calls.some((c) => c.key.endsWith("/retry")) ? processing : legacy }),
      [`POST /api/projects/${legacy.id}/retry`]: () => ({ body: processing }),
    });
    vi.stubGlobal("fetch", fn);
    const user = userEvent.setup();
    renderPage(legacy.id);
    await user.click(await screen.findByRole("button", { name: /Extrair áudio/ }));
    expect(await screen.findByText(/Preparação do vídeo · Verificando integridade/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: /Progresso de/ })).toHaveAttribute("aria-valuenow", "10");
  });

  it("exibe o erro do processamento e o botão de tentar novamente", async () => {
    const failed = makeProject({ status: "failed", audio: null, error: "O vídeo não possui trilha de áudio." });
    vi.stubGlobal("fetch", mockFetch({ [`GET /api/projects/${failed.id}`]: () => ({ body: failed }) }).fn);
    renderPage(failed.id);
    expect(await screen.findByText("O vídeo não possui trilha de áudio.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tentar novamente/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Extração de áudio: não concluída")).toBeInTheDocument();
  });
});
