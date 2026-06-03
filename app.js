/* ============================================================
   Tap Studio (polished) — selection tools + direct painting,
   real PNG-8 tap-to-reveal export. All local, no uploads.
   ============================================================ */
const $ = id => document.getElementById(id);
const els = {
  area: $('area'), stack: $('stack'), drop: $('drop'), file: $('file'), newImg: $('newImg'),
  imgCanvas: $('imgCanvas'), maskCanvas: $('maskCanvas'), selTint: $('selTint'), selAnts: $('selAnts'),
  cursor: $('cursor'), hint: $('hint'), dims: $('dims'),
  tol: $('tol'), brush: $('brush'), zoom: $('zoom'), density: $('density'), bucketReach: $('bucketReach'),
  contig: $('contig'), bucketLimit: $('bucketLimit'),
  shapeGroup: $('shapeGroup'),
  brushRow: $('brushRow'), tolRow: $('tolRow'),
  markAll: $('markAll'), undo: $('undo'), clearMask: $('clearMask'),
  generate: $('generate'), result: $('result'), previewFull: $('previewFull'),
  resultMeta: $('resultMeta'), download: $('download'), themeBtn: $('themeBtn'),
  saveProject: $('saveProject'), openProject: $('openProject'), tspFile: $('tspFile'),
};

// Mask paint colors (must match the export classifier).
const COLORS = {
  hidden: { r: 255, g: 100, b: 100, a: 153 },
  visible: { r: 100, g: 200, b: 255, a: 153 },
  black: { r: 100, g: 255, b: 150, a: 153 },
};
function classify(r, g, b, a) {
  if (a < 20) return null;
  if (g > r && g > b && g > 120) return 'black';
  if (b > r && b > g - 30) return 'visible';
  if (r > b && r > g - 30) return 'hidden';
  return null;
}

let srcImage = null, srcName = 'tap_studio', W = 0, H = 0;
let srcData = null;                 // cached untouched source pixels
let mctx = null;                    // mask 2d ctx (willReadFrequently)
let undoStack = []; const MAX_UNDO = 14;
let isDown = false, isRightClick = false, lastCoord = null, tool = 'brush', mode = 'hidden', brushShape = 'circle';
let isResizingBrush = false, lastResizeX = 0;
let lassoPoints = [], lassoErase = false, lassoAdd = false;
let panX = 0, panY = 0, isPanning = false, isSpaceDown = false, lastPanX = 0, lastPanY = 0;
let selBase = null, selRegion = null;   // floating selection: base mask + current region
const MAX_WORK = 2500;

let lassoEdgeMap = null;

function computeEdgeMap() {
  lassoEdgeMap = new Float32Array(W * H);
  const d = srcData;
  const gray = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) gray[i] = (d[i*4]*299 + d[i*4+1]*587 + d[i*4+2]*114)/1000;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = -gray[i-W-1] + gray[i-W+1] -2*gray[i-1] + 2*gray[i+1] -gray[i+W-1] + gray[i+W+1];
      const gy = -gray[i-W-1] - 2*gray[i-W] - gray[i-W+1] +gray[i+W-1] + 2*gray[i+W] + gray[i+W+1];
      lassoEdgeMap[i] = Math.sqrt(gx*gx + gy*gy);
    }
  }
}

/* ─────────── Loading ─────────── */
// #drop is a <label> wrapping #file, so it opens the picker natively.
// We do NOT call file.click() ourselves (that would prompt twice).
els.drop.addEventListener('dragover', e => { e.preventDefault(); els.drop.classList.add('over'); });
els.drop.addEventListener('dragleave', () => els.drop.classList.remove('over'));
els.drop.addEventListener('drop', e => {
  e.preventDefault(); els.drop.classList.remove('over');
  const f = e.dataTransfer.files[0];
  if (f) { f.name.toLowerCase().endsWith('.tsp') ? openProjectFile(f) : loadFile(f); }
});
els.file.addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  f.name.toLowerCase().endsWith('.tsp') ? openProjectFile(f) : loadFile(f);
});
els.newImg.addEventListener('click', e => {
  e.preventDefault();
  srcImage = null; els.drop.style.display = 'flex'; els.newImg.style.display = 'none';
  els.result.classList.add('hidden'); els.generate.disabled = true; els.dims.textContent = '';
  els.file.value = '';
  if (els.saveProject) els.saveProject.disabled = true;
  [els.imgCanvas, els.maskCanvas, els.selTint, els.selAnts].forEach(c => { const x = c.getContext('2d'); x && x.clearRect(0, 0, c.width, c.height); });
});

function loadFile(file) {
  srcName = file.name.replace(/\.[^.]+$/, '') + '_tapme';
  const rd = new FileReader();
  rd.onload = ev => { const img = new Image(); img.onload = () => { srcImage = img; setup(); }; img.src = ev.target.result; };
  rd.readAsDataURL(file);
}

function setup() {
  // Work at the image's NATIVE resolution, like the original tool, so the source
  // is never smoothed/blurred before the interlace pattern is applied (that load-time
  // downscale weakened the hide/reveal effect). Export still caps the long side at
  // 2500px via baseScale in generate().
  W = srcImage.naturalWidth; H = srcImage.naturalHeight;
  [els.imgCanvas, els.maskCanvas, els.selTint, els.selAnts].forEach(c => { c.width = W; c.height = H; });
  const ictx = els.imgCanvas.getContext('2d');
  ictx.clearRect(0, 0, W, H); ictx.drawImage(srcImage, 0, 0);
  srcData = ictx.getImageData(0, 0, W, H).data;
  computeEdgeMap();
  mctx = els.maskCanvas.getContext('2d', { willReadFrequently: true });
  mctx.clearRect(0, 0, W, H);
  els.selAnts.getContext('2d').clearRect(0, 0, W, H);
  selBase = null; selRegion = null;
  undoStack = [];
  els.drop.style.display = 'none'; els.newImg.style.display = 'inline-block';
  els.generate.disabled = false; els.result.classList.add('hidden');
  if (els.saveProject) els.saveProject.disabled = false;
  els.dims.textContent = W + '×' + H + 'px';
  fitZoom();
}

function fitZoom() {
  panX = 0; panY = 0;
  const aw = els.area.clientWidth - 26, ah = els.area.clientHeight - 26;
  let pct = 100;
  if (aw > 0 && ah > 0) { pct = Math.floor(Math.min(aw / W, ah / H) * 100); pct = Math.max(10, Math.min(500, pct)); }
  els.zoom.value = pct; $('zoomVal').textContent = pct; applyZoom();
}
function applyZoom() {
  const z = parseInt(els.zoom.value) / 100;
  els.stack.style.transform = `translate(${panX}px, ${panY}px) scale(${z})`;
  els.stack.style.width = W + 'px'; els.stack.style.height = H + 'px';
}

