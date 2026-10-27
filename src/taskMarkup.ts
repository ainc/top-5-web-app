// Task titles are plain text until someone adds a link or bold.
// Quill stores that richer title as a small piece of HTML. Everything else
// stays the words themselves, so older rows and "does this task have text?"
// keep working.

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<]+/gi;

export function taskPlainText(value: string): string {
  if (!value) return "";
  if (!value.trimStart().startsWith("<")) return value.trim();
  const doc = new DOMParser().parseFromString(value, "text/html");
  return (doc.body.textContent ?? "").replace(/\u00a0/g, " ").trim();
}

export function taskToHtml(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("<")) return sanitizeTaskHtml(trimmed);
  return linkifyText(trimmed);
}

// What we write back after the editor closes. A title with no bold and no
// link is stored as plain text again.
export function taskFromEditorHtml(html: string): string {
  const safe = sanitizeTaskHtml(html);
  const plain = taskPlainText(safe);
  if (!plain) return "";
  const doc = new DOMParser().parseFromString(safe, "text/html");
  if (!doc.body.querySelector("a, strong, b")) return plain;
  return safe;
}

export function taskToEditorHtml(value: string): string {
  const html = taskToHtml(value);
  if (!html) return "<p><br></p>";
  if (value.trimStart().startsWith("<")) return html;
  return `<p>${html}</p>`;
}

function linkifyText(text: string): string {
  let html = "";
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const found = match[0];
    const trimmed = found.replace(/[),.;:!?]+$/, "");
    const trailing = found.slice(trimmed.length);
    html += escapeHtml(text.slice(last, start));
    html += linkTag(trimmed);
    html += escapeHtml(trailing);
    last = start + found.length;
  }
  html += escapeHtml(text.slice(last));
  return html;
}

function linkTag(raw: string): string {
  const href = safeHref(raw.startsWith("www.") ? `https://${raw}` : raw);
  if (!href) return escapeHtml(raw);
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(raw)}</a>`;
}

function sanitizeTaskHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = document.createElement("div");
  doc.body.childNodes.forEach((node) => keepNode(node, root));
  return root.innerHTML;
}

function keepNode(node: Node, parent: HTMLElement): void {
  if (node.nodeType === Node.TEXT_NODE) {
    parent.append(node.textContent ?? "");
    return;
  }
  if (!(node instanceof HTMLElement)) return;
  if (node.tagName === "BR") {
    parent.append(document.createElement("br"));
    return;
  }
  if (node.tagName === "A") {
    const href = safeHref(node.getAttribute("href") ?? "");
    if (!href) {
      node.childNodes.forEach((child) => keepNode(child, parent));
      return;
    }
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    node.childNodes.forEach((child) => keepNode(child, link));
    parent.append(link);
    return;
  }
  if (node.tagName === "P" || node.tagName === "STRONG" || node.tagName === "B") {
    const next = document.createElement(node.tagName.toLowerCase());
    node.childNodes.forEach((child) => keepNode(child, next));
    parent.append(next);
    return;
  }
  node.childNodes.forEach((child) => keepNode(child, parent));
}

function safeHref(url: string): string {
  const trimmed = url.trim();
  if (!/^(https?:|mailto:)/i.test(trimmed)) return "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "mailto:") return "";
    return parsed.href;
  } catch {
    return "";
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
