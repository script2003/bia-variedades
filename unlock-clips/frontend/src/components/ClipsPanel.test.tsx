import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Project } from "../api/types";
import { makeClip, makeProject, makeRender, mockFetch, sampleClipSet, sampleSubtitles } from "../test/fixtures";
import ClipsPanel from "./ClipsPanel";

const project = makeProject();
const base = `/api/projects/${project.id}`;

function setup(routes: Record<string, (init?: RequestInit) => { status?: number; body?: unknown }> = {}, props: Partial<Parameters<typeof ClipsPanel>[0]> = {}) {
  const { fn, calls } = mockFetch({
    [`GET ${base}/clips`]: () => ({ body: sampleClipSet }),
    [`GET ${base}`]: () => ({ body: project }),
    ...routes,
  });
  vi.stubGlobal("fetch", fn);
  const handlers = { onPreview: vi.fn(), onProjectChange: vi.fn(), onError: vi.fn() };
  render(<ClipsPanel project={project} currentTime={12.3} {...handlers} {...props} />);
  return { calls, ...handlers };
}

const body = (calls: { key: string; init?: RequestInit }[], key: string) =>
  JSON.parse(String(calls.find((c) => c.key === key)?.init?.body ?? "null"));

describe("ClipsPanel", () => {
  it("lista os cortes com pontuação, motivos, avisos e aviso de heurística", async () => {
    setup();
    const first = await screen.findByRole("article", { name: "Corte 1: Por que a maioria nunca guarda dinheiro?" });
    expect(within(first).getByText("75")).toBeInTheDocument();
    expect(within(first).getByText("0:21.9 → 0:42.0")).toBeInTheDocument();
    expect(within(first).getByText("Abre com uma pergunta")).toBeInTheDocument();
    const second = screen.getByRole("article", { name: /Corte 2: Uma vez/ });
    expect(within(second).getByText(/pode depender do que foi dito antes/)).toBeInTheDocument();
    expect(within(second).getByText("Aprovado")).toBeInTheDocument();
    expect(screen.getByText(/Ela não prevê/)).toBeInTheDocument();
    expect(screen.getByText(/2 corte\(s\) · 1 aprovado\(s\) · 120 trechos avaliados · faixa de 15–30 s/)).toBeInTheDocument();
  });

  it("explica a pontuação por critério", async () => {
    const user = userEvent.setup();
    setup();
    const first = await screen.findByRole("article", { name: /Corte 1/ });
    await user.click(within(first).getByRole("button", { name: /Por que esta pontuação/ }));
    expect(within(first).getByText("Pergunta e resposta")).toBeInTheDocument();
    expect(within(first).getByText("100% · +14,3 pts")).toBeInTheDocument();
    expect(within(first).getAllByText("Pergunta respondida em 17 s")).toHaveLength(2); // destaque + detalhamento
  });

  it("filtra por status", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole("article", { name: /Corte 1/ });
    expect(screen.getAllByRole("article")).toHaveLength(3);
    await user.click(screen.getByRole("tab", { name: "Aprovados (1)" }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    await user.click(screen.getByRole("tab", { name: "Descartados (1)" }));
    expect(screen.getByRole("article", { name: /Trecho descartado/ })).toBeInTheDocument();
    expect(within(screen.getByRole("article")).getByRole("button", { name: /Restaurar/ })).toBeInTheDocument();
  });

  it("pré-visualiza, aprova e descarta", async () => {
    const user = userEvent.setup();
    const approved = makeClip({ status: "approved" });
    const { calls, onPreview, onProjectChange } = setup({ [`PATCH ${base}/clips/clip-1`]: () => ({ body: approved }) });
    const first = await screen.findByRole("article", { name: /Corte 1/ });
    await user.click(within(first).getByRole("button", { name: /Pré-visualizar/ }));
    expect(onPreview).toHaveBeenCalledWith(21.9, 42.0);
    await user.click(within(first).getByRole("button", { name: /Aprovar/ }));
    expect(body(calls, `PATCH ${base}/clips/clip-1`)).toEqual({ status: "approved" });
    expect(await screen.findAllByText("Aprovado")).toHaveLength(2);
    expect(onProjectChange).toHaveBeenCalled();
  });

  it("ajusta início e fim e recalcula", async () => {
    const user = userEvent.setup();
    const moved = makeClip({ start: 12.3, end: 40, score: 60.2, edited: true, warnings: ["Começa no meio de uma frase"] });
    const { calls } = setup({ [`PATCH ${base}/clips/clip-1`]: () => ({ body: moved }) });
    const first = await screen.findByRole("article", { name: /Corte 1/ });
    await user.click(within(first).getByRole("button", { name: /Ajustar início e fim/ }));
    const editor = within(first).getByRole("form", { name: "Ajustar início e fim" });
    await user.click(within(editor).getAllByRole("button", { name: /Usar tempo atual do vídeo/ })[0]!);
    expect(within(editor).getByLabelText("Início")).toHaveValue("0:12.3");
    await user.clear(within(editor).getByLabelText("Fim"));
    await user.type(within(editor).getByLabelText("Fim"), "0:39.5");
    await user.click(within(editor).getByRole("button", { name: "Fim: +0,5 s" }));
    await user.click(within(editor).getByRole("button", { name: "Salvar e recalcular" }));
    expect(body(calls, `PATCH ${base}/clips/clip-1`)).toEqual({ start: 12.3, end: 40 });
    const updated = await screen.findByRole("article", { name: /Corte 1/ });
    expect(within(updated).getByText("60")).toBeInTheDocument();
    expect(within(updated).getByText("Ajustado")).toBeInTheDocument();
    expect(within(updated).getByText("Começa no meio de uma frase")).toBeInTheDocument();
  });

  it("valida o intervalo antes de enviar e mostra erros do servidor", async () => {
    const user = userEvent.setup();
    const { calls } = setup({
      [`PATCH ${base}/clips/clip-1`]: () => ({ status: 422, body: { detail: "Um corte pode ter no máximo 180 segundos." } }),
    });
    const first = await screen.findByRole("article", { name: /Corte 1/ });
    await user.click(within(first).getByRole("button", { name: /Ajustar início e fim/ }));
    const editor = within(first).getByRole("form", { name: "Ajustar início e fim" });
    await user.clear(within(editor).getByLabelText("Fim"));
    await user.type(within(editor).getByLabelText("Fim"), "abc");
    await user.click(within(editor).getByRole("button", { name: "Salvar e recalcular" }));
    expect(within(editor).getByRole("alert")).toHaveTextContent("minutos:segundos");
    expect(calls.some((c) => c.key.startsWith("PATCH"))).toBe(false);
    await user.clear(within(editor).getByLabelText("Fim"));
    await user.type(within(editor).getByLabelText("Fim"), "5:00");
    await user.click(within(editor).getByRole("button", { name: "Salvar e recalcular" }));
    expect(await within(editor).findByText("Um corte pode ter no máximo 180 segundos.")).toBeInTheDocument();
  });

  it("edita o título", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ [`PATCH ${base}/clips/clip-1`]: () => ({ body: makeClip({ title: "Novo título", edited: true }) }) });
    const first = await screen.findByRole("article", { name: /Corte 1/ });
    await user.click(within(first).getByRole("button", { name: "Editar título do corte" }));
    await user.clear(within(first).getByLabelText("Título do corte"));
    await user.type(within(first).getByLabelText("Título do corte"), "Novo título");
    await user.click(within(first).getByRole("button", { name: "Salvar" }));
    expect(body(calls, `PATCH ${base}/clips/clip-1`)).toEqual({ title: "Novo título" });
    expect(await screen.findByRole("article", { name: "Corte 1: Novo título" })).toBeInTheDocument();
  });

  it("adiciona corte manual no tempo atual e regenera mantendo os curados", async () => {
    const user = userEvent.setup();
    const manual = makeClip({ id: "m1", title: "Manual", start: 12.3, end: 42.3, origin: "manual", status: "approved", score: 50 });
    const detecting: Project = { ...project, status: "detecting_clips" };
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { calls, onProjectChange } = setup({
      [`POST ${base}/clips`]: () => ({ status: 201, body: manual }),
      [`POST ${base}/clips/detect`]: () => ({ body: detecting }),
    });
    await screen.findByRole("article", { name: /Corte 1/ });
    await user.click(screen.getByRole("button", { name: "Adicionar corte em 0:12" }));
    expect(body(calls, `POST ${base}/clips`)).toEqual({ start: 12.3, end: 42.3 });
    expect(await screen.findByRole("article", { name: /Manual/ })).toHaveTextContent("Manual");
    await user.click(screen.getByRole("button", { name: /Gerar novamente/ }));
    expect(confirm).toHaveBeenCalled();
    expect(body(calls, `POST ${base}/clips/detect`)).toEqual({ keep_curated: true });
    expect(onProjectChange).toHaveBeenCalledWith(detecting);
  });

  it("exclui com confirmação", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { calls } = setup({ [`DELETE ${base}/clips/clip-1`]: () => ({ status: 204 }) });
    const first = await screen.findByRole("article", { name: /Corte 1/ });
    await user.click(within(first).getByRole("button", { name: "Excluir corte" }));
    expect(calls.some((c) => c.key === `DELETE ${base}/clips/clip-1`)).toBe(true);
    expect(screen.queryByRole("article", { name: /Por que a maioria/ })).not.toBeInTheDocument();
  });

  it("oferece sugerir cortes quando há transcrição mas ainda não há cortes", async () => {
    const user = userEvent.setup();
    const pending = makeProject({ clips: null });
    const { fn, calls } = mockFetch({ [`POST ${base}/clips/detect`]: () => ({ body: { ...pending, status: "detecting_clips" } }) });
    vi.stubGlobal("fetch", fn);
    render(<ClipsPanel project={pending} currentTime={0} onPreview={vi.fn()} onProjectChange={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByText(/A transcrição está pronta/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sugerir cortes" }));
    expect(calls.map((c) => c.key)).toEqual([`POST ${base}/clips/detect`]);
  });
});

describe("ClipsPanel — vídeos", () => {
  it("gera o vídeo de um corte e dos aprovados", async () => {
    const user = userEvent.setup();
    const rendering: Project = { ...project, status: "rendering" };
    const { calls, onProjectChange } = setup({ [`POST ${base}/clips/render`]: () => ({ body: rendering }) });
    const first = await screen.findByRole("article", { name: /Corte 1/ });
    expect(within(first).getByText("Vídeo ainda não gerado.")).toBeInTheDocument();
    await user.click(within(first).getByRole("button", { name: /Gerar vídeo/ }));
    expect(body(calls, `POST ${base}/clips/render`)).toEqual({ clip_ids: ["clip-1"] });
    expect(onProjectChange).toHaveBeenCalledWith(rendering);
    await user.click(screen.getByRole("button", { name: /Gerar vídeos dos aprovados \(1\)/ }));
    expect(JSON.parse(String(calls.filter((c) => c.key === `POST ${base}/clips/render`)[1]!.init?.body))).toEqual({});
  });

  it("mostra vídeo pronto, desatualizado, download e abre a prévia", async () => {
    const user = userEvent.setup();
    const withRenders = {
      ...sampleClipSet,
      clips: [
        makeClip({ render: makeRender() }),
        makeClip({ id: "clip-2", title: "Outro", status: "approved", render: makeRender({ filename: "outro.mp4", stale: true }) }),
      ],
    };
    setup({
      [`GET ${base}/clips`]: () => ({ body: withRenders }),
      [`GET ${base}/clips/clip-1/subtitles`]: () => ({ body: sampleSubtitles }),
    });
    const first = await screen.findByRole("article", { name: /Corte 1/ });
    expect(within(first).getByText("Vídeo pronto")).toBeInTheDocument();
    expect(within(first).getByText(/1080×1920 · 4,0 MB · rosto acompanhado/)).toBeInTheDocument();
    expect(within(first).getByRole("link", { name: /Baixar MP4/ })).toHaveAttribute(
      "href",
      `${base}/exports/por-que-a-maioria-clip-1-9x16.mp4`,
    );
    expect(within(screen.getByRole("article", { name: /Outro/ })).getByText("Vídeo desatualizado")).toBeInTheDocument();
    await user.click(within(first).getByRole("button", { name: "Assistir" }));
    expect(await screen.findByRole("dialog", { name: /Prévia:/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Vídeo gerado" })).toHaveAttribute("aria-selected", "true");
  });
});
