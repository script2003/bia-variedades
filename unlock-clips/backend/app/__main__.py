"""Inicia o servidor: ``python -m app [--host 127.0.0.1] [--port 8000] [--abrir] [--reload]``."""

from __future__ import annotations

import argparse
import json
import socket
import sys
import threading
import time
import urllib.request
import webbrowser

MIN_PYTHON = (3, 10)


def port_in_use(host: str, port: int) -> bool:
    """Verifica se já existe algum programa usando a porta (no Windows, o bind exclusivo evita falsos negativos)."""
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    with socket.socket(family, socket.SOCK_STREAM) as sock:
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        try:
            sock.bind((host, port))
        except OSError:
            return True
    return False


def running_instance(url: str, timeout: float = 2.0) -> str | None:
    """Versão do UNLOCK CLIPS que responde em ``url``, ou ``None`` se for outro programa."""
    try:
        with urllib.request.urlopen(f"{url}/api/health", timeout=timeout) as response:  # noqa: S310 - endereço local
            data = json.loads(response.read().decode("utf-8"))
    except (OSError, ValueError):
        return None
    return data.get("version") if isinstance(data, dict) and data.get("status") == "ok" else None


def open_when_ready(url: str, timeout: float = 60.0) -> None:
    """Abre o navegador assim que o servidor responder (em segundo plano)."""

    def wait_and_open() -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if running_instance(url, timeout=1.0):
                webbrowser.open(url)
                return
            time.sleep(0.5)

    threading.Thread(target=wait_and_open, name="abrir-navegador", daemon=True).start()


def main(argv: list[str] | None = None) -> int:
    if sys.version_info < MIN_PYTHON:
        print(f"O UNLOCK CLIPS precisa do Python {MIN_PYTHON[0]}.{MIN_PYTHON[1]} ou mais recente "
              f"(encontrado: {sys.version.split()[0]}).", file=sys.stderr)  # fmt: skip
        return 1

    parser = argparse.ArgumentParser(prog="python -m app", description="Servidor UNLOCK CLIPS")
    parser.add_argument("--host", default="127.0.0.1", help="Endereço de escuta (padrão: 127.0.0.1, só este computador)")
    parser.add_argument("--port", type=int, default=8000, help="Porta (padrão: 8000)")
    parser.add_argument("--abrir", "--open", dest="open_browser", action="store_true", help="Abre o navegador quando o servidor estiver pronto")
    parser.add_argument("--reload", action="store_true", help="Reinicia ao alterar o código (desenvolvimento)")
    parser.add_argument("--log-requisicoes", dest="access_log", action="store_true", help="Mostra cada requisição HTTP no terminal")
    args = parser.parse_args(argv)

    browser_host = "127.0.0.1" if args.host in ("0.0.0.0", "::") else args.host
    url = f"http://{browser_host}:{args.port}"
    if port_in_use(args.host, args.port):
        version = running_instance(url)
        if version:
            print(f"O UNLOCK CLIPS {version} já está em execução em {url}")
            if args.open_browser:
                webbrowser.open(url)
            return 0
        print(f"A porta {args.port} já está sendo usada por outro programa. Feche-o ou escolha outra porta, "
              f"por exemplo: python -m app --port {args.port + 10}", file=sys.stderr)  # fmt: skip
        return 2

    import uvicorn

    from .config import AppConfig
    from .logs import log_file, uvicorn_log_config

    config = AppConfig.from_env()
    log_config = uvicorn_log_config(config.data_dir, access_log=args.access_log)
    print(f"UNLOCK CLIPS em {url}  (Ctrl+C para encerrar)")
    print(f"Dados: {config.data_dir}  ·  Log: {log_file(config.data_dir)}")
    if args.open_browser:
        open_when_ready(url)
    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_config=log_config,
        access_log=args.access_log,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
