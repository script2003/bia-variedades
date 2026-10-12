import { describe, expect, it, vi } from "vitest";
import { makeProject } from "../test/fixtures";
import { ApiError } from "./client";
import { UploadCancelled, buildUploadUrl, uploadVideo } from "./upload";

class FakeXHR {
  static last: FakeXHR | null = null;
  status = 0;
  responseText = "";
  responseType = "";
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown = null;
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onloadend: (() => void) | null = null;

  constructor() {
    FakeXHR.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.onabort?.();
    this.onloadend?.();
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
    this.onloadend?.();
  }
}

const video = () => new File([new Uint8Array(100)], "Meu podcast.mp4", { type: "video/mp4" });

describe("buildUploadUrl", () => {
  it("codifica nome, título e configurações", () => {
    const url = buildUploadUrl(video(), "  Título  ", undefined);
    expect(url).toBe("/api/projects/upload?filename=Meu+podcast.mp4&title=T%C3%ADtulo");
  });
});

describe("uploadVideo", () => {
  it("envia o arquivo bruto, informa progresso e resolve com o projeto", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const onProgress = vi.fn();
    const file = video();
    const promise = uploadVideo({ file, onProgress });
    const xhr = FakeXHR.last!;
    expect(xhr.method).toBe("POST");
    expect(xhr.body).toBe(file);
    expect(xhr.headers["Content-Type"]).toBe("video/mp4");
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent);
    expect(onProgress).toHaveBeenCalledWith({ loaded: 50, total: 100, fraction: 0.5 });
    const project = makeProject();
    xhr.respond(201, project);
    await expect(promise).resolves.toEqual(project);
  });

  it("converte erros do servidor em ApiError com a mensagem do back-end", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const promise = uploadVideo({ file: video() });
    FakeXHR.last!.respond(415, { detail: "Formato não suportado" });
    await expect(promise).rejects.toEqual(new ApiError(415, "Formato não suportado"));
  });

  it("cancela pelo AbortSignal", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const controller = new AbortController();
    const promise = uploadVideo({ file: video(), signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(UploadCancelled);
  });
});
