import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import { appSettings, makeProject, mockFetch } from "./test/fixtures";

const stats = { projects_total: 1, projects_by_status: { ready: 1 }, active_jobs: 0, storage_bytes: 2048, exports_total: 0 };

function setup(path = "/") {
  vi.stubGlobal(
    "fetch",
    mockFetch({
      "GET /api/settings": () => ({ body: appSettings }),
      "GET /api/projects": () => ({ body: [makeProject({ title: "Entrevista com a pesquisadora" })] }),
      "GET /api/stats": () => ({ body: stats }),
      "GET /api/exports": () => ({ body: [] }),
      "GET /api/health": () => ({
        body: {
          status: "ok",
          version: "0.2.0",
          ffmpeg_available: false,
          ffprobe_available: false,
          ffmpeg_path: null,
          ffprobe_path: null,
          ffmpeg_version: null,
          ffmpeg_error: "FFmpeg não foi encontrado. No Windows, instale com 'winget install -e --id Gyan.FFmpeg'",
          data_dir: "C:\\dados",
        },
      }),
    }).fn,
  );
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("App", () => {
  it("exibe o menu lateral completo em português", () => {
    setup();
    const nav = screen.getAllByRole("navigation", { name: "Menu principal" })[0]!;
    for (const label of ["Painel", "Criar cortes", "Meus projetos", "Vídeos exportados", "Configurações"]) {
      expect(within(nav).getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("mostra o painel com envio de vídeo e projetos recentes", async () => {
    setup();
    expect(screen.getByRole("heading", { name: "Painel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Analisar vídeo/ })).toBeInTheDocument();
    expect(await screen.findByText("Entrevista com a pesquisadora")).toBeInTheDocument();
    expect(screen.getByText("2,0 KB")).toBeInTheDocument();
  });

  it("navega entre as páginas", async () => {
    const user = userEvent.setup();
    setup();
    const nav = screen.getAllByRole("navigation", { name: "Menu principal" })[0]!;
    await user.click(within(nav).getByRole("link", { name: "Vídeos exportados" }));
    expect(await screen.findByText("Nenhum vídeo exportado ainda")).toBeInTheDocument();
    await user.click(within(nav).getByRole("link", { name: "Configurações" }));
    expect(await screen.findByText("Links autorizados")).toBeInTheDocument();
    expect(await screen.findByText("FFmpeg indisponível")).toBeInTheDocument();
    expect(screen.getByLabelText("Pasta do FFmpeg (opcional)")).toHaveValue("");
  });

  it("exibe página 404 para rotas desconhecidas", () => {
    setup("/rota-inexistente");
    expect(screen.getByText("Página não encontrada")).toBeInTheDocument();
  });
});
