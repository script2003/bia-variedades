import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { appSettings, makeProject, mockFetch } from "../test/fixtures";
import NewProjectPanel from "./NewProjectPanel";

function renderPanel(showSettings = false) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<NewProjectPanel showSettings={showSettings} />} />
        <Route path="/projetos/:id" element={<p>página do projeto</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("NewProjectPanel", () => {
  it("recusa arquivos que não são vídeo antes de enviar", async () => {
    const { fn } = mockFetch({ "GET /api/settings": () => ({ body: appSettings }) });
    vi.stubGlobal("fetch", fn);
    const user = userEvent.setup({ applyAccept: false });
    renderPanel();
    await waitFor(() => expect(screen.getByRole("button", { name: /Analisar vídeo/ })).toBeEnabled());

    await user.upload(screen.getByTestId("file-input"), new File(["x"], "notas.pdf", { type: "application/pdf" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Formato não suportado");

    await user.click(screen.getByRole("button", { name: /Analisar vídeo/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("Selecione um arquivo");
  });

  it("recusa arquivos acima do limite configurado", async () => {
    const { fn } = mockFetch({ "GET /api/settings": () => ({ body: { ...appSettings, max_upload_size_mb: 1 } }) });
    vi.stubGlobal("fetch", fn);
    const user = userEvent.setup();
    renderPanel();
    await waitFor(() => expect(screen.getByRole("button", { name: /Analisar vídeo/ })).toBeEnabled());
    await user.upload(screen.getByTestId("file-input"), new File([new Uint8Array(2 * 1024 * 1024)], "grande.mp4", { type: "video/mp4" }));
    expect(screen.getByRole("alert")).toHaveTextContent("limite de 1 MB");
  });

  it("importa por link somente após confirmar a autorização", async () => {
    const project = makeProject({ status: "importing" });
    const { fn, calls } = mockFetch({
      "GET /api/settings": () => ({ body: appSettings }),
      "POST /api/projects/from-link": () => ({ status: 201, body: project }),
    });
    vi.stubGlobal("fetch", fn);
    const user = userEvent.setup();
    renderPanel();
    await waitFor(() => expect(screen.getByRole("button", { name: /Analisar vídeo/ })).toBeEnabled());

    await user.click(screen.getByRole("tab", { name: /Usar link/ }));
    expect(screen.getByText(/Domínios autorizados: exemplo.com/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Link direto do vídeo"), "https://exemplo.com/ep1.mp4");
    await user.click(screen.getByRole("button", { name: /Analisar vídeo/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("Confirme que você tem autorização");
    expect(calls.some((c) => c.key === "POST /api/projects/from-link")).toBe(false);

    await user.click(screen.getByLabelText(/Confirmo que tenho autorização/));
    await user.click(screen.getByRole("button", { name: /Analisar vídeo/ }));
    expect(await screen.findByText("página do projeto")).toBeInTheDocument();
    const call = calls.find((c) => c.key === "POST /api/projects/from-link")!;
    expect(JSON.parse(String(call.init?.body))).toEqual({ url: "https://exemplo.com/ep1.mp4", rights_confirmed: true });
  });

  it("mostra a mensagem de erro do servidor", async () => {
    const { fn } = mockFetch({
      "GET /api/settings": () => ({ body: appSettings }),
      "POST /api/projects/from-link": () => ({ status: 400, body: { detail: "O domínio 'x.com' não está na lista" } }),
    });
    vi.stubGlobal("fetch", fn);
    const user = userEvent.setup();
    renderPanel();
    await waitFor(() => expect(screen.getByRole("button", { name: /Analisar vídeo/ })).toBeEnabled());
    await user.click(screen.getByRole("tab", { name: /Usar link/ }));
    await user.type(screen.getByLabelText("Link direto do vídeo"), "https://x.com/a.mp4");
    await user.click(screen.getByLabelText(/Confirmo que tenho autorização/));
    await user.click(screen.getByRole("button", { name: /Analisar vídeo/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("não está na lista");
  });

  it("exibe as configurações de corte na página Criar cortes", async () => {
    vi.stubGlobal("fetch", mockFetch({ "GET /api/settings": () => ({ body: appSettings }) }).fn);
    renderPanel(true);
    expect(await screen.findByText("Configurações dos cortes")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /9:16/ })).toHaveAttribute("aria-checked", "true");
  });
});
