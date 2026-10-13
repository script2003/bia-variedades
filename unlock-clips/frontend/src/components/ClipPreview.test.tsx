import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeClip, makeProject, makeRender, mockFetch, sampleFraming, sampleSubtitles } from "../test/fixtures";
import { cropRectAt, cropXAt, videoCropStyle } from "../lib/framing";
import { activeCueIndex, activeWordIndex } from "../lib/subtitles";
import ClipPreview from "./ClipPreview";
import { SubtitleOverlay } from "./LivePlayer";

const project = makeProject();
const clip = makeClip();

function stubFetch(framing: unknown = sampleFraming) {
  vi.stubGlobal(
    "fetch",
    mockFetch({
      [`GET /api/projects/${project.id}/clips/${clip.id}/subtitles`]: () => ({ body: sampleSubtitles }),
      [`GET /api/projects/${project.id}/clips/${clip.id}/framing`]: () => ({ body: framing }),
    }).fn,
  );
}

function setup(overrides = {}) {
  stubFetch();
  const onClose = vi.fn();
  render(<ClipPreview project={project} clip={clip} onClose={onClose} {...overrides} />);
  return { onClose };
}

describe("cálculo da legenda ativa", () => {
  it("encontra o bloco e a palavra do instante", () => {
    expect(activeCueIndex(sampleSubtitles.cues, 0.5)).toBe(0);
    expect(activeCueIndex(sampleSubtitles.cues, 1.8)).toBe(-1); // intervalo entre blocos
    expect(activeCueIndex(sampleSubtitles.cues, 2.5)).toBe(1);
    const cue = sampleSubtitles.cues[0]!;
    expect(activeWordIndex(cue, 0.1)).toBe(0);
    expect(activeWordIndex(cue, 0.5)).toBe(1);
    expect(activeWordIndex(cue, 1.5)).toBe(2);
  });
});

describe("SubtitleOverlay", () => {
  it("destaca a palavra falada com a cor e o tamanho do modelo", () => {
    render(<SubtitleOverlay subtitles={sampleSubtitles} time={0.5} scale={0.25} />);
    const overlay = screen.getByTestId("subtitle-overlay");
    expect(overlay).toHaveTextContent("POR QUE GUARDAR");
    const current = overlay.querySelector("[data-current]") as HTMLElement;
    expect(current).toHaveTextContent("QUE");
    expect(current.style.color).toBe("rgb(196, 243, 74)");
    expect(current.style.transform).toBe("scale(1.08)");
    expect(overlay.style.bottom).toBe("96px"); // margem de 384 px × escala 0,25
    expect((overlay.querySelector("span") as HTMLElement).style.fontSize).toBe("16px");
  });

  it("não mostra nada entre blocos e respeita o destaque desligado", () => {
    const { container, rerender } = render(<SubtitleOverlay subtitles={sampleSubtitles} time={1.8} scale={1} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<SubtitleOverlay subtitles={{ ...sampleSubtitles, highlight: false }} time={0.5} scale={1} />);
    expect(container.querySelector("[data-current]")).toBeNull();
  });

  it("posiciona no alto ou no centro conforme o alinhamento", () => {
    const { rerender } = render(<SubtitleOverlay subtitles={{ ...sampleSubtitles, alignment: 8, margin_v: 230 }} time={0.5} scale={0.5} />);
    expect(screen.getByTestId("subtitle-overlay").style.top).toBe("115px");
    rerender(<SubtitleOverlay subtitles={{ ...sampleSubtitles, alignment: 5 }} time={0.5} scale={0.5} />);
    expect(screen.getByTestId("subtitle-overlay").style.top).toBe("50%");
  });
});