/* ─────────── Pickers ─────────── */
document.querySelectorAll('.mode').forEach(b => b.addEventListener('click', () => {
  commitFloating(); // bake in any active selection before switching mode
  document.querySelectorAll('.mode').forEach(x => x.classList.remove('active'));
  b.classList.add('active'); mode = b.dataset.mode;
}));
document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => {
  commitFloating();   // switching tool bakes the current selection in
  document.querySelectorAll('.tool').forEach(x => x.classList.remove('active'));
  b.classList.add('active'); tool = b.dataset.tool;
  els.area.setAttribute('data-tool', tool);
  const isSel = tool === 'wand' || tool === 'quick' || tool === 'lasso';
  els.shapeGroup.style.display = tool === 'brush' ? 'flex' : 'none';
  els.brushRow.style.opacity = (tool === 'brush' || tool === 'quick') ? 1 : .4;
  els.tolRow.style.opacity = isSel ? 1 : .4;
}));
els.area.setAttribute('data-tool', tool); // Set initial
document.querySelectorAll('.shape').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.shape').forEach(x => x.classList.remove('active'));
  b.classList.add('active'); brushShape = b.dataset.shape;
}));
els.tol.oninput = () => $('tolVal').textContent = els.tol.value;
els.brush.oninput = () => $('brushVal').textContent = els.brush.value;
els.density.oninput = () => $('densityVal').textContent = els.density.value;
els.bucketReach.oninput = () => $('bucketReachVal').textContent = els.bucketReach.value;
els.zoom.oninput = () => { $('zoomVal').textContent = els.zoom.value; applyZoom(); };

if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}
window.scrollTo(0, 0);

/* ─────────── Undo ─────────── */
function saveUndo() {
  if (!mctx) return;
  undoStack.push(mctx.getImageData(0, 0, W, H));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}
const IS_MAC = /Mac|iPhone|iPad|iPod/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent);
els.undo.textContent = IS_MAC ? 'Undo (⌘Z)' : 'Undo (Ctrl+Z)';
const kbUndo = $('kb-undo');
if (kbUndo) kbUndo.innerHTML = IS_MAC ? '<kbd>⌘</kbd> + <kbd>Z</kbd>' : '<kbd>Ctrl</kbd> + <kbd>Z</kbd>';
const kbZoom = $('kb-zoom');
const scrollIcon = `<svg width="13" height="19" viewBox="0 0 24 36" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" style="vertical-align: middle; margin: 0 4px; transform: translateY(-1px);"><rect x="3" y="2" width="18" height="32" rx="9"/><path d="M 3 14 L 21 14"/><rect x="10" y="4" width="4" height="8" rx="2" fill="currentColor"/></svg>`;
if (kbZoom) kbZoom.innerHTML = (IS_MAC ? '<kbd>⌘</kbd> + ' : '<kbd>Ctrl</kbd> + ') + scrollIcon + ' Scroll';
els.undo.onclick = () => { commitFloating(); if (undoStack.length) { mctx.putImageData(undoStack.pop(), 0, 0); } };
document.addEventListener('keydown', e => {
  if (e.repeat) return;  // ignore OS key auto-repeat: one physical press = one action.
                         // Without this, holding Ctrl+Z fires a burst of undos and wipes the whole drawing.
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); els.undo.onclick(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (srcImage) saveProject(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); els.tspFile.click(); }
});
els.clearMask.onclick = () => { if (!mctx) return; commitFloating(); saveUndo(); mctx.clearRect(0, 0, W, H); };
els.markAll.onclick = () => {
  if (!mctx) return; commitFloating(); saveUndo();
  const img = mctx.getImageData(0, 0, W, H), d = img.data, c = COLORS.hidden;
  for (let i = 0; i < W * H; i++) { if (srcData[i * 4 + 3] > 20) { const p = i * 4; d[p] = c.r; d[p + 1] = c.g; d[p + 2] = c.b; d[p + 3] = c.a; } }
  mctx.putImageData(img, 0, 0);
};

/* ─────────── Brush ─────────── */
function traceShape(ctx, x, y, r, shape) {
  ctx.beginPath();
  if (shape === 'square') ctx.rect(x - r, y - r, r * 2, r * 2);
  else if (shape === 'triangle') { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r); ctx.lineTo(x - r, y + r); ctx.closePath(); }
  else if (shape === 'hline') { const t = Math.max(2, r / 2.5); ctx.rect(x - r, y - t / 2, r * 2, t); }
  else if (shape === 'vline') { const t = Math.max(2, r / 2.5); ctx.rect(x - t / 2, y - r, t, r * 2); }
  else ctx.arc(x, y, r, 0, Math.PI * 2);
}
function paintAt(x, y, erase) {
  const r = parseInt(els.brush.value);
  const m = erase ? 'erase' : mode;
  if (m === 'erase') {
    mctx.save(); mctx.globalCompositeOperation = 'destination-out'; mctx.fillStyle = 'rgba(0,0,0,1)';
    traceShape(mctx, x, y, r, brushShape); mctx.fill(); mctx.restore();
  } else {
    const c = COLORS[m];
    if (brushShape === 'round') {
      const g = mctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${c.r},${c.g},${c.b},${c.a / 255})`);
      g.addColorStop(.6, `rgba(${c.r},${c.g},${c.b},${(c.a * .85) / 255})`);
      g.addColorStop(1, `rgba(${c.r},${c.g},${c.b},${(c.a * .2) / 255})`);
      mctx.fillStyle = g; traceShape(mctx, x, y, r, 'round'); mctx.fill();
    } else { mctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${c.a / 255})`; traceShape(mctx, x, y, r, brushShape); mctx.fill(); }
  }
}

/* ─────────── Bucket (respects the drawing's outlines) ─────────── */
function bucketFill(sx, sy, erase) {
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return;
  const maskImg = mctx.getImageData(0, 0, W, H), md = maskImg.data, sd = srcData;
  const sp = (sy * W + sx) * 4;
  const cls0 = classify(md[sp], md[sp + 1], md[sp + 2], md[sp + 3]);
  const sr = sd[sp], sg = sd[sp + 1], sb = sd[sp + 2], sa = sd[sp + 3];
  const sLum = .299 * sr + .587 * sg + .114 * sb;
  const LUM = 60, COL = 75, AL = 80; const col2 = COL * COL;
  const maxReach = parseInt(els.bucketReach.value), mr2 = maxReach * maxReach;
  const limit = els.bucketLimit.checked;
  const target = erase ? null : mode;
  function fillable(i, x, y) {
    if (limit) { const dx = x - sx, dy = y - sy; if (dx * dx + dy * dy > mr2) return false; }
    const p = i * 4;
    if (classify(md[p], md[p + 1], md[p + 2], md[p + 3]) !== cls0) return false;
    const pr = sd[p], pg = sd[p + 1], pb = sd[p + 2], pa = sd[p + 3];
    if (Math.abs((.299 * pr + .587 * pg + .114 * pb) - sLum) > LUM) return false;
    if (Math.abs(pa - sa) > AL) return false;
    const dr = pr - sr, dg = pg - sg, db = pb - sb; if (dr * dr + dg * dg + db * db > col2) return false;
    return true;
  }
  const start = sy * W + sx; if (!fillable(start, sx, sy)) return;
  const visited = new Uint8Array(W * H), toFill = []; const stack = [start]; visited[start] = 1;
  while (stack.length) {
    const i = stack.pop(); toFill.push(i); const x = i % W, y = (i / W) | 0; let n;
    if (x + 1 < W) { n = i + 1; if (!visited[n] && fillable(n, x + 1, y)) { visited[n] = 1; stack.push(n); } }
    if (x - 1 >= 0) { n = i - 1; if (!visited[n] && fillable(n, x - 1, y)) { visited[n] = 1; stack.push(n); } }
    if (y + 1 < H) { n = i + W; if (!visited[n] && fillable(n, x, y + 1)) { visited[n] = 1; stack.push(n); } }
    if (y - 1 >= 0) { n = i - W; if (!visited[n] && fillable(n, x, y - 1)) { visited[n] = 1; stack.push(n); } }
  }
  for (const i of toFill) {
    const p = i * 4;
    if (target === null) md[p + 3] = 0;
    else { const c = COLORS[target]; md[p] = c.r; md[p + 1] = c.g; md[p + 2] = c.b; md[p + 3] = c.a; }
  }
  mctx.putImageData(maskImg, 0, 0);
}

