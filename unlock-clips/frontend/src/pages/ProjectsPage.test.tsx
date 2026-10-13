import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { makeProject, mockFetch } from "../test/fixtures";
import ProjectsPage from "./ProjectsPage";

const older = makeProject({ id: "b".repeat(32), title: "Zebra entrevista", created_at: "2026-10-01T10:00:00Z" });
const newer = makeProject({ id: "c".repeat(32), title: "Aula de finanças", created_at: "2026-10-09T10:00:00Z" });
const storage = [
  { project_id: older.id, source_bytes: 900, audio_bytes: 50, exports_bytes: 50, other_bytes: 0, total_bytes: 5_000_000_000, exports_count: 1 },
  { project_id: newer.id, source_bytes: 900, audio_bytes: 50, exports_bytes: 0, other_bytes: 0, total_bytes: 1_000_000, exports_count: 0 },
];

function setup(routes = {}) {
  const { fn, calls } = mockFetch({
    "GET /api/projects": () => ({ body: [older, newer] }),
    "GET /api/storage": () => ({ body: storage }),
    ...routes,
  });
  vi.stubGlobal("fetch", fn);
  render(
    <MemoryRouter>
      <ProjectsPage />
    </MemoryRouter>,
  );
  return { calls };
}

const titles = () => screen.getAllByRole("listitem").map((li) => within(li).getAllByRole("link")[0]!.textContent);

describe("ProjectsPage", () => {
  it("mostra o espaço em disco e ordena os projetos", async () => {
    const user = userEvent.setup();
    setup();
    expect(await screen.findByText(/2 projeto\(s\) · 4,7 GB em disco/)).toBeInTheDocument();
    expect(titles()).toEqual(["Aula de finanças", "Zebra entrevista"]);
    expect(screen.getByText("4,7 GB")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Ordenar projetos"), "oldest");
    expect(titles()).toEqual(["Zebra entrevista", "Aula de finanças"]);
    await user.selectOptions(screen.getByLabelText("Ordenar projetos"), "title");
    expect(titles()).toEqual(["Aula de finanças", "Zebra entrevista"]);
    await user.selectOptions(screen.getByLabelText("Ordenar projetos"), "size");
    expect(titles()).toEqual(["Zebra entrevista", "Aula de finanças"]);
  });

  it("exclui um projeto com confirmação", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { calls } = setup({ [`DELETE /api/projects/${older.id}`]: () => ({ status: 204 }) });
    await user.click(await screen.findByRole("button", { name: "Excluir o projeto Zebra entrevista" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Zebra entrevista"));
    expect(calls.some((c) => c.key === `DELETE /api/projects/${older.id}`)).toBe(true);
  });
});
