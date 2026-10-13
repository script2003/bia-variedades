"""Teste de ponta a ponta com o UNLOCK CLIPS em execução (sem bibliotecas extras).

Percorre o fluxo inteiro pela API, como um usuário faria pela interface:

  envio do vídeo → verificação e extração de áudio → transcrição (modelo Whisper real)
  → sugestão de cortes → edição (título, legendas e enquadramento) → geração do MP4
  → conferência do arquivo com o FFprobe → exclusão do projeto de teste.

Uso (com o servidor já iniciado, por exemplo com scripts\\iniciar.ps1):

    backend\\.venv\\Scripts\\python.exe scripts\\teste_completo.py --video caminho\\do\\video.mp4

Sem ``--video``, um vídeo de teste com tom (sem fala) é gerado com o FFmpeg — nesse caso não há
falas para transcrever e um corte manual é criado para testar o resto do fluxo. As configurações
globais alteradas para o teste (modelo de transcrição) são restauradas no final.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


class Falha(Exception):
    pass


class Api:
    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")

    def call(self, method: str, path: str, body: object | None = None, *, data: bytes | None = None, raw=None, headers=None, timeout=120):
        url = self.base + path
        hdrs = {"Accept": "application/json", **(headers or {})}
        payload = data
        if body is not None:
            payload = json.dumps(body).encode("utf-8")
            hdrs["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=raw if raw is not None else payload, method=method, headers=hdrs)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - servidor local
                content = response.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")
            raise Falha(f"{method} {path} → HTTP {exc.code}: {detail}") from exc
        if not content:
            return None
        try:
            return json.loads(content)
        except ValueError:
            return content

    def get(self, path: str):
        return self.call("GET", path)


def log(texto: str) -> None:
    print(texto, flush=True)


def aguardar(api: Api, pid: str, alvo: set[str], limite: float, rotulo: str) -> dict:
    inicio = time.monotonic()
    ultima = ""
    while True:
        projeto = api.get(f"/api/projects/{pid}")
        job = projeto.get("job") or {}
        linha = f"   [{rotulo}] {projeto['status']} · {job.get('message') or ''} {round((job.get('progress') or 0) * 100)}%"
        if linha != ultima:
            log(linha)
            ultima = linha
        if projeto["status"] in alvo and (job.get("status") not in ("queued", "running")):
            return projeto
        if projeto["status"] in ("failed", "cancelled", "interrupted"):
            raise Falha(f"{rotulo}: o projeto terminou como '{projeto['status']}': {projeto.get('error')}")
        if time.monotonic() - inicio > limite:
            raise Falha(f"{rotulo}: tempo esgotado ({limite:.0f} s) aguardando {alvo}")
        time.sleep(1.0)


def gerar_video(ffmpeg: str, destino: Path) -> None:
    subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
         "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=25:duration=40",
         "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=44100:duration=40",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(destino)],
        check=True, timeout=300,
    )  # fmt: skip


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--video", type=Path, help="Vídeo com fala para testar (padrão: gera um vídeo de teste)")
    parser.add_argument("--modelo", default="tiny", help="Modelo Whisper usado no teste (padrão: tiny, 75 MB)")
    parser.add_argument("--pasta-modelo", dest="pasta_modelo", help="Pasta de um modelo Whisper já baixado (sem internet)")
    parser.add_argument("--idioma", default="pt-BR", help="Idioma das legendas/transcrição (ex.: pt-BR, en)")
    parser.add_argument("--esperado", default="", help="Palavras (separadas por vírgula) que devem aparecer na transcrição")
    parser.add_argument("--saida", type=Path, help="Pasta onde guardar o MP4 gerado e um quadro dele")
    parser.add_argument("--manter", action="store_true", help="Não exclui o projeto de teste no final")
    args = parser.parse_args()
    api = Api(args.url)

    log(f"1/9 Verificando o servidor em {args.url}")
    try:
        saude = api.get("/api/health")
    except (Falha, OSError) as exc:
        log(f"FALHOU: servidor indisponível ({exc}). Inicie-o com scripts\\iniciar.ps1.")
        return 1
    log(f"   versão {saude['version']} · FFmpeg: {saude['ffmpeg_available']} · transcrição: {saude['transcription_available']}")
    if not saude["ffmpeg_available"]:
        log(f"FALHOU: FFmpeg indisponível: {saude.get('ffmpeg_error')}")
        return 1
    ffmpeg, ffprobe = saude["ffmpeg_path"], saude["ffprobe_path"]

    originais = api.get("/api/settings")
    pid: str | None = None
    try:
        teste = json.loads(json.dumps(originais))
        teste["transcription"].update({"model": args.modelo, "model_dir": args.pasta_modelo, "auto_transcribe": True, "allow_download": True})
        teste["clip_detection"]["auto_detect"] = True
        api.call("PUT", "/api/settings", teste)

        trabalho = Path(tempfile.mkdtemp(prefix="unlock-e2e-"))
        video = args.video
        if video is None:
            video = trabalho / "teste.mp4"
            log("2/9 Gerando um vídeo de teste com o FFmpeg (sem fala)")
            gerar_video(ffmpeg, video)
        else:
            log(f"2/9 Usando o vídeo {video} ({video.stat().st_size / 1024 / 1024:.1f} MB)")

        log("3/9 Enviando o vídeo")
        ajustes = {"duration": "15-30", "aspect_ratio": "9:16", "subtitle_language": args.idioma, "max_clips": 3}
        query = urllib.parse.urlencode({"filename": video.name, "title": "Teste completo", "settings": json.dumps(ajustes)})
        with open(video, "rb") as arquivo:
            projeto = api.call(
                "POST", f"/api/projects/upload?{query}", raw=arquivo,
                headers={"Content-Type": "application/octet-stream", "Content-Length": str(video.stat().st_size)},
                timeout=600,
            )  # fmt: skip
        pid = projeto["id"]
        log(f"   projeto {pid}")

        log("4/9 Processando (verificação, áudio, transcrição e sugestão de cortes)")
        projeto = aguardar(api, pid, {"ready"}, 1800, "processamento")
        transcricao = api.get(f"/api/projects/{pid}/transcript")
        texto = " ".join(s["text"] for s in transcricao["segments"]).strip()
        palavras = sum(len(s["words"]) or len(s["text"].split()) for s in transcricao["segments"])
        log(f"   transcrição ({transcricao['language']}, modelo {transcricao['model']}, {palavras} palavras): {texto[:300]}")
        esperado = [p.strip().lower() for p in args.esperado.split(",") if p.strip()]
        if esperado:
            achadas = [p for p in esperado if p in texto.lower()]
            log(f"   palavras esperadas encontradas: {achadas} de {esperado}")
            if len(achadas) * 2 < len(esperado):
                raise Falha("a transcrição não contém as palavras esperadas")

        log("5/9 Conferindo os cortes sugeridos")
        cortes = api.get(f"/api/projects/{pid}/clips")["clips"] if projeto.get("clips") else []
        for c in cortes:
            log(f"   {round(c['score'])} pts · {c['start']:.1f}–{c['end']:.1f} s · {c['title']}")
        if cortes:
            corte = cortes[0]
        else:
            log("   nenhum corte sugerido (vídeo sem fala?): criando um corte manual de 20 s")
            if not projeto.get("clips"):
                raise Falha("o projeto não tem lista de cortes")
            corte = api.call("POST", f"/api/projects/{pid}/clips", {"start": 5, "end": 25, "title": "Corte manual de teste"})

        log("6/9 Editando: título, aprovação, enquadramento manual e legenda")
        cid = corte["id"]
        api.call("PATCH", f"/api/projects/{pid}/clips/{cid}", {
            "title": "Corte de teste editado", "status": "approved",
            "framing_override": {"mode": "manual", "x": 0.3, "y": 0.5, "zoom": 1.2},
        })  # fmt: skip
        legendas = api.get(f"/api/projects/{pid}/clips/{cid}/subtitles")
        blocos = [{k: b[k] for k in ("start", "end", "text", "hidden")} for b in legendas["editable"]]
        if blocos:
            blocos[0]["text"] = "Legenda editada no teste"
            editadas = api.call("PUT", f"/api/projects/{pid}/clips/{cid}/subtitles", {"cues": blocos})
            if not editadas["edited"]:
                raise Falha("a legenda editada não foi salva")
            log(f"   {len(blocos)} bloco(s) de legenda; o primeiro foi editado")
        else:
            log("   o trecho não tem fala: sem legendas para editar")

        log("7/9 Gerando o MP4")
        api.call("POST", f"/api/projects/{pid}/clips/render", {"clip_ids": [cid]})
        aguardar(api, pid, {"ready"}, 900, "geração")
        render = next(c for c in api.get(f"/api/projects/{pid}/clips")["clips"] if c["id"] == cid)["render"]
        if not render or render["stale"]:
            raise Falha(f"vídeo não gerado ou desatualizado: {render}")
        log(f"   {render['filename']} · {render['width']}×{render['height']} · {render['duration_seconds']:.1f} s · "
            f"{render['size_bytes'] / 1024:.0f} KB · enquadramento {render['framing']}")  # fmt: skip

        log("8/9 Baixando e conferindo o arquivo com o FFprobe")
        saida = args.saida or trabalho
        saida.mkdir(parents=True, exist_ok=True)
        destino = saida / render["filename"]
        conteudo = api.call("GET", f"/api/projects/{pid}/exports/{urllib.parse.quote(render['filename'])}", timeout=300)
        destino.write_bytes(conteudo)
        info = json.loads(subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height", "-of", "json", str(destino)],
            capture_output=True, text=True, check=True,
        ).stdout)  # fmt: skip
        fluxos = {s["codec_type"]: s for s in info["streams"]}
        video_info = fluxos.get("video", {})
        if (video_info.get("codec_name"), video_info.get("width"), video_info.get("height")) != ("h264", 1080, 1920):
            raise Falha(f"MP4 inesperado: {info}")
        if fluxos.get("audio", {}).get("codec_name") != "aac":
            raise Falha(f"MP4 sem áudio AAC: {info}")
        quadro = saida / "quadro.jpg"
        subprocess.run([ffmpeg, "-v", "error", "-y", "-ss", "1", "-i", str(destino), "-frames:v", "1", str(quadro)], check=True)
        log(f"   H.264 1080×1920 + AAC · salvo em {destino} · quadro em {quadro}")

        exportados = api.get(f"/api/projects/{pid}/exports")
        if [e["filename"] for e in exportados] != [render["filename"]]:
            raise Falha(f"lista de exportados inesperada: {exportados}")
    except Falha as exc:
        log(f"FALHOU: {exc}")
        return 1
    finally:
        api.call("PUT", "/api/settings", originais)
        if pid and not args.manter:
            log("9/9 Excluindo o projeto de teste")
            try:
                api.call("DELETE", f"/api/projects/{pid}")
            except Falha as exc:
                log(f"   aviso: {exc}")

    log("OK: fluxo completo concluído com sucesso.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
