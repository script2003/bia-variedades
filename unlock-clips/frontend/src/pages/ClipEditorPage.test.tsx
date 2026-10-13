import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { Clip, ClipSubtitles } from "../api/types";
import { makeClip, makeProject, makeRender, mockFetch, sampleClipSet, sampleFraming, sampleSubtitles } from "../test/fixtures";
import ClipEditorPage from "./ClipEditorPage";

const project = makeProject();
const base = `/api/projects/${project.id}`;
const clip = sampleClipSet.clips[0]!;

function setup(routes: Record<string, (init?: RequestInit) => { status?: number; body?: unknown }> = {}, clipId = clip.id) {
  const { fn, calls } = mockFetch({
    [`GET ${base}`]: () => ({ body: project }),
    [`GET ${base}/clips`]: () => ({ body: sampleClipSet }),
    [`GET ${base}/clips/${clipId}/subtitles`]: () => ({ body: sampleSubtitles }),
    [`GET ${base}/clips/${clipId}/framing`]: () => ({ body: sampleFraming }),
    ["GET /api/health"]: () => ({ body: { face_detection_available: true, data_dir: "C:/dados" } }),
    ...routes,
  });
  vi.stubGlobal("fetch", fn);
  render(
    <MemoryRouter initialEntries={[`/projetos/${project.id}/cortes/${clipId}`]}>
      <Routes>
        <Route path="/projetos/:projectId/cortes/:clipId" element={<ClipEditorPage />} />
        <Route path="/projetos/:projectId" element={<p>Página do projeto</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return { calls };
}

const body = (calls: { key: string; init?: RequestInit }[], key: string) =>
  JSON.parse(String(calls.filter((c) => c.key === key).at(-1)?.init?.body ?? "null"));

describe("ClipEditorPage", () => {
  it("mostra prévia, título, trecho, enquadramento, legendas e exportação do corte", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: clip.title })).toBeInTheDocument();
    expect(screen.getByText("Corte 1 de 2")).toBeInTheDocument();
    expect(screen.getByTestId("live-player")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Início e fim" })).toBeInTheDocument();
    expect(await screen.findByRole("radio", { name: /Padrão do projeto/ })).toBeChecked();
    expect(await screen.findByLabelText("Texto da legenda 1")).toHaveValue("Por que guardar");
    expect(screen.getByRole("button", { name: /Exportar MP4/ })).toBeEnabled();
    expect(screen.getByText(/ainda não foi gerado/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Baixar .srt/ })).toHaveAttribute("href", `${base}/clips/${clip.id}/subtitles.srt`);
    expect(screen.getByRole("link", { name: "Próximo corte" })).toHaveAttribute("href", `/projetos/${project.id}/cortes/clip-2`);
  });

  it("edita e salva as legendas (texto e visibilidade)", async () => {
    const user = userEvent.setup();
    const saved: ClipSubtitles = {
      ...sampleSubtitles,
      edited: true,
      editable: [
        { ...sampleSubtitles.editable[0]!, text: "Por que poupar", edited: true },
        { ...sampleSubtitles.editable[1]!, hidden: true, edited: true },
      ],
    };
    const { calls } = setup({ [`PUT ${base}/clips/${clip.id}/subtitles`]: () => ({ body: saved }) });
    const text = await screen.findByLabelText("Texto da legenda 1");
    const save = screen.getByRole("button", { name: "Salvar legendas" });
    expect(save).toBeDisabled();
    await user.clear(text);
    await user.type(text, "Por que poupar");
    await user.click(screen.getByRole("button", { name: "Ocultar a legenda 2" }));
    expect(screen.getAllByText("alterada")).toHaveLength(2);
    // A prévia ao vivo já usa o rascunho.
    expect(within(screen.getByTestId("live-player")).getByTestId("subtitle-overlay")).toHaveTextContent("POR QUE POUPAR");
    await user.click(save);
    expect(body(calls, `PUT ${base}/clips/${clip.id}/subtitles`)).toEqual({
      cues: [
        { start: 21.9, end: 23.5, text: "Por que poupar", hidden: false },
        { start: 23.9, end: 24.9, text: "dinheiro?", hidden: true },
      ],
    });
    expect(await screen.findByText(/Legendas salvas/)).toBeInTheDocument();
    expect(screen.getByText("Editadas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Voltar às legendas automáticas/ })).toBeInTheDocument();
  });

  it("valida tempos sobrepostos antes de salvar", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByLabelText("Texto da legenda 1");
    await user.click(screen.getByRole("button", { name: /Editar tempos/ }));
    const end = screen.getByLabelText("Fim da legenda 1");
    await user.clear(end);
    await user.type(end, "0:02.5{Enter}");
    expect(screen.getByText(/As legendas 1 e 2 se sobrepõem/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar legendas" })).toBeDisabled();
  });

  it("ajusta o enquadramento manual com prévia imediata e salva", async () => {
    const user = userEvent.setup();
    const override = { mode: "manual" as const, x: 0, y: 0.5, zoom: 1 };
    const { calls } = setup({
      [`PATCH ${base}/clips/${clip.id}`]: () => ({ body: { ...clip, framing_override: override } satisfies Clip }),
    });
    await user.click(await screen.findByRole("radio", { name: /Posição fixa/ }));
    const horizontal = screen.getByLabelText(/Posição horizontal/);
    fireEvent.change(horizontal, { target: { value: "0" } });
    expect(screen.getByText(/Recorte de 608×1080 px/)).toBeInTheDocument();
    expect(screen.getByText(/Alteração não salva/)).toBeInTheDocument();
    // A prévia mostra o recorte encostado à esquerda (left = 0).
    const video = screen.getByTestId("live-player").querySelector("video") as HTMLVideoElement;
    expect(parseFloat(video.style.left)).toBeCloseTo(0);
    await user.click(screen.getByRole("button", { name: "Salvar enquadramento" }));
    expect(body(calls, `PATCH ${base}/clips/${clip.id}`)).toEqual({ framing_override: override });
    expect(await screen.findByText(/Enquadramento salvo/)).toBeInTheDocument();
  });

  it("exporta salvando antes as alterações pendentes", async () => {
    const user = userEvent.setup();
    const { calls } = setup({
      [`PATCH ${base}/clips/${clip.id}`]: () => ({ body: { ...clip, framing_override: { mode: "centro", x: 0.5, y: 0.5, zoom: 1 } } }),
      [`POST ${base}/clips/render`]: () => ({ body: { ...project, status: "rendering" } }),
    });
    await user.click(await screen.findByRole("radio", { name: /^Central/ }));
    expect(screen.getByText(/serão salvas antes de gerar o vídeo/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Exportar MP4/ }));
    await waitFor(() => expect(body(calls, `POST ${base}/clips/render`)).toEqual({ clip_ids: [clip.id] }));
    const order = calls.map((c) => c.key).filter((k) => k.startsWith("PATCH") || k.startsWith("POST"));
    expect(order).toEqual([`PATCH ${base}/clips/${clip.id}`, `POST ${base}/clips/render`]);
  });

  it("oferece baixar o MP4 pronto e gerar novamente", async () => {
    const rendered = { ...sampleClipSet, clips: [makeClip({ render: makeRender({ stale: false }) }), ...sampleClipSet.clips.slice(1)] };
    setup({ [`GET ${base}/clips`]: () => ({ body: rendered }) });
    const download = await screen.findByRole("link", { name: /^Baixar MP4$/ });
    expect(download).toHaveAttribute("href", `${base}/exports/por-que-a-maioria-clip-1-9x16.mp4`);
    expect(screen.getByRole("button", { name: /^Gerar novamente$/ })).toBeInTheDocument();
    expect(screen.getByText("Vídeo pronto")).toBeInTheDocument();
  });

  it("avisa quando o corte não existe", async () => {
    setup({}, "sumiu");
    expect(await screen.findByText("Corte não encontrado")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Voltar ao projeto" })).toHaveAttribute("href", `/projetos/${project.id}`);
  });
});
