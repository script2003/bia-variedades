import { CheckCircle2, Save, XCircle } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api/client";
import type { AppSettings, HealthInfo, WhisperModelOption } from "../api/types";
import ClipSettingsForm from "../components/ClipSettingsForm";
import TranscriptionSettingsForm from "../components/TranscriptionSettingsForm";
import Notice from "../components/Notice";
import PageHeader from "../components/PageHeader";

export function parseDomains(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((d) => d.trim())
    .filter(Boolean);
}

function FFmpegStatus({ health }: { health: HealthInfo }) {
  const ok = health.ffmpeg_available && health.ffprobe_available;
  return (
    <div className={`rounded-xl border p-4 text-sm ${ok ? "border-brand-400/30 bg-brand-400/5" : "border-amber-500/30 bg-amber-500/10"}`}>
      <p className={`flex items-center gap-2 font-semibold ${ok ? "text-brand-300" : "text-amber-200"}`}>
        {ok ? <CheckCircle2 className="size-4" aria-hidden /> : <XCircle className="size-4" aria-hidden />}
        {ok ? "FFmpeg encontrado e funcionando" : "FFmpeg indisponível"}
      </p>
      {ok ? (
        <dl className="mt-2 grid gap-1 text-xs text-zinc-400">
          <div>
            <dt className="inline text-zinc-500">Versão: </dt>
            <dd className="inline">{health.ffmpeg_version}</dd>
          </div>
          <div>
            <dt className="inline text-zinc-500">FFmpeg: </dt>
            <dd className="inline font-mono break-all">{health.ffmpeg_path}</dd>
          </div>
          <div>
            <dt className="inline text-zinc-500">FFprobe: </dt>
            <dd className="inline font-mono break-all">{health.ffprobe_path}</dd>
          </div>
        </dl>
      ) : (
        <p className="mt-1 text-amber-100/80">{health.ffmpeg_error}</p>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [domainsText, setDomainsText] = useState("");
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [models, setModels] = useState<WhisperModelOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([api.getSettings(), api.health(), api.transcriptionModels()])
      .then(([loaded, info, catalog]) => {
        if (!active) return;
        setSettings(loaded);
        setDomainsText(loaded.allowed_link_domains.join("\n"));
        setHealth(info);
        setModels(catalog);
      })
      .catch((err: Error) => active && setMessage({ tone: "error", text: err.message }));
    return () => {
      active = false;
    };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!settings) return;
    setSaving(true);
    setMessage(null);
    try {
      const saved = await api.saveSettings({ ...settings, allowed_link_domains: parseDomains(domainsText) });
      setSettings(saved);
      setDomainsText(saved.allowed_link_domains.join("\n"));
      // A pasta do FFmpeg e os modelos podem ter mudado: verifica novamente antes de confirmar.
      const [info, catalog] = await Promise.all([api.health(), api.transcriptionModels()]);
      setHealth(info);
      setModels(catalog);
      setMessage({ tone: "success", text: "Configurações salvas." });
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="Configurações" description="Preferências padrão aplicadas aos novos projetos e regras de importação." />

      {!settings ? (
        message ? <Notice tone="error">{message.text}</Notice> : <p className="text-sm text-zinc-500">Carregando…</p>
      ) : (
        <form onSubmit={submit} className="grid gap-6">
          <section className="card p-5 sm:p-6">
            <h2 className="mb-1 text-lg font-semibold">Padrões dos cortes</h2>
            <p className="mb-5 text-sm text-zinc-500">Usados ao criar projetos pelo Painel. Cada projeto pode ter configurações próprias.</p>
            <ClipSettingsForm
              value={settings.clip_defaults}
              onChange={(clip_defaults) => setSettings({ ...settings, clip_defaults })}
              idPrefix="defaults"
            />
          </section>

          <section className="card grid gap-5 p-5 sm:p-6">
            <div>
              <h2 className="mb-1 text-lg font-semibold">Links autorizados</h2>
              <p className="text-sm text-zinc-500">
                Somente links destes domínios (e subdomínios) podem ser importados. Cadastre apenas fontes cujo conteúdo
                você tem direito de usar — por exemplo, o armazenamento do seu próprio site ou CDN.
              </p>
            </div>
            <div>
              <label className="label" htmlFor="domains">Domínios (um por linha)</label>
              <textarea
                id="domains"
                rows={4}
                className="input font-mono"
                placeholder={"arquivos.meusite.com.br\ncdn.minhaempresa.com"}
                value={domainsText}
                onChange={(e) => setDomainsText(e.target.value)}
              />
            </div>
            <div className="max-w-xs">
              <label className="label" htmlFor="max-size">Tamanho máximo por vídeo (MB)</label>
              <input
                id="max-size"
                type="number"
                min={1}
                max={102400}
                className="input"
                value={settings.max_upload_size_mb}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value));
                  if (Number.isFinite(n)) setSettings({ ...settings, max_upload_size_mb: Math.min(102400, Math.max(1, n)) });
                }}
              />
            </div>
          </section>

          <section className="card grid gap-4 p-5 sm:p-6" aria-label="Transcrição">
            <div>
              <h2 className="mb-1 text-lg font-semibold">Transcrição</h2>
              <p className="text-sm text-zinc-500">
                Feita localmente com o faster-whisper, sem serviços pagos. O idioma usado é o{" "}
                <strong className="text-zinc-300">idioma das legendas</strong> de cada projeto.
              </p>
            </div>
            {health && !health.transcription_available && <Notice tone="warning">{health.transcription_error}</Notice>}
            <TranscriptionSettingsForm
              value={settings.transcription}
              models={models}
              onChange={(transcription) => setSettings({ ...settings, transcription })}
            />
          </section>

          <section className="card grid gap-4 p-5 sm:p-6">
            <div>
              <h2 className="mb-1 text-lg font-semibold">FFmpeg</h2>
              <p className="text-sm text-zinc-500">
                Usado para ler o vídeo e extrair o áudio. Deixe em branco para usar o FFmpeg do PATH do sistema
                (instalado com <code className="font-mono text-zinc-300">winget install -e --id Gyan.FFmpeg</code>), ou
                informe a pasta que contém <code className="font-mono text-zinc-300">ffmpeg.exe</code> e{" "}
                <code className="font-mono text-zinc-300">ffprobe.exe</code>.
              </p>
            </div>
            <div>
              <label className="label" htmlFor="ffmpeg-dir">Pasta do FFmpeg (opcional)</label>
              <input
                id="ffmpeg-dir"
                className="input font-mono"
                placeholder="C:\ffmpeg\bin"
                value={settings.ffmpeg_dir ?? ""}
                onChange={(e) => setSettings({ ...settings, ffmpeg_dir: e.target.value || null })}
              />
            </div>
            {health && <FFmpegStatus health={health} />}
          </section>

          {message && <Notice tone={message.tone}>{message.text}</Notice>}

          <div className="flex justify-end">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              <Save className="size-4" aria-hidden />
              {saving ? "Salvando…" : "Salvar configurações"}
            </button>
          </div>
        </form>
      )}

      {health && (
        <section className="card mt-6 p-5 sm:p-6">
          <h2 className="mb-4 text-lg font-semibold">Sistema</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-zinc-500">Versão</dt>
              <dd>{health.version}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Pasta de dados</dt>
              <dd className="font-mono text-xs break-all">{health.data_dir}</dd>
            </div>
          </dl>
        </section>
      )}
    </>
  );
}
