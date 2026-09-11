(function () {
  const shareId = window.__SHARE_ID__;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const state = {
    images: [],
    title: "",
    indexA: 0,
    indexB: 1,
    mode: "wipe", // split | wipe | fade
    wipePos: 0.5,
    fade: 0.5,
  };

  // Synchronized zoom/pan for A+B (compare lockstep)
  // scale: 1 = CSS "fit" (object-fit contain baseline); >1 zooms in
  const zoom = {
    scale: 1,
    minScale: 1,
    maxScale: 8,
    x: 0,
    y: 0,
  };

  function showError(msg) {
    $("#loading").classList.add("hidden");
    $("#error").classList.remove("hidden");
    $("#error").textContent = msg;
  }

  function imgAt(i) {
    return state.images[i] || null;
  }

  function isPortraitLayout() {
    return window.matchMedia("(max-aspect-ratio: 1/1), (max-width: 699px)").matches;
  }

  function isZoomed() {
    return zoom.scale > 1.02;
  }

  /* ---------- zoom ---------- */

  function stageRect() {
    return $("#stage").getBoundingClientRect();
  }

  function paneFor(img) {
    return img.closest(".pane") || $("#stage");
  }

  /** Natural→display scale under object-fit:contain inside pane */
  function fitContentScale(img) {
    const pane = paneFor(img);
    const nw = img.naturalWidth || 1;
    const nh = img.naturalHeight || 1;
    const pw = Math.max(1, pane.clientWidth);
    const ph = Math.max(1, pane.clientHeight);
    return Math.min(pw / nw, ph / nh);
  }

  /** scale multiplier so displayed pixels == image pixels (1:1) */
  function actualScaleForCompare() {
    const imgA = $("#img-a");
    if (!imgA || !imgA.naturalWidth) return 1;
    const fit = fitContentScale(imgA);
    if (fit <= 0) return 1;
    // allow up to maxScale
    return Math.min(zoom.maxScale, Math.max(1, 1 / fit));
  }

  function clampPan() {
    const stage = $("#stage");
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    // keep at least some image on screen when zoomed
    const maxOffX = sw * (zoom.scale - 0.2);
    const maxOffY = sh * (zoom.scale - 0.2);
    zoom.x = Math.min(maxOffX, Math.max(-maxOffX, zoom.x));
    zoom.y = Math.min(maxOffY, Math.max(-maxOffY, zoom.y));
  }

  function applyZoom() {
    clampPan();
    const t = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`;
    // transform-origin center keeps contain-fit centered when scale=1
    [$("#img-a"), $("#img-b")].forEach((img) => {
      if (!img) return;
      img.style.transformOrigin = "50% 50%";
      img.style.transform = t;
    });
    const label = $("#zoom-label");
    if (label) {
      if (!isZoomed()) label.textContent = "适应";
      else label.textContent = `${Math.round(zoom.scale * 100)}%`;
    }
    $("#stage").classList.toggle("is-zoomed", isZoomed());
  }

  function resetZoom() {
    zoom.scale = 1;
    zoom.x = 0;
    zoom.y = 0;
    applyZoom();
  }

  function setZoomAt(nextScale, clientX, clientY) {
    const rect = stageRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const prev = zoom.scale;
    const s = Math.min(zoom.maxScale, Math.max(zoom.minScale, nextScale));
    // zoom around pointer: keep image point under finger stable
    const ix = (px - zoom.x) / prev;
    const iy = (py - zoom.y) / prev;
    zoom.scale = s;
    zoom.x = px - ix * s;
    zoom.y = py - iy * s;
    if (s <= 1.02) {
      zoom.scale = 1;
      zoom.x = 0;
      zoom.y = 0;
    }
    applyZoom();
  }

  function zoomTo100() {
    const s = actualScaleForCompare();
    // center the 1:1 view
    zoom.scale = s;
    zoom.x = 0;
    zoom.y = 0;
    applyZoom();
  }

  function zoomFit() {
    resetZoom();
  }

  function nudgeZoom(factor) {
    const r = stageRect();
    setZoomAt(zoom.scale * factor, r.left + r.width / 2, r.top + r.height / 2);
  }

  /* ---------- modes / wipe / fade ---------- */

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
    applyZoom();
  }

  function applyWipe() {
    const paneB = $("#pane-b");
    const handle = $("#wipe-handle");
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
    // switching images resets zoom for a clean compare baseline
    resetZoom();
    renderThumbs();
  }

  function renderThumbs() {
    const boxA = $("#thumbs-a");
    const boxB = $("#thumbs-b");
    boxA.innerHTML = "";
    boxB.innerHTML = "";
    state.images.forEach((img, idx) => {
      boxA.appendChild(
        makeThumb(img, idx, state.indexA, () => {
          state.indexA = idx;
          if (state.images.length > 1 && state.indexA === state.indexB) {
            state.indexB = (idx + 1) % state.images.length;
          }
          renderImages();
        })
      );
      boxB.appendChild(
        makeThumb(img, idx, state.indexB, () => {
          state.indexB = idx;
          if (state.indexA === state.indexB) {
            state.indexA = (idx + 1) % state.images.length;
          }
          renderImages();
        })
      );
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

  /* ---------- gestures: wipe / pan / pinch ---------- */

  function wipePosFrom(clientX, clientY) {
    const rect = stageRect();
    if (isPortraitLayout()) {
      const y = clientY - rect.top;
      return Math.min(1, Math.max(0, y / rect.height));
    }
    const x = clientX - rect.left;
    return Math.min(1, Math.max(0, x / rect.width));
  }

  function onHandleDown(e) {
    if (state.mode !== "wipe" || isZoomed()) return;
    const p = e.touches ? e.touches[0] : e;
    state.wipePos = wipePosFrom(p.clientX, p.clientY);
    applyWipe();
    e.preventDefault();
  }

  function bindGestures() {
    const stage = $("#stage");
    const handle = $("#wipe-handle");

    // --- mouse: wipe handle + wheel zoom + drag pan ---
    let mousePan = null;
    handle.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      onHandleDown(e);
      const move = (ev) => {
        if (state.mode !== "wipe" || isZoomed()) return;
        state.wipePos = wipePosFrom(ev.clientX, ev.clientY);
        applyWipe();
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      e.preventDefault();
      e.stopPropagation();
    });

    stage.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      // zoomed → pan; wipe mode & not zoomed → wipe
      if (isZoomed()) {
        mousePan = { x: e.clientX, y: e.clientY };
        stage.classList.add("dragging");
        e.preventDefault();
        return;
      }
      if (state.mode === "wipe" && state.images.length > 1) {
        state.wipePos = wipePosFrom(e.clientX, e.clientY);
        applyWipe();
        const move = (ev) => {
          state.wipePos = wipePosFrom(ev.clientX, ev.clientY);
          applyWipe();
        };
        const up = () => {
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
        e.preventDefault();
      }
    });
    window.addEventListener("mousemove", (e) => {
      if (!mousePan) return;
      zoom.x += e.clientX - mousePan.x;
      zoom.y += e.clientY - mousePan.y;
      mousePan = { x: e.clientX, y: e.clientY };
      applyZoom();
    });
    window.addEventListener("mouseup", () => {
      mousePan = null;
      stage.classList.remove("dragging");
    });

    stage.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        setZoomAt(zoom.scale * factor, e.clientX, e.clientY);
      },
      { passive: false }
    );

    // double-click desktop / double-tap
    let lastTap = 0;
    stage.addEventListener("dblclick", (e) => {
      if (isZoomed()) zoomFit();
      else zoomTo100();
      e.preventDefault();
    });

    // --- touch: 1 finger wipe-or-pan, 2 finger pinch+pan ---
    let touchMode = null; // 'wipe' | 'pan' | 'pinch'
    let pinch = null;
    let panLast = null;
    let tapTimer = null;

    stage.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length === 1) {
          const t = e.touches[0];
          const now = Date.now();
          if (now - lastTap < 280) {
            // double tap
            clearTimeout(tapTimer);
            lastTap = 0;
            if (isZoomed()) zoomFit();
            else zoomTo100();
            e.preventDefault();
            return;
          }
          lastTap = now;
          if (isZoomed()) {
            touchMode = "pan";
            panLast = { x: t.clientX, y: t.clientY };
          } else if (state.mode === "wipe" && state.images.length > 1) {
            touchMode = "wipe";
            state.wipePos = wipePosFrom(t.clientX, t.clientY);
            applyWipe();
          } else {
            touchMode = "pan";
            panLast = { x: t.clientX, y: t.clientY };
          }
          e.preventDefault();
        } else if (e.touches.length === 2) {
          touchMode = "pinch";
          const [a, b] = e.touches;
          pinch = {
            dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
            scale: zoom.scale,
            cx: (a.clientX + b.clientX) / 2,
            cy: (a.clientY + b.clientY) / 2,
            x: zoom.x,
            y: zoom.y,
          };
          e.preventDefault();
        }
      },
      { passive: false }
    );

    stage.addEventListener(
      "touchmove",
      (e) => {
        if (touchMode === "pinch" && e.touches.length === 2 && pinch) {
          const [a, b] = e.touches;
          const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
          const cx = (a.clientX + b.clientX) / 2;
          const cy = (a.clientY + b.clientY) / 2;
          const next = pinch.scale * (dist / Math.max(1, pinch.dist));
          // pinch around midpoint; also allow two-finger pan
          const rect = stageRect();
          const px = pinch.cx - rect.left;
          const py = pinch.cy - rect.top;
          const ix = (px - pinch.x) / Math.max(0.0001, pinch.scale);
          const iy = (py - pinch.y) / Math.max(0.0001, pinch.scale);
          zoom.scale = Math.min(zoom.maxScale, Math.max(zoom.minScale, next));
          const ncx = cx - rect.left;
          const ncy = cy - rect.top;
          zoom.x = ncx - ix * zoom.scale;
          zoom.y = ncy - iy * zoom.scale;
          if (zoom.scale <= 1.02) {
            zoom.scale = 1;
            zoom.x = 0;
            zoom.y = 0;
          }
          applyZoom();
          e.preventDefault();
          return;
        }
        if (touchMode === "pan" && e.touches.length === 1 && panLast) {
          const t = e.touches[0];
          zoom.x += t.clientX - panLast.x;
          zoom.y += t.clientY - panLast.y;
          panLast = { x: t.clientX, y: t.clientY };
          applyZoom();
          e.preventDefault();
          return;
        }
        if (touchMode === "wipe" && e.touches.length === 1) {
          const t = e.touches[0];
          state.wipePos = wipePosFrom(t.clientX, t.clientY);
          applyWipe();
          e.preventDefault();
        }
      },
      { passive: false }
    );

    stage.addEventListener("touchend", (e) => {
      if (e.touches.length < 2) pinch = null;
      if (e.touches.length === 0) {
        touchMode = null;
        panLast = null;
      } else if (e.touches.length === 1) {
        // drop from pinch to pan
        touchMode = isZoomed() ? "pan" : state.mode === "wipe" ? "wipe" : "pan";
        panLast = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    });

    // fade slider should not trigger stage gestures
    $("#fade-slider").addEventListener(
      "touchstart",
      (e) => e.stopPropagation(),
      { passive: true }
    );
    $("#fade-slider").addEventListener(
      "mousedown",
      (e) => e.stopPropagation(),
      false
    );
  }

  function bindUI() {
    $$(".mode").forEach((btn) => {
      btn.addEventListener("click", () => setMode(btn.dataset.mode));
    });

    $("#fade-range").addEventListener("input", (e) => {
      state.fade = Number(e.target.value) / 100;
      applyFade();
    });

    $("#zoom-in").addEventListener("click", () => nudgeZoom(1.25));
    $("#zoom-out").addEventListener("click", () => nudgeZoom(1 / 1.25));
    $("#zoom-fit").addEventListener("click", zoomFit);
    $("#zoom-100").addEventListener("click", zoomTo100);

    window.addEventListener("keydown", (e) => {
      if (e.target.matches("input,textarea")) return;
      if (e.key === "1") setMode("split");
      else if (e.key === "2") setMode("wipe");
      else if (e.key === "3") setMode("fade");
      else if (e.key === "+" || e.key === "=") nudgeZoom(1.25);
      else if (e.key === "-" || e.key === "_") nudgeZoom(1 / 1.25);
      else if (e.key === "0") zoomTo100();
      else if (e.key === "f" || e.key === "F") zoomFit();
      else if (e.key === "Escape") zoomFit();
      else if (e.key === "ArrowLeft") {
        if (state.images.length < 2) return;
        if (state.images.length === 2) {
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
      if (!isZoomed()) {
        zoom.x = 0;
        zoom.y = 0;
        zoom.scale = 1;
      }
      applyZoom();
    });

    bindGestures();
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
      applyZoom();
      setTimeout(() => {
        const h = $("#zoom-hint");
        if (h) h.classList.add("fade-out");
      }, 4000);
    } catch (err) {
      showError(err.message || "加载失败");
    }
  }

  boot();
})();
