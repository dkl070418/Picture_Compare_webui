const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const state = {
  images: [],
  groups: [],
  shares: [],
  selected: new Set(),
};

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 2200);
}

async function api(path, options = {}) {
  const opts = { credentials: "same-origin", ...options };
  if (opts.body && !(opts.body instanceof FormData) && typeof opts.body !== "string") {
    opts.headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, opts);
  if (!res.ok) {
    let detail = res.statusText || "请求失败";
    try {
      const data = await res.json();
      if (typeof data.detail === "string") detail = data.detail;
      else if (data.detail) detail = JSON.stringify(data.detail);
    } catch (_) {}
    // Only force logout when the session itself is invalid
    if (res.status === 401 && detail === "未登录") {
      showLogin();
    }
    throw new Error(detail);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

function showLogin() {
  $("#login-view").classList.remove("hidden");
  $("#app-view").classList.add("hidden");
}

function showApp() {
  $("#login-view").classList.add("hidden");
  $("#app-view").classList.remove("hidden");
}

function updateSelectionUI() {
  const n = state.selected.size;
  $("#btn-share-selected").disabled = n === 0;
  $("#btn-group-selected").disabled = n === 0;
  $("#btn-delete-selected").disabled = n === 0;
  $$(".card").forEach((card) => {
    card.classList.toggle("selected", state.selected.has(card.dataset.id));
  });
}

function renderLibrary() {
  const grid = $("#library-grid");
  const empty = $("#library-empty");
  grid.innerHTML = "";
  empty.classList.toggle("hidden", state.images.length > 0);
  const zoomIcon = `
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.8"/>
      <path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M8.5 11h5M11 8.5v5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    </svg>`;
  for (const img of state.images) {
    const card = document.createElement("article");
    card.className = "card" + (state.selected.has(img.id) ? " selected" : "");
    card.dataset.id = img.id;
    card.innerHTML = `
      <div class="card-check" title="选择">${state.selected.has(img.id) ? "✓" : ""}</div>
      <div class="card-thumb">
        <img src="${img.thumb_url}" alt="" loading="lazy" />
        <button type="button" class="card-zoom" title="预览原图" aria-label="预览原图">${zoomIcon}</button>
      </div>
      <div class="card-body">
        <div class="card-note" title="${escapeAttr(img.note || img.filename)}">
          ${escapeHtml(img.note || "未备注")}
        </div>
        <div class="card-meta">
          <span>${img.width}×${img.height}</span>
          <span>${formatDate(img.created_at)}</span>
        </div>
      </div>
    `;
    card.querySelector(".card-check").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleSelect(img.id);
    });
    card.querySelector(".card-thumb").addEventListener("click", () => toggleSelect(img.id));
    card.querySelector(".card-zoom").addEventListener("click", (e) => {
      e.stopPropagation();
      openLightbox(img);
    });
    card.querySelector(".card-note").addEventListener("click", async (e) => {
      e.stopPropagation();
      await editNote(img);
    });
    grid.appendChild(card);
  }
  updateSelectionUI();
}

function toggleSelect(id) {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  renderLibrary();
}

async function editNote(img) {
  const card = $(`.card[data-id="${img.id}"] .card-note`);
  if (!card || card.querySelector("input")) return;
  const prev = img.note || "";
  card.innerHTML = "";
  const input = document.createElement("input");
  input.value = prev;
  input.placeholder = "备注，如「A效果」";
  card.appendChild(input);
  input.focus();
  input.select();
  const commit = async () => {
    const note = input.value.trim();
    if (note === prev) {
      renderLibrary();
      return;
    }
    try {
      const updated = await api(`/api/admin/images/${img.id}`, {
        method: "PATCH",
        body: { note },
      });
      Object.assign(img, updated);
      toast("备注已保存");
    } catch (err) {
      toast(err.message);
    }
    renderLibrary();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      renderLibrary();
    }
  });
  input.addEventListener("blur", () => commit());
}

function imageById(id) {
  return state.images.find((i) => i.id === id);
}

function thumbStrip(ids) {
  return ids
    .map((id) => {
      const img = imageById(id);
      return img ? `<img src="${img.thumb_url}" alt="" />` : "";
    })
    .join("");
}

