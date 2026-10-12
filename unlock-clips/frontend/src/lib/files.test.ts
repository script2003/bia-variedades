import { describe, expect, it } from "vitest";
import { fileExtension, validateLink, validateVideoFile } from "./files";

const file = (name: string, size: number) => new File([new Uint8Array(size)], name, { type: "video/mp4" });

describe("validateVideoFile", () => {
  it("aceita extensões de vídeo suportadas", () => {
    expect(validateVideoFile(file("Aula.MP4", 10), 100)).toBeNull();
    expect(validateVideoFile(file("debate.webm", 10), null)).toBeNull();
  });

  it("recusa formatos não suportados, arquivos vazios e grandes demais", () => {
    expect(validateVideoFile(file("foto.png", 10), 100)).toMatch(/Formato não suportado/);
    expect(validateVideoFile(file("vazio.mp4", 0), 100)).toMatch(/vazio/);
    expect(validateVideoFile(file("grande.mp4", 2 * 1024 * 1024), 1)).toMatch(/limite de 1 MB/);
  });
});

describe("fileExtension", () => {
  it("extrai a extensão em minúsculas", () => {
    expect(fileExtension("a.b.MKV")).toBe(".mkv");
    expect(fileExtension("semextensao")).toBe("");
    expect(fileExtension(".oculto")).toBe("");
  });
});

describe("validateLink", () => {
  it("exige URL http(s) completa", () => {
    expect(validateLink("")).toMatch(/Informe/);
    expect(validateLink("exemplo.com/video.mp4")).toMatch(/inválido/);
    expect(validateLink("ftp://exemplo.com/a.mp4")).toMatch(/http/);
    expect(validateLink(" https://exemplo.com/a.mp4 ")).toBeNull();
  });
});
