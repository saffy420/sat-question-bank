import { escapeHTML } from "./escape.ts";

// Instructor notes: escaped first, then paragraphs, "- " lists and inline code/bold/em.
// The builder preview, the live instructor drawer and the student Breakdown (§9.1) share it.
export const notesHTML = (text: string) =>
  escapeHTML(text)
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split("\n");
      const inline = (s: string) =>
        s.replace(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g, (token) =>
          token.startsWith("`")
            ? `<code>${token.slice(1, -1)}</code>`
            : token.startsWith("**")
              ? `<strong>${token.slice(2, -2)}</strong>`
              : `<em>${token.slice(1, -1)}</em>`,
        );
      return lines.every((s) => /^[-*] /.test(s))
        ? `<ul>${lines.map((s) => `<li>${inline(s.slice(2))}</li>`).join("")}</ul>`
        : `<p>${lines.map(inline).join("<br>")}</p>`;
    })
    .join("");