function renderGroups() {
  const root = $("#groups-list");
  root.innerHTML = "";
  if (!state.groups.length) {
    root.innerHTML = `<p class="empty">还没有对比组。</p>`;
    return;
  }
  for (const g of state.groups) {
    const el = document.createElement("article");
    el.className = "list-card";
    el.innerHTML = `
      <div class="list-card-head">
        <h3>${escapeHtml(g.name)}</h3>
        <span class="meta">${g.image_ids.length} 张 · ${formatDate(g.created_at)}</span>
      </div>
      <div class="thumb-row">${thumbStrip(g.image_ids)}</div>
      <div class="row-actions">
        <button class="btn small" data-act="share">用这些图生成分享</button>
        <button class="btn small" data-act="edit">编辑</button>
        <button class="btn small danger" data-act="del">删除</button>
      </div>
    `;
    el.querySelector('[data-act="share"]').addEventListener("click", async () => {
      if (!g.image_ids.length) return toast("对比组为空");
      const title = prompt("分享标题", g.name) || g.name;
      try {
        const s = await api("/api/admin/shares", {
          method: "POST",
          body: { title, image_ids: g.image_ids },
        });
        await loadShares();
        toast("已创建分享");
        copyText(location.origin + s.url);
      } catch (err) {
        toast(err.message);
      }
    });
    el.querySelector('[data-act="edit"]').addEventListener("click", () => openGroupEdit(g));
    el.querySelector('[data-act="del"]').addEventListener("click", async () => {
      if (!confirm(`删除对比组「${g.name}」？`)) return;
      try {
        await api(`/api/admin/groups/${g.id}`, { method: "DELETE" });
        await loadGroups();
        toast("已删除");
      } catch (err) {
        toast(err.message);
      }
    });
    root.appendChild(el);
  }
}

function openGroupEdit(g) {
  $("#ge-id").value = g.id;
  $("#ge-name").value = g.name;
  const box = $("#ge-images");
  const selected = new Set(g.image_ids);
  box.innerHTML = "";
  for (const img of state.images) {
    const item = document.createElement("div");
    item.className = "mini-item" + (selected.has(img.id) ? " on" : "");
    item.innerHTML = `<img src="${img.thumb_url}" alt="" /><span>${escapeHtml(img.note || img.filename)}</span>`;
    item.addEventListener("click", () => {
      if (selected.has(img.id)) selected.delete(img.id);
      else selected.add(img.id);
      item.classList.toggle("on", selected.has(img.id));
      item.dataset.dirty = "1";
      box._selected = selected;
    });
    box.appendChild(item);
  }
  box._selected = selected;
  $("#group-edit-dialog").showModal();
}

