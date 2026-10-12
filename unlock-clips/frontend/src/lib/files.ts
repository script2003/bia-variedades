export const ALLOWED_VIDEO_EXTENSIONS = [".mp4", ".m4v", ".mov", ".mkv", ".webm", ".avi"] as const;

export const ACCEPT_ATTRIBUTE = [...ALLOWED_VIDEO_EXTENSIONS, "video/*"].join(",");

export function fileExtension(name: string): string {
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index).toLowerCase() : "";
}

/** Validação prévia no navegador. O back-end repete todas as verificações. */
export function validateVideoFile(file: File, maxUploadSizeMb: number | null): string | null {
  const ext = fileExtension(file.name);
  if (!(ALLOWED_VIDEO_EXTENSIONS as readonly string[]).includes(ext)) {
    return `Formato não suportado (${ext || "sem extensão"}). Use ${ALLOWED_VIDEO_EXTENSIONS.join(", ")}.`;
  }
  if (file.size === 0) return "O arquivo selecionado está vazio.";
  if (maxUploadSizeMb !== null && file.size > maxUploadSizeMb * 1024 * 1024) {
    return `O arquivo excede o limite de ${maxUploadSizeMb.toLocaleString("pt-BR")} MB definido em Configurações.`;
  }
  return null;
}

/** Validação prévia de links (o servidor aplica a lista de domínios autorizados). */
export function validateLink(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "Informe o link do vídeo.";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Link inválido. Use o endereço completo, começando com https://";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Somente links http:// ou https:// são aceitos.";
  return null;
}
