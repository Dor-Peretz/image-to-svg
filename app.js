const MAX_SIDE = 900;
const CRISP_MAX_SIDE = 2000;
const MIN_AREA_RATIO = 0.0004;

const els = {
  dropZone: document.getElementById("drop-zone"),
  fileInput: document.getElementById("file-input"),
  chooseBtn: document.getElementById("choose-btn"),
  controls: document.getElementById("controls"),
  stages: document.getElementById("stages"),
  status: document.getElementById("status"),
  original: document.getElementById("original-canvas"),
  bw: document.getElementById("bw-canvas"),
  originalView: document.getElementById("original-view"),
  bwView: document.getElementById("bw-view"),
  svgPreview: document.getElementById("svg-preview"),
  threshold: document.getElementById("threshold"),
  thresholdValue: document.getElementById("threshold-value"),
  smooth: document.getElementById("smooth"),
  smoothValue: document.getElementById("smooth-value"),
  simplify: document.getElementById("simplify"),
  simplifyValue: document.getElementById("simplify-value"),
  zoom: document.getElementById("zoom"),
  zoomValue: document.getElementById("zoom-value"),
  invert: document.getElementById("invert"),
  alreadyBw: document.getElementById("already-bw"),
  useImage: document.getElementById("use-image"),
  keepColors: document.getElementById("keep-colors"),
  outline: document.getElementById("outline"),
  crop: document.getElementById("crop"),
  fitBtn: document.getElementById("fit-btn"),
  downloadBtn: document.getElementById("download-btn"),
  copyBtn: document.getElementById("copy-btn"),
  editor: document.getElementById("editor"),
  editorHelp: document.getElementById("editor-help"),
  editorCanvas: document.getElementById("editor-canvas"),
  deleteBtn: document.getElementById("delete-btn"),
  keepBtn: document.getElementById("keep-btn"),
  restoreBtn: document.getElementById("restore-btn"),
  fillColor: document.getElementById("fill-color"),
  strokeColor: document.getElementById("stroke-color"),
  strokeWidth: document.getElementById("stroke-width"),
  strokeWidthValue: document.getElementById("stroke-width-value"),
  whiteBg: document.getElementById("white-bg"),
  zonesPanel: document.getElementById("zones-panel"),
  zoneList: document.getElementById("zone-list"),
  drawZoneBtn: document.getElementById("draw-zone-btn"),
  clearZonesBtn: document.getElementById("clear-zones-btn"),
  originalCaption: document.getElementById("original-caption"),
  originalStage: document.getElementById("original-stage"),
  zoneHint: document.getElementById("zone-hint"),
  nozzle: document.getElementById("nozzle"),
  sizer: document.getElementById("sizer"),
  sizeWidth: document.getElementById("size-width"),
  sizeHeight: document.getElementById("size-height"),
  sizeUnit: document.getElementById("size-unit"),
  sizerRatio: document.getElementById("sizer-ratio"),
};

const originalCtx = els.original.getContext("2d", { willReadFrequently: true });
const bwCtx = els.bw.getContext("2d", { willReadFrequently: true });

let sourceName = "shape";
let sourceBitmap = null;
let lastSvg = "";
let renderTimer = 0;
let pieces = [];
let selectedIds = new Set();
let nextPieceId = 1;
let embedded = null;
const EMBED_MAX = 1600;
const view = { zoomPct: 100, panX: 0, panY: 0, fitted: true };
let drag = null;
let zones = [];
let nextZoneId = 1;
let selectedZoneId = null;
let drawing = false;
let draftZone = null;
const ZONE_COLORS = ["#0f766e", "#1d4ed8", "#c2410c", "#7c3aed", "#15803d", "#b45309"];

els.chooseBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  els.fileInput.click();
});
els.dropZone.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", () => {
  const file = els.fileInput.files?.[0];
  if (file) loadFile(file);
});

["dragenter", "dragover"].forEach((type) => {
  els.dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    els.dropZone.classList.add("dragover");
  });
});
["dragleave", "drop"].forEach((type) => {
  els.dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    els.dropZone.classList.remove("dragover");
  });
});
els.dropZone.addEventListener("drop", (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (file && file.type.startsWith("image/")) loadFile(file);
});

[
  els.threshold,
  els.smooth,
  els.simplify,
  els.invert,
  els.alreadyBw,
  els.useImage,
  els.keepColors,
  els.outline,
  els.nozzle,
].forEach((el) => el.addEventListener("input", scheduleRender));

els.sizeWidth.addEventListener("input", () => {
  syncSize("width");
  scheduleRender();
});
els.sizeHeight.addEventListener("input", () => {
  syncSize("height");
  scheduleRender();
});
els.sizeUnit.addEventListener("change", () => {
  convertSizeUnits();
  scheduleRender();
});

[
  els.outline,
  els.crop,
  els.fillColor,
  els.strokeColor,
  els.strokeWidth,
  els.whiteBg,
].forEach((el) => el.addEventListener("input", () => {
  updateModeUi();
  rebuildOutput();
}));

els.zoom.addEventListener("input", () => {
  const rect = els.originalView.getBoundingClientRect();
  setZoom(Number(els.zoom.value), rect.width / 2, rect.height / 2);
});
els.fitBtn.addEventListener("click", fitImage);
els.drawZoneBtn.addEventListener("click", () => setDrawing(!drawing));
els.clearZonesBtn.addEventListener("click", () => {
  zones = [];
  selectedZoneId = null;
  draftZone = null;
  renderZoneList();
  scheduleRender();
});

