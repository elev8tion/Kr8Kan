export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function relativeTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(d);
}

export function isOverdue(date: Date | string | null | undefined): boolean {
  if (!date) return false;
  return new Date(date).getTime() < Date.now();
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Minimal markdown → HTML for worker results (headings, bold, italics,
 * inline code, code fences, lists, links). Escapes HTML first. */
export function miniMarkdown(md: string): string {
  const escaped = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const withCode = escaped.replace(
    /```([\s\S]*?)```/g,
    (_, code: string) => `<pre><code>${code.trim()}</code></pre>`,
  );
  const lines = withCode.split("\n");
  const out: string[] = [];
  let inList = false;
  for (const line of lines) {
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (li) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(li[1]!)}</li>`);
      continue;
    }
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = Math.min(h[1]!.length + 2, 6);
      out.push(`<h${level}>${inline(h[2]!)}</h${level}>`);
    } else if (line.trim() === "") {
      out.push("");
    } else if (line.startsWith("<pre>")) {
      out.push(line);
    } else {
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  if (inList) out.push("</ul>");
  return out.join("\n");

  function inline(text: string): string {
    return text
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|\W)\*(.+?)\*(?=\W|$)/g, "$1<em>$2</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(
        /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
        '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
      );
  }
}
