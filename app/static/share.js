(function () {
  const shareId = window.__SHARE_ID__;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const state = {
    images: [],
    title: "",
    indexA: 0,
    indexB: 1,
    mode: "wipe", // split | wipe | fade — default wipe
    wipePos: 0.5, // 0..1 along the divider axis
    fade: 0.5,
  };

  function showError(msg) {
    $("#loading").classList.add("hidden");
    $("#error").classList.remove("hidden");
    $("#error").textContent = msg;
  }

  function imgAt(i) {
    return state.images[i] || null;
  }

  function setMode(mode) {
    state.mode = mode;
    const stage = $("#stage");
    stage.classList.remove("mode-split", "mode-wipe", "mode-fade");
    stage.classList.add(`mode-${mode}`);
    $$(".mode").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    $("#wipe-handle").classList.toggle("hidden", mode !== "wipe");
    $("#fade-slider").classList.toggle("hidden", mode !== "fade");
    applyWipe();
    applyFade();
  }

  function applyWipe() {
    const paneB = $("#pane-b");
    const handle = $("#wipe-handle");
    // Only clip in wipe mode — otherwise split/fade keep a stale clip-path
    if (state.mode !== "wipe" || state.images.length < 2) {
      paneB.style.clipPath = "";
      return;
    }
    const p = Math.min(0.98, Math.max(0.02, state.wipePos));
    const portrait = isPortraitLayout();
    if (portrait) {
      paneB.style.clipPath = `inset(${(p * 100).toFixed(3)}% 0 0 0)`;
      handle.style.left = "0";
      handle.style.right = "0";
      handle.style.top = `${(p * 100).toFixed(3)}%`;
      handle.style.bottom = "auto";
      handle.style.width = "auto";
      handle.style.height = "28px";
      handle.style.marginLeft = "0";
      handle.style.marginTop = "-14px";
    } else {
      paneB.style.clipPath = `inset(0 0 0 ${(p * 100).toFixed(3)}%)`;
      handle.style.top = "0";
      handle.style.bottom = "0";
      handle.style.left = `${(p * 100).toFixed(3)}%`;
      handle.style.right = "auto";
      handle.style.width = "28px";
      handle.style.height = "auto";
      handle.style.marginLeft = "-14px";
      handle.style.marginTop = "0";
    }
  }

  function applyFade() {
    const paneB = $("#pane-b");
    if (state.mode !== "fade" || state.images.length < 2) {
      paneB.style.opacity = "";
    } else {
      paneB.style.opacity = String(state.fade);
    }
    $("#fade-range").value = String(Math.round(state.fade * 100));
    $("#fade-val").textContent = `${Math.round(state.fade * 100)}%`;
  }

  function isPortraitLayout() {
    // Match CSS: portrait or narrow → horizontal wipe
    return window.matchMedia("(max-aspect-ratio: 1/1), (max-width: 699px)").matches;
  }

  function labelOf(img, fallback) {
    if (!img) return fallback;
    return img.note || img.filename || fallback;
  }

  function renderImages() {
    const a = imgAt(state.indexA);
    const b = imgAt(state.indexB);
    const imgA = $("#img-a");
    const imgB = $("#img-b");
    if (a) {
      imgA.src = a.url;
      imgA.alt = labelOf(a, "A");
      $("#tag-a").textContent = `A · ${labelOf(a, "")}`;
    }
    if (b) {
      imgB.src = b.url;
      imgB.alt = labelOf(b, "B");
      $("#tag-b").textContent = `B · ${labelOf(b, "")}`;
    } else {
      imgB.removeAttribute("src");
      $("#tag-b").textContent = "B";
    }
    // Single image: hide B side visually in split by stacking full
    const stage = $("#stage");
    if (state.images.length === 1) {
      stage.classList.add("single");
      $("#pane-b").style.display = "none";
      $("#wipe-handle").classList.add("hidden");
      $("#fade-slider").classList.add("hidden");
    } else {
      stage.classList.remove("single");
      $("#pane-b").style.display = "";
      if (state.mode === "wipe") $("#wipe-handle").classList.remove("hidden");
      if (state.mode === "fade") $("#fade-slider").classList.remove("hidden");
      applyWipe();
      applyFade();
    }
    renderThumbs();
  }

  function renderThumbs() {
    const boxA = $("#thumbs-a");
    const boxB = $("#thumbs-b");
    boxA.innerHTML = "";
    boxB.innerHTML = "";
    state.images.forEach((img, idx) => {
      const ta = makeThumb(img, idx, state.indexA, () => {
        state.indexA = idx;
        if (state.images.length > 1 && state.indexA === state.indexB) {
          state.indexB = (idx + 1) % state.images.length;
        }
        renderImages();
      });
      const tb = makeThumb(img, idx, state.indexB, () => {
        state.indexB = idx;
        if (state.indexA === state.indexB) {
          state.indexA = (idx + 1) % state.images.length;
        }
        renderImages();
      });
      boxA.appendChild(ta);
      boxB.appendChild(tb);
    });
  }

  function makeThumb(img, idx, activeIdx, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "thumb" + (idx === activeIdx ? " active" : "");
    btn.title = labelOf(img, `#${idx + 1}`);
    btn.innerHTML = `<img src="${img.thumb_url}" alt="" loading="lazy" />`;
    btn.addEventListener("click", onClick);
    return btn;
  }

  function bindWipe() {
    const stage = $("#stage");
    const handle = $("#wipe-handle");
    let dragging = false;

    function posFromEvent(e) {
      const rect = stage.getBoundingClientRect();
      const point = e.touches ? e.touches[0] : e;
      if (isPortraitLayout()) {
        const y = point.clientY - rect.top;
        return Math.min(1, Math.max(0, y / rect.height));
      }
      const x = point.clientX - rect.left;
      return Math.min(1, Math.max(0, x / rect.width));
    }

    function start(e) {
      dragging = true;
      state.wipePos = posFromEvent(e);
      applyWipe();
      e.preventDefault();
    }
    function move(e) {
      if (!dragging) return;
      state.wipePos = posFromEvent(e);
      applyWipe();
      e.preventDefault();
    }
    function end() {
      dragging = false;
    }

    handle.addEventListener("mousedown", start);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    handle.addEventListener("touchstart", start, { passive: false });
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", end);

    // Also allow dragging on stage in wipe mode
    stage.addEventListener("mousedown", (e) => {
      if (state.mode !== "wipe") return;
      start(e);
    });
    stage.addEventListener("touchstart", (e) => {
      if (state.mode !== "wipe") return;
      start(e);
    }, { passive: false });
  }

  function bindUI() {
    $$(".mode").forEach((btn) => {
      btn.addEventListener("click", () => setMode(btn.dataset.mode));
    });

    $("#fade-range").addEventListener("input", (e) => {
      state.fade = Number(e.target.value) / 100;
      applyFade();
    });

    window.addEventListener("keydown", (e) => {
      if (e.target.matches("input,textarea")) return;
      if (e.key === "1") setMode("split");
      else if (e.key === "2") setMode("wipe");
      else if (e.key === "3") setMode("fade");
      else if (e.key === "ArrowLeft") {
        if (state.images.length < 2) return;
        if (state.images.length === 2) {
          // Swap A/B
          const t = state.indexA;
          state.indexA = state.indexB;
          state.indexB = t;
        } else {
          state.indexA = (state.indexA - 1 + state.images.length) % state.images.length;
          if (state.indexA === state.indexB) {
            state.indexA = (state.indexA - 1 + state.images.length) % state.images.length;
          }
        }
        renderImages();
      } else if (e.key === "ArrowRight") {
        if (state.images.length < 2) return;
        if (state.images.length === 2) {
          const t = state.indexA;
          state.indexA = state.indexB;
          state.indexB = t;
        } else {
          state.indexB = (state.indexB + 1) % state.images.length;
          if (state.indexB === state.indexA) {
            state.indexB = (state.indexB + 1) % state.images.length;
          }
        }
        renderImages();
      }
    });

    window.addEventListener("resize", () => {
      if (state.mode === "wipe") applyWipe();
    });

    bindWipe();
  }

  async function boot() {
    bindUI();
    try {
      const res = await fetch(`/api/share/${shareId}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "无法打开该分享");
      }
      const data = await res.json();
      state.images = data.images || [];
      state.title = data.title || "";
      if (!state.images.length) throw new Error("分享中没有图片");

      $("#share-title").textContent = state.title || "图片对比";
      $("#share-sub").textContent = `${state.images.length} 张图片`;
      document.title = state.title ? `${state.title} · 对比` : "图片对比";

      state.indexA = 0;
      state.indexB = state.images.length > 1 ? 1 : 0;
      setMode("wipe");
      $("#loading").classList.add("hidden");
      $("#app").classList.remove("hidden");
      renderImages();
      applyWipe();
      applyFade();
    } catch (err) {
      showError(err.message || "加载失败");
    }
  }

  boot();
})();
