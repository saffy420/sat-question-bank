// Plain-text first words of an item's notes, for the lesson rows and the viewer outline.
export const notesSnippet = (notes: string, words = 8) => {
  const text = notes
    .replace(/\\[()[\]]/g, " ")
    .replace(/[`*_#>]/g, "")
    .replace(/^\s*-\s+/gm, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!text.length) return "No notes";
  return text.slice(0, words).join(" ") + (text.length > words ? "…" : "");
};
