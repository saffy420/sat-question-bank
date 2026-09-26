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
export function overlay(card, layer, laser = null) {
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
    ctx.strokeStyle = mark.color; ctx.fillStyle = mark.color; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); mark.points.forEach(([x,y],i) => i ? ctx.lineTo(x*width,y*height) : ctx.moveTo(x*width,y*height));
    ctx.stroke(); if (mark.points.length === 1) { ctx.beginPath(); ctx.arc(mark.points[0][0]*width,mark.points[0][1]*height,2,0,Math.PI*2); ctx.fill(); }
  }
  if (laser) { ctx.fillStyle = '#e32020'; ctx.beginPath(); ctx.arc(laser.x*width,laser.y*height,7,0,Math.PI*2); ctx.fill(); }
}
export function follow(card, op) {
  let target;
  if (op.type === 'highlight' || op.type === 'strike') {
    const block = [...card.querySelectorAll('[data-ann-node]')].find(n => n.dataset.annNode === op.nodeId);
    target = [...(block?.querySelectorAll('[data-ann-mark]') || [])].find(n => n.dataset.annMark === op.id);
  }
  const y = op.type === 'stroke' ? op.points.at(-1)?.[1] : null;
  const rect = target?.getBoundingClientRect();
  const top = rect?.top ?? (y == null ? null : card.getBoundingClientRect().top + y*card.clientHeight);
  const scroller = card.closest('#lesson-live') || window;
  const viewport = scroller === window ? { top:0,bottom:innerHeight,height:innerHeight } : scroller.getBoundingClientRect();
  if (top != null && (top < viewport.top || top > viewport.bottom)) scroller.scrollBy({ top:top - viewport.top - viewport.height/2,behavior:'smooth' });
}
