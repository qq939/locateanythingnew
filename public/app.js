const $ = (id) => document.getElementById(id);
const video = $('video');
const canvas = $('canvas');
const ctx = canvas.getContext('2d');

const state = {
  url: null,
  fps: 25,
  totalFrames: 0,
  frame: 0,
  annotations: new Map(),
  tool: 'select',
  selected: null,
  dragStart: null,
  dragNow: null,
  modelReady: false,
};

const colors = ['#6db3ff', '#91df86', '#f0c869', '#ff7d8f', '#b58cff', '#71e1cf'];

function setStatus(text, type = '') {
  $('status').textContent = text;
  $('status').className = `status-line ${type}`;
}

function frameTime(frame = state.frame) {
  return frame / Math.max(1, state.fps);
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
  return `${m}:${s}.${ms}`;
}

function anns(frame = state.frame) {
  return state.annotations.get(frame) || [];
}

function setAnns(items, frame = state.frame) {
  if (items.length) state.annotations.set(frame, items);
  else state.annotations.delete(frame);
}

function allAnnotations() {
  return [...state.annotations.entries()]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([frame, items]) => items.map((item) => ({ ...item, frame })));
}

function nextTraceId() {
  const value = Number($('traceId').value || 1000000);
  $('traceId').value = String(value + 1);
  return value;
}

function newAnn(fields) {
  return {
    id: crypto.randomUUID(),
    traceId: nextTraceId(),
    label: $('label').value || $('query').value || 'Object',
    mode: $('mode').value,
    source: 'manual',
    accepted: true,
    createdAt: new Date().toISOString(),
    ...fields,
  };
}

function colorFor(ann) {
  const seed = Number(ann.traceId || 0);
  return colors[Math.abs(seed) % colors.length];
}

function updateStats() {
  const current = anns();
  const all = allAnnotations();
  $('frameTitle').textContent = `Frame ${state.frame}`;
  $('frameCount').textContent = String(current.length);
  $('allCount').textContent = String(all.length);
  $('totalFrames').textContent = String(state.totalFrames);
  $('frameInput').value = String(state.frame);
  $('time').textContent = formatTime(video.currentTime || 0);
  $('videoState').textContent = video.videoWidth ? `${video.videoWidth}x${video.videoHeight}` : '未加载视频';
}

function waitSeek() {
  return new Promise((resolve) => video.addEventListener('seeked', () => requestAnimationFrame(resolve), { once: true }));
}

async function seek(frame) {
  if (!video.duration) return;
  state.frame = Math.max(0, Math.min(state.totalFrames - 1, frame));
  video.currentTime = Math.min(video.duration, frameTime());
  await waitSeek();
  draw();
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height),
  };
}

function draw() {
  if (!video.videoWidth) {
    updateStats();
    return;
  }
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  anns().forEach((ann) => drawAnn(ann, ann.id === state.selected));
  if (state.dragStart && state.dragNow) drawDraftBox();
  updateStats();
  renderResults();
}