/* ─────────── Selection tools — wand / quick ───────────
   They keep a FLOATING selection painted live with the active mode color.
   A new selection REPLACES the previous one; hold Shift to ADD. Erase mode or
   right-click removes (and bakes the floating selection in first). */
function colorD2(d, i, r, g, b) { const p = i * 4, dr = d[p] - r, dg = d[p + 1] - g, db = d[p + 2] - b; return dr * dr + dg * dg + db * db; }

function startSession() { if (!selBase) { saveUndo(); selBase = mctx.getImageData(0, 0, W, H); selRegion = new Uint8Array(W * H); } }
function commitFloating() { selBase = null; selRegion = null; }   // canvas keeps whatever is painted
function renderFloating() {
  if (!selBase) return;
  const c = COLORS[mode]; if (!c) return;   // 'erase' has no colour
  const img = mctx.createImageData(W, H); img.data.set(selBase.data);
  const d = img.data;
  for (let i = 0; i < W * H; i++) { if (selRegion[i]) { const p = i * 4; d[p] = c.r; d[p + 1] = c.g; d[p + 2] = c.b; d[p + 3] = c.a; } }
  mctx.putImageData(img, 0, 0);
}
function eraseRegion(region, x0, y0, x1, y1) {
  if (x1 < x0 || y1 < y0) return;
  const img = mctx.getImageData(0, 0, W, H), d = img.data;
  for (let y = y0; y <= y1; y++)for (let x = x0; x <= x1; x++) { const i = y * W + x; if (region[i]) d[i * 4 + 3] = 0; }
  mctx.putImageData(img, 0, 0, x0, y0, (x1 - x0 + 1), (y1 - y0 + 1));
}

/* Magic wand — region by color similarity */
function wandRegion(sx, sy) {
  const d = srcData, t2 = parseInt(els.tol.value) ** 2, contig = els.contig.checked;
  const sp = (sy * W + sx) * 4, sr = d[sp], sg = d[sp + 1], sb = d[sp + 2];
  const region = new Uint8Array(W * H); const bb = [sx, sy, sx, sy];
  const mark = i => { region[i] = 1; const x = i % W, y = (i / W) | 0; if (x < bb[0]) bb[0] = x; if (x > bb[2]) bb[2] = x; if (y < bb[1]) bb[1] = y; if (y > bb[3]) bb[3] = y; };
  if (!contig) { for (let i = 0; i < W * H; i++) if (colorD2(d, i, sr, sg, sb) <= t2) mark(i); }
  else {
    const vis = new Uint8Array(W * H), start = sy * W + sx; vis[start] = 1; const st = [start];
    while (st.length) {
      const i = st.pop(); if (colorD2(d, i, sr, sg, sb) > t2) continue; mark(i);
      const x = i % W, y = (i / W) | 0;
      if (x + 1 < W) { const n = i + 1; if (!vis[n]) { vis[n] = 1; st.push(n); } }
      if (x - 1 >= 0) { const n = i - 1; if (!vis[n]) { vis[n] = 1; st.push(n); } }
      if (y + 1 < H) { const n = i + W; if (!vis[n]) { vis[n] = 1; st.push(n); } }
      if (y - 1 >= 0) { const n = i - W; if (!vis[n]) { vis[n] = 1; st.push(n); } }
    }
  }
  return { region, bb };
}
function wandAction(sx, sy, erase, add) {
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return;
  const { region, bb } = wandRegion(sx, sy);
  if (erase) { commitFloating(); saveUndo(); eraseRegion(region, bb[0], bb[1], bb[2], bb[3]); return; }
  startSession(); if (!add) selRegion.fill(0);
  for (let i = 0; i < W * H; i++) if (region[i]) selRegion[i] = 1;
  renderFloating();
}

/* Quick select — a colour-aware brush. Each dab floods outward from the cursor by
   colour similarity, clipped to a CIRCLE the size of the brush, so it follows the
   shape under the cursor instead of filling a square box. */
let qScratch = null, liveMask = null, qErase = false;
function quickBegin(erase, add) {
  qErase = erase; qScratch = new Uint8Array(W * H);
  if (erase) { commitFloating(); saveUndo(); liveMask = mctx.getImageData(0, 0, W, H); return; }
  startSession(); if (!add) selRegion.fill(0);
  liveMask = mctx.createImageData(W, H); liveMask.data.set(selBase.data);   // base + existing selection
  const c = COLORS[mode], d = liveMask.data;
  for (let i = 0; i < W * H; i++) { if (selRegion[i]) { const p = i * 4; d[p] = c.r; d[p + 1] = c.g; d[p + 2] = c.b; d[p + 3] = c.a; } }
  mctx.putImageData(liveMask, 0, 0);
}
function quickStroke(x, y) {
  if (!liveMask) return;
  x = Math.round(x); y = Math.round(y);
  const r = parseInt(els.brush.value), t2 = parseInt(els.tol.value) ** 2, r2 = r * r;
  const bx0 = Math.max(0, x - r), by0 = Math.max(0, y - r), bx1 = Math.min(W - 1, x + r), by1 = Math.min(H - 1, y + r);
  const target = qErase ? qScratch : selRegion;
  const d = srcData, sp = (y * W + x) * 4, sr = d[sp], sg = d[sp + 1], sb = d[sp + 2];
  // flood from the cursor by colour similarity, clipped to a circle of radius r
  const st = [y * W + x];
  while (st.length) {
    const i = st.pop(); const px = i % W, py = (i / W) | 0;
    const ddx = px - x, ddy = py - y; if (ddx * ddx + ddy * ddy > r2) continue;
    if (target[i]) continue; if (colorD2(d, i, sr, sg, sb) > t2) continue;
    target[i] = 1;
    if (px + 1 <= bx1) st.push(i + 1); if (px - 1 >= bx0) st.push(i - 1);
    if (py + 1 <= by1) st.push(i + W); if (py - 1 >= by0) st.push(i - W);
  }
  const dm = liveMask.data, c = qErase ? null : COLORS[mode];
  for (let yy = by0; yy <= by1; yy++) for (let xx = bx0; xx <= bx1; xx++) {
    const i = yy * W + xx; if (!target[i]) continue; const p = i * 4;
    if (qErase) dm[p + 3] = 0; else { dm[p] = c.r; dm[p + 1] = c.g; dm[p + 2] = c.b; dm[p + 3] = c.a; }
  }
  mctx.putImageData(liveMask, 0, 0, bx0, by0, (bx1 - bx0 + 1), (by1 - by0 + 1));
}

