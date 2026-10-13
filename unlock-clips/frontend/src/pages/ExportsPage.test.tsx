import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ExportedVideo } from "../api/types";
import { mockFetch } from "../test/fixtures";
import ExportsPage from "./ExportsPage";

const video = (overrides: Partial<ExportedVideo>): ExportedVideo => ({
  project_id: "p1",
  project_title: "Podcast 1",
  filename: "corte-a-111111-9x16.mp4",
  size_bytes: 2_000_000,
  created_at: "2026-10-10T13:00:00Z",
  url: "/api/projects/p1/exports/corte-a-111111-9x16.mp4",
  clip_id: "c1",
  clip_title: "Corte A",
  aspect_ratio: "9:16",
  width: 1080,
  height: 1920,
  duration_seconds: 21.5,
  stale: false,
  ...overrides,
});

const items = [
  video({}),
  video({ filename: "b.mp4", url: "/api/projects/p1/exports/b.mp4", clip_id: "c2", clip_title: "Corte B", stale: true }),
  video({ project_id: "p2", project_title: "Entrevista", filename: "c.mp4", url: "/api/projects/p2/exports/c.mp4", clip_id: null, clip_title: null }),
];

function setup(routes = {}) {
  const { fn, calls } = mockFetch({
    "GET /api/exports": () => ({ body: items }),
    "GET /api/health": () => ({ body: { data_dir: "C:\\UNLOCK\\data" } }),
    ...routes,
  });
  vi.stubGlobal("fetch", fn);
  render(
    <MemoryRouter>
      <ExportsPage />
    </MemoryRouter>,
  );
  return { calls };
}

describe("ExportsPage", () => {
  it("lista os vídeos com formato, duração, estado e ações", async () => {
    setup();
    const first = await screen.findByRole("listitem", { name: "Corte A" });
    expect(within(first).getByText("9:16")).toBeInTheDocument();
    expect(within(first).getByText(/21,5 s/)).toBeInTheDocument();
    expect(within(first).getByRole("link", { name: /Baixar/ })).toHaveAttribute("href", items[0]!.url);
    expect(within(first).getByRole("link", { name: /Editar/ })).toHaveAttribute("href", "/projetos/p1/cortes/c1");
    expect(within(screen.getByRole("listitem", { name: "Corte B" })).getByText("Desatualizado")).toBeInTheDocument();
    // Arquivo sem corte associado: sem link para o editor.
    expect(within(screen.getByRole("listitem", { name: "c.mp4" })).queryByRole("link", { name: /Editar/ })).toBeNull();
    expect(await screen.findByText(/C:\\UNLOCK\\data/)).toBeInTheDocument();
    expect(screen.getByText(/3 vídeo\(s\) · 5,7 MB/)).toBeInTheDocument();
  });

  it("filtra por projeto e busca", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole("listitem", { name: "Corte A" });
    await user.selectOptions(screen.getByLabelText("Filtrar por projeto"), "p2");
    expect(screen.queryByRole("listitem", { name: "Corte A" })).toBeNull();
    expect(screen.getByRole("listitem", { name: "c.mp4" })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Filtrar por projeto"), "all");
    await user.type(screen.getByLabelText("Buscar vídeos"), "corte b");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("assiste no navegador e exclui com confirmação", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { calls } = setup({ "DELETE /api/projects/p1/exports/corte-a-111111-9x16.mp4": () => ({ status: 204 }) });
    const first = await screen.findByRole("listitem", { name: "Corte A" });
    await user.click(within(first).getByRole("button", { name: /Assistir/ }));
    const dialog = screen.getByRole("dialog", { name: "Assistir: Corte A" });
    expect(dialog.querySelector("video")?.getAttribute("src")).toBe(`${items[0]!.url}?download=false`);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(within(first).getByRole("button", { name: "Excluir Corte A" }));
    expect(calls.some((c) => c.key === "DELETE /api/projects/p1/exports/corte-a-111111-9x16.mp4")).toBe(true);
    expect(await screen.findByText(/Vídeo excluído \(1,9 MB liberados\)/)).toBeInTheDocument();
  });

  it("exclui todos os vídeos de um projeto", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { calls } = setup({ "DELETE /api/projects/p1/exports": () => ({ body: { deleted: 2, freed_bytes: 4_000_000 } }) });
    await screen.findByRole("listitem", { name: "Corte A" });
    await user.selectOptions(screen.getByLabelText("Filtrar por projeto"), "p1");
    await user.click(screen.getByRole("button", { name: /Excluir todos deste projeto/ }));
    expect(calls.some((c) => c.key === "DELETE /api/projects/p1/exports")).toBe(true);
    expect(await screen.findByText(/2 vídeo\(s\) excluído\(s\), 3,8 MB liberados/)).toBeInTheDocument();
  });
});