describe("ClipPreview", () => {
  it("mostra a prévia ao vivo no formato do projeto com a legenda sincronizada", async () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: /Prévia: Por que a maioria/ });
    expect(within(dialog).getByText(/Formato 9:16 · 1080×1920/)).toBeInTheDocument();
    const video = dialog.querySelector("video") as HTMLVideoElement;
    expect(video.getAttribute("src")).toBe(`/api/projects/${project.id}/source`);
    // Simula o vídeo tocando 0,5 s depois do início do corte.
    await screen.findByText(/legenda “Destaque”/);
    Object.defineProperty(video, "currentTime", { value: clip.start + 0.5, writable: true });
    act(() => {
      fireEvent.timeUpdate(video);
    });
    expect(screen.getByTestId("subtitle-overlay")).toHaveTextContent("POR QUE GUARDAR");
    expect(screen.getByText("0:00.5 / 0:20.1")).toBeInTheDocument();
  });

  it("gera o quadro final exato pelo servidor", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("tab", { name: "Quadro final (exato)" }));
    const image = screen.getByRole("img", { name: /Quadro final em 0:00.0/ });
    expect(image.getAttribute("src")).toMatch(new RegExp(`^/api/projects/${project.id}/clips/${clip.id}/frame.jpg\\?t=0.00&v=`));
    expect(screen.getByText(/Gerando o quadro com o FFmpeg/)).toBeInTheDocument();
    fireEvent.load(image);
    expect(screen.queryByText(/Gerando o quadro/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Momento do quadro"), { target: { value: "3.5" } });
    expect(screen.getByRole("img").getAttribute("src")).toContain("t=3.50");
  });

  it("mostra o vídeo gerado com download e aviso de desatualizado", async () => {
    stubFetch();
    const rendered = makeClip({ render: makeRender({ stale: true, notes: ["Rosto encontrado em só 20% do trecho."] }) });
    render(<ClipPreview project={project} clip={rendered} initialTab="rendered" onClose={vi.fn()} />);
    const url = `/api/projects/${project.id}/exports/por-que-a-maioria-clip-1-9x16.mp4`;
    expect(document.querySelector("video")?.getAttribute("src")).toBe(`${url}?download=false`);
    expect(screen.getByRole("link", { name: /Baixar MP4 \(4,0 MB\)/ })).toHaveAttribute("href", url);
    expect(screen.getByText(/gerado antes das últimas alterações/)).toBeInTheDocument();
    expect(screen.getByText("Rosto encontrado em só 20% do trecho.")).toBeInTheDocument();
  });

  it("fecha com o botão e com Esc", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    await user.click(screen.getByRole("button", { name: "Fechar prévia" }));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("enquadramento na prévia ao vivo", () => {
  const framing = {
    mode: "rosto" as const,
    requested: "rosto" as const,
    override: null,
    source_width: 1280,
    source_height: 720,
    crop_width: 404,
    crop_height: 720,
    x: 100,
    y: 0,
    keyframes: [
      [0, 100],
      [10, 876],
    ] as [number, number][],
    notes: [],
  };

  it("posiciona o vídeo para mostrar só o recorte", () => {
    expect(cropXAt(framing, 5)).toBe(488);
    expect(cropXAt(framing, 20)).toBe(876);
    // Caixa de 202 px de largura = recorte de 404 px na escala 0,5.
    expect(videoCropStyle(cropRectAt(framing, 0), 1280, 720, 202)).toEqual({
      position: "absolute",
      left: -50,
      top: -0,
      width: 640,
      height: 360,
      maxWidth: "none",
    });
    expect(videoCropStyle(cropRectAt(framing, 10), 1280, 720, 202).left).toBe(-438);
  });

  it("usa o enquadramento por rosto calculado pelo servidor", async () => {
    const rostoProject = makeProject({ settings: { ...project.settings, framing: "rosto" } });
    stubFetch(framing);
    render(<ClipPreview project={rostoProject} clip={clip} onClose={vi.fn()} />);
    expect(await screen.findByText("Acompanhamento do rosto aplicado à prévia.")).toBeInTheDocument();
    const video = document.querySelector("video") as HTMLVideoElement;
    // jsdom não mede a caixa: a largura inicial de 270 px dá escala 270/404.
    expect(parseFloat(video.style.left)).toBeCloseTo((-100 * 270) / 404, 6);
    expect(parseFloat(video.style.width)).toBeCloseTo((1280 * 270) / 404, 6);
  });

  it("avisa quando o navegador não reproduz o MP4 gerado", () => {
    stubFetch();
    render(<ClipPreview project={project} clip={makeClip({ render: makeRender() })} initialTab="rendered" onClose={vi.fn()} />);
    fireEvent.error(document.querySelector("video") as HTMLVideoElement);
    expect(screen.getByText(/não conseguiu reproduzir o MP4/)).toBeInTheDocument();
  });
});
