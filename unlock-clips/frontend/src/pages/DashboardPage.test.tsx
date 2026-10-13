import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { makeProject, mockFetch } from "../test/fixtures";
import DashboardPage from "./DashboardPage";

const stats = (free: number | null) => ({
  projects_total: 1,
  projects_by_status: { ready: 1 },
  active_jobs: 0,
  storage_bytes: 12 * 1024 ** 2,
  exports_total: 3,
  disk_free_bytes: free,
});

function setup(free: number | null) {
  vi.stubGlobal(
    "fetch",
    mockFetch({
      "GET /api/projects": () => ({ body: [makeProject({ title: "Podcast de finanças" })] }),
      "GET /api/stats": () => ({ body: stats(free) }),
      "GET /api/settings": () => ({ body: null }),
    }).fn,
  );
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe("DashboardPage", () => {
  it("mostra resumo, projetos recentes e o envio de vídeo", async () => {
    setup(50 * 1024 ** 3);
    expect(await screen.findByText("Podcast de finanças")).toBeInTheDocument();
    expect(screen.getByText("12,0 MB")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.queryByText(/Pouco espaço livre/)).toBeNull();
  });

  it("avisa quando o disco está quase cheio", async () => {
    setup(1024 ** 3);
    expect(await screen.findByText(/Pouco espaço livre no disco da pasta de dados \(1,0 GB\)/)).toBeInTheDocument();
  });
});