/* ─────────── Smart Lasso ─────────── */
function drawLassoLive() {
  const ctx = els.selAnts.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  if (lassoPoints.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
  for (let i = 1; i < lassoPoints.length; i++) ctx.lineTo(lassoPoints[i].x, lassoPoints[i].y);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function refineLassoAndFill() {
  if (lassoPoints.length < 3) return;
  
  let minX = W, minY = H, maxX = 0, maxY = 0;
  for (const p of lassoPoints) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const margin = 2;
  minX = Math.max(0, Math.floor(minX) - margin);
  maxX = Math.min(W - 1, Math.ceil(maxX) + margin);
  minY = Math.max(0, Math.floor(minY) - margin);
  maxY = Math.min(H - 1, Math.ceil(maxY) + margin);
  if (minX > maxX || minY > maxY) return;
  const bw = maxX - minX + 1, bh = maxY - minY + 1;

  const off = document.createElement('canvas'); off.width = bw; off.height = bh;
  const octx = off.getContext('2d');
  octx.translate(-minX, -minY);
  octx.beginPath(); octx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
  for(let i=1; i<lassoPoints.length; i++) octx.lineTo(lassoPoints[i].x, lassoPoints[i].y);
  octx.closePath(); octx.fillStyle = '#fff'; octx.fill();
  
  const lassoMask = new Uint8Array(W * H);
  const imgData = octx.getImageData(0, 0, bw, bh).data;
  
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      if (imgData[(y * bw + x) * 4 + 3] > 128) {
        lassoMask[(minY + y) * W + (minX + x)] = 1;
      }
    }
  }

  const d = srcData;
  const t2 = parseInt(els.tol.value) ** 2;

  const st = [];
  const stColor = [];
  const visited = new Uint8Array(W * H);

  // 1. Collect all boundary pixels
  const bndPixels = [];
  const bndColors = [];
  
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const i = y * W + x;
      if (lassoMask[i]) {
        if (x === 0 || x === W - 1 || y === 0 || y === H - 1 || 
            !lassoMask[i - 1] || !lassoMask[i + 1] || !lassoMask[i - W] || !lassoMask[i + W]) {
          bndPixels.push(i);
          const p = i * 4;
          bndColors.push((d[p] << 16) | (d[p + 1] << 8) | d[p + 2]);
        }
      }
    }
  }

  const numBnd = bndPixels.length;
  if (numBnd > 0) {
    // 2. Sample the boundary for majority color consensus
    const sampleCount = Math.min(100, numBnd);
    const samples = [];
    const step = Math.max(1, Math.floor(numBnd / sampleCount));
    for(let i=0; i<sampleCount; i++) {
      samples.push(bndColors[(i * step) % numBnd]);
    }

    // 3. Filter boundary seeds: only use those that match at least 15% of the samples
    const minMatches = Math.max(1, Math.floor(sampleCount * 0.15));

    for (let i = 0; i < numBnd; i++) {
      const c = bndColors[i];
      const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
      let matches = 0;
      for (let j = 0; j < sampleCount; j++) {
        const sc = samples[j];
        const sr = (sc >> 16) & 255, sg = (sc >> 8) & 255, sb = sc & 255;
        const dr = r - sr, dg = g - sg, db = b - sb;
        if (dr * dr + dg * dg + db * db <= t2) {
          matches++;
        }
      }
      
      if (matches >= minMatches) {
        st.push(bndPixels[i]);
        stColor.push(c);
        visited[bndPixels[i]] = 1;
      }
    }

    // 4. Clear the seeds from lassoMask to prep for flood fill
    for (let k = 0; k < st.length; k++) {
      lassoMask[st[k]] = 0;
    }
  }

  // 5. Flood Fill
  while (st.length) {
    const curr = st.pop();
    const c = stColor.pop();
    const sr = (c >> 16) & 255, sg = (c >> 8) & 255, sb = c & 255;

    const cx = curr % W, cy = Math.floor(curr / W);
    const neighbors = [];
    if (cx > 0) neighbors.push(curr - 1);
    if (cx < W - 1) neighbors.push(curr + 1);
    if (cy > 0) neighbors.push(curr - W);
    if (cy < H - 1) neighbors.push(curr + W);

    for (let j = 0; j < neighbors.length; j++) {
      const n = neighbors[j];
      if (lassoMask[n] && !visited[n]) {
        if (colorD2(d, n, sr, sg, sb) <= t2) {
          visited[n] = 1;
          lassoMask[n] = 0;
          st.push(n);
          stColor.push(c);
        }
      }
    }
  }

  // 6. Connected component filtering
  const compVis = new Uint8Array(W * H);
  const comps = [];
  let maxArea = 0;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const i = y * W + x;
      if (lassoMask[i] && !compVis[i]) {
        const compQ = [i];
        compVis[i] = 1;
        let head = 0;
        while (head < compQ.length) {
          const curr = compQ[head++];
          const cx = curr % W, cy = Math.floor(curr / W);
          if (cx > 0) { const n = curr - 1; if (lassoMask[n] && !compVis[n]) { compVis[n] = 1; compQ.push(n); } }
          if (cx < W - 1) { const n = curr + 1; if (lassoMask[n] && !compVis[n]) { compVis[n] = 1; compQ.push(n); } }
          if (cy > 0) { const n = curr - W; if (lassoMask[n] && !compVis[n]) { compVis[n] = 1; compQ.push(n); } }
          if (cy < H - 1) { const n = curr + W; if (lassoMask[n] && !compVis[n]) { compVis[n] = 1; compQ.push(n); } }
        }
        comps.push(compQ);
        if (compQ.length > maxArea) maxArea = compQ.length;
      }
    }
  }

  const trashThreshold = Math.max(10, Math.floor((W * H) / 5000));
  for (let cidx = 0; cidx < comps.length; cidx++) {
    const q = comps[cidx];
    if (q.length < trashThreshold && q.length !== maxArea) {
      for (let k = 0; k < q.length; k++) {
        lassoMask[q[k]] = 0;
      }
    }
  }

  if (lassoErase) {
    commitFloating(); saveUndo();
    const mask = mctx.getImageData(0, 0, W, H);
    for (let i = 0; i < W * H; i++) if (lassoMask[i]) mask.data[i * 4 + 3] = 0;
    mctx.putImageData(mask, 0, 0);
  } else {
    startSession(); 
    if (!lassoAdd) selRegion.fill(0);
    for (let i = 0; i < W * H; i++) if (lassoMask[i]) selRegion[i] = 1;
    renderFloating();
  }
}


/* ─────────── Pointer input (mouse + touch) ─────────── */
function toPixel(e) {
  const r = els.maskCanvas.getBoundingClientRect();
  const x = (e.clientX - r.left) * (W / r.width), y = (e.clientY - r.top) * (H / r.height);
  return { x: Math.max(0, Math.min(W - 1, x)), y: Math.max(0, Math.min(H - 1, y)) };
}

