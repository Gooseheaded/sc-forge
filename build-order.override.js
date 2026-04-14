(() => {
const FORGE_LS_KEY = 'bw-build-order';
const FORGE_SAVES_KEY = 'bw-named-saves';
const MIN_DUR = 300;
const WIGGLE = 120;
const GAS_PER_SECOND = 5.15;
const GAS_GRAPH_H = 132;
const GAS_PADDING_X = 8;
const GAS_PADDING_Y = 14;
const GAS_SOURCE_NAMES = new Set(['Refinery', 'Assimilator', 'Extractor']);
const SUPPLY_CAP = {
  'Command Center': 10, 'Supply Depot': 8,
  'Nexus': 9, 'Pylon': 8,
  'Hatchery': 1, 'Lair': 1, 'Hive': 1, 'Overlord': 8,
};

let sets = [];
let activeSetId = null;
let nextItemId = 0;
let nextSetId = 1;
let nextGroupId = 1;
let selectedIds = new Set();
let dragState = null;
let gasPanelExpanded = false;
let syncingGasScroll = false;

const ghostEl = document.getElementById('ghost');
const tipEl = document.getElementById('tip');
const ctxEl = document.getElementById('ctx');
const boText = document.getElementById('bo-text');
const tabsEl = document.getElementById('set-tabs');
const labelList = document.getElementById('label-list');
const tracksRoot = document.getElementById('tracks');
const ruler = document.getElementById('ruler');
const tlInner = document.getElementById('tl-inner');
const tlScroll = document.getElementById('tl-scroll');
const boTitle = document.getElementById('bo-title');
const hiddenSupply = document.getElementById('supply-row');
const hiddenLabelSupply = document.getElementById('label-supply-cell');
const gasPanelEl = document.getElementById('gas-panel');
const gasToggleBtn = document.getElementById('gas-toggle-btn');
const gasSubtitleEl = document.getElementById('gas-subtitle');
const gasScrollEl = document.getElementById('gas-scroll');
const gasInnerEl = document.getElementById('gas-inner');
const gasSvgEl = document.getElementById('gas-svg');
const gasEmptyEl = document.getElementById('gas-empty');

function createSet(name) { return { id: nextSetId++, name, tracks: [[]], groups: [] }; }
function resetState() { nextItemId = 0; nextSetId = 1; nextGroupId = 1; selectedIds = new Set(); const set = createSet('Build 1'); sets = [set]; activeSetId = set.id; }
function activeSet() { if (!sets.length) resetState(); if (!sets.some(s => s.id === activeSetId)) activeSetId = sets[0].id; return sets.find(s => s.id === activeSetId); }
function ensureTrack(set, ti) { while (set.tracks.length <= ti) set.tracks.push([]); }
function makeItem(src, setId, trackIndex, startTime, idOverride) {
  const id = typeof idOverride === 'number' ? idOverride : nextItemId++;
  if (typeof idOverride === 'number') nextItemId = Math.max(nextItemId, idOverride + 1);
  return { id, name: src.name, race: src.race, type: src.type, buildTime: src.buildTime, mineralCost: src.mineralCost, gasCost: src.gasCost, supplyCost: src.supplyCost, startTime, trackIndex, trackSetId: setId };
}
function allItems() { return sets.flatMap(set => set.tracks.flat()); }
function normalizeSet(set) {
  set.tracks = (set.tracks || [[]]).filter((track, idx) => idx === 0 || track.length);
  if (!set.tracks.length) set.tracks = [[]];
  set.tracks.forEach((track, ti) => track.forEach(item => { item.trackIndex = ti; item.trackSetId = set.id; }));
  const validIds = new Set(set.tracks.flat().map(item => item.id));
  set.groups = (set.groups || []).map(group => ({ id: group.id, name: group.name || `Group ${group.id}`, itemIds: (group.itemIds || []).filter(id => validIds.has(id)) })).filter(group => group.itemIds.length > 1);
}
function normalizeState() {
  sets.forEach(normalizeSet);
  if (!sets.length) resetState();
  if (!sets.some(set => set.id === activeSetId)) activeSetId = sets[0].id;
  const validIds = new Set(allItems().map(item => item.id));
  selectedIds = new Set([...selectedIds].filter(id => validIds.has(id)));
}
function overlaps2(trackItems, startTime, duration, excludeIds = []) {
  const excluded = new Set(Array.isArray(excludeIds) ? excludeIds : [excludeIds]);
  const end = startTime + duration;
  return trackItems.some(item => !excluded.has(item.id) && startTime < item.startTime + item.buildTime && end > item.startTime);
}
function findItem(id) {
  for (const set of sets) {
    for (let ti = 0; ti < set.tracks.length; ti++) {
      const item = set.tracks[ti].find(entry => entry.id === id);
      if (item) return { set, item, trackIndex: ti };
    }
  }
  return null;
}
function groupForItem(set, id) { return (set.groups || []).find(group => group.itemIds.includes(id)) || null; }
function selectionInSet(set) { const ids = new Set(set.tracks.flat().map(item => item.id)); return [...selectedIds].filter(id => ids.has(id)); }
function timeRange2() {
  const items = allItems();
  const earliest = items.length ? Math.min(...items.map(item => item.startTime)) : 0;
  const latest = items.length ? Math.max(...items.map(item => item.startTime + item.buildTime)) : 0;
  return { min: earliest < 0 ? earliest - 10 : 0, max: Math.max(MIN_DUR, latest + WIGGLE) };
}
function encodeState() {
  return btoa(JSON.stringify({ v: 2, activeTrackSetId: activeSetId, trackSets: sets.map(set => ({ id: set.id, name: set.name, tracks: set.tracks.map(track => track.map(item => ({ id: item.id, n: item.name, t: item.startTime }))), groups: set.groups.map(group => ({ id: group.id, name: group.name, itemIds: group.itemIds.slice() })) })) }));
}
function persistState() { const encoded = encodeState(); history.replaceState(null, '', '#' + encoded); try { localStorage.setItem(FORGE_LS_KEY, encoded); } catch {} }
function decodeState2(encoded) {
  const raw = JSON.parse(atob(encoded));
  resetState();
  sets = [];
  if (Array.isArray(raw)) {
    const set = createSet('Build 1'); sets = [set]; activeSetId = set.id;
    raw.forEach(entry => { const src = DATA.find(d => d.name === entry.n); if (!src) return; const ti = entry.r || 0; ensureTrack(set, ti); set.tracks[ti].push(makeItem(src, set.id, ti, entry.t || 0)); });
  } else if (raw && Array.isArray(raw.trackSets)) {
    raw.trackSets.forEach(rawSet => {
      const setId = typeof rawSet.id === 'number' ? rawSet.id : nextSetId++;
      nextSetId = Math.max(nextSetId, setId + 1);
      const set = { id: setId, name: rawSet.name || `Build ${setId}`, tracks: [], groups: [] };
      (rawSet.tracks || []).forEach((track, ti) => { set.tracks[ti] = []; track.forEach(entry => { const src = DATA.find(d => d.name === entry.n); if (!src) return; set.tracks[ti].push(makeItem(src, set.id, ti, entry.t || 0, typeof entry.id === 'number' ? entry.id : undefined)); }); });
      if (!set.tracks.length) set.tracks = [[]];
      set.groups = (rawSet.groups || []).map(group => { const id = typeof group.id === 'number' ? group.id : nextGroupId++; nextGroupId = Math.max(nextGroupId, id + 1); return { id, name: group.name || `Group ${id}`, itemIds: (group.itemIds || []).slice() }; });
      sets.push(set);
    });
    activeSetId = raw.activeTrackSetId;
  }
  normalizeState();
}
function loadState() { const hash = location.hash.slice(1); const stored = hash || (() => { try { return localStorage.getItem(FORGE_LS_KEY) || ''; } catch { return ''; } })(); if (!stored) { resetState(); return; } try { decodeState2(stored); } catch { resetState(); } }
function renderTabs() { tabsEl.innerHTML = ''; sets.forEach(set => { const btn = document.createElement('button'); btn.className = 'set-tab' + (set.id === activeSetId ? ' active' : ''); btn.textContent = set.name; btn.onclick = () => window.switchActiveTrackSet(set.id); tabsEl.appendChild(btn); }); }
function renderRuler2(range) {
  ruler.innerHTML = '';
  const maj = PPS >= 18 ? 10 : PPS >= 8 ? 15 : PPS >= 5 ? 30 : 60;
  const min = PPS >= 18 ? 5 : PPS >= 8 ? 5 : PPS >= 5 ? 10 : 30;
  const startS = Math.floor(range.min / min) * min;
  for (let s = startS; s <= range.max; s += min) {
    const x = (s - range.min) * PPS;
    const isMaj = s % maj === 0;
    const tick = document.createElement('div');
    tick.className = 'tick' + (isMaj ? ' major' : '');
    tick.style.left = x + 'px';
    tick.style.height = isMaj ? '100%' : '35%';
    ruler.appendChild(tick);
    if (isMaj) { const lbl = document.createElement('div'); lbl.className = 'tick-label'; lbl.style.left = x + 'px'; lbl.textContent = fmt(s); ruler.appendChild(lbl); }
  }
  if (range.min < 0) {
    const x0 = (0 - range.min) * PPS;
    const zero = document.createElement('div'); zero.className = 'tick-zero'; zero.style.left = x0 + 'px'; ruler.appendChild(zero);
    const zeroLabel = document.createElement('div'); zeroLabel.className = 'tick-zero-label'; zeroLabel.style.left = x0 + 'px'; zeroLabel.textContent = '0:00'; ruler.appendChild(zeroLabel);
  }
}
function renderSupply(set, range, width) {
  const row = document.createElement('div'); row.className = 'supply-row'; row.style.width = width + 'px';
  const items = set.tracks.flat(); if (!items.length) return row;
  const events = [];
  items.forEach(item => { if (item.type === 'Unit' && item.supplyCost > 0) events.push({ t: item.startTime, used: item.supplyCost, cap: 0 }); const cap = SUPPLY_CAP[item.name] || 0; if (cap > 0) events.push({ t: item.startTime + item.buildTime, used: 0, cap }); });
  if (!events.length) return row;
  events.sort((a, b) => a.t - b.t);
  const points = [{ t: range.min, usedTotal: 0, capTotal: 0 }]; let used = 0; let cap = 0;
  events.forEach(event => { used += event.used; cap += event.cap; points.push({ t: event.t, usedTotal: used, capTotal: cap }); });
  points.push({ t: range.max, usedTotal: used, capTotal: cap });
  for (let i = 0; i < points.length - 1; i++) {
    const current = points[i], next = points[i + 1], x = (current.t - range.min) * PPS, segW = (next.t - current.t) * PPS;
    if (segW < 1) continue;
    const ratio = current.capTotal > 0 ? current.usedTotal / current.capTotal : 0;
    const cls = current.capTotal === 0 ? 'sup-zero' : ratio > 1 ? 'sup-over' : ratio >= 0.9 ? 'sup-warn' : 'sup-ok';
    const seg = document.createElement('div'); seg.className = `sup-seg ${cls}`; seg.style.left = x + 'px'; seg.style.width = segW + 'px'; if (segW > 28 && current.capTotal > 0) seg.textContent = `${current.usedTotal}/${current.capTotal}`; row.appendChild(seg);
  }
  return row;
}
function computeGasSeries(set, range) {
  const events = [];
  set.tracks.flat().forEach(item => {
    if (GAS_SOURCE_NAMES.has(item.name)) events.push({ t: item.startTime + item.buildTime, rateDelta: GAS_PER_SECOND, spend: 0 });
    if (item.gasCost > 0) events.push({ t: item.startTime, rateDelta: 0, spend: item.gasCost });
  });
  if (!events.length) return null;
  events.sort((a, b) => a.t - b.t || b.spend - a.spend);
  const points = [{ t: range.min, bank: 0 }];
  let rate = 0;
  let bank = 0;
  let idx = 0;
  while (idx < events.length) {
    const t = events[idx].t;
    bank += rate * (t - points[points.length - 1].t);
    if (points[points.length - 1].t !== t || points[points.length - 1].bank !== bank) points.push({ t, bank });
    let spend = 0;
    let rateDelta = 0;
    while (idx < events.length && events[idx].t === t) {
      spend += events[idx].spend;
      rateDelta += events[idx].rateDelta;
      idx += 1;
    }
    if (spend !== 0) {
      bank -= spend;
      points.push({ t, bank });
    }
    rate += rateDelta;
  }
  const lastTime = points[points.length - 1].t;
  bank += rate * (range.max - lastTime);
  if (points[points.length - 1].t !== range.max || points[points.length - 1].bank !== bank) points.push({ t: range.max, bank });
  return { points, minBank: Math.min(...points.map(point => point.bank)), maxBank: Math.max(...points.map(point => point.bank)) };
}
function buildGasAreaPath(points, mapY, baselineY, positive) {
  const filtered = [];
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const bank = positive ? Math.max(point.bank, 0) : Math.min(point.bank, 0);
    filtered.push({ t: point.t, bank });
  }
  if (filtered.every(point => point.bank === 0)) return '';
  let d = `M ${((filtered[0].t - TL_MIN) * PPS) + GAS_PADDING_X} ${baselineY}`;
  filtered.forEach(point => {
    const x = ((point.t - TL_MIN) * PPS) + GAS_PADDING_X;
    d += ` L ${x} ${mapY(point.bank)}`;
  });
  const lastX = ((filtered[filtered.length - 1].t - TL_MIN) * PPS) + GAS_PADDING_X;
  const firstX = ((filtered[0].t - TL_MIN) * PPS) + GAS_PADDING_X;
  d += ` L ${lastX} ${baselineY} L ${firstX} ${baselineY} Z`;
  return d;
}
function sampleGasAt(points, t) {
  if (!points.length) return 0;
  if (t <= points[0].t) return points[0].bank;
  for (let i = 0; i < points.length - 1; i++) {
    const current = points[i];
    const next = points[i + 1];
    if (t > next.t) continue;
    if (next.t === current.t) return next.bank;
    const ratio = (t - current.t) / (next.t - current.t);
    return current.bank + (next.bank - current.bank) * ratio;
  }
  return points[points.length - 1].bank;
}
function renderGasPanel(set, range, width) {
  gasPanelEl.classList.toggle('collapsed', !gasPanelExpanded);
  gasToggleBtn.textContent = gasPanelExpanded ? 'Hide Gas' : 'Show Gas';
  gasSubtitleEl.textContent = gasPanelExpanded
    ? `Simulated at ${GAS_PER_SECOND.toFixed(2)} gas/sec per completed extractor for ${set.name}`
    : 'Disabled by default. Expand to simulate extractor income and gas spending.';
  if (!gasPanelExpanded) return;

  const graph = computeGasSeries(set, range);
  gasInnerEl.style.width = (width + GAS_PADDING_X * 2) + 'px';
  gasSvgEl.setAttribute('width', width + GAS_PADDING_X * 2);
  gasSvgEl.setAttribute('height', GAS_GRAPH_H);
  gasSvgEl.innerHTML = '';
  if (!syncingGasScroll) gasScrollEl.scrollLeft = tlScroll.scrollLeft;
  gasEmptyEl.style.display = graph ? 'none' : 'flex';
  if (!graph) return;

  const minBank = Math.min(graph.minBank, 0);
  const maxBank = Math.max(graph.maxBank, 0);
  const usableH = GAS_GRAPH_H - GAS_PADDING_Y * 2;
  const span = Math.max(maxBank - minBank, 1);
  const mapY = bank => GAS_PADDING_Y + ((maxBank - bank) / span) * usableH;
  const baselineY = mapY(0);
  const ns = 'http://www.w3.org/2000/svg';
  const make = (tag, attrs) => {
    const node = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  };

  [minBank, 0, maxBank].filter((value, idx, arr) => arr.indexOf(value) === idx).forEach(value => {
    const y = mapY(value);
    gasSvgEl.appendChild(make('line', { x1: 0, y1: y, x2: width + GAS_PADDING_X * 2, y2: y, class: value === 0 ? 'gas-zero' : 'gas-grid' }));
    const label = make('text', { x: 4, y: Math.max(10, y - 4), class: 'gas-label' });
    label.textContent = `${Math.round(value)} gas`;
    gasSvgEl.appendChild(label);
  });

  const posArea = buildGasAreaPath(graph.points, mapY, baselineY, true);
  const negArea = buildGasAreaPath(graph.points, mapY, baselineY, false);
  if (posArea) gasSvgEl.appendChild(make('path', { d: posArea, class: 'gas-area-pos' }));
  if (negArea) gasSvgEl.appendChild(make('path', { d: negArea, class: 'gas-area-neg' }));

  const linePoints = graph.points.map(point => `${((point.t - TL_MIN) * PPS) + GAS_PADDING_X},${mapY(point.bank)}`).join(' ');
  gasSvgEl.appendChild(make('polyline', { points: linePoints, class: 'gas-path' }));

  const hoverLine = make('line', { class: 'gas-hover-line', x1: 0, y1: 0, x2: 0, y2: GAS_GRAPH_H, visibility: 'hidden' });
  const hoverDot = make('circle', { class: 'gas-hover-dot', r: 4, cx: 0, cy: 0, visibility: 'hidden' });
  const hoverBg = make('rect', { class: 'gas-hover-bg', x: 0, y: 0, width: 10, height: 10, rx: 3, ry: 3, visibility: 'hidden' });
  const hoverLabel = make('text', { class: 'gas-hover-label', x: 0, y: 0, visibility: 'hidden' });
  gasSvgEl.appendChild(hoverLine);
  gasSvgEl.appendChild(hoverDot);
  gasSvgEl.appendChild(hoverBg);
  gasSvgEl.appendChild(hoverLabel);

  const showHover = event => {
    const rect = gasSvgEl.getBoundingClientRect();
    const rawX = event.clientX - rect.left;
    const clampedX = Math.max(GAS_PADDING_X, Math.min(width + GAS_PADDING_X, rawX));
    const t = ((clampedX - GAS_PADDING_X) / PPS) + TL_MIN;
    const bank = sampleGasAt(graph.points, t);
    const y = mapY(bank);
    const labelText = `${fmt(t)}  ${bank.toFixed(1)} gas`;

    hoverLine.setAttribute('x1', clampedX);
    hoverLine.setAttribute('x2', clampedX);
    hoverLine.setAttribute('y1', 0);
    hoverLine.setAttribute('y2', GAS_GRAPH_H);
    hoverLine.setAttribute('visibility', 'visible');

    hoverDot.setAttribute('cx', clampedX);
    hoverDot.setAttribute('cy', y);
    hoverDot.setAttribute('visibility', 'visible');

    hoverLabel.textContent = labelText;
    hoverLabel.setAttribute('visibility', 'visible');
    hoverLabel.setAttribute('x', 0);
    hoverLabel.setAttribute('y', 0);
    const labelBox = hoverLabel.getBBox();
    const labelX = Math.max(6, Math.min(clampedX + 10, width + GAS_PADDING_X * 2 - labelBox.width - 10));
    const labelY = y < 24 ? y + 18 : y - 10;
    hoverLabel.setAttribute('x', labelX);
    hoverLabel.setAttribute('y', labelY);
    const adjustedBox = hoverLabel.getBBox();
    hoverBg.setAttribute('x', adjustedBox.x - 6);
    hoverBg.setAttribute('y', adjustedBox.y - 4);
    hoverBg.setAttribute('width', adjustedBox.width + 12);
    hoverBg.setAttribute('height', adjustedBox.height + 8);
    hoverBg.setAttribute('visibility', 'visible');
  };
  const hideHover = () => {
    hoverLine.setAttribute('visibility', 'hidden');
    hoverDot.setAttribute('visibility', 'hidden');
    hoverBg.setAttribute('visibility', 'hidden');
    hoverLabel.setAttribute('visibility', 'hidden');
  };
  gasSvgEl.onmousemove = showHover;
  gasSvgEl.onmouseleave = hideHover;
}
tlScroll.addEventListener('scroll', () => {
  if (syncingGasScroll) return;
  syncingGasScroll = true;
  gasScrollEl.scrollLeft = tlScroll.scrollLeft;
  syncingGasScroll = false;
});
gasScrollEl.addEventListener('scroll', () => {
  if (syncingGasScroll) return;
  syncingGasScroll = true;
  tlScroll.scrollLeft = gasScrollEl.scrollLeft;
  syncingGasScroll = false;
});
function makeBlock(item) {
  const set = sets.find(entry => entry.id === item.trackSetId);
  const group = groupForItem(set, item.id);
  const block = document.createElement('div');
  block.className = 'bl';
  if (selectedIds.has(item.id)) block.classList.add('sel');
  if (group) block.classList.add('grouped');
  block.dataset.id = item.id;
  block.style.left = ((item.startTime - TL_MIN) * PPS) + 'px';
  block.style.width = Math.max(item.buildTime * PPS - 2, 6) + 'px';
  block.style.background = RACE_BG[item.race];
  block.style.borderLeft = `2px ${item.type === 'Upgrade' ? 'dashed' : 'solid'} ${RACE_COLOR[item.race]}`;
  block.style.color = RACE_COLOR[item.race];
  if (item.type === 'Upgrade') block.style.opacity = '0.85';
  const label = document.createElement('span'); label.textContent = item.name; block.appendChild(label);
  block.addEventListener('mousedown', event => handleBlockMouseDown(event, item));
  block.addEventListener('mouseenter', event => showTip(event, item));
  block.addEventListener('mousemove', moveTip);
  block.addEventListener('mouseleave', hideTip);
  block.addEventListener('contextmenu', event => { event.preventDefault(); selectedIds = new Set(group ? group.itemIds : [item.id]); showContext(event, item.id); window.render(true); });
  return block;
}
function renderSections(range, width) {
  labelList.innerHTML = ''; tracksRoot.innerHTML = '';
  sets.forEach(set => {
    const labelSection = document.createElement('div');
    const labelHeader = document.createElement('div'); labelHeader.className = 'label-set-header' + (set.id === activeSetId ? ' active' : ''); labelHeader.textContent = set.name; labelSection.appendChild(labelHeader);
    const labelSupply = document.createElement('div'); labelSupply.className = 'label-supply-cell'; labelSupply.textContent = 'SUP'; labelSection.appendChild(labelSupply);
    set.tracks.forEach((_, ti) => { const cell = document.createElement('div'); cell.className = 'label-cell'; cell.textContent = `T${ti + 1}`; labelSection.appendChild(cell); });
    const dropCell = document.createElement('div'); dropCell.className = 'label-drop-cell'; dropCell.textContent = '+'; labelSection.appendChild(dropCell); labelList.appendChild(labelSection);
    const section = document.createElement('div'); section.className = 'tracks-section'; section.style.width = width + 'px';
    const header = document.createElement('div'); header.className = 'set-section-header' + (set.id === activeSetId ? ' active' : ''); header.onclick = () => window.switchActiveTrackSet(set.id);
    const title = document.createElement('span'); title.textContent = set.name; const meta = document.createElement('span'); meta.className = 'set-section-meta'; meta.textContent = `${set.tracks.filter(track => track.length).length || 1} tracks - ${set.groups.length} groups`; header.appendChild(title); header.appendChild(meta); section.appendChild(header);
    section.appendChild(renderSupply(set, range, width));
    set.tracks.forEach((items, ti) => { const row = document.createElement('div'); row.className = 'track-row'; row.dataset.setId = set.id; row.dataset.ti = ti; items.forEach(item => row.appendChild(makeBlock(item))); section.appendChild(row); });
    const dropRow = document.createElement('div'); dropRow.className = 'track-drop-row' + (set.id === activeSetId ? ' active' : ''); dropRow.dataset.setId = set.id; dropRow.dataset.ti = set.tracks.length; section.appendChild(dropRow); tracksRoot.appendChild(section);
  });
}
function computeMovePlan(set, entries, baseSec, baseTrack) {
  const movingIds = entries.map(entry => entry.id);
  const tempTracks = set.tracks.map(track => track.filter(item => !movingIds.includes(item.id)).slice());
  const positions = [];
  const ordered = entries.slice().sort((a, b) => a.dTrack - b.dTrack || a.dt - b.dt);
  for (const entry of ordered) {
    const targetTrack = baseTrack + entry.dTrack;
    if (targetTrack < 0) return null;
    while (tempTracks.length <= targetTrack) tempTracks.push([]);
    const targetStart = baseSec + entry.dt;
    if (overlaps2(tempTracks[targetTrack], targetStart, entry.item.buildTime)) return null;
    tempTracks[targetTrack].push({ ...entry.item, startTime: targetStart, trackIndex: targetTrack });
    positions.push({ id: entry.id, trackIndex: targetTrack, startTime: targetStart });
  }
  return positions;
}
function handleBlockMouseDown(event, item) {
  if (event.button !== 0) return;
  if (event.ctrlKey || event.metaKey) { event.preventDefault(); if (selectedIds.has(item.id)) selectedIds.delete(item.id); else selectedIds.add(item.id); window.render(true); return; }
  const set = sets.find(entry => entry.id === item.trackSetId); const group = groupForItem(set, item.id); const moveIds = group ? group.itemIds.slice() : [item.id]; selectedIds = new Set(moveIds); startDrag(event, item, moveIds, group ? group.name : null);
}
function startDrag(event, anchorItem, moveIds, groupName) {
  event.preventDefault(); hideTip();
  const anchorEl = event.currentTarget; const rect = anchorEl.getBoundingClientRect(); const set = sets.find(entry => entry.id === anchorItem.trackSetId);
  const entries = moveIds.map(id => findItem(id)).filter(Boolean).map(found => ({ id: found.item.id, item: found.item, dt: found.item.startTime - anchorItem.startTime, dTrack: found.item.trackIndex - anchorItem.trackIndex }));
  const dragEls = moveIds.map(id => document.querySelector(`.bl[data-id="${id}"]`)).filter(Boolean); dragEls.forEach(el => el.classList.add('dragging'));
  ghostEl.style.display = 'flex'; ghostEl.style.width = anchorEl.style.width; ghostEl.style.background = anchorEl.style.background; ghostEl.style.borderLeft = anchorEl.style.borderLeft; ghostEl.style.color = anchorEl.style.color; ghostEl.innerHTML = `<span id="ghost-name">${groupName || anchorItem.name}</span><span id="ghost-time"></span>`;
  dragState = { setId: set.id, anchorItem, entries, offX: event.clientX - rect.left, dragEls, plan: null };
  document.addEventListener('mousemove', moveDrag); document.addEventListener('mouseup', endDrag);
}
function moveDrag(event) {
  if (!dragState) return;
  const tracksRect = tracksRoot.getBoundingClientRect(), scrollRect = tlScroll.getBoundingClientRect(), relX = event.clientX - tracksRect.left + tlScroll.scrollLeft - dragState.offX, sec = Math.round(relX / PPS + TL_MIN);
  const hovered = document.elementFromPoint(event.clientX, event.clientY), row = hovered && hovered.closest('.track-row, .track-drop-row'), set = sets.find(entry => entry.id === dragState.setId), targetTrack = row && Number(row.dataset.setId) === dragState.setId ? Number(row.dataset.ti) : dragState.anchorItem.trackIndex;
  dragState.plan = computeMovePlan(set, dragState.entries, sec, targetTrack);
  const rowRect = row && Number(row.dataset.setId) === dragState.setId ? row.getBoundingClientRect() : document.querySelector(`.track-row[data-set-id="${dragState.setId}"][data-ti="${Math.min(targetTrack, set.tracks.length - 1)}"]`)?.getBoundingClientRect();
  ghostEl.style.left = (tracksRect.left - tlScroll.scrollLeft + (sec - TL_MIN) * PPS) + 'px'; ghostEl.style.top = ((rowRect ? rowRect.top : tracksRect.top) + 3) + 'px';
  const ghostTime = document.getElementById('ghost-time'); if (ghostTime) { const starts = (dragState.plan || []).map(pos => pos.startTime), ends = (dragState.plan || []).map(pos => { const entry = dragState.entries.find(item => item.id === pos.id); return pos.startTime + entry.item.buildTime; }); const start = starts.length ? Math.min(...starts) : sec, end = ends.length ? Math.max(...ends) : sec + dragState.anchorItem.buildTime; ghostTime.textContent = `${fmt(start)} -> ${fmt(end)}`; }
  if (event.clientX > scrollRect.right - 50) tlScroll.scrollLeft += 10; if (event.clientX < scrollRect.left + 50) tlScroll.scrollLeft -= 10; if (event.clientY > scrollRect.bottom - 40) tlScroll.scrollTop += 10; if (event.clientY < scrollRect.top + 40) tlScroll.scrollTop -= 10;
}
function endDrag() {
  if (!dragState) return;
  const set = sets.find(entry => entry.id === dragState.setId);
  if (dragState.plan) {
    const planMap = new Map(dragState.plan.map(pos => [pos.id, pos])); const movingIds = new Set(dragState.entries.map(entry => entry.id));
    set.tracks = set.tracks.map(track => track.filter(item => !movingIds.has(item.id)));
    dragState.entries.forEach(entry => { const pos = planMap.get(entry.id); if (!pos) return; entry.item.startTime = pos.startTime; entry.item.trackIndex = pos.trackIndex; entry.item.trackSetId = set.id; ensureTrack(set, pos.trackIndex); set.tracks[pos.trackIndex].push(entry.item); });
    normalizeSet(set); persistState();
  }
  ghostEl.style.display = 'none'; dragState.dragEls.forEach(el => el.classList.remove('dragging')); dragState = null; document.removeEventListener('mousemove', moveDrag); document.removeEventListener('mouseup', endDrag); window.render(true);
}
function showTip(event, item) {
  const endTime = item.startTime + item.buildTime; const sup = item.supplyCost > 0 ? ` Supply <b style="color:#ddd">${item.supplyCost}</b>` : '';
  tipEl.innerHTML = `<b style="color:#fff">${item.name}</b> <span style="color:#444">${item.race} ${item.type}</span><br><span style="color:#555">start</span> <b style="color:#f0c040">${fmt(item.startTime)}</b> -> <span style="color:#555">end</span> <b style="color:#f0c040">${fmt(endTime)}</b><br><span style="color:#444">build time ${item.buildTime}s</span><br>Minerals <b style="color:#ddd">${item.mineralCost}</b> Gas <b style="color:#ddd">${item.gasCost}</b>${sup}`;
  tipEl.style.display = 'block'; moveTip(event);
}
function moveTip(event) { tipEl.style.left = (event.clientX + 14) + 'px'; tipEl.style.top = (event.clientY - 8) + 'px'; }
function hideTip() { tipEl.style.display = 'none'; }
let ctxId2 = null; function showContext(event, id) { ctxId2 = id; ctxEl.style.left = event.clientX + 'px'; ctxEl.style.top = event.clientY + 'px'; ctxEl.style.display = 'block'; }
document.getElementById('ctx-remove').onclick = () => { if (ctxId2 != null) window.removeItem(ctxId2); ctxEl.style.display = 'none'; ctxId2 = null; };
window.render = function renderForge(skipBO = false) {
  normalizeState();
  const range = timeRange2();
  const set = activeSet();
  TL_MIN = range.min;
  const width = (range.max - range.min) * PPS;
  tlInner.style.width = width + 'px'; tracksRoot.style.width = width + 'px'; ruler.style.width = width + 'px'; hiddenSupply.style.width = width + 'px'; hiddenLabelSupply.style.display = 'none';
  renderTabs(); renderRuler2(range); renderSections(range, width);
  renderGasPanel(set, range, width);
  if (!skipBO) window.updateBO();
  document.getElementById('zoom-info').textContent = PPS + 'px/s'; boTitle.textContent = `Build Order - ${set.name}`;
};
window.addItem = function addItemForge(dataItem) {
  const set = activeSet();
  for (let ti = 0; ti < set.tracks.length; ti++) {
    if (!overlaps2(set.tracks[ti], 0, dataItem.buildTime)) { set.tracks[ti].push(makeItem(dataItem, set.id, ti, 0)); normalizeSet(set); window.render(); persistState(); return; }
  }
  const ti = set.tracks.length; ensureTrack(set, ti); set.tracks[ti].push(makeItem(dataItem, set.id, ti, 0)); normalizeSet(set); window.render(); persistState();
};
window.removeItem = function removeItemForge(id) {
  const found = findItem(id); if (!found) return;
  found.set.tracks[found.trackIndex] = found.set.tracks[found.trackIndex].filter(item => item.id !== id);
  found.set.groups = found.set.groups.map(group => ({ ...group, itemIds: group.itemIds.filter(itemId => itemId !== id) })).filter(group => group.itemIds.length > 1);
  selectedIds.delete(id); normalizeSet(found.set); window.render(); persistState();
};
window.updateBO = function updateBOForge() {
  const set = activeSet(); const all = set.tracks.flat().sort((a, b) => a.startTime - b.startTime || a.trackIndex - b.trackIndex); const multiTrack = set.tracks.filter(track => track.length).length > 1;
  boText.value = all.map(item => `${multiTrack ? `(${item.trackIndex + 1}) ` : ''}${fmt(item.startTime)}  ${item.name}`).join('\n');
};
window.zoom = function zoomForge(dir) { zoomIdx = Math.max(0, Math.min(ZOOM_STEPS.length - 1, zoomIdx + dir)); PPS = ZOOM_STEPS[zoomIdx]; window.render(true); };
window.clearAll = function clearAllForge() { resetState(); window.render(); persistState(); };
window.saveURL = persistState; window.decodeState = decodeState2; window.loadURL = loadState;
window.addTrackSet = function addTrackSetForge() { const name = prompt('New set name:', `Build ${sets.length + 1}`); if (!name || !name.trim()) return; const set = createSet(name.trim()); sets.push(set); activeSetId = set.id; selectedIds = new Set(); window.render(); persistState(); };
window.renameActiveTrackSet = function renameTrackSetForge() { const set = activeSet(); const name = prompt('Rename set:', set.name); if (!name || !name.trim()) return; set.name = name.trim(); window.render(true); persistState(); };
window.deleteActiveTrackSet = function deleteTrackSetForge() { if (sets.length === 1) { window.clearAll(); return; } sets = sets.filter(set => set.id !== activeSetId); activeSetId = sets[0].id; selectedIds = new Set(); window.render(); persistState(); };
window.switchActiveTrackSet = function switchTrackSetForge(id) { activeSetId = id; selectedIds = new Set(); window.render(); };
window.createGroupFromSelection = function createGroupForge() { const set = activeSet(); const ids = selectionInSet(set); if (ids.length < 2) return; const name = prompt('Group name:'); if (!name || !name.trim()) return; set.groups = set.groups.map(group => ({ ...group, itemIds: group.itemIds.filter(id => !ids.includes(id)) })).filter(group => group.itemIds.length > 1); set.groups.push({ id: nextGroupId++, name: name.trim(), itemIds: ids.slice() }); window.render(true); persistState(); };
window.ungroupSelection = function ungroupSelectionForge() { const set = activeSet(); const ids = selectionInSet(set); if (!ids.length) return; set.groups = set.groups.map(group => ({ ...group, itemIds: group.itemIds.filter(id => !ids.includes(id)) })).filter(group => group.itemIds.length > 1); window.render(true); persistState(); };
window.toggleGasPanel = function toggleGasPanelForge() { gasPanelExpanded = !gasPanelExpanded; window.render(true); };
window.saveBuild = function saveBuildForge() { const name = prompt('Save build as:'); if (!name || !name.trim()) return; const saves = (() => { try { return JSON.parse(localStorage.getItem(FORGE_SAVES_KEY) || '{}'); } catch { return {}; } })(); saves[name.trim()] = encodeState(); try { localStorage.setItem(FORGE_SAVES_KEY, JSON.stringify(saves)); } catch {} };
window.loadBuild = function loadBuildForge(name) { const saves = (() => { try { return JSON.parse(localStorage.getItem(FORGE_SAVES_KEY) || '{}'); } catch { return {}; } })(); if (!saves[name]) return; try { decodeState2(saves[name]); window.render(); persistState(); } catch {} closeSavesPanel(); };
window.deleteSave = function deleteSaveForge(name) { const saves = (() => { try { return JSON.parse(localStorage.getItem(FORGE_SAVES_KEY) || '{}'); } catch { return {}; } })(); delete saves[name]; try { localStorage.setItem(FORGE_SAVES_KEY, JSON.stringify(saves)); } catch {} window.renderSavesPanel(); };
window.renderSavesPanel = function renderSavesForge() { const panel = document.getElementById('saves-panel'); const saves = (() => { try { return JSON.parse(localStorage.getItem(FORGE_SAVES_KEY) || '{}'); } catch { return {}; } })(); const names = Object.keys(saves); if (!names.length) { panel.innerHTML = '<div id="saves-empty">No saved builds</div>'; return; } panel.innerHTML = names.map(name => `\n<div class="save-row"><span class="save-name" title="${name}">${name}</span><button class="save-btn" onclick="loadBuild(${JSON.stringify(name)})">Load</button><button class="save-btn del" onclick="deleteSave(${JSON.stringify(name)})">x</button></div>`).join(''); };
window.parseAndApply = function parseAndApplyForge() {
  const set = activeSet(); const parsed = [];
  boText.value.split('\n').forEach(line => { const raw = line.trim(); if (!raw) return; const match = raw.match(/^(?:\((\d+)\)\s+)?(-?\d+:\d{2})\s+(.+)$/); if (!match) return; const trackHint = match[1] != null ? parseInt(match[1], 10) - 1 : null; const secs = parseTime(match[2]); if (secs == null) return; let chainTime = secs; for (const rawName of match[3].split(/\s*->\s*/)) { const src = DATA.find(d => d.name.toLowerCase() === rawName.trim().toLowerCase()); if (!src) break; parsed.push({ src, startTime: chainTime, trackHint }); chainTime += src.buildTime; } });
  parsed.sort((a, b) => a.startTime - b.startTime); set.tracks = [[]]; set.groups = []; selectedIds = new Set();
  parsed.forEach(({ src, startTime, trackHint }) => { if (trackHint != null) { ensureTrack(set, trackHint); set.tracks[trackHint].push(makeItem(src, set.id, trackHint, startTime)); return; } let placed = false; for (let ti = 0; ti < set.tracks.length; ti++) { if (!overlaps2(set.tracks[ti], startTime, src.buildTime)) { set.tracks[ti].push(makeItem(src, set.id, ti, startTime)); placed = true; break; } } if (!placed) { const ti = set.tracks.length; ensureTrack(set, ti); set.tracks[ti].push(makeItem(src, set.id, ti, startTime)); } });
  normalizeSet(set); window.render(true); persistState();
};
loadState();
window.render();
})();
