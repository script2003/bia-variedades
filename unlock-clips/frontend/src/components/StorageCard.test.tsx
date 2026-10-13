import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeProject, mockFetch } from "../test/fixtures";
import StorageCard from "./StorageCard";

const project = makeProject();
const storage = {
  project_id: project.id,
  source_bytes: 50 * 1024 ** 2,
  audio_bytes: 5 * 1024 ** 2,
  exports_bytes: 8 * 1024 ** 2,
  other_bytes: 20 * 1024,
  total_bytes: 63 * 1024 ** 2 + 20 * 1024,
  exports_count: 2,
};

describe("StorageCard", () => {
  it("detalha o espaço do projeto e exclui os vídeos exportados", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { fn, calls } = mockFetch({
      [`GET /api/projects/${project.id}/storage`]: () => ({ body: storage }),
      [`DELETE /api/projects/${project.id}/exports`]: () => ({ body: { deleted: 2, freed_bytes: storage.exports_bytes } }),
    });
    vi.stubGlobal("fetch", fn);
    const onChanged = vi.fn();
    const onMessage = vi.fn();
    render(<StorageCard project={project} onChanged={onChanged} onMessage={onMessage} />);
    expect(await screen.findByText("Vídeo original")).toBeInTheDocument();
    expect(screen.getByText("50,0 MB")).toBeInTheDocument();
    expect(screen.getByText("Vídeos exportados (2)")).toBeInTheDocument();
    expect(screen.getByText("63,0 MB")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Excluir vídeos exportados/ }));
    expect(calls.some((c) => c.key === `DELETE /api/projects/${project.id}/exports`)).toBe(true);
    expect(onMessage).toHaveBeenCalledWith("success", "2 vídeo(s) excluído(s), 8,0 MB liberados.");
    expect(onChanged).toHaveBeenCalled();
  });

  it("não mostra o botão sem vídeos exportados e some se a consulta falhar", async () => {
    vi.stubGlobal("fetch", mockFetch({ [`GET /api/projects/${project.id}/storage`]: () => ({ body: { ...storage, exports_count: 0 } }) }).fn);
    const { unmount } = render(<StorageCard project={project} onChanged={vi.fn()} onMessage={vi.fn()} />);
    await screen.findByText("Vídeo original");
    expect(screen.queryByRole("button")).toBeNull();
    unmount();
    vi.stubGlobal("fetch", mockFetch({}).fn);
    const { container } = render(<StorageCard project={project} onChanged={vi.fn()} onMessage={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });
});
