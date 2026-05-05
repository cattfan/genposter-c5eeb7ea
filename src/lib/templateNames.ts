const IMPORT_NAME_TOKEN = /\s*(?:\((?:import|bản nhập|ban nhap)\)|-\s*(?:import|bản nhập|ban nhap))\s*/gi;

export function formatTemplateDisplayName(name: string | undefined, fallback = "Khuôn mẫu") {
  const cleaned = (name ?? "")
    .replace(IMPORT_NAME_TOKEN, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || fallback;
}

export function formatImportedTemplateName(name: string | undefined, fallback = "Khuôn mẫu") {
  return `${formatTemplateDisplayName(name, fallback)} - bản nhập`;
}
