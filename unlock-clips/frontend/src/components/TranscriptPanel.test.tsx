import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeProject, mockFetch, sampleTranscript } from "../test/fixtures";
import TranscriptPanel, { activeSegmentIndex } from "./TranscriptPanel";

const project = makeProject();

function setup(props: Partial<Parameters<typeof TranscriptPanel>[0]> = {}, routes = {}) {
  const { fn, calls } = mockFetch({
    [`GET /api/projects/${project.id}/transcript`]: () => ({ body: sampleTranscript }),
    ...routes,
  });
  vi.stubGlobal("fetch", fn);
  const handlers = { onSeek: vi.fn(), onProjectChange: vi.fn(), onError: vi.fn() };
  render(<TranscriptPanel project={project} currentTime={0} {...handlers} {...props} />);
  return { calls, ...handlers };
}

describe("activeSegmentIndex", () => {
  it("encontra o trecho pelo tempo com busca binária", () => {
    const segments = sampleTranscript.segments;
    expect(activeSegmentIndex(segments, 0)).toBe(0);
    expect(activeSegmentIndex(segments, 5)).toBe(1);
    expect(activeSegmentIndex(segments, 30)).toBe(-1); // pausa entre trechos
    expect(activeSegmentIndex(segments, 69.9)).toBe(2);
    expect(activeSegmentIndex([], 1)).toBe(-1);
  });
});

describe("TranscriptPanel", () => {
  it("lista os trechos com tempo e links de download", async () => {
    setup();
    expect(await screen.findByText("Bem-vindos ao podcast.")).toBeInTheDocument();
    expect(screen.getByText(/Português · 9 palavras · 3 trechos · modelo small/)).toBeInTheDocument();
    expect(screen.getByText("1:05")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /SRT/ })).toHaveAttribute("href", `/api/projects/${project.id}/transcript.srt`);
    expect(screen.getByRole("link", { name: /TXT/ })).toHaveAttribute("download");
  });

  it("busca ignorando acentos e maiúsculas", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByText("Bem-vindos ao podcast.");
    await user.type(screen.getByLabelText("Buscar na transcrição"), "EDUCACAO");
    const list = screen.getByRole("list", { name: "Trechos da transcrição" });
    expect(within(list).getAllByRole("button")).toHaveLength(1);
    expect(within(list).getByText("Hoje vamos falar de educação.")).toBeInTheDocument();
    expect(screen.getByText("1 trecho(s) encontrado(s).")).toBeInTheDocument();
  });

  it("pula para o trecho ao clicar e destaca o trecho falado", async () => {
    const user = userEvent.setup();
    const { onSeek } = setup({ currentTime: 66 });
    await user.click(await screen.findByText("Hoje vamos falar de educação."));
    expect(onSeek).toHaveBeenCalledWith(4.2);
    expect(screen.getByText("A pergunta é: por que isso importa?").closest("button")).toHaveAttribute("aria-current", "true");
  });

  it("inicia a transcrição de um projeto com áudio pronto", async () => {
    const user = userEvent.setup();
    const pending = makeProject({ transcript: null });
    const started = makeProject({ ...pending, status: "transcribing" });
    const { fn, calls } = mockFetch({ [`POST /api/projects/${pending.id}/transcribe`]: () => ({ body: started }) });
    vi.stubGlobal("fetch", fn);
    const onProjectChange = vi.fn();
    render(<TranscriptPanel project={pending} currentTime={0} onSeek={vi.fn()} onProjectChange={onProjectChange} onError={vi.fn()} />);
    expect(screen.getByText(/O áudio está pronto/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Transcrever agora/ }));
    expect(onProjectChange).toHaveBeenCalledWith(started);
    expect(calls.map((c) => c.key)).toEqual([`POST /api/projects/${pending.id}/transcribe`]);
  });

  it("pede confirmação antes de substituir uma transcrição", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { calls } = setup();
    await user.click(await screen.findByRole("button", { name: /Transcrever novamente/ }));
    expect(confirm).toHaveBeenCalled();
    expect(calls.some((c) => c.key.endsWith("/transcribe"))).toBe(false);
  });

  it("mostra erros do servidor", async () => {
    const user = userEvent.setup();
    const pending = makeProject({ transcript: null });
    const { fn } = mockFetch({
      [`POST /api/projects/${pending.id}/transcribe`]: () => ({ status: 409, body: { detail: "Já existe uma tarefa em andamento neste projeto." } }),
    });
    vi.stubGlobal("fetch", fn);
    const onError = vi.fn();
    render(<TranscriptPanel project={pending} currentTime={0} onSeek={vi.fn()} onProjectChange={vi.fn()} onError={onError} />);
    await user.click(screen.getByRole("button", { name: /Transcrever agora/ }));
    expect(onError).toHaveBeenCalledWith("Já existe uma tarefa em andamento neste projeto.");
  });
});
