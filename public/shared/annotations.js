// Shared lesson annotations: offsets count authored text nodes, never KaTeX output.
const textNodes = root => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode(node) {
    // The figure toolbar's "125%" differs per client, so it never counts toward an offset.
    return node.parentElement.closest('.katex,script,style,canvas,.fv-bar') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
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
// Pointer anchors. Presenter and students lay the stage out at different widths and, since type is
// fluid (clamp() of the viewport), at different font sizes, so laser and pen positions are tied to
// content and to a scale-free unit, never to the card box or to CSS px:
//   '<node>~<offset>'  character <offset> of an annotation block; x,y are EM of that block's font size
//                      from that glyph's top-left, so they mean the same words at any type size;
//   '<node>@<offset>'  the same with x,y in CSS px (marks saved before em anchors; only exact while
//                      both sides use the same font size);
//   'i:<n>' / 'P' / 'Q' / '<node>'  figure image, pane or block; x,y are fractions of its box;
//   absent             fractions of the whole card (legacy marks, nothing better under the pointer).
const round = v => Math.round(v * 1e4) / 1e4;
// Layout px per client px. A card is never transformed here; integer offsetWidth vs fractional rect
// width differs by sub-pixels at fractional zoom, so only a real difference counts as a scale.
export function scaleOf(card, rect = card.getBoundingClientRect()) {
  const w = card.offsetWidth;
  return !w || Math.abs(rect.width - w) < 1.5 ? 1 : rect.width / w;
}
const fontPx = el => parseFloat(getComputedStyle(el).fontSize) || 16;
const GLYPH = /^(.+?)([@~])(\d+)$/;
const caretAt = (x, y) => {
  if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); return p && { node:p.offsetNode, offset:p.offset }; }
  const r = document.caretRangeFromPoint?.(x, y); return r && { node:r.startContainer, offset:r.startOffset };
};
// 'i:<n>' numbers figures before other images. Math figures used to sit in the left pane, ahead of the
// stem's notation crops; now they sit in the stem in a viewer frame. Listing framed and pane images first
// keeps every saved 'i:<n>' on the figure it was drawn on.
const images = card => {
  const all = [...card.querySelectorAll('img')], lead = all.filter(i => i.closest('.fv-content, .stage-passage'));
  return lead.concat(all.filter(i => !lead.includes(i)));
};
function anchorElement(card, id) {
  if (id === 'P') return card.querySelector('.stage-passage');
  if (id === 'Q') return card.querySelector('.stage-question');
  if (id.startsWith('i:')) return images(card)[Number(id.slice(2))] || null;
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
// Card-local (layout px) mapping for one anchor, or null when the anchor is missing here.
// `em` is the anchor block's font size in px for glyph anchors (pen width follows it), else 0.
export function frame(card, a) {
  const c = card.getBoundingClientRect(), s = scaleOf(card, c);
  if (!a) return { em:0, toCard:([x,y]) => [x * card.clientWidth, y * card.clientHeight], fromClient:(cx,cy) => [round((cx - c.left) / c.width), round((cy - c.top) / c.height)] };
  const m = GLYPH.exec(a);
  const el = anchorElement(card, m ? m[1] : a);
  if (!el) return null;
  if (m) {
    const g = glyph(el, Number(m[3]));
    if (!g) return null;
    const k = m[2] === '~' ? fontPx(el) : 1;
    const ox = (g.left - c.left) / s, oy = (g.top - c.top) / s;
    return { em:m[2] === '~' ? k : 0, toCard:([x,y]) => [ox + x * k, oy + y * k], fromClient:(cx,cy) => [round(((cx - c.left) / s - ox) / k), round(((cy - c.top) / s - oy) / k)] };
  }
  // A figure in a viewer frame: its box includes this client's zoom/pan, so a fraction names the same
  // point of the figure at any zoom; `clip` is the frame's visible view in card px.
  const r = el.getBoundingClientRect();
  const ox = (r.left - c.left) / s, oy = (r.top - c.top) / s, w = r.width / s || 1, h = r.height / s || 1;
  const view = a.startsWith('i:') ? el.closest('.fv-view')?.getBoundingClientRect() : null;
  const clip = view ? [(view.left - c.left) / s, (view.top - c.top) / s, view.width / s, view.height / s] : null;
  return { em:0, clip, toCard:([x,y]) => [ox + x * w, oy + y * h], fromClient:(cx,cy) => [round(((cx - c.left) / s - ox) / w), round(((cy - c.top) / s - oy) / h)] };
}
const inClip = (clip, [x, y]) => !clip || (x >= clip[0] && y >= clip[1] && x <= clip[0] + clip[2] && y <= clip[1] + clip[3]);
// The glyph under (or right next to) a client point, as an em anchor; null when no text is close.
// Caret APIs snap to the nearest text from far away, so only a glyph within 3 em × 2 em counts.
export function locateGlyph(card, cx, cy) {
  const caret = caretAt(cx, cy);
  const block = caret?.node?.nodeType === 3 && card.contains(caret.node) && !caret.node.parentElement.closest('.katex, .fv-bar') ? caret.node.parentElement.closest('[data-ann-node]') : null;
  if (!block || !card.contains(block)) return null;
  let offset = 0;
  for (const node of textNodes(block)) { if (node === caret.node) { offset += caret.offset; break; } offset += node.length; }
  const a = `${block.dataset.annNode}~${offset}`, f = frame(card, a);
  if (!f) return null;
  const [x, y] = f.fromClient(cx, cy);
  return Math.abs(x) < 3 && Math.abs(y) < 2 ? { a, x, y } : null;
}
// Best anchor for a client point: the character under it, else the smallest figure/pane/block, else the card.
export function locate(card, cx, cy) {
  const near = locateGlyph(card, cx, cy);
  if (near) return near;
  let best = null, area = Infinity;
  const ids = [...card.querySelectorAll('img')].map((_, i) => 'i:' + i).concat(['P', 'Q'], [...card.querySelectorAll('[data-ann-node]')].map(n => n.dataset.annNode));
  for (const id of ids) {
    const el = anchorElement(card, id); if (!el) continue;
    let r = el.getBoundingClientRect();
    // A zoomed figure's box runs past its frame; only the part the frame shows is under the pointer.
    const view = id.startsWith('i:') ? el.closest('.fv-view')?.getBoundingClientRect() : null;
    if (view) r = { left:Math.max(r.left, view.left), top:Math.max(r.top, view.top), right:Math.min(r.right, view.right), bottom:Math.min(r.bottom, view.bottom), width:r.width, height:r.height };
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
  if (!canvas) { canvas = document.createElement('canvas'); canvas.className = 'lesson-ink'; canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:2;pointer-events:none'; card.prepend(canvas); }
  // The canvas fills the card's padding box exactly (CSS 100%); the backing store is that box in
  // device pixels, rounded once, and the context is scaled by the exact ratio (not truncated).
  const rect = card.getBoundingClientRect(), s = scaleOf(card, rect);
  const width = rect.width / s, height = rect.height / s;
  if (!width || !height) return;
  const ratio = window.devicePixelRatio || 1;
  const pw = Math.max(1, Math.round(width * ratio * s)), ph = Math.max(1, Math.round(height * ratio * s));
  if (canvas.width !== pw) canvas.width = pw;
  if (canvas.height !== ph) canvas.height = ph;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, pw, ph);
  ctx.setTransform(pw / width, 0, 0, ph / height, 0, 0);
  for (const mark of layer) {
    if (mark.type !== 'stroke') continue;
    const f = frame(card, mark.a);
    const points = f ? mark.points.map(f.toCard) : [];
    if (!points.length) continue;
    // Pen width follows the type size it was drawn over, so it looks the same on every screen.
    const line = f.em ? Math.max(2, Math.min(6, f.em * 0.16)) : 3;
    ctx.save();
    if (f.clip) { ctx.beginPath(); ctx.rect(...f.clip); ctx.clip(); }
    ctx.strokeStyle = mark.color; ctx.fillStyle = mark.color; ctx.lineWidth = line; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); points.forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
    ctx.stroke(); if (points.length === 1) { ctx.beginPath(); ctx.arc(points[0][0],points[0][1],line / 1.5,0,Math.PI*2); ctx.fill(); }
    ctx.restore();
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
    const f = frame(card, point.a), at = f?.toCard([point.x, point.y]);
    // A point on a figure this client has zoomed or panned out of its frame is not shown.
    if (!at || !inClip(f.clip, at)) { dot.hidden = true; return; }
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