function drawDraftBox() {
  const x = Math.min(state.dragStart.x, state.dragNow.x);
  const y = Math.min(state.dragStart.y, state.dragNow.y);
  const w = Math.abs(state.dragNow.x - state.dragStart.x);
  const h = Math.abs(state.dragNow.y - state.dragStart.y);
  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#91df86';
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function drawAnn(ann, selected) {
  const color = selected ? '#f0c869' : colorFor(ann);
  ctx.save();
  ctx.lineWidth = selected ? 4 : 2;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  if (ann.kind === 'point') {
    ctx.beginPath();
    ctx.arc(ann.point[0], ann.point[1], selected ? 9 : 7, 0, Math.PI * 2);
    ctx.fill();
    drawLabel(ann.point[0] + 10, ann.point[1] - 10, labelText(ann), color);
  } else {
    const [x1, y1, x2, y2] = ann.bbox;
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    ctx.strokeRect(x, y, Math.abs(x2 - x1), Math.abs(y2 - y1));
    drawLabel(x, y, labelText(ann), color);
  }
  ctx.restore();
}

function labelText(ann) {
  const conf = Number.isFinite(ann.confidence) ? ` ${(ann.confidence * 100).toFixed(0)}%` : '';
  return `${ann.traceId} ${ann.label}${conf}`;
}

function drawLabel(x, y, text, color) {
  ctx.font = '14px Avenir Next, sans-serif';
  const w = Math.min(ctx.measureText(text).width + 10, canvas.width - x);
  const top = Math.max(0, y - 22);
  ctx.fillStyle = color;
  ctx.fillRect(x, top, w, 20);
  ctx.fillStyle = '#0b0d10';
  ctx.fillText(text, x + 5, top + 14, Math.max(20, w - 10));
}

function setTool(tool) {
  state.tool = tool;
  for (const id of ['selectBtn', 'boxBtn', 'pointBtn']) $(id).classList.remove('active');
  $(`${tool}Btn`).classList.add('active');
  canvas.classList.toggle('draw', tool !== 'select');
}

function frameImage() {
  return canvas.toDataURL('image/jpeg', 0.9);
}

async function locateFrame() {
  if (!video.videoWidth) {
    setStatus('请先选择视频', 'bad');
    return;
  }
  $('locateBtn').disabled = true;
  setStatus('LocateAnything 正在处理当前帧，首次加载模型会比较久...', '');
  try {
    const payload = {
      mode: $('mode').value,
      query: $('query').value,
      outputType: $('outputType').value,
      generationMode: $('generationMode').value,
      image: frameImage(),
      width: canvas.width,
      height: canvas.height,
      frame: state.frame,
      fps: state.fps,
    };
    const res = await fetch('/api/locate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    $('rawAnswer').textContent = data.answer || data.error || '无输出';
    if (!data.ok) {
      setStatus(data.error || 'LocateAnything 调用失败', 'bad');
      return;
    }

    const items = anns().slice();
    const query = $('query').value.trim() || $('mode').value;
    for (const box of data.boxes || []) {
      items.push(newAnn({
        kind: 'box',
        bbox: [box.x1, box.y1, box.x2, box.y2],
        label: box.label || query,
        confidence: box.confidence,
        source: data.mock ? 'mock' : 'locateanything',
        rawAnswer: data.answer,
      }));
    }
    for (const point of data.points || []) {
      items.push(newAnn({
        kind: 'point',
        point: [point.x, point.y],
        label: point.label || query,
        source: data.mock ? 'mock' : 'locateanything',
        rawAnswer: data.answer,
      }));
    }
    setAnns(items);
    draw();
    const added = (data.boxes || []).length + (data.points || []).length;
    setStatus(`已把 ${added} 个 LocateAnything 结果落到当前帧`, added ? 'ok' : '');
  } catch (error) {
    setStatus(error.message, 'bad');
  } finally {
    $('locateBtn').disabled = false;
  }
}

function selectAt(point) {
  state.selected = null;
  for (const ann of anns().slice().reverse()) {
    if (ann.kind === 'point') {
      const dx = point.x - ann.point[0];
      const dy = point.y - ann.point[1];
      if (Math.sqrt(dx * dx + dy * dy) < 14) {
        state.selected = ann.id;
        break;
      }
    } else {
      const [x1, y1, x2, y2] = ann.bbox;
      if (point.x >= Math.min(x1, x2) && point.x <= Math.max(x1, x2) && point.y >= Math.min(y1, y2) && point.y <= Math.max(y1, y2)) {
        state.selected = ann.id;
        break;
      }
    }
  }
}

function renderResults() {
  renderCurrentResults();
  renderTimeline();
}

function renderCurrentResults() {
  const list = $('currentResults');
  const items = anns();
  if (!items.length) {
    list.className = 'result-list empty-list';
    list.textContent = '当前帧还没有标注';
    return;
  }
  list.className = 'result-list';
  list.innerHTML = items.map((ann) => `
    <div class="result-item ${ann.id === state.selected ? 'selected' : ''}" data-id="${ann.id}">
      <div>
        <strong>${escapeHtml(labelText(ann))}</strong>
        <small>${ann.kind === 'box' ? bboxText(ann.bbox) : pointText(ann.point)} · ${escapeHtml(ann.source)}</small>
      </div>
      <span class="pill">${ann.kind}</span>
    </div>
  `).join('');
  list.querySelectorAll('.result-item').forEach((node) => node.addEventListener('click', () => {
    state.selected = node.dataset.id;
    draw();
  }));
}

function renderTimeline() {
  const list = $('timelineResults');
  const items = allAnnotations();
  if (!items.length) {
    list.className = 'timeline-list empty-list';
    list.textContent = '暂无标注结果';
    return;
  }
  list.className = 'timeline-list';
  list.innerHTML = items.map((ann) => `
    <div class="timeline-row" data-frame="${ann.frame}" data-id="${ann.id}">
      <b>F${ann.frame}</b>
      <span>${escapeHtml(ann.label)}</span>
      <small>${ann.kind}</small>
    </div>
  `).join('');
  list.querySelectorAll('.timeline-row').forEach((node) => node.addEventListener('click', async () => {
    await seek(Number(node.dataset.frame));
    state.selected = node.dataset.id;
    draw();
  }));
}

function bboxText(box) {
  return box.map((n) => Math.round(n)).join(', ');
}

function pointText(point) {
  return point.map((n) => Math.round(n)).join(', ');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

function exportPayload() {
  return {
    video: $('videoName').textContent,
    fps: state.fps,
    totalFrames: state.totalFrames,
    width: video.videoWidth || 0,
    height: video.videoHeight || 0,
    exportedAt: new Date().toISOString(),
    annotations: allAnnotations(),
  };
}

function downloadJson(payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'locateanything-video-annotations.json';
  a.click();
  URL.revokeObjectURL(url);
}

async function saveJson() {
  const payload = exportPayload();
  const res = await fetch('/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  setStatus(data.ok ? `已保存 ${data.annotations} 条标注到 data/annotations.json` : data.error, data.ok ? 'ok' : 'bad');
}

async function checkModel() {
  try {
    const res = await fetch('/api/model-status');
    const data = await res.json();
    state.modelReady = Boolean(data.ok);
    const modules = data.modules || {};
    const missing = Object.entries(modules).filter(([, value]) => !value.ok).map(([name]) => name);
    if (data.ok) {
      $('modelStatus').textContent = data.mock ? '模型环境正常，当前启用 MOCK 模式' : `模型环境正常：${data.model}`;
      $('modelStatus').className = 'status-line ok';
    } else {
      $('modelStatus').textContent = `模型环境缺依赖：${missing.join(', ') || data.error}`;
      $('modelStatus').className = 'status-line bad';
    }
  } catch (error) {
    $('modelStatus').textContent = `模型环境检查失败：${error.message}`;
    $('modelStatus').className = 'status-line bad';
  }
}

$('videoInput').addEventListener('change', () => {
  const file = $('videoInput').files[0];
  if (!file) return;
  if (state.url) URL.revokeObjectURL(state.url);
  state.url = URL.createObjectURL(file);
  video.src = state.url;
  $('videoName').textContent = file.name;
  $('videoMeta').textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB`;
  $('empty').classList.add('hide');
  setStatus('视频已载入，选择帧后可运行 LocateAnything', 'ok');
});

video.addEventListener('loadedmetadata', async () => {
  state.fps = Number($('fps').value || 25);
  state.totalFrames = Math.max(1, Math.ceil(video.duration * state.fps));
  await seek(0);
});

$('fps').addEventListener('change', () => {
  state.fps = Number($('fps').value || 25);
  state.totalFrames = Math.max(1, Math.ceil((video.duration || 0) * state.fps));
  draw();
});

$('prevBtn').addEventListener('click', () => seek(state.frame - 1));
$('nextBtn').addEventListener('click', () => seek(state.frame + 1));
$('frameInput').addEventListener('change', () => seek(Number($('frameInput').value) || 0));
$('selectBtn').addEventListener('click', () => setTool('select'));
$('boxBtn').addEventListener('click', () => setTool('box'));
$('pointBtn').addEventListener('click', () => setTool('point'));
$('locateBtn').addEventListener('click', locateFrame);
$('saveBtn').addEventListener('click', saveJson);
$('downloadBtn').addEventListener('click', () => downloadJson(exportPayload()));
$('acceptAllBtn').addEventListener('click', () => {
  setAnns(anns().map((ann) => ({ ...ann, accepted: true })));
  draw();
  setStatus('当前帧结果已保留', 'ok');
});
$('clearBtn').addEventListener('click', () => {
  setAnns([]);
  state.selected = null;
  draw();
});
$('deleteBtn').addEventListener('click', () => {
  if (!state.selected) return;
  setAnns(anns().filter((ann) => ann.id !== state.selected));
  state.selected = null;
  draw();
});

canvas.addEventListener('mousedown', (event) => {
  if (!video.videoWidth) return;
  const point = canvasPoint(event);
  if (state.tool === 'point') {
    const items = anns().slice();
    items.push(newAnn({ kind: 'point', point: [point.x, point.y], source: 'manual' }));
    setAnns(items);
    draw();
    return;
  }
  if (state.tool === 'box') {
    state.dragStart = point;
    state.dragNow = point;
    return;
  }
  selectAt(point);
  draw();
});

canvas.addEventListener('mousemove', (event) => {
  if (!state.dragStart) return;
  state.dragNow = canvasPoint(event);
  draw();
});

window.addEventListener('mouseup', () => {
  if (!state.dragStart || !state.dragNow) return;
  const box = [state.dragStart.x, state.dragStart.y, state.dragNow.x, state.dragNow.y];
  state.dragStart = null;
  state.dragNow = null;
  if (Math.abs(box[2] - box[0]) > 5 && Math.abs(box[3] - box[1]) > 5) {
    const items = anns().slice();
    items.push(newAnn({ kind: 'box', bbox: box, source: 'manual' }));
    setAnns(items);
  }
  draw();
});

checkModel();
renderResults();
updateStats();
