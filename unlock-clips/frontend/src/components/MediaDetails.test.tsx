import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeProject } from "../test/fixtures";
import MediaDetails, { describeAudioStreams, describeVideo } from "./MediaDetails";

describe("MediaDetails", () => {
  const project = makeProject();

  it("descreve vídeo e trilhas de áudio", () => {
    expect(describeVideo(project.media!)).toBe("1920×1080 (horizontal) · H264 · 29,97 fps");
    const rotated = { ...project.media!, video: { ...project.media!.video!, rotation: 90 } };
    expect(describeVideo(rotated)).toMatch(/^1080×1920 \(vertical\)/);
    expect(describeAudioStreams(project.media!)).toBe("AAC 48 kHz estéreo por");
    expect(describeAudioStreams({ ...project.media!, audio_streams: [] })).toBe("Nenhuma");
  });

  it("mostra duração e o player do áudio extraído", () => {
    render(<MediaDetails project={project} />);
    expect(screen.getByText("1:02:05")).toBeInTheDocument();
    const player = screen.getByLabelText("Áudio extraído");
    expect(player).toHaveAttribute("src", `/api/projects/${project.id}/audio?v=119200044`);
    expect(screen.getByText(/WAV PCM 16 bits · mono · 16 kHz/)).toBeInTheDocument();
  });

  it("não renderiza nada antes da leitura da mídia", () => {
    const { container } = render(<MediaDetails project={makeProject({ media: null, audio: null })} />);
    expect(container).toBeEmptyDOMElement();
  });
});
