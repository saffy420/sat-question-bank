// Shared lesson annotations: offsets count authored text nodes, never KaTeX output.
const textNodes = root => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode(node) {
    return node.parentElement.closest('.katex,script,style,canvas') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
  } });
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
};
export function blocks(card) {
  const result = [];
  for (const [selector, prefix] of [['.passage','p'],['.lesson-stem','s']]) {
    let i = 0;
    card.querySelectorAll(selector).forEach(container => {
      const children = container.querySelectorAll('p,li,h1,h2,h3,h4,blockquote');
      const roots = children.length ? [...children].filter(n => !n.parentElement.closest('p,li,h1,h2,h3,h4,blockquote')) : [container];
      roots.forEach(node => { node.dataset.annNode = `${prefix}:${i++}`; result.push(node); });
    });
  }
  card.querySelectorAll('.choice[data-letter]').forEach(choice => {
    const node = choice.querySelector(':scope > span:last-child');
    if (node) { node.dataset.annNode = `c:${choice.dataset.letter}`; result.push(node); }
  });
  return result;
}
export function anchor(card, selection) {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  const block = blocks(card).find(n => n.contains(range.startContainer) && n.contains(range.endContainer));
  if (!block || range.startContainer.parentElement?.closest('.katex') || range.endContainer.parentElement?.closest('.katex')) return null;
  let start = 0, end = 0, pos = 0;
  for (const node of textNodes(block)) {
    if (node === range.startContainer) start = pos + range.startOffset;
    if (node === range.endContainer) end = pos + range.endOffset;
    pos += node.length;
  }
  return end > start ? { nodeId:block.dataset.annNode, startOffset:start, endOffset:end } : null;
}
// Pointer anchors. Presenter and students lay the stage out at different widths, so laser and pen
// positions are tied to content, not to the card box:
//   '<node>@<offset>'  character <offset> of an annotation block; x,y are CSS px from that glyph,
//                      exact across reflow because stage text is sized in px on every client;
//   'i:<n>' / 'P' / 'Q' / '<node>'  figure image, pane or block; x,y are fractions of its box;
//   absent             fractions of the whole card (legacy marks, nothing better under the pointer).
const round = v => Math.round(v * 1e4) / 1e4;
const scaleOf = (card, rect) => rect.width / card.offsetWidth || 1;
const caretAt = (x, y) => {
  if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); return p && { node:p.offsetNode, offset:p.offset }; }
  const r = document.caretRangeFromPoint?.(x, y); return r && { node:r.startContainer, offset:r.startOffset };
};
function anchorElement(card, id) {
  if (id === 'P') return card.querySelector('.stage-passage');
  if (id === 'Q') return card.querySelector('.stage-question');
  if (id.startsWith('i:')) return card.querySelectorAll('img')[Number(id.slice(2))] || null;
  return [...card.querySelectorAll('[data-ann-node]')].find(n => n.dataset.annNode === id) || null;
}
function glyph(block, offset) {
  let pos = 0;
  for (const node of textNodes(block)) {
    if (offset <= pos + node.length) {
      const range = document.createRange(), at = offset - pos;
      range.setStart(node, Math.min(at, node.length)); range.setEnd(node, Math.min(at + 1, node.length));
      return range.getClientRects()[0] || range.getBoundingClientRect();
    }
    pos += node.length;
  }
  return null;
}
// Card-local (unzoomed CSS px) mapping for one anchor, or null when the anchor is missing here.
export function frame(card, a) {
  const c = card.getBoundingClientRect(), s = scaleOf(card, c);
  if (!a) return { toCard:([x,y]) => [x * card.clientWidth, y * card.clientHeight], fromClient:(cx,cy) => [round((cx - c.left) / c.width), round((cy - c.top) / c.height)] };
  const at = a.indexOf('@');
  const el = anchorElement(card, at < 0 ? a : a.slice(0, at));
  if (!el) return null;
  if (at >= 0) {
    const g = glyph(el, Number(a.slice(at + 1)));
    if (!g) return null;
    const ox = (g.left - c.left) / s, oy = (g.top - c.top) / s;
    return { toCard:([x,y]) => [ox + x, oy + y], fromClient:(cx,cy) => [round((cx - c.left) / s - ox), round((cy - c.top) / s - oy)] };
  }
  const r = el.getBoundingClientRect();
  const ox = (r.left - c.left) / s, oy = (r.top - c.top) / s, w = r.width / s || 1, h = r.height / s || 1;
  return { toCard:([x,y]) => [ox + x * w, oy + y * h], fromClient:(cx,cy) => [round(((cx - c.left) / s - ox) / w), round(((cy - c.top) / s - oy) / h)] };
}
// Best anchor for a client point: the character under it, else the smallest figure/pane/block, else the card.
export function locate(card, cx, cy) {
  const caret = caretAt(cx, cy);
  const block = caret?.node?.nodeType === 3 && card.contains(caret.node) && !caret.node.parentElement.closest('.katex') ? caret.node.parentElement.closest('[data-ann-node]') : null;
  if (block && card.contains(block)) {
    let offset = 0;
    for (const node of textNodes(block)) { if (node === caret.node) { offset += caret.offset; break; } offset += node.length; }
    const a = `${block.dataset.annNode}@${offset}`, f = frame(card, a);
    // Caret APIs snap to the nearest text from far away; only use it when the glyph is close by.
    if (f) { const [x, y] = f.fromClient(cx, cy); if (Math.abs(x) < 60 && Math.abs(y) < 40) return { a, x, y }; }
  }
  let best = null, area = Infinity;
  const ids = [...card.querySelectorAll('img')].map((_, i) => 'i:' + i).concat(['P', 'Q'], [...card.querySelectorAll('[data-ann-node]')].map(n => n.dataset.annNode));
  for (const id of ids) {
    const el = anchorElement(card, id); if (!el) continue;
    const r = el.getBoundingClientRect();
    if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom && r.width * r.height < area) { best = id; area = r.width * r.height; }
  }
  const [x, y] = frame(card, best).fromClient(cx, cy);
  return best ? { a:best, x, y } : { x:Math.min(1, Math.max(0, x)), y:Math.min(1, Math.max(0, y)) };
}
export function strokePoints(card, mark) {
  const f = frame(card, mark.a);
  return f ? mark.points.map(f.toCard) : [];
}
export function paint(card, layer) {
  [...card.querySelectorAll('[data-ann-mark]')].reverse().forEach(n => n.replaceWith(...n.childNodes));
  for (const mark of layer) {
    if (mark.type !== 'highlight' && mark.type !== 'strike') continue;
    const block = [...card.querySelectorAll('[data-ann-node]')].find(n => n.dataset.annNode === mark.nodeId);
    if (!block) continue;
    let pos = 0;
    const segments = [];
    for (const node of textNodes(block)) {
      const from = Math.max(0, mark.startOffset - pos), to = Math.min(node.length, mark.endOffset - pos);
      if (to > from) segments.push([node,from,to]);
      pos += node.length;
    }
    for (const [node,from,to] of segments.reverse()) {
      const range = document.createRange(); range.setStart(node,from); range.setEnd(node,to);
      const span = document.createElement('span'); span.dataset.annMark = mark.id;
      if (mark.type === 'highlight') span.style.backgroundColor = mark.color;
      else span.style.textDecoration = 'line-through';
      range.surroundContents(span);
    }
  }
}
export function overlay(card, layer) {
  let canvas = card.querySelector(':scope > canvas.lesson-ink');
  if (!canvas) { canvas = document.createElement('canvas'); canvas.className = 'lesson-ink'; canvas.style.cssText = 'position:absolute;inset:0;z-index:2;pointer-events:none'; card.prepend(canvas); }
  const width = card.clientWidth, height = card.clientHeight;
  if (!width || !height) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio; canvas.height = height * ratio;
  canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d'); ctx.scale(ratio,ratio);
  for (const mark of layer) {
    if (mark.type !== 'stroke') continue;
    const points = strokePoints(card, mark);
    if (!points.length) continue;
    ctx.strokeStyle = mark.color; ctx.fillStyle = mark.color; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); points.forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
    ctx.stroke(); if (points.length === 1) { ctx.beginPath(); ctx.arc(points[0][0],points[0][1],2,0,Math.PI*2); ctx.fill(); }
  }
}
// Laser: one absolutely positioned dot per card, moved only with transform. Each packet
// retargets a short linear transform transition, so the compositor interpolates every frame
// between packets without main-thread work; the canvas and React tree are never repainted.
const lasers = new WeakMap();
const GLIDE = 'transform 50ms linear';
export function laser(card) {
  const cached = lasers.get(card);
  if (cached?.dot.isConnected) return cached;
  const dot = document.createElement('div');
  dot.className = 'lesson-laser'; dot.hidden = true; dot.setAttribute('aria-hidden', 'true');
  card.append(dot);
  let point = null;
  const move = glide => {
    const at = frame(card, point.a)?.toCard([point.x, point.y]);
    if (!at) { dot.hidden = true; return; }
    dot.style.transition = glide ? GLIDE : 'none';
    dot.style.transform = `translate3d(${at[0]}px,${at[1]}px,0)`;
    dot.hidden = false;
  };
  const view = {
    dot,
    show(next) {
      const appearing = dot.hidden;
      point = next; move(!appearing);
    },
    hide() { point = null; dot.hidden = true; },
    // Layout changed under the dot (resize, reflow): jump, don't glide across the page.
    refresh() { if (point) move(false); }
  };
  lasers.set(card, view);
  return view;
}
export function refreshLaser(card) { lasers.get(card)?.refresh(); }
export function follow(card, op) {
  let target;
  if (op.type === 'highlight' || op.type === 'strike') {
    const block = [...card.querySelectorAll('[data-ann-node]')].find(n => n.dataset.annNode === op.nodeId);
    target = [...(block?.querySelectorAll('[data-ann-mark]') || [])].find(n => n.dataset.annMark === op.id);
  }
  const y = op.type === 'stroke' ? strokePoints(card, op).at(-1)?.[1] : null;
  const rect = target?.getBoundingClientRect();
  const top = rect?.top ?? (y == null ? null : card.getBoundingClientRect().top + y * scaleOf(card, card.getBoundingClientRect()));
  const scroller = card.closest('#lesson-live') || window;
  const viewport = scroller === window ? { top:0,bottom:innerHeight,height:innerHeight } : scroller.getBoundingClientRect();
  if (top != null && (top < viewport.top || top > viewport.bottom)) scroller.scrollBy({ top:top - viewport.top - viewport.height/2,behavior:'smooth' });
}