els.originalView.addEventListener("pointerdown", (event) => {
  if (!sourceBitmap || event.button !== 0) return;
  if (drawing) {
    const point = pointerToImage(event, els.originalView);
    draftZone = { x: point.x, y: point.y, w: 0, h: 0 };
    els.zoneHint.hidden = true;
    els.originalView.setPointerCapture(event.pointerId);
    paintOriginal();
    return;
  }
  startPan(event, els.originalView);
});
els.originalView.addEventListener("pointermove", (event) => {
  if (drawing && draftZone && event.buttons) {
    const point = pointerToImage(event, els.originalView);
    draftZone.w = point.x - draftZone.x;
    draftZone.h = point.y - draftZone.y;
    paintOriginal();
    return;
  }
  movePan(event);
});
els.originalView.addEventListener("pointerup", (event) => {
  if (drawing && draftZone) {
    finishDraftZone();
    els.originalView.releasePointerCapture(event.pointerId);
    return;
  }
  endPan(event, els.originalView);
});
els.originalView.addEventListener("pointercancel", (event) => {
  if (drawing) {
    draftZone = null;
    paintOriginal();
    return;
  }
  endPan(event, els.originalView);
});
els.originalView.addEventListener(
  "wheel",
  (event) => {
    if (!sourceBitmap) return;
    event.preventDefault();
    const rect = els.originalView.getBoundingClientRect();
    const next = Math.min(
      400,
      Math.max(50, view.zoomPct + (event.deltaY < 0 ? 14 : -14)),
    );
    setZoom(next, event.clientX - rect.left, event.clientY - rect.top);
  },
  { passive: false },
);

els.bwView.addEventListener("pointerdown", (event) => {
  if (!sourceBitmap || event.button !== 0) return;
  startPan(event, els.bwView);
});
els.bwView.addEventListener("pointermove", movePan);
els.bwView.addEventListener("pointerup", (event) => endPan(event, els.bwView));
els.bwView.addEventListener("pointercancel", (event) => endPan(event, els.bwView));
els.bwView.addEventListener(
  "wheel",
  (event) => {
    if (!sourceBitmap) return;
    event.preventDefault();
    const rect = els.bwView.getBoundingClientRect();
    const next = Math.min(
      400,
      Math.max(50, view.zoomPct + (event.deltaY < 0 ? 14 : -14)),
    );
    setZoom(next, event.clientX - rect.left, event.clientY - rect.top);
  },
  { passive: false },
);

function startPan(event, viewport) {
  view.fitted = false;
  drag = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    panX: view.panX,
    panY: view.panY,
  };
  viewport.setPointerCapture(event.pointerId);
  viewport.classList.add("panning");
}

function movePan(event) {
  if (!drag || drag.id !== event.pointerId) return;
  view.panX = drag.panX + (event.clientX - drag.x);
  view.panY = drag.panY + (event.clientY - drag.y);
  applyView();
}

function endPan(event, viewport) {
  if (!drag || drag.id !== event.pointerId) return;
  drag = null;
  viewport.classList.remove("panning");
}

new ResizeObserver(() => applyView()).observe(els.originalView);

els.deleteBtn.addEventListener("click", () => deleteSelected());
els.keepBtn.addEventListener("click", () => keepSelected());
els.restoreBtn.addEventListener("click", () => restoreAll());

document.addEventListener("keydown", (event) => {
  const typing = event.target.matches("input, textarea");
  if (typing) return;
  if (event.key === "Escape") {
    if (drawing) {
      setDrawing(false);
      return;
    }
    selectedIds.clear();
    selectedZoneId = null;
    renderZoneList();
    rebuildOutput();
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    if (selectedZoneId) {
      event.preventDefault();
      removeZone(selectedZoneId);
      return;
    }
    if (!pieces.length) return;
    event.preventDefault();
    deleteSelected();
  }
});