document.addEventListener('keydown', e => {
  if (e.target && e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  
  if (k === '1') { e.preventDefault(); document.querySelector('[data-mode="hidden"]').click(); }
  if (k === '2') { e.preventDefault(); document.querySelector('[data-mode="visible"]').click(); }
  if (k === '3') { e.preventDefault(); document.querySelector('[data-mode="black"]').click(); }
  if (k === 'e') { e.preventDefault(); document.querySelector('[data-mode="erase"]').click(); }
  
  if (k === 'b') { e.preventDefault(); document.querySelector('[data-tool="brush"]').click(); }
  if (k === 'g') { e.preventDefault(); document.querySelector('[data-tool="bucket"]').click(); }
  if (k === 'w') { e.preventDefault(); document.querySelector('[data-tool="wand"]').click(); }
  if (k === 'q') { e.preventDefault(); document.querySelector('[data-tool="quick"]').click(); }
  if (k === 'l') { e.preventDefault(); document.querySelector('[data-tool="lasso"]').click(); }

  if (e.code === 'Space') {
    e.preventDefault(); // Stop browser from scrolling down
    if (!isSpaceDown && !e.repeat) {
      isSpaceDown = true; els.area.style.cursor = 'grab';
    }
  }
});
document.addEventListener('keyup', e => {
  if (e.code === 'Space') { isSpaceDown = false; isPanning = false; els.area.style.cursor = ''; }
});

els.area.addEventListener('pointerdown', e => {
  if (isSpaceDown) {
    isPanning = true; els.area.style.cursor = 'grabbing';
    lastPanX = e.clientX; lastPanY = e.clientY;
    e.stopPropagation(); e.preventDefault();
  }
}, true);

els.area.addEventListener('pointermove', e => {
  if (isPanning) {
    panX += e.clientX - lastPanX; panY += e.clientY - lastPanY;
    lastPanX = e.clientX; lastPanY = e.clientY;
    applyZoom();
    e.stopPropagation(); e.preventDefault();
  } else if (isSpaceDown) {
    e.stopPropagation(); e.preventDefault();
  }
}, true);

els.area.addEventListener('pointerup', e => {
  if (isPanning) {
    isPanning = false; if (isSpaceDown) els.area.style.cursor = 'grab';
    e.stopPropagation(); e.preventDefault();
  }
}, true);

els.area.addEventListener('wheel', e => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    if (!srcImage) return;
    const z1 = parseInt(els.zoom.value) / 100;
    let z2 = z1 - e.deltaY * 0.005;
    z2 = Math.max(0.1, Math.min(5, z2)); 
    
    const ar = els.area.getBoundingClientRect();
    const dx = e.clientX - ar.left - els.area.clientWidth / 2 - panX;
    const dy = e.clientY - ar.top - els.area.clientHeight / 2 - panY;
    
    panX -= dx * (z2 / z1 - 1);
    panY -= dy * (z2 / z1 - 1);
    
    els.zoom.value = Math.round(z2 * 100);
    $('zoomVal').textContent = els.zoom.value;
    applyZoom();
  }
}, { passive: false });

els.maskCanvas.addEventListener('pointerdown', e => {
  if (!srcImage) return; e.preventDefault();
  els.maskCanvas.setPointerCapture(e.pointerId);
  isRightClick = e.button === 2;
  
  if (e.altKey && isRightClick && (tool === 'brush' || tool === 'quick')) {
    isResizingBrush = true;
    lastResizeX = e.clientX;
    return;
  }
  
  const erase = isRightClick || mode === 'erase';   // right-click or erase mode removes
  const add = e.shiftKey;                          // Shift adds to the selection
  const c = toPixel(e);
  if (tool === 'wand') { wandAction(Math.round(c.x), Math.round(c.y), erase, add); isRightClick = false; return; }
  if (tool === 'quick') { isDown = true; quickBegin(erase, add); quickStroke(c.x, c.y); lastCoord = c; return; }
  if (tool === 'lasso') { 
    isDown = true; lassoPoints = [c]; lastCoord = c; lassoErase = erase; lassoAdd = add; return; 
  }
  // brush / bucket: bake any floating selection, then paint directly
  commitFloating(); saveUndo();
  if (tool === 'bucket') { bucketFill(Math.round(c.x), Math.round(c.y), erase); isRightClick = false; return; }
  isDown = true; paintAt(c.x, c.y, erase); lastCoord = c;
});

document.addEventListener('pointermove', e => {
  if (!srcImage) return;
  if (isPanning || isSpaceDown) { els.cursor.style.display = 'none'; return; }
  
  if (isResizingBrush) {
    const dx = e.clientX - lastResizeX;
    if (Math.abs(dx) < 2) return;
    lastResizeX = e.clientX;
    
    let step = 1;
    const speed = Math.abs(dx);
    if (speed > 8) step = 5;
    if (speed > 20) step = 10;
    
    let current = parseInt(els.brush.value);
    current += Math.sign(dx) * step;
    current = Math.max(1, Math.min(200, current));
    els.brush.value = current;
    $('brushVal').textContent = current + 'px';
    
    const z = parseInt(els.zoom.value) / 100;
    els.cursor.style.width = (current * 2 * z) + 'px';
    els.cursor.style.height = (current * 2 * z) + 'px';
    return;
  }
  
  // cursor preview
  const ar = els.area.getBoundingClientRect();
  els.cursor.style.display = 'block';
  els.cursor.style.left = (e.clientX - ar.left + els.area.scrollLeft) + 'px';
  els.cursor.style.top = (e.clientY - ar.top + els.area.scrollTop) + 'px';
  const z = parseInt(els.zoom.value) / 100;
  const sizable = tool === 'brush' || tool === 'quick';
  els.cursor.className = 'tool-' + tool;
  if (tool === 'brush' && brushShape === 'square') els.cursor.classList.add('sq');
  if (sizable) { const r = parseInt(els.brush.value); els.cursor.style.width = (r * 2 * z) + 'px'; els.cursor.style.height = (r * 2 * z) + 'px'; }
  else { els.cursor.style.width = '10px'; els.cursor.style.height = '10px'; }

  if (!isDown) return;
  const c = toPixel(e);
  const erase = isRightClick || mode === 'erase';
  if (tool === 'quick') {
    if (lastCoord) {
      const dx = c.x - lastCoord.x, dy = c.y - lastCoord.y, dist = Math.hypot(dx, dy);
      const stepLen = Math.max(2, parseInt(els.brush.value) / 2), steps = Math.max(1, Math.ceil(dist / stepLen));
      for (let i = 1; i <= steps; i++) { const t = i / steps; quickStroke(lastCoord.x + dx * t, lastCoord.y + dy * t); }
    }
    else quickStroke(c.x, c.y);
    lastCoord = c; return;
  }
  if (tool === 'lasso') {
    if (lastCoord) {
       const dist = Math.hypot(c.x - lastCoord.x, c.y - lastCoord.y);
       if (dist > 3) { lassoPoints.push(c); lastCoord = c; drawLassoLive(); }
    }
    return;
  }
  // brush
  if (lastCoord) {
    const dx = c.x - lastCoord.x, dy = c.y - lastCoord.y, dist = Math.hypot(dx, dy), steps = Math.max(1, Math.ceil(dist / 4));
    for (let i = 1; i <= steps; i++) { const t = i / steps; paintAt(lastCoord.x + dx * t, lastCoord.y + dy * t, erase); }
  }
  else paintAt(c.x, c.y, erase);
  lastCoord = c;
});

document.addEventListener('pointerup', () => {
  if (isResizingBrush) { isResizingBrush = false; return; }
  if (isDown && tool === 'lasso' && lassoPoints.length > 3) {
    refineLassoAndFill();
    lassoPoints = [];
    els.selAnts.getContext('2d').clearRect(0, 0, W, H);
  }
  isDown = false; isRightClick = false; lastCoord = null; qScratch = null; liveMask = null;
});
els.maskCanvas.addEventListener('contextmenu', e => e.preventDefault());
els.area.addEventListener('contextmenu', e => e.preventDefault());
els.area.addEventListener('mouseleave', () => { els.cursor.style.display = 'none'; });