function renderShares() {
  const root = $("#shares-list");
  root.innerHTML = "";
  if (!state.shares.length) {
    root.innerHTML = `<p class="empty">还没有分享链接。</p>`;
    return;
  }
  for (const s of state.shares) {
    const url = location.origin + s.url;
    const el = document.createElement("article");
    el.className = "list-card";
    el.innerHTML = `
      <div class="list-card-head">
        <h3>${escapeHtml(s.title || "未命名分享")} <span class="badge ${s.revoked ? "off" : ""}">${s.revoked ? "已撤销" : "有效"}</span></h3>
        <span class="meta">${s.image_ids.length} 张 · ${formatDate(s.created_at)}</span>
      </div>
      <div class="thumb-row">${thumbStrip(s.image_ids)}</div>
      <div class="share-url">${escapeHtml(url)}</div>
      <div class="row-actions">
        <button class="btn small primary" data-act="copy">复制链接</button>
        <button class="btn small" data-act="open">打开</button>
        <button class="btn small" data-act="toggle">${s.revoked ? "恢复" : "撤销"}</button>
        <button class="btn small danger" data-act="del">删除</button>
      </div>
    `;
    el.querySelector('[data-act="copy"]').addEventListener("click", () => {
      copyText(url).then(() => toast("链接已复制"));
    });
    el.querySelector('[data-act="open"]').addEventListener("click", () => {
      window.open(s.url, "_blank");
    });
    el.querySelector('[data-act="toggle"]').addEventListener("click", async () => {
      try {
        await api(`/api/admin/shares/${s.id}`, {
          method: "PATCH",
          body: { revoked: !s.revoked },
        });
        await loadShares();
        toast(s.revoked ? "已恢复" : "已撤销");
      } catch (err) {
        toast(err.message);
      }
    });
    el.querySelector('[data-act="del"]').addEventListener("click", async () => {
      if (!confirm("删除该分享链接？")) return;
      try {
        await api(`/api/admin/shares/${s.id}`, { method: "DELETE" });
        await loadShares();
        toast("已删除");
      } catch (err) {
        toast(err.message);
      }
    });
    root.appendChild(el);
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

async function loadAll() {
  await Promise.all([loadImages(), loadGroups(), loadShares()]);
}

async function loadImages() {
  state.images = await api("/api/admin/images");
  renderLibrary();
}

async function loadGroups() {
  state.groups = await api("/api/admin/groups");
  renderGroups();
}

async function loadShares() {
  state.shares = await api("/api/admin/shares");
  renderShares();
}

function switchTab(name) {
  $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tab").forEach((t) => t.classList.toggle("active", t.id === `tab-${name}`));
  const titles = { library: "图库", groups: "对比组", shares: "分享" };
  $("#page-title").textContent = titles[name] || name;
  $("#library-actions").style.display = name === "library" ? "" : "none";
}

async function uploadFiles(fileList) {
  const list = $("#upload-list");
  for (const file of fileList) {
    const row = document.createElement("div");
    row.className = "upload-row";
    row.innerHTML = `<span>${escapeHtml(file.name)}</span><span>上传中…</span>`;
    list.prepend(row);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("note", "");
    try {
      const created = await api("/api/admin/images", { method: "POST", body: fd });
      row.classList.add("ok");
      row.lastElementChild.textContent = "完成";
      state.images.unshift(created);
    } catch (err) {
      row.classList.add("err");
      row.lastElementChild.textContent = err.message;
    }
  }
  renderLibrary();
  toast("上传结束");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replaceAll("'", "&#39;");
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  } catch (_) {
    return "";
  }
}

/* ---------- Lightbox with fit / 1:1 / wheel zoom ---------- */
const lightbox = {
  open: false,
  img: null,
  naturalW: 0,
  naturalH: 0,
  scale: 1,
  minScale: 0.05,
  maxScale: 8,
  x: 0,
  y: 0,
  dragging: false,
  lastX: 0,
  lastY: 0,
  mode: "fit", // fit | actual | custom
};

function lbEls() {
  return {
    root: $("#lightbox"),
    stage: $("#lb-stage"),
    img: $("#lb-img"),
    label: $("#lb-zoom-label"),
    title: $("#lb-title"),
    meta: $("#lb-meta"),
  };
}

function lbApply() {
  const { img, label, stage } = lbEls();
  if (!lightbox.img) return;
  img.style.transform = `translate(${lightbox.x}px, ${lightbox.y}px) scale(${lightbox.scale})`;
  label.textContent = `${Math.round(lightbox.scale * 100)}%`;
  // keep image reasonably inside when possible
  const sw = stage.clientWidth;
  const sh = stage.clientHeight;
  const dw = lightbox.naturalW * lightbox.scale;
  const dh = lightbox.naturalH * lightbox.scale;
  if (dw <= sw) {
    lightbox.x = (sw - dw) / 2;
  } else {
    const minX = sw - dw;
    lightbox.x = Math.min(0, Math.max(minX, lightbox.x));
  }
  if (dh <= sh) {
    lightbox.y = (sh - dh) / 2;
  } else {
    const minY = sh - dh;
    lightbox.y = Math.min(0, Math.max(minY, lightbox.y));
  }
  img.style.transform = `translate(${lightbox.x}px, ${lightbox.y}px) scale(${lightbox.scale})`;
}

/**
 * Fit algorithm:
 * - If image is larger than viewport → scale down to contain (window reaches into photo).
 * - If image is smaller than viewport → scale up to contain (photo fills more of window),
 *   but never beyond 4x original to avoid extreme blur on tiny assets.
 */
function lbFitScale() {
  const { stage } = lbEls();
  const pad = 24;
  const sw = Math.max(1, stage.clientWidth - pad * 2);
  const sh = Math.max(1, stage.clientHeight - pad * 2);
  const sx = sw / lightbox.naturalW;
  const sy = sh / lightbox.naturalH;
  let s = Math.min(sx, sy);
  // allow upscaling small images to fill the window, cap at 4x
  s = Math.min(s, 4);
  return Math.max(lightbox.minScale, Math.min(lightbox.maxScale, s));
}

function lbCenterAtScale(scale) {
  const { stage } = lbEls();
  const dw = lightbox.naturalW * scale;
  const dh = lightbox.naturalH * scale;
  lightbox.scale = scale;
  lightbox.x = (stage.clientWidth - dw) / 2;
  lightbox.y = (stage.clientHeight - dh) / 2;
  lbApply();
}

function lbFit() {
  lightbox.mode = "fit";
  lbCenterAtScale(lbFitScale());
}

function lbActual() {
  lightbox.mode = "actual";
  lbCenterAtScale(1);
}

function lbZoomAt(nextScale, cx, cy) {
  const { stage } = lbEls();
  const rect = stage.getBoundingClientRect();
  const px = cx - rect.left;
  const py = cy - rect.top;
  const prev = lightbox.scale;
  const s = Math.max(lightbox.minScale, Math.min(lightbox.maxScale, nextScale));
  // zoom around pointer
  const ix = (px - lightbox.x) / prev;
  const iy = (py - lightbox.y) / prev;
  lightbox.scale = s;
  lightbox.x = px - ix * s;
  lightbox.y = py - iy * s;
  lightbox.mode = "custom";
  lbApply();
}

function openLightbox(imgMeta) {
  const { root, img, title, meta } = lbEls();
  lightbox.img = imgMeta;
  lightbox.open = true;
  title.textContent = imgMeta.note || imgMeta.filename || "预览";
  meta.textContent = `${imgMeta.width || "?"}×${imgMeta.height || "?"}`;
  root.classList.add("open");
  document.body.style.overflow = "hidden";

  let settled = false;
  const onLoad = () => {
    if (settled) return;
    settled = true;
    lightbox.naturalW = img.naturalWidth || imgMeta.width || 1;
    lightbox.naturalH = img.naturalHeight || imgMeta.height || 1;
    meta.textContent = `${lightbox.naturalW}×${lightbox.naturalH}`;
    lightbox.minScale = Math.min(1, 64 / Math.max(lightbox.naturalW, lightbox.naturalH));
    requestAnimationFrame(() => {
      lbFit();
      const hint = $("#lb-hint");
      if (hint) {
        hint.style.opacity = "1";
        setTimeout(() => {
          hint.style.opacity = "0";
        }, 3200);
      }
    });
  };
  img.onload = onLoad;
  img.onerror = () => {
    if (settled) return;
    settled = true;
    toast("原图加载失败");
    closeLightbox();
  };
  img.src = imgMeta.url;
  if (img.complete && img.naturalWidth) onLoad();
}

function closeLightbox() {
  const { root, img } = lbEls();
  lightbox.open = false;
  lightbox.img = null;
  root.classList.remove("open");
  document.body.style.overflow = "";
  img.onload = null;
  img.onerror = null;
  img.removeAttribute("src");
}

function bindLightbox() {
  const { root, stage, img } = lbEls();

  $("#lb-close").addEventListener("click", closeLightbox);
  $("#lb-fit").addEventListener("click", lbFit);
  $("#lb-actual").addEventListener("click", lbActual);
  $("#lb-zoom-in").addEventListener("click", () => {
    lbZoomAt(lightbox.scale * 1.25, stage.getBoundingClientRect().left + stage.clientWidth / 2, stage.getBoundingClientRect().top + stage.clientHeight / 2);
  });
  $("#lb-zoom-out").addEventListener("click", () => {
    lbZoomAt(lightbox.scale / 1.25, stage.getBoundingClientRect().left + stage.clientWidth / 2, stage.getBoundingClientRect().top + stage.clientHeight / 2);
  });

  root.addEventListener("click", (e) => {
    if (e.target === root) closeLightbox();
  });

  stage.addEventListener(
    "wheel",
    (e) => {
      if (!lightbox.open) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      lbZoomAt(lightbox.scale * factor, e.clientX, e.clientY);
    },
    { passive: false }
  );

  stage.addEventListener("dblclick", (e) => {
    if (!lightbox.open) return;
    if (lightbox.mode === "fit") lbActual();
    else lbFit();
  });

  stage.addEventListener("mousedown", (e) => {
    if (!lightbox.open || e.button !== 0) return;
    lightbox.dragging = true;
    lightbox.lastX = e.clientX;
    lightbox.lastY = e.clientY;
    stage.classList.add("dragging");
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!lightbox.dragging) return;
    lightbox.x += e.clientX - lightbox.lastX;
    lightbox.y += e.clientY - lightbox.lastY;
    lightbox.lastX = e.clientX;
    lightbox.lastY = e.clientY;
    lightbox.mode = "custom";
    lbApply();
  });
  window.addEventListener("mouseup", () => {
    lightbox.dragging = false;
    stage.classList.remove("dragging");
  });

  // touch
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  stage.addEventListener(
    "touchstart",
    (e) => {
      if (!lightbox.open) return;
      if (e.touches.length === 1) {
        lightbox.dragging = true;
        lightbox.lastX = e.touches[0].clientX;
        lightbox.lastY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        lightbox.dragging = false;
        const [a, b] = e.touches;
        pinchStartDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        pinchStartScale = lightbox.scale;
      }
    },
    { passive: true }
  );
  stage.addEventListener(
    "touchmove",
    (e) => {
      if (!lightbox.open) return;
      if (e.touches.length === 1 && lightbox.dragging) {
        const t = e.touches[0];
        lightbox.x += t.clientX - lightbox.lastX;
        lightbox.y += t.clientY - lightbox.lastY;
        lightbox.lastX = t.clientX;
        lightbox.lastY = t.clientY;
        lightbox.mode = "custom";
        lbApply();
        e.preventDefault();
      } else if (e.touches.length === 2 && pinchStartDist) {
        const [a, b] = e.touches;
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const cx = (a.clientX + b.clientX) / 2;
        const cy = (a.clientY + b.clientY) / 2;
        lbZoomAt(pinchStartScale * (dist / pinchStartDist), cx, cy);
        e.preventDefault();
      }
    },
    { passive: false }
  );
  stage.addEventListener("touchend", () => {
    lightbox.dragging = false;
    pinchStartDist = 0;
  });

  window.addEventListener("keydown", (e) => {
    if (!lightbox.open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeLightbox();
    } else if (e.key === "+" || e.key === "=") {
      const r = stage.getBoundingClientRect();
      lbZoomAt(lightbox.scale * 1.25, r.left + r.width / 2, r.top + r.height / 2);
    } else if (e.key === "-" || e.key === "_") {
      const r = stage.getBoundingClientRect();
      lbZoomAt(lightbox.scale / 1.25, r.left + r.width / 2, r.top + r.height / 2);
    } else if (e.key === "0") {
      lbActual();
    } else if (e.key === "f" || e.key === "F") {
      lbFit();
    }
  });

  window.addEventListener("resize", () => {
    if (!lightbox.open) return;
    if (lightbox.mode === "fit") lbFit();
    else lbApply();
  });
}