for (const canvas of [els.svgPreview, els.editorCanvas]) {
  canvas.addEventListener("click", (event) => {
    const hit = event.target.closest("path.hit");
    if (!hit) {
      selectedIds.clear();
      rebuildOutput();
      return;
    }
    const id = Number(hit.dataset.id);
    if (!event.shiftKey) selectedIds.clear();
    if (selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
    rebuildOutput();
  });
}

els.downloadBtn.addEventListener("click", () => {
  if (!lastSvg) return;
  const blob = new Blob([lastSvg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sourceName}.svg`;
  link.click();
  URL.revokeObjectURL(url);
});

els.copyBtn.addEventListener("click", async () => {
  if (!lastSvg) return;
  await navigator.clipboard.writeText(lastSvg);
  els.status.hidden = false;
  els.status.textContent = "SVG copied to the clipboard.";
});

async function loadFile(file) {
  sourceName = file.name.replace(/\.[^.]+$/, "") || "shape";
  try {
    sourceBitmap = await createImageBitmap(file);
    zones = [];
    selectedZoneId = null;
    draftZone = null;
    setDrawing(false);
    fitImage();
    els.controls.hidden = false;
    els.stages.hidden = false;
    els.editor.hidden = false;
    els.zonesPanel.hidden = false;
    els.sizer.hidden = false;
    els.status.hidden = false;
    renderZoneList();
    render();
    syncSize("width");
  } catch (error) {
    els.status.hidden = false;
    els.status.textContent = "Could not read that image. Try a PNG, JPG, or WebP.";
    console.error(error);
  }
}

function scheduleRender() {
  updateLabels();
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 40);
}

function currentStrokeWidth() {
  return Number(els.strokeWidth.value) / 20;
}

function updateLabels() {
  els.thresholdValue.textContent = `${els.threshold.value}%`;
  els.smoothValue.textContent = els.smooth.value;
  els.simplifyValue.textContent = (Number(els.simplify.value) / 10).toFixed(1);
  els.zoomValue.textContent = `${Math.round(view.zoomPct)}%`;
  els.strokeWidthValue.textContent = currentStrokeWidth().toFixed(2);
  updateSizerRatio();
}

function fitScale() {
  const rect = els.originalView.getBoundingClientRect();
  if (!els.original.width || !rect.width) return 1;
  return Math.min(rect.width / els.original.width, rect.height / els.original.height);
}

function applyView() {
  if (!els.original.width) return;
  const rect = els.originalView.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const scale = fitScale() * (view.zoomPct / 100);
  if (view.fitted) {
    view.panX = (rect.width - els.original.width * scale) / 2;
    view.panY = (rect.height - els.original.height * scale) / 2;
  }
  const transform = `translate(${view.panX}px, ${view.panY}px) scale(${scale})`;
  els.original.style.transform = transform;
  els.bw.style.transform = transform;
}

function setZoom(pct, originX, originY) {
  const oldScale = fitScale() * (view.zoomPct / 100) || 1;
  view.zoomPct = pct;
  els.zoom.value = String(Math.round(pct));
  const newScale = fitScale() * (view.zoomPct / 100);
  view.fitted = false;
  view.panX = originX - ((originX - view.panX) * newScale) / oldScale;
  view.panY = originY - ((originY - view.panY) * newScale) / oldScale;
  updateLabels();
  applyView();
}

function fitImage() {
  view.zoomPct = 100;
  view.fitted = true;
  els.zoom.value = "100";
  updateLabels();
  applyView();
}

function setDrawing(on) {
  drawing = on;
  draftZone = null;
  els.drawZoneBtn.textContent = drawing ? "Cancel" : "Add zone";
  els.drawZoneBtn.classList.toggle("ghost", !drawing);
  els.originalView.classList.toggle("is-drawing", drawing);
  els.originalStage.classList.toggle("is-drawing-target", drawing);
  els.zoneHint.hidden = !drawing;
  els.originalCaption.textContent = drawing
    ? "Original · drag a box to add a zone"
    : "Original · drag to move";
  if (drawing) {
    els.originalStage.scrollIntoView({ behavior: "smooth", block: "center" });
  } else {
    paintOriginal();
  }
}

function pointerToImage(event, viewport) {
  const rect = viewport.getBoundingClientRect();
  const scale = fitScale() * (view.zoomPct / 100) || 1;
  const x = (event.clientX - rect.left - view.panX) / scale / els.original.width;
  const y = (event.clientY - rect.top - view.panY) / scale / els.original.height;
  return {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
  };
}

function normalizeRect(rect) {
  const x = Math.min(rect.x, rect.x + rect.w);
  const y = Math.min(rect.y, rect.y + rect.h);
  const w = Math.abs(rect.w);
  const h = Math.abs(rect.h);
  return { x, y, w, h };
}

function finishDraftZone() {
  const box = normalizeRect(draftZone);
  draftZone = null;
  if (box.w < 0.02 || box.h < 0.02) {
    paintOriginal();
    if (drawing) els.zoneHint.hidden = false;
    return;
  }
  const zone = {
    id: nextZoneId++,
    ...box,
    threshold: Number(els.threshold.value),
  };
  zones.push(zone);
  selectedZoneId = zone.id;
  setDrawing(false);
  renderZoneList();
  scheduleRender();
}

function removeZone(id) {
  zones = zones.filter((zone) => zone.id !== id);
  if (selectedZoneId === id) selectedZoneId = null;
  renderZoneList();
  scheduleRender();
}

function isoForPoint(nx, ny, defaultIso) {
  for (let i = zones.length - 1; i >= 0; i--) {
    const zone = zones[i];
    if (nx >= zone.x && nx <= zone.x + zone.w && ny >= zone.y && ny <= zone.y + zone.h) {
      return (zone.threshold / 100) * 255;
    }
  }
  return defaultIso;
}

function zoneColor(index) {
  return ZONE_COLORS[index % ZONE_COLORS.length];
}

function renderZoneList() {
  els.zoneList.innerHTML = "";
  els.clearZonesBtn.disabled = !zones.length;
  if (!zones.length) {
    const empty = document.createElement("button");
    empty.type = "button";
    empty.className = "zone-empty";
    empty.innerHTML = `<strong>+ Add a zone</strong><span>Click here, then drag a rectangle on the Original image.</span>`;
    empty.addEventListener("click", () => setDrawing(true));
    els.zoneList.append(empty);
    return;
  }
  zones.forEach((zone, index) => {
    const row = document.createElement("div");
    row.className = `zone-row${zone.id === selectedZoneId ? " is-selected" : ""}`;
    row.innerHTML = `
      <span class="zone-swatch" style="background:${zoneColor(index)}"></span>
      <strong>Zone ${index + 1}</strong>
      <label class="control">
        <span>Threshold <em>${zone.threshold}%</em></span>
        <input type="range" min="1" max="99" value="${zone.threshold}" />
      </label>
      <button class="btn ghost" type="button">Delete</button>
    `;
    const slider = row.querySelector("input");
    const label = row.querySelector("em");
    slider.addEventListener("input", () => {
      zone.threshold = Number(slider.value);
      label.textContent = `${zone.threshold}%`;
      scheduleRender();
    });
    row.querySelector("button").addEventListener("click", (event) => {
      event.stopPropagation();
      removeZone(zone.id);
    });
    row.addEventListener("click", () => {
      selectedZoneId = zone.id;
      renderZoneList();
      paintOriginal();
    });
    els.zoneList.append(row);
  });
  const addAnother = document.createElement("button");
  addAnother.type = "button";
  addAnother.className = "zone-empty";
  addAnother.innerHTML = `<strong>+ Add another zone</strong><span>Click, then drag a new box on the Original image.</span>`;
  addAnother.addEventListener("click", () => setDrawing(true));
  els.zoneList.append(addAnother);
}

function paintOriginal() {
  if (!sourceBitmap || !els.original.width) return;
  const width = els.original.width;
  const height = els.original.height;
  originalCtx.clearRect(0, 0, width, height);
  originalCtx.drawImage(sourceBitmap, 0, 0, width, height);
  const boxes = draftZone ? [...zones, { ...normalizeRect(draftZone), draft: true }] : zones;
  boxes.forEach((zone, index) => {
    const x = zone.x * width;
    const y = zone.y * height;
    const w = zone.w * width;
    const h = zone.h * height;
    const color = zone.draft ? "#b42318" : zoneColor(zones.indexOf(zone) === -1 ? zones.length : index);
    originalCtx.save();
    originalCtx.fillStyle = `${color}33`;
    originalCtx.strokeStyle = color;
    originalCtx.lineWidth = Math.max(2, width / 280);
    originalCtx.setLineDash(zone.draft ? [6, 4] : []);
    originalCtx.fillRect(x, y, w, h);
    originalCtx.strokeRect(x, y, w, h);
    if (!zone.draft) {
      originalCtx.fillStyle = color;
      originalCtx.font = `${Math.max(12, width / 42)}px Segoe UI, sans-serif`;
      originalCtx.fillText(`${index + 1} · ${zone.threshold}%`, x + 6, y + Math.max(16, height / 28));
    }
    if (zone.id === selectedZoneId) {
      originalCtx.strokeStyle = "#b42318";
      originalCtx.setLineDash([]);
      originalCtx.lineWidth += 1;
      originalCtx.strokeRect(x, y, w, h);
    }
    originalCtx.restore();
  });
}

function usingImage() {
  return els.useImage.checked;
}

function nozzleMm() {
  return Number(els.nozzle.value) || 0;
}

function printWidthMm() {
  const width = Number(els.sizeWidth.value);
  const mm = els.sizeUnit.value === "cm" ? width * 10 : width;
  return Math.max(1, mm || 50);
}

function imageAspect() {
  const width = els.original.width || sourceBitmap?.width || 1;
  const height = els.original.height || sourceBitmap?.height || 1;
  return width / Math.max(1, height);
}

let syncingSize = false;
let lastSizeUnit = "cm";

function syncSize(from) {
  if (syncingSize) return;
  syncingSize = true;
  const aspect = imageAspect();
  if (from === "width") {
    const width = Number(els.sizeWidth.value);
    if (width > 0) els.sizeHeight.value = (width / aspect).toFixed(2);
  } else {
    const height = Number(els.sizeHeight.value);
    if (height > 0) els.sizeWidth.value = (height * aspect).toFixed(2);
  }
  updateSizerRatio();
  syncingSize = false;
}

function convertSizeUnits() {
  const next = els.sizeUnit.value;
  if (next === lastSizeUnit) return;
  const factor = next === "mm" ? 10 : 0.1;
  const digits = next === "mm" ? 1 : 2;
  const width = Number(els.sizeWidth.value);
  const height = Number(els.sizeHeight.value);
  if (width > 0) els.sizeWidth.value = (width * factor).toFixed(digits);
  if (height > 0) els.sizeHeight.value = (height * factor).toFixed(digits);
  lastSizeUnit = next;
  updateSizerRatio();
}

function updateSizerRatio() {
  if (!els.sizerRatio) return;
  const width = Number(els.sizeWidth.value);
  const height = Number(els.sizeHeight.value);
  const unit = els.sizeUnit.value;
  if (width > 0 && height > 0) {
    els.sizerRatio.textContent = `${width} × ${height} ${unit} · height follows the image ratio`;
  } else {
    els.sizerRatio.textContent = "Enter a width. Height stays in proportion.";
  }
}

function updateModeUi() {
  const imageMode = usingImage();
  const keepColors = imageMode && els.keepColors.checked;
  els.controls.classList.toggle("is-image-mode", imageMode);
  els.controls.classList.toggle("is-crisp-mode", els.alreadyBw.checked);
  els.editor.classList.toggle("is-image-mode", imageMode);
  els.editor.classList.toggle("is-keep-colors", keepColors);
  els.keepColors.disabled = !imageMode;
  if (els.editorHelp) {
    const unit = els.sizeUnit?.value || "cm";
    const width = els.sizeWidth?.value || "5";
    els.editorHelp.textContent = nozzleMm() > 0
      ? `Shapes are thickened to ${nozzleMm()} mm. The SVG will be ${width} ${unit} wide, with height kept in ratio.`
      : imageMode
        ? keepColors
          ? "The SVG contains the original image, not a traced outline. Uncheck Keep original colors if you want to recolor the black shape."
          : "The original image is used as the shape. Change Fill to recolor it. Part deleting is only available when tracing an outline."
        : `Click a part to select it. The download is ${width} ${unit} wide; height follows the image ratio.`;
  }
}

function render() {
  if (!sourceBitmap) return;
  updateLabels();
  updateModeUi();

  const crisp = els.alreadyBw.checked;
  const maxSide = crisp ? CRISP_MAX_SIDE : MAX_SIDE;
  const scale = Math.min(1, maxSide / Math.max(sourceBitmap.width, sourceBitmap.height));
  const width = Math.max(2, Math.round(sourceBitmap.width * scale));
  const height = Math.max(2, Math.round(sourceBitmap.height * scale));

  for (const canvas of [els.original, els.bw]) {
    canvas.width = width;
    canvas.height = height;
  }

  originalCtx.imageSmoothingEnabled = !crisp;
  originalCtx.imageSmoothingQuality = crisp ? "low" : "high";
  originalCtx.clearRect(0, 0, width, height);
  originalCtx.drawImage(sourceBitmap, 0, 0, width, height);

  const pixels = originalCtx.getImageData(0, 0, width, height);
  const gray = toLuma(pixels);
  const invert = els.invert.checked;
  const iso = crisp ? 128 : (Number(els.threshold.value) / 100) * 255;
  const radius = crisp ? 0 : Number(els.smooth.value);
  const blurred = radius > 0 ? boxBlur(gray, width, height, radius) : gray;
  const field = new Float32Array(width * height);
  const binary = new Uint8Array(width * height);

  const bwData = bwCtx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const localIso = isoForPoint(x / width, y / height, iso);
      const isInside = invert ? blurred[i] > localIso : blurred[i] < localIso;
      binary[i] = isInside ? 1 : 0;
      field[i] = isInside ? 0 : 255;
      const v = isInside ? 0 : 255;
      const o = i * 4;
      bwData.data[o] = v;
      bwData.data[o + 1] = v;
      bwData.data[o + 2] = v;
      bwData.data[o + 3] = 255;
    }
  }
  bwCtx.putImageData(bwData, 0, 0);

  const nozzle = nozzleMm();
  const printW = printWidthMm();
  let nozzlePixels = 0;
  if (nozzle > 0) {
    nozzlePixels = (nozzle * width) / printW;
    const radius = Math.max(0.5, (nozzlePixels - 1) / 2);
    if (els.outline.checked) {
      const dilated = dilateBinary(binary, width, height, radius);
      const eroded = erodeBinary(binary, width, height, radius);
      for (let i = 0; i < binary.length; i++) {
        binary[i] = dilated[i] && !eroded[i] ? 1 : 0;
      }
    } else {
      const dilated = dilateBinary(binary, width, height, radius);
      binary.set(dilated);
    }
    for (let i = 0; i < binary.length; i++) {
      field[i] = binary[i] ? 0 : 255;
      const v = binary[i] ? 0 : 255;
      const o = i * 4;
      bwData.data[o] = v;
      bwData.data[o + 1] = v;
      bwData.data[o + 2] = v;
      bwData.data[o + 3] = 255;
    }
    bwCtx.putImageData(bwData, 0, 0);
  }

  paintOriginal();

  embedded = buildEmbedded(blurred, width, height, iso, invert);

  if (usingImage()) {
    pieces = [];
    selectedIds.clear();
    rebuildOutput();
    applyView();
    return;
  }

  const loops = crisp
    ? tracePixelEdges(binary, width, height)
    : traceShape(field, width, height, 128, false);
  const epsilon = crisp ? 0 : Number(els.simplify.value) / 10;
  const minArea = nozzle > 0
    ? Math.max(2, nozzlePixels * nozzlePixels)
    : crisp
      ? 2
      : width * height * MIN_AREA_RATIO;
  const simplified = loops
    .map((loop) => (crisp ? cleanCrispPath(loop) : rdp(loop, epsilon)))
    .filter((loop) => loop.length >= 3 && polygonArea(loop) >= minArea);

  if (!simplified.length) {
    pieces = [];
    selectedIds.clear();
    lastSvg = "";
    els.svgPreview.innerHTML = "";
    els.editorCanvas.innerHTML = "";
    els.downloadBtn.disabled = true;
    els.copyBtn.disabled = true;
    updateEditorButtons();
    els.status.textContent = "No shape found. Try a different threshold or invert the image.";
    applyView();
    return;
  }

  pieces = simplified.map((points) => ({
    id: nextPieceId++,
    points,
    hidden: false,
  }));
  selectedIds.clear();
  rebuildOutput();
  applyView();
}

function buildEmbedded(gray, previewW, previewH, iso, invert) {
  const scale = Math.min(1, EMBED_MAX / Math.max(sourceBitmap.width, sourceBitmap.height));
  const width = Math.max(2, Math.round(sourceBitmap.width * scale));
  const height = Math.max(2, Math.round(sourceBitmap.height * scale));
  const color = document.createElement("canvas");
  const mask = document.createElement("canvas");
  color.width = mask.width = width;
  color.height = mask.height = height;
  const colorCtx = color.getContext("2d");
  const maskCtx = mask.getContext("2d");
  colorCtx.drawImage(sourceBitmap, 0, 0, width, height);
  const sourcePixels = colorCtx.getImageData(0, 0, width, height);
  if (invert) {
    const inverted = colorCtx.getImageData(0, 0, width, height);
    for (let i = 0; i < inverted.data.length; i += 4) {
      inverted.data[i] = 255 - inverted.data[i];
      inverted.data[i + 1] = 255 - inverted.data[i + 1];
      inverted.data[i + 2] = 255 - inverted.data[i + 2];
    }
    colorCtx.putImageData(inverted, 0, 0);
  }

  const maskData = maskCtx.createImageData(width, height);
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  const px = sourcePixels.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = px[i + 3] / 255;
      const lum =
        (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) * a + 255 * (1 - a);
      const localIso = isoForPoint(x / width, y / height, iso);
      const inside = invert ? lum > localIso : lum < localIso;
      const v = inside ? 255 : 0;
      maskData.data[i] = v;
      maskData.data[i + 1] = v;
      maskData.data[i + 2] = v;
      maskData.data[i + 3] = 255;
      if (inside) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  maskCtx.putImageData(maskData, 0, 0);
  if (maxX < minX) {
    minX = 0;
    minY = 0;
    maxX = width;
    maxY = height;
  }
  return {
    width,
    height,
    colorUrl: color.toDataURL("image/png"),
    maskUrl: mask.toDataURL("image/png"),
    bbox: { minX, minY, maxX: maxX + 1, maxY: maxY + 1 },
    previewW,
    previewH,
  };
}

function visiblePieces() {
  return pieces.filter((piece) => !piece.hidden);
}

function deleteSelected() {
  if (!selectedIds.size) return;
  for (const piece of pieces) {
    if (selectedIds.has(piece.id)) piece.hidden = true;
  }
  selectedIds.clear();
  rebuildOutput();
}

function keepSelected() {
  if (!selectedIds.size) return;
  for (const piece of pieces) {
    if (!selectedIds.has(piece.id)) piece.hidden = true;
  }
  selectedIds.clear();
  rebuildOutput();
}

function restoreAll() {
  for (const piece of pieces) piece.hidden = false;
  selectedIds.clear();
  rebuildOutput();
}

function updateEditorButtons() {
  const imageMode = usingImage();
  const hasSelection = !imageMode && selectedIds.size > 0;
  const hasHidden = !imageMode && pieces.some((piece) => piece.hidden);
  els.deleteBtn.disabled = !hasSelection;
  els.keepBtn.disabled = !hasSelection;
  els.restoreBtn.disabled = !hasHidden;
}

function rebuildOutput() {
  updateLabels();
  updateModeUi();
  updateEditorButtons();

  if (usingImage()) {
    if (!embedded) return;
    lastSvg = serializeImageSvg();
    els.svgPreview.innerHTML = lastSvg;
    els.editorCanvas.innerHTML = lastSvg;
    els.downloadBtn.disabled = false;
    els.copyBtn.disabled = false;
    els.status.textContent = els.keepColors.checked
      ? "Using the original image in the SVG · no traced outline"
      : "Using the original image as the shape · change Fill to recolor";
    return;
  }

  const visible = visiblePieces();
  if (!visible.length) {
    lastSvg = "";
    els.svgPreview.innerHTML = "";
    els.editorCanvas.innerHTML = "";
    els.downloadBtn.disabled = true;
    els.copyBtn.disabled = true;
    els.status.textContent = pieces.length
      ? "All parts removed. Restore all parts to bring the shape back."
      : "No shape found. Try a different threshold or invert the image.";
    return;
  }

  lastSvg = serializeSvg(false);
  const preview = serializeSvg(true);
  els.svgPreview.innerHTML = preview;
  els.editorCanvas.innerHTML = preview;
  els.downloadBtn.disabled = false;
  els.copyBtn.disabled = false;
  const hiddenCount = pieces.length - visible.length;
  const selectedCount = selectedIds.size;
  const parts = [
    `${visible.length} part${visible.length === 1 ? "" : "s"}`,
    hiddenCount ? `${hiddenCount} deleted` : null,
    selectedCount ? `${selectedCount} selected` : "click a part to select it",
  ].filter(Boolean);
  const printW = printWidthMm();
  const printH = printW * (els.original.height / els.original.width);
  const unit = els.sizeUnit.value;
  const wLabel = unit === "cm" ? (printW / 10).toFixed(2) : printW.toFixed(1);
  const hLabel = unit === "cm" ? (printH / 10).toFixed(2) : printH.toFixed(1);
  parts.unshift(`${wLabel} × ${hLabel} ${unit}${nozzleMm() > 0 ? ` · ${nozzleMm()} mm nozzle` : ""}`);
  els.status.textContent = parts.join(" · ");
}

function serializeImageSvg() {
  const { width, height, colorUrl, maskUrl, bbox } = embedded;
  const pad = 8;
  let minX = 0;
  let minY = 0;
  let viewW = width;
  let viewH = height;
  if (els.crop.checked) {
    minX = Math.max(0, bbox.minX - pad);
    minY = Math.max(0, bbox.minY - pad);
    viewW = Math.max(1, bbox.maxX - bbox.minX + pad * 2);
    viewH = Math.max(1, bbox.maxY - bbox.minY + pad * 2);
  }
  const printScale = printWidthMm() / viewW;
  const toUnit = (value) => fmt(value * printScale, 3);
  const bg = els.whiteBg.checked
    ? `<rect x="${toUnit(minX)}" y="${toUnit(minY)}" width="${toUnit(viewW)}" height="${toUnit(viewH)}" fill="#ffffff"/>`
    : "";
  const image = els.keepColors.checked
    ? `<image href="${colorUrl}" width="${toUnit(width)}" height="${toUnit(height)}" preserveAspectRatio="none"/>`
    : `<defs><mask id="shape-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${toUnit(width)}" height="${toUnit(height)}"><image href="${maskUrl}" width="${toUnit(width)}" height="${toUnit(height)}" preserveAspectRatio="none"/></mask></defs><rect width="${toUnit(width)}" height="${toUnit(height)}" fill="${els.fillColor.value}" mask="url(#shape-mask)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${toUnit(minX)} ${toUnit(minY)} ${toUnit(viewW)} ${toUnit(viewH)}" width="${toUnit(viewW)}mm" height="${toUnit(viewH)}mm">${bg}${image}</svg>`;
}

function toLuma(imageData) {
  const { data, width, height } = imageData;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const a = data[i + 3] / 255;
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[p] = lum * a + 255 * (1 - a);
  }
  return gray;
}

function boxBlur(src, width, height, radius) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const windowSize = radius * 2 + 1;

  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) {
      sum += src[y * width + clamp(x, 0, width - 1)];
    }
    for (let x = 0; x < width; x++) {
      tmp[y * width + x] = sum / windowSize;
      sum += src[y * width + clamp(x + radius + 1, 0, width - 1)];
      sum -= src[y * width + clamp(x - radius, 0, width - 1)];
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) {
      sum += tmp[clamp(y, 0, height - 1) * width + x];
    }
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / windowSize;
      sum += tmp[clamp(y + radius + 1, 0, height - 1) * width + x];
      sum -= tmp[clamp(y - radius, 0, height - 1) * width + x];
    }
  }
  return out;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function dilateBinary(src, width, height, radius) {
  const r = Math.max(0, radius);
  if (r < 0.5) return src;
  const inf = 1e9;
  const dist = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) dist[i] = src[i] ? 0 : inf;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (x > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1);
      if (y > 0) dist[i] = Math.min(dist[i], dist[i - width] + 1);
      if (x > 0 && y > 0) dist[i] = Math.min(dist[i], dist[i - width - 1] + Math.SQRT2);
      if (x + 1 < width && y > 0) dist[i] = Math.min(dist[i], dist[i - width + 1] + Math.SQRT2);
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (x + 1 < width) dist[i] = Math.min(dist[i], dist[i + 1] + 1);
      if (y + 1 < height) dist[i] = Math.min(dist[i], dist[i + width] + 1);
      if (x + 1 < width && y + 1 < height) dist[i] = Math.min(dist[i], dist[i + width + 1] + Math.SQRT2);
      if (x > 0 && y + 1 < height) dist[i] = Math.min(dist[i], dist[i + width - 1] + Math.SQRT2);
    }
  }
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = dist[i] <= r ? 1 : 0;
  return out;
}

function invertBinary(src) {
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] ? 0 : 1;
  return out;
}

function erodeBinary(src, width, height, radius) {
  return invertBinary(dilateBinary(invertBinary(src), width, height, radius));
}

function sample(gray, width, height, x, y) {
  return gray[clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)];
}

function inside(value, iso, invert) {
  return invert ? value > iso : value < iso;
}

function lerpEdge(x1, y1, v1, x2, y2, v2, iso) {
  const t = (iso - v1) / ((v2 - v1) || 1e-6);
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

function pixelAt(binary, width, height, x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return 0;
  return binary[y * width + x];
}

function tracePixelEdges(binary, width, height) {
  const segments = [];
  for (let y = 0; y <= height; y++) {
    for (let x = 0; x < width; x++) {
      const below = pixelAt(binary, width, height, x, y);
      const above = pixelAt(binary, width, height, x, y - 1);
      if (below && !above) segments.push([[x, y], [x + 1, y]]);
      else if (above && !below) segments.push([[x + 1, y], [x, y]]);
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x <= width; x++) {
      const right = pixelAt(binary, width, height, x, y);
      const left = pixelAt(binary, width, height, x - 1, y);
      if (right && !left) segments.push([[x, y + 1], [x, y]]);
      else if (left && !right) segments.push([[x, y], [x, y + 1]]);
    }
  }
  return stitch(segments);
}

function collinear(a, b, c) {
  return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) < 1e-6;
}

function collapseCollinear(points) {
  if (points.length < 4) return points;
  const closed = pointKey(points[0]) === pointKey(points[points.length - 1]);
  let ring = closed ? points.slice(0, -1) : points.slice();
  const collapsed = [ring[0]];
  for (let i = 1; i < ring.length - 1; i++) {
    if (!collinear(collapsed[collapsed.length - 1], ring[i], ring[i + 1])) {
      collapsed.push(ring[i]);
    }
  }
  collapsed.push(ring[ring.length - 1]);
  ring = collapsed;
  if (closed) {
    while (ring.length > 3 && collinear(ring[ring.length - 1], ring[0], ring[1])) {
      ring.shift();
    }
    while (ring.length > 3 && collinear(ring[ring.length - 2], ring[ring.length - 1], ring[0])) {
      ring.pop();
    }
    ring.push(ring[0].slice());
  }
  return ring;
}

function unitStep(a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if ((dx === 0 && Math.abs(dy) === 1) || (dy === 0 && Math.abs(dx) === 1)) {
    return [dx, dy];
  }
  return null;
}

function smoothStairs(points) {
  if (points.length < 6) return points;
  const closed = pointKey(points[0]) === pointKey(points[points.length - 1]);
  const ring = closed ? points.slice(0, -1) : points.slice();
  const n = ring.length;
  if (n < 5) return points;
  const kept = new Array(n).fill(true);

  const stepAt = (i) => unitStep(ring[i % n], ring[(i + 1) % n]);

  let i = 0;
  while (i < n) {
    const d1 = stepAt(i);
    const d2 = stepAt(i + 1);
    if (!d1 || !d2 || d1[0] * d2[0] + d1[1] * d2[1] !== 0) {
      i += 1;
      continue;
    }
    let len = 2;
    while (len < n) {
      const step = stepAt(i + len);
      const expect = len % 2 === 0 ? d1 : d2;
      if (!step || step[0] !== expect[0] || step[1] !== expect[1]) break;
      len += 1;
    }
    if (len >= 3 && len < n - 1) {
      for (let k = 1; k < len; k++) kept[(i + k) % n] = false;
      i += len;
      continue;
    }
    i += 1;
  }

  const out = ring.filter((_, index) => kept[index]);
  if (out.length < 3) return points;
  if (closed) out.push(out[0].slice());
  return collapseCollinear(out);
}

function cleanCrispPath(points) {
  return smoothStairs(collapseCollinear(points));
}

function traceShape(gray, width, height, iso, invert) {
  const segments = [];

  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const tl = sample(gray, width, height, x, y);
      const tr = sample(gray, width, height, x + 1, y);
      const br = sample(gray, width, height, x + 1, y + 1);
      const bl = sample(gray, width, height, x, y + 1);

      let code = 0;
      if (inside(tl, iso, invert)) code |= 8;
      if (inside(tr, iso, invert)) code |= 4;
      if (inside(br, iso, invert)) code |= 2;
      if (inside(bl, iso, invert)) code |= 1;
      if (code === 0 || code === 15) continue;

      const top = lerpEdge(x, y, tl, x + 1, y, tr, iso);
      const right = lerpEdge(x + 1, y, tr, x + 1, y + 1, br, iso);
      const bottom = lerpEdge(x, y + 1, bl, x + 1, y + 1, br, iso);
      const left = lerpEdge(x, y, tl, x, y + 1, bl, iso);

      const edges = {
        1: [left, bottom],
        2: [bottom, right],
        3: [left, right],
        4: [top, right],
        5: [left, top, bottom, right],
        6: [top, bottom],
        7: [left, top],
        8: [left, top],
        9: [top, bottom],
        10: [left, bottom, top, right],
        11: [top, right],
        12: [left, right],
        13: [bottom, right],
        14: [left, bottom],
      }[code];

      for (let i = 0; i < edges.length; i += 2) {
        segments.push([edges[i], edges[i + 1]]);
      }
    }
  }

  return stitch(segments);
}

function pointKey(point) {
  return `${point[0].toFixed(2)},${point[1].toFixed(2)}`;
}

function stitch(segments) {
  const unused = new Set(segments.map((_, i) => i));
  const byPoint = new Map();

  const add = (point, index) => {
    const key = pointKey(point);
    if (!byPoint.has(key)) byPoint.set(key, []);
    byPoint.get(key).push(index);
  };

  segments.forEach((segment, index) => {
    add(segment[0], index);
    add(segment[1], index);
  });

  const loops = [];
  while (unused.size) {
    const startIndex = unused.values().next().value;
    unused.delete(startIndex);
    const start = segments[startIndex][0];
    let current = segments[startIndex][1];
    const loop = [start, current];
    let safety = segments.length + 2;

    while (safety-- && pointKey(current) !== pointKey(start)) {
      const candidates = byPoint.get(pointKey(current)) || [];
      let next = null;
      for (const index of candidates) {
        if (!unused.has(index)) continue;
        unused.delete(index);
        const segment = segments[index];
        next = pointKey(segment[0]) === pointKey(current) ? segment[1] : segment[0];
        break;
      }
      if (!next) break;
      current = next;
      loop.push(current);
    }

    if (loop.length >= 4) loops.push(loop);
  }
  return loops;
}

function polygonArea(points) {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += points[j][0] * points[i][1] - points[i][0] * points[j][1];
  }
  return Math.abs(area) / 2;
}

function rdp(points, epsilon) {
  if (points.length < 3) return points;
  const closed =
    pointKey(points[0]) === pointKey(points[points.length - 1]);
  const ring = closed ? points.slice(0, -1) : points.slice();
  const simplified = simplify(ring, epsilon);
  if (simplified.length < 3) return points;
  if (closed) simplified.push(simplified[0].slice());
  return simplified;
}

function simplify(points, epsilon) {
  let maxDist = 0;
  let index = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      index = i;
      maxDist = dist;
    }
  }
  if (maxDist > epsilon) {
    const left = simplify(points.slice(0, index + 1), epsilon);
    const right = simplify(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

function perpendicularDistance(point, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy) || 1;
  return Math.abs(dy * point[0] - dx * point[1] + b[0] * a[1] - b[1] * a[0]) / length;
}

function boundsOf(loops) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const loop of loops) {
    for (const [x, y] of loop) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY };
}

function serializeSvg(preview) {
  const visible = visiblePieces();
  const width = els.original.width;
  const height = els.original.height;
  const pad = 8;
  let minX = 0;
  let minY = 0;
  let viewW = width;
  let viewH = height;

  if (els.crop.checked) {
    const box = boundsOf(visible.map((piece) => piece.points));
    minX = box.minX - pad;
    minY = box.minY - pad;
    viewW = Math.max(1, box.maxX - box.minX + pad * 2);
    viewH = Math.max(1, box.maxY - box.minY + pad * 2);
  }

  const nozzle = nozzleMm();
  const printScale = printWidthMm() / viewW;
  const unit = 3;
  const toUnit = (value) => fmt(value * printScale, unit);
  const scaled = (points) => points.map(([x, y]) => [x * printScale, y * printScale]);

  const outline = els.outline.checked && nozzle <= 0;
  const fill = els.fillColor.value;
  const stroke = els.strokeColor.value;
  const slider = currentStrokeWidth();
  const crisp = els.alreadyBw.checked;
  const hairline = crisp ? 0.35 : Math.min(0.8, Math.max(0.35, Math.min(viewW, viewH) * 0.002));
  const strokeWidth = nozzle > 0
    ? 0
    : slider > 0
      ? slider
      : outline
        ? hairline
        : 0;
  const join = crisp ? "miter" : "round";
  const style = outline
    ? `fill="none" stroke="${stroke}" stroke-width="${strokeWidth.toFixed(2)}" stroke-linejoin="${join}" stroke-linecap="butt" stroke-miterlimit="4"`
    : `fill="${fill}" fill-rule="evenodd"${
        strokeWidth > 0
          ? ` stroke="${stroke}" stroke-width="${strokeWidth.toFixed(2)}" stroke-linejoin="${join}"`
          : ""
      }`;

  const d = visible.map((piece) => loopToD(scaled(piece.points), unit)).join("");
  const bg = els.whiteBg.checked
    ? `<rect x="${toUnit(minX)}" y="${toUnit(minY)}" width="${toUnit(viewW)}" height="${toUnit(viewH)}" fill="#ffffff"/>`
    : "";

  let extras = "";
  if (preview) {
    const hits = [...visible].sort(
      (a, b) => polygonArea(b.points) - polygonArea(a.points),
    );
    extras = hits
      .map(
        (piece) =>
          `<path class="hit" data-id="${piece.id}" d="${loopToD(scaled(piece.points), unit)}" fill="transparent" pointer-events="fill" />`,
      )
      .join("");
    extras += [...selectedIds]
      .map((id) => visible.find((piece) => piece.id === id))
      .filter(Boolean)
      .map(
        (piece) =>
          `<path class="sel" d="${loopToD(scaled(piece.points), unit)}" fill="none" stroke="#b42318" stroke-width="${fmt(Math.max(nozzle || hairline, 0.2) * (nozzle ? 1 : printScale), unit)}" stroke-linejoin="round" />`,
      )
      .join("");
  }

  const visualPointer = preview ? ` pointer-events="none"` : "";
  const crispAttr = els.alreadyBw.checked && nozzle <= 0 ? ` shape-rendering="crispEdges"` : "";
  const sizeAttr = ` width="${toUnit(viewW)}mm" height="${toUnit(viewH)}mm"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${toUnit(minX)} ${toUnit(minY)} ${toUnit(viewW)} ${toUnit(viewH)}"${sizeAttr}${crispAttr}>${bg}<path ${style}${visualPointer} d="${d}"/>${extras}</svg>`;
}

function loopToD(points, digits = 2) {
  const closed =
    points.length > 1 && pointKey(points[0]) === pointKey(points[points.length - 1]);
  const last = closed ? points.length - 1 : points.length;
  let path = `M${fmt(points[0][0], digits)} ${fmt(points[0][1], digits)}`;
  for (let i = 1; i < last; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    if (Math.abs(cur[1] - prev[1]) < 1e-6) path += `H${fmt(cur[0], digits)}`;
    else if (Math.abs(cur[0] - prev[0]) < 1e-6) path += `V${fmt(cur[1], digits)}`;
    else path += `L${fmt(cur[0], digits)} ${fmt(cur[1], digits)}`;
  }
  return `${path}Z`;
}

function fmt(value, digits = 2) {
  return Number(value.toFixed(digits));
}

updateLabels();
updateModeUi();