/* ─────────── Generate (PNG-8 indexed, auto-fit under ~700KB) ─────────── */
els.generate.addEventListener('click', async () => {
  if (!srcImage) return;
  commitFloating();
  els.generate.disabled = true; els.generate.textContent = '… working';
  const density = parseInt(els.density.value);
  const ictx = els.imgCanvas.getContext('2d');
  const sData = ictx.getImageData(0, 0, W, H).data;
  const mData = mctx.getImageData(0, 0, W, H).data;
  const TARGET_KB = 700, MAX_DIM = 2500;

  function buildOutput(tw, th, sd, mdL) {
    const out = new Uint8ClampedArray(tw * th * 4);
    for (let y = 0; y < th; y++)for (let x = 0; x < tw; x++) {
      const i = y * tw + x, p = i * 4;
      const cls = classify(mdL[p], mdL[p + 1], mdL[p + 2], mdL[p + 3]);
      if (cls === 'black') { out[p] = 0; out[p + 1] = 0; out[p + 2] = 0; out[p + 3] = 255; }
      else if (cls === 'visible') { out[p] = sd[p]; out[p + 1] = sd[p + 1]; out[p + 2] = sd[p + 2]; out[p + 3] = 255; }
      else if (cls === 'hidden') {
        const keep = (density === 2) ? ((x + y) % 2 === 0) : ((x % density === 0) && (y % density === 0));
        if (keep) { out[p] = sd[p]; out[p + 1] = sd[p + 1]; out[p + 2] = sd[p + 2]; out[p + 3] = 255; }
        else { out[p] = 0; out[p + 1] = 0; out[p + 2] = 0; out[p + 3] = 0; }
      }
      else { out[p] = 0; out[p + 1] = 0; out[p + 2] = 0; out[p + 3] = 0; }
    }
    return out;
  }
  function resample(tw, th) {
    const cs = document.createElement('canvas'); cs.width = tw; cs.height = th;
    const xs = cs.getContext('2d'); xs.imageSmoothingEnabled = false; xs.drawImage(els.imgCanvas, 0, 0, tw, th);
    const sd = xs.getImageData(0, 0, tw, th).data;
    const cm = document.createElement('canvas'); cm.width = tw; cm.height = th;
    const xm = cm.getContext('2d'); xm.imageSmoothingEnabled = false; xm.drawImage(els.maskCanvas, 0, 0, tw, th);
    const md = xm.getImageData(0, 0, tw, th).data; return { sd, md };
  }
  const attempts = [{ s: 1, q: 8 }, { s: 1, q: 16 }, { s: 1, q: 32 }, { s: .85, q: 16 }, { s: .75, q: 16 }, { s: .75, q: 32 }, { s: .6, q: 16 }, { s: .6, q: 32 }, { s: .5, q: 16 }, { s: .5, q: 32 }, { s: .5, q: 64 }];
  const base = Math.min(1, MAX_DIM / Math.max(W, H));
  let blob = null, info = null;
  for (const a of attempts) {
    const fs = a.s * base, tw = Math.max(1, Math.round(W * fs)), th = Math.max(1, Math.round(H * fs));
    let sd, md; if (fs === 1) { sd = sData; md = mData; } else { const r = resample(tw, th); sd = r.sd; md = r.md; }
    const out = buildOutput(tw, th, sd, md);
    blob = await encodeIndexedPNG(out, tw, th, a.q); info = { tw, th, q: a.q, kb: Math.round(blob.size / 1024) };
    if (blob.size / 1024 <= TARGET_KB) break;
  }
  const url = URL.createObjectURL(blob);
  window.__tapLastPng = blob;   // keep the blob so the desktop app can save it natively
  els.previewFull.src = url; els.download.href = url; els.download.download = srcName + '.png';
  els.resultMeta.textContent = '[ ' + info.tw + '×' + info.th + ' · ' + info.kb + ' KB ]';
  els.result.classList.remove('hidden');
  els.generate.disabled = false; els.generate.textContent = '▸ Generate PNG';
  els.result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

// In the desktop app (pywebview), an <a download> blob link doesn't trigger a save,
// so route the PNG download through the native Save dialog (same bridge as project save).
// In a normal browser window.pywebview is undefined, so the <a download> works as before.
els.download.addEventListener('click', async (e) => {
  if (!(window.pywebview && window.pywebview.api && window.pywebview.api.save_file_dialog)) return;
  if (!window.__tapLastPng) return;
  e.preventDefault();
  const bytes = new Uint8Array(await window.__tapLastPng.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  await window.pywebview.api.save_file_dialog((srcName || 'tap_studio') + '.png', btoa(binary));
});

async function encodeIndexedPNG(rgba, W, H, quantStep) {
  const N = W * H, Q = quantStep || 8;
  const snap = v => Math.min(255, Math.max(0, Math.round(v / Q) * Q));
  const map = new Map(), palette = [[0, 0, 0]], idxs = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const p = i * 4; if (rgba[p + 3] < 128) { idxs[i] = 0; continue; }
    const r = snap(rgba[p]), g = snap(rgba[p + 1]), b = snap(rgba[p + 2]); const key = (r << 16) | (g << 8) | b;
    let idx = map.get(key);
    if (idx === undefined) {
      if (palette.length < 256) { idx = palette.length; palette.push([r, g, b]); map.set(key, idx); }
      else { let best = 1, bd = Infinity; for (let pi = 1; pi < palette.length; pi++) { const d = (palette[pi][0] - r) ** 2 + (palette[pi][1] - g) ** 2 + (palette[pi][2] - b) ** 2; if (d < bd) { bd = d; best = pi; } } idx = best; }
    }
    idxs[i] = idx;
  }
  const raw = new Uint8Array(H * (1 + W)); let pos = 0;
  for (let y = 0; y < H; y++) { raw[pos++] = 0; for (let x = 0; x < W; x++) raw[pos++] = idxs[y * W + x]; }
  const comp = await deflate(raw); const chunks = [];
  const ihdr = new Uint8Array(13); u32(ihdr, 0, W); u32(ihdr, 4, H); ihdr[8] = 8; ihdr[9] = 3; chunks.push(chunk('IHDR', ihdr));
  const plte = new Uint8Array(palette.length * 3);
  for (let i = 0; i < palette.length; i++) { plte[i * 3] = palette[i][0]; plte[i * 3 + 1] = palette[i][1]; plte[i * 3 + 2] = palette[i][2]; }
  chunks.push(chunk('PLTE', plte)); chunks.push(chunk('tRNS', new Uint8Array([0])));
  chunks.push(chunk('IDAT', comp)); chunks.push(chunk('IEND', new Uint8Array(0)));
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); let total = sig.length;
  for (const c of chunks) total += c.length;
  const png = new Uint8Array(total); let p = 0; png.set(sig, p); p += sig.length;
  for (const c of chunks) { png.set(c, p); p += c.length; }
  return new Blob([png], { type: 'image/png' });
}
function u32(a, o, v) { a[o] = (v >>> 24) & 255; a[o + 1] = (v >>> 16) & 255; a[o + 2] = (v >>> 8) & 255; a[o + 3] = v & 255; }
function chunk(type, data) {
  const len = data.length, out = new Uint8Array(12 + len); u32(out, 0, len);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i); out.set(data, 8);
  const crcBuf = new Uint8Array(4 + len); for (let i = 0; i < 4; i++) crcBuf[i] = type.charCodeAt(i); crcBuf.set(data, 4);
  u32(out, 8 + len, crc32(crcBuf)); return out;
}
const crcTable = (() => {
  const t = new Uint32Array(256); for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c;
  } return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
async function deflate(data) {
  const s = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

window.addEventListener('resize', () => { if (srcImage) applyZoom(); });

/* ─────────── View (Clean / H4CK3R) + Light / Dark toggles ─────────── */
const docEl = document.documentElement;
const BRAND = {
  clean: { h1: 'Tap<span>Studio</span>', sub: 'Tap-to-reveal image maker · Runs locally, nothing uploaded' },
  hacker: { h1: 'Tap_<span>STUDIO</span>', sub: '// tap-to-reveal image maker · runs 100% local, nothing uploaded' }
};
let viewMode = 'clean', themeMode = 'dark';
function savePref() { try { localStorage.setItem('ts_view', viewMode); localStorage.setItem('ts_theme', themeMode); } catch (e) { } }
function refreshThemeIcon() {
  // show the mode you'll switch TO: in dark offer the sun (→ light); in light offer the moon (→ dark)
  const showSun = themeMode === 'dark';
  const ico = $('themeIco');
  if (viewMode === 'hacker') ico.textContent = showSun ? '☀' : '☾';   // terminal symbols
  else ico.textContent = showSun ? '☀️' : '🌙';                     // clean emojis (tilted moon)
  els.themeBtn.classList.toggle('is-moon', !showSun);              // rotate the symbol moon via CSS
  els.themeBtn.title = showSun ? 'Switch to light' : 'Switch to dark';
}
function updateMatrix() { viewMode === 'hacker' ? matrixStart() : matrixStop(); }
function applyView(v) {
  viewMode = v; docEl.setAttribute('data-view', v);
  document.querySelectorAll('#viewSeg button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  const br = BRAND[v] || BRAND.clean; $('brandH1').innerHTML = br.h1; $('brandSub').textContent = br.sub;
  // swap project button icons: clean → emoji, hacker → terminal symbols
  if (els.saveProject) els.saveProject.textContent = v === 'hacker' ? '[\u2193] Save Project' : '\uD83D\uDCBE Save Project';
  if (els.openProject) els.openProject.textContent = v === 'hacker' ? '[\u2191] Open Project' : '\uD83D\uDCC2 Open Project';
  refreshThemeIcon(); updateMatrix(); savePref();
}
function applyTheme(t) {
  themeMode = t; docEl.setAttribute('data-theme', t);
  refreshThemeIcon(); updateMatrix(); savePref();
}
document.querySelectorAll('#viewSeg button').forEach(b => b.addEventListener('click', () => applyView(b.dataset.view)));
els.themeBtn.addEventListener('click', () => applyTheme(themeMode === 'dark' ? 'light' : 'dark'));

/* ─────────── Matrix rain (H4CK3R dark only) ─────────── */
const mCanvas = $('matrix'), mctx2 = mCanvas ? mCanvas.getContext('2d') : null;
const M_GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネﾊﾋﾌﾍﾎ0123456789ABCDEF<>*/=+$#';
const M_FS = 14; let mCols = [], mRAF = null, mLast = 0;
function matrixResize() {
  if (!mCanvas) return;
  mCanvas.width = window.innerWidth; mCanvas.height = window.innerHeight;
  const n = Math.ceil(mCanvas.width / M_FS);
  mCols = Array.from({ length: n }, () => (Math.random() * mCanvas.height / M_FS) | 0);
  mctx2.font = M_FS + 'px monospace';
}
function matrixFrame(t) {
  if (!mctx2) { mRAF = null; return; }
  if (t - mLast > 60) {
    mLast = t;
    mctx2.fillStyle = 'rgba(3,8,5,0.10)'; mctx2.fillRect(0, 0, mCanvas.width, mCanvas.height);
    mctx2.fillStyle = '#33cf38';
    for (let i = 0; i < mCols.length; i++) {
      const ch = M_GLYPHS[(Math.random() * M_GLYPHS.length) | 0];
      mctx2.fillText(ch, i * M_FS, mCols[i] * M_FS);
      if (mCols[i] * M_FS > mCanvas.height && Math.random() > 0.975) mCols[i] = 0; else mCols[i]++;
    }
  }
  mRAF = requestAnimationFrame(matrixFrame);
}
function matrixStart() { if (!mCanvas || mRAF) return; matrixResize(); mLast = 0; mRAF = requestAnimationFrame(matrixFrame); }
function matrixStop() { if (mRAF) { cancelAnimationFrame(mRAF); mRAF = null; } if (mctx2) mctx2.clearRect(0, 0, mCanvas.width, mCanvas.height); }
window.addEventListener('resize', () => { if (mRAF) matrixResize(); });

/* ─────────── .tsp Project file (Save / Open) ─────────── */
// .tsp v2 = hybrid format: valid PNG thumbnail + appended ZIP + 8-byte footer
// Footer: [4 bytes: PNG length (big-endian uint32)] + [4 bytes: "TSP1" magic]
// Windows sees a valid PNG → shows the thumbnail in Explorer.
// Our app reads the footer, extracts the ZIP, and restores the project.
// Backward-compatible: also opens v1 files (pure ZIP).

function canvasToBlob(canvas) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

async function saveProject() {
  if (!srcImage || !mctx) return;
  commitFloating();
  const btn = els.saveProject;
  const origText = btn.textContent;
  btn.disabled = true; btn.textContent = '… saving';
  try {
    // ── 1. Build the project ZIP ──
    const zip = new JSZip();
    const manifest = {
      version: 2,
      app: 'TapStudio Pro',
      created: new Date().toISOString(),
      canvas: { width: W, height: H },
      settings: {
        tolerance: parseInt(els.tol.value),
        brushSize: parseInt(els.brush.value),
        density: parseInt(els.density.value),
        bucketReach: parseInt(els.bucketReach.value),
        contiguous: els.contig.checked,
        bucketLimit: els.bucketLimit.checked,
        mode: mode,
        tool: tool,
        brushShape: brushShape,
        zoom: parseInt(els.zoom.value),
      },
      sourceName: srcName,
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    // source image
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = W; srcCanvas.height = H;
    const sctx = srcCanvas.getContext('2d');
    sctx.drawImage(srcImage, 0, 0, W, H);
    zip.file('source.png', await canvasToBlob(srcCanvas));

    // mask
    zip.file('mask.png', await canvasToBlob(els.maskCanvas));

    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });

    // ── 2. Build the PNG thumbnail (shown by Windows Explorer) ──
    const THUMB = 512;
    const thumbScale = Math.min(THUMB / W, THUMB / H);
    const tw = Math.round(W * thumbScale), th = Math.round(H * thumbScale);
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = tw; thumbCanvas.height = th;
    const tctx = thumbCanvas.getContext('2d');
    // checkerboard background so transparent areas look intentional
    tctx.fillStyle = '#1a1a2e';
    tctx.fillRect(0, 0, tw, th);
    tctx.drawImage(els.imgCanvas, 0, 0, tw, th);
    tctx.globalAlpha = 0.4;
    tctx.drawImage(els.maskCanvas, 0, 0, tw, th);
    tctx.globalAlpha = 1.0;
    const thumbBlob = await canvasToBlob(thumbCanvas);

    // ── 3. Combine: PNG + ZIP + footer ──
    const thumbBuf = await thumbBlob.arrayBuffer();
    const zipBuf = await zipBlob.arrayBuffer();
    const footer = new ArrayBuffer(8);
    const dv = new DataView(footer);
    dv.setUint32(0, thumbBuf.byteLength, false); // big-endian PNG length
    dv.setUint8(4, 84); dv.setUint8(5, 83); dv.setUint8(6, 80); dv.setUint8(7, 49); // "TSP1"
    const combined = new Blob([thumbBuf, zipBuf, footer], { type: 'application/octet-stream' });

    // ── 4. Download ──
    if (window.pywebview && window.pywebview.api && window.pywebview.api.save_file_dialog) {
      const arrayBuf = await combined.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
      }
      const base64 = btoa(binary);
      const defaultName = srcName.replace(/_tapme$/, '') + '.tsp';
      await window.pywebview.api.save_file_dialog(defaultName, base64);
    } else {
      const url = URL.createObjectURL(combined);
      const a = document.createElement('a');
      a.href = url;
      a.download = srcName.replace(/_tapme$/, '') + '.tsp';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  } catch (err) {
    console.error('Save project error:', err);
    alert('Error saving project: ' + err.message);
  }
  btn.disabled = false; btn.textContent = origText;
}

async function openProjectFile(file) {
  try {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const len = bytes.length;
    let zipData;

    // Detect format: check last 4 bytes for "TSP1" magic
    if (len >= 8 &&
        bytes[len - 4] === 84 && bytes[len - 3] === 83 &&
        bytes[len - 2] === 80 && bytes[len - 1] === 49) {
      // v2 hybrid format — extract the ZIP portion
      const dv = new DataView(buf);
      const pngLen = dv.getUint32(len - 8, false);
      zipData = bytes.slice(pngLen, len - 8);
    } else {
      // v1 pure ZIP format (backward compatible)
      zipData = buf;
    }

    const zip = await JSZip.loadAsync(zipData);

    // Read manifest
    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) throw new Error('Invalid .tsp file: missing manifest.json');
    const manifest = JSON.parse(await manifestFile.async('string'));

    // Read source image
    const sourceFile = zip.file('source.png');
    if (!sourceFile) throw new Error('Invalid .tsp file: missing source.png');
    const sourceBlob = await sourceFile.async('blob');
    const sourceUrl = URL.createObjectURL(sourceBlob);

    // Read mask image
    const maskFile = zip.file('mask.png');
    const maskBlob = maskFile ? await maskFile.async('blob') : null;

    // Load source image
    const img = new Image();
    img.onload = async () => {
      srcImage = img;
      srcName = manifest.sourceName || 'project_tapme';

      // setup canvas
      W = manifest.canvas?.width || img.naturalWidth;
      H = manifest.canvas?.height || img.naturalHeight;
      [els.imgCanvas, els.maskCanvas, els.selTint, els.selAnts].forEach(c => { c.width = W; c.height = H; });
      const ictx = els.imgCanvas.getContext('2d'); ictx.imageSmoothingEnabled = true;
      ictx.clearRect(0, 0, W, H); ictx.drawImage(srcImage, 0, 0, W, H);
      srcData = ictx.getImageData(0, 0, W, H).data;
      computeEdgeMap();
      mctx = els.maskCanvas.getContext('2d', { willReadFrequently: true });
      mctx.clearRect(0, 0, W, H);
      els.selAnts.getContext('2d').clearRect(0, 0, W, H);
      selBase = null; selRegion = null;
      undoStack = [];

      // Restore mask
      if (maskBlob) {
        const maskImg = new Image();
        maskImg.onload = () => {
          mctx.drawImage(maskImg, 0, 0, W, H);
          URL.revokeObjectURL(maskImg.src);
        };
        maskImg.src = URL.createObjectURL(maskBlob);
      }

      // Restore settings
      const s = manifest.settings;
      if (s) {
        if (s.tolerance != null) { els.tol.value = s.tolerance; $('tolVal').textContent = s.tolerance; }
        if (s.brushSize != null) { els.brush.value = s.brushSize; $('brushVal').textContent = s.brushSize; }
        if (s.density != null) { els.density.value = s.density; $('densityVal').textContent = s.density; }
        if (s.bucketReach != null) { els.bucketReach.value = s.bucketReach; $('bucketReachVal').textContent = s.bucketReach; }
        if (s.contiguous != null) els.contig.checked = s.contiguous;
        if (s.bucketLimit != null) els.bucketLimit.checked = s.bucketLimit;
        if (s.zoom != null) { els.zoom.value = s.zoom; $('zoomVal').textContent = s.zoom; }
        if (s.mode) {
          mode = s.mode;
          document.querySelectorAll('.mode').forEach(b => {
            b.classList.toggle('active', b.dataset.mode === s.mode);
          });
        }
        if (s.tool) {
          tool = s.tool;
          document.querySelectorAll('.tool').forEach(b => {
            b.classList.toggle('active', b.dataset.tool === s.tool);
          });
          els.area.setAttribute('data-tool', s.tool);
          const isSel = s.tool === 'wand' || s.tool === 'quick' || s.tool === 'lasso';
          els.shapeGroup.style.display = s.tool === 'brush' ? 'flex' : 'none';
          els.brushRow.style.opacity = (s.tool === 'brush' || s.tool === 'quick') ? 1 : .4;
          els.tolRow.style.opacity = isSel ? 1 : .4;
        }
        if (s.brushShape) {
          brushShape = s.brushShape;
          document.querySelectorAll('.shape').forEach(b => {
            b.classList.toggle('active', b.dataset.shape === s.brushShape);
          });
        }
      }

      els.drop.style.display = 'none'; els.newImg.style.display = 'inline-block';
      els.generate.disabled = false; els.result.classList.add('hidden');
      if (els.saveProject) els.saveProject.disabled = false;
      els.dims.textContent = W + '\u00d7' + H + 'px';
      fitZoom();
      // If zoom was saved, re-apply it after fitZoom
      if (s && s.zoom != null) {
        els.zoom.value = s.zoom; $('zoomVal').textContent = s.zoom; applyZoom();
      }

      URL.revokeObjectURL(sourceUrl);
    };
    img.onerror = () => { URL.revokeObjectURL(sourceUrl); alert('Error: could not load image from .tsp file'); };
    img.src = sourceUrl;
  } catch (err) {
    console.error('Open project error:', err);
    alert('Error opening project: ' + err.message);
  }
}

// Wire up project buttons
els.saveProject.addEventListener('click', saveProject);
els.openProject.addEventListener('click', () => els.tspFile.click());
els.tspFile.addEventListener('change', e => {
  const f = e.target.files[0];
  if (f) openProjectFile(f);
  els.tspFile.value = '';
});

(function initPrefs() {
  let v = 'clean', t = 'dark';
  try { v = localStorage.getItem('ts_view') || v; t = localStorage.getItem('ts_theme') || t; } catch (e) { }
  applyView(v); applyTheme(t);
})();

/* ─────────── PWA File Handling ─────────── */
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async launchParams => {
    if (!launchParams.files.length) return;
    for (const fileHandle of launchParams.files) {
      if (fileHandle.name.endsWith('.tsp')) {
        const file = await fileHandle.getFile();
        openProjectFile(file);
        break; // open the first one
      }
    }
  });
}