function bindUI() {
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = $("#login-password").value;
    try {
      await api("/api/login", { method: "POST", body: { password } });
      $("#login-error").textContent = "";
      $("#login-password").value = "";
      showApp();
      await loadAll();
    } catch (err) {
      $("#login-error").textContent = err.message || "登录失败";
    }
  });

  $("#btn-logout").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    showLogin();
  });

  $("#btn-change-password").addEventListener("click", () => {
    $("#pw-current").value = "";
    $("#pw-new").value = "";
    $("#pw-confirm").value = "";
    $("#pw-error").textContent = "";
    $("#password-dialog").showModal();
    $("#pw-current").focus();
  });

  $("#pw-cancel").addEventListener("click", () => {
    $("#password-dialog").close();
  });

  $("#password-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const current_password = $("#pw-current").value;
    const new_password = $("#pw-new").value;
    const confirm = $("#pw-confirm").value;
    const errEl = $("#pw-error");
    errEl.textContent = "";
    if (new_password.length < 4) {
      errEl.textContent = "新口令至少 4 位";
      return;
    }
    if (new_password !== confirm) {
      errEl.textContent = "两次输入的新口令不一致";
      return;
    }
    try {
      const res = await api("/api/admin/password", {
        method: "POST",
        body: { current_password, new_password },
      });
      $("#password-dialog").close();
      toast("口令已修改");
      if (res && res.note) {
        setTimeout(() => toast(res.note), 2400);
      }
    } catch (err) {
      errEl.textContent = err.message || "修改失败";
    }
  });

  $$(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  const dz = $("#dropzone");
  const input = $("#file-input");
  dz.addEventListener("dragover", (e) => {
    e.preventDefault();
    dz.classList.add("dragover");
  });
  dz.addEventListener("dragleave", () => dz.classList.remove("dragover"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("dragover");
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (files.length) uploadFiles(files);
  });
  input.addEventListener("change", () => {
    if (input.files?.length) uploadFiles([...input.files]);
    input.value = "";
  });

  $("#btn-group-selected").addEventListener("click", async () => {
    const name = prompt("对比组名称", "对比组") || "对比组";
    try {
      await api("/api/admin/groups", {
        method: "POST",
        body: { name, image_ids: [...state.selected] },
      });
      await loadGroups();
      switchTab("groups");
      toast("对比组已创建");
    } catch (err) {
      toast(err.message);
    }
  });

  $("#btn-share-selected").addEventListener("click", async () => {
    const title = prompt("分享标题", "") || "";
    try {
      const s = await api("/api/admin/shares", {
        method: "POST",
        body: { title, image_ids: [...state.selected] },
      });
      await loadShares();
      switchTab("shares");
      copyText(location.origin + s.url);
      toast("分享已创建，链接已复制");
    } catch (err) {
      toast(err.message);
    }
  });

  $("#btn-delete-selected").addEventListener("click", async () => {
    if (!state.selected.size) return;
    if (!confirm(`删除选中的 ${state.selected.size} 张图片？`)) return;
    try {
      for (const id of [...state.selected]) {
        await api(`/api/admin/images/${id}`, { method: "DELETE" });
      }
      state.selected.clear();
      await loadAll();
      toast("已删除");
    } catch (err) {
      toast(err.message);
    }
  });

  $("#group-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#group-name").value.trim();
    if (!name) return;
    if (!state.selected.size) {
      toast("请先在图库勾选图片");
      return;
    }
    try {
      await api("/api/admin/groups", {
        method: "POST",
        body: { name, image_ids: [...state.selected] },
      });
      $("#group-name").value = "";
      await loadGroups();
      toast("对比组已创建");
    } catch (err) {
      toast(err.message);
    }
  });

  $("#share-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.selected.size) {
      toast("请先在图库勾选图片");
      return;
    }
    const title = $("#share-title").value.trim();
    try {
      const s = await api("/api/admin/shares", {
        method: "POST",
        body: { title, image_ids: [...state.selected] },
      });
      $("#share-title").value = "";
      await loadShares();
      copyText(location.origin + s.url);
      toast("分享已创建，链接已复制");
    } catch (err) {
      toast(err.message);
    }
  });

  $("#group-edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("#ge-id").value;
    const name = $("#ge-name").value.trim();
    const box = $("#ge-images");
    const image_ids = [...(box._selected || [])];
    try {
      await api(`/api/admin/groups/${id}`, {
        method: "PATCH",
        body: { name, image_ids },
      });
      $("#group-edit-dialog").close();
      await loadGroups();
      toast("已保存");
    } catch (err) {
      toast(err.message);
    }
  });

  $("#ge-save").addEventListener("click", (e) => {
    // let form submit handle; prevent default dialog close first
    e.preventDefault();
    $("#group-edit-form").requestSubmit();
  });
}

async function boot() {
  bindUI();
  bindLightbox();
  try {
    const me = await api("/api/me");
    if (me.authenticated) {
      showApp();
      await loadAll();
    } else {
      showLogin();
    }
  } catch (_) {
    showLogin();
  }
}

boot();
