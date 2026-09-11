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
  for (const img of state.images) {
    const card = document.createElement("article");
    card.className = "card" + (state.selected.has(img.id) ? " selected" : "");
    card.dataset.id = img.id;
    card.innerHTML = `
      <div class="card-check" title="选择">${state.selected.has(img.id) ? "✓" : ""}</div>
      <div class="card-thumb"><img src="${img.thumb_url}" alt="" loading="lazy" /></div>
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
