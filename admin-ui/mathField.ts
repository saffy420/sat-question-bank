import MathQuill from "@desmos-community/mathquill";
import mathQuillStyles from "@desmos-community/mathquill/style.css?inline";

// live-mathtype: the presenter's math input, MathQuill as the Desmos calculator ships it (the desmosinc fork,
// bundled and pinned in package.json), so keys behave as they do in Desmos: `sqrt` `cbrt` `nthroot` `pi`
// `theta` `infinity` become symbols, sin/cos/tan/log/ln upright, `<=` `>=` `*` become ≤ ≥ ·, `^` `_` `/` take the
// group before them, brackets close themselves and arrows/Backspace walk the structure.
const MQ = MathQuill.getInterface(3);
const CONFIG = {
  autoCommands: "pi theta sqrt cbrt nthroot infinity",
  // Desmos's function names, not MathQuill's default list: that one has `inf`, which would eat `infinity`.
  autoOperatorNames: "sin cos tan sec csc cot arcsin arccos arctan sinh cosh tanh log ln exp min max gcd lcm mod",
  restrictMismatchedBrackets: true,
  supSubsRequireOperand: true,
};

// The editor's CSS without its Symbola @font-face: the font files are not shipped, and the editor draws in
// the page's KaTeX fonts instead (admin.css), so no font request goes out.
export const mathFieldStyles = mathQuillStyles.replace(/@font-face\s*\{[^}]*\}/g, "");

export type MathField = {
  latex: () => string;
  focus: () => void;
};

// A MathQuill field in `el` holding `tex`. `edit` runs after every change. The field's LaTeX is mirrored on
// `el.dataset.latex` (tests and tooling read it there). Pasted text is read as LaTeX, with or without \( \) or $.
export function mathField(el: HTMLElement, tex: string, edit: () => void): MathField {
  // Loading `tex` is not an edit.
  let ready = false;
  const mirror = () => {
    el.dataset.latex = field.latex();
  };
  const field = MQ.MathField(el, {
    ...CONFIG,
    overridePaste: (event?: ClipboardEvent) => {
      const text = event?.clipboardData?.getData("text/plain");
      if (text == null) return false;
      event!.preventDefault();
      field.write(
        text
          .trim()
          .replace(/^\$\$?([\s\S]*?)\$\$?$/, "$1")
          .replace(/^\\[([]([\s\S]*)\\[)\]]$/, "$1"),
      );
      mirror();
      edit();
      return true;
    },
    handlers: {
      edit: () => {
        if (!ready) return;
        mirror();
        edit();
      },
    },
  });
  field.latex(tex);
  mirror();
  ready = true;
  return { latex: () => field.latex(), focus: () => field.focus() };
}

// Whether MathQuill took `tex` without losing anything: KaTeX draws the same symbols from what the field
// loaded (spacing and display style aside). Environments (arrays, cases) and commands MathQuill doesn't know,
// like \text, fail this and stay locked instead of being rewritten.
export function sameMath(tex: string, loaded: string) {
  if (!loaded.trim() || /\\begin\b/.test(tex)) return false;
  const katex = (
    window as Window & {
      katex?: { renderToString: (tex: string, options: object) => string };
    }
  ).katex;
  const symbols = (source: string) => {
    if (!katex) return null;
    try {
      const holder = document.createElement("template");
      holder.innerHTML = katex.renderToString(source, { output: "mathml", throwOnError: true });
      holder.content.querySelectorAll("annotation").forEach((n) => n.remove());
      return holder.content.textContent!.replace(/\s+/g, "");
    } catch {
      return null;
    }
  };
  const before = symbols(tex);
  return before !== null && before === symbols(loaded);
}
