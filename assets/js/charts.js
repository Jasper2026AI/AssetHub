/* =========================================================
   AssetHub — 图表（纯 SVG 手写，无需任何第三方库，可离线运行）
   AVCharts.donut(el, segments, options)  圆环图
   AVCharts.line(el, config)              收支折线图
   ========================================================= */
(function () {
  'use strict';
  const prevDonut = {}; // 记录上一次圆环数据，用于平滑过渡动画

  /* ---------- 刻度计算 ---------- */
  function niceNum(x) {
    if (x <= 0) return 1;
    const e = Math.floor(Math.log10(x)), f = x / Math.pow(10, e);
    const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return nf * Math.pow(10, e);
  }
  /**
   * step = 'auto' 或 10 / 100 / 1000 …（刻度基本单位）
   * 网格线数量自动控制在 ~5 条以内，保证美观
   */
  function yScale(max, step, target) {
    target = target || 5;
    let interval;
    if (step === 'auto' || !step) {
      interval = niceNum((max || 100) / target);
    } else {
      step = +step;
      const mults = [1, 2, 2.5, 5];
      let p = 1, found = false;
      for (let guard = 0; guard < 20 && !found; guard++) {
        for (const m of mults) {
          const iv = step * m * p;
          if ((max || 0) / iv <= target) { interval = iv; found = true; break; }
        }
        p *= 10;
      }
    }
    const top = Math.max(interval, Math.ceil((max || 0) / interval) * interval);
    const ticks = [];
    for (let v = 0; v <= top + interval / 1e6; v += interval) ticks.push(+v.toFixed(8));
    return { top, interval, ticks };
  }

  /* ---------- 单调三次曲线（不会出现低于 0 的过冲） ---------- */
  function monotonePath(p) {
    const n = p.length;
    if (!n) return '';
    if (n === 1) return `M${p[0][0]},${p[0][1]}`;
    if (n === 2) return `M${p[0][0]},${p[0][1]}L${p[1][0]},${p[1][1]}`;
    const dx = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = p[i + 1][0] - p[i][0]; m[i] = (p[i + 1][1] - p[i][1]) / dx[i]; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
      const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
      if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
    }
    let d = `M${p[0][0]},${p[0][1]}`;
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += `C${p[i][0] + h},${p[i][1] + t[i] * h},${p[i + 1][0] - h},${p[i + 1][1] - t[i + 1] * h},${p[i + 1][0]},${p[i + 1][1]}`;
    }
    return d;
  }

  /* ---------- 圆环图 ---------- */
  function donut(el, segs, opt) {
    opt = opt || {};
    const id = opt.id || 'donut';
    const size = 230, sw = 22, c = size / 2, r = c - sw / 2 - 6, C = 2 * Math.PI * r;
    const total = segs.reduce((s, x) => s + Math.max(0, x.value), 0);
    const active = segs.filter(s => s.value > 0).length;
    const gap = active > 1 ? 3 : 0;
    const prev = prevDonut[id] || {};
    let off = 0, html = '';
    const finals = [];
    segs.forEach(s => {
      const v = Math.max(0, s.value), len = total ? (v / total) * C : 0, dash = Math.max(0, len - gap);
      const p = prev[s.key] || { dash: 0, off: -off };
      html += `<circle class="donut-seg" data-k="${s.key}" cx="${c}" cy="${c}" r="${r}" stroke="${s.color}" stroke-width="${sw}"
        style="stroke-dasharray:${p.dash} ${C};stroke-dashoffset:${p.off}" transform="rotate(-90 ${c} ${c})"></circle>`;
      finals.push({ key: s.key, dash, off: -off });
      off += len;
    });
    el.innerHTML = `<svg viewBox="0 0 ${size} ${size}"><circle class="donut-track" cx="${c}" cy="${c}" r="${r}" stroke-width="${sw}"></circle>${html}</svg><div class="donut-center"></div>`;
    const center = el.querySelector('.donut-center');
    const setCenter = k => { center.innerHTML = opt.center ? opt.center(k) : ''; };
    setCenter(null);
    // 下一帧过渡到新数值（产生“动态更新”的动画）
    requestAnimationFrame(() => requestAnimationFrame(() => {
      finals.forEach(f => {
        const n = el.querySelector(`[data-k="${f.key}"]`);
        if (n) { n.style.strokeDasharray = `${f.dash} ${C}`; n.style.strokeDashoffset = f.off; }
      });
    }));
    prevDonut[id] = Object.fromEntries(finals.map(f => [f.key, f]));

    const api = {
      hl(k) {
        el.querySelectorAll('.donut-seg').forEach(n => n.classList.toggle('hl', n.dataset.k === k));
        el.classList.toggle('hovering', !!k);
        setCenter(k);
        if (opt.onHover) opt.onHover(k);
      }
    };
    el.querySelectorAll('.donut-seg').forEach(n => {
      n.addEventListener('mouseenter', () => api.hl(n.dataset.k));
      n.addEventListener('mouseleave', () => api.hl(null));
      n.addEventListener('click', () => { if (opt.onClick) opt.onClick(n.dataset.k); else api.hl(n.classList.contains('hl') ? null : n.dataset.k); });
    });
    if (opt.onCenter) { center.classList.add('clickable'); center.addEventListener('click', opt.onCenter); }
    return api;
  }

  /* ---------- 折线图 ---------- */
  function line(el, cfg) {
    const W = Math.max(280, Math.floor(el.clientWidth || 600));
    const H = Math.max(180, Math.floor(el.clientHeight || 270));
    const { labels, series } = cfg;
    const n = labels.length;
    let max = 0;
    series.forEach(s => s.values.forEach(v => { if (v != null && v > max) max = v; }));
    const sc = yScale(max, cfg.step);
    const yl = sc.ticks.map(cfg.fmtY || String);
    const padL = Math.ceil(Math.max(...yl.map(s => s.length)) * 6.8) + 14, padR = 14, padT = 16, padB = 30;
    const pw = W - padL - padR, ph = H - padT - padB;
    const X = i => padL + (n === 1 ? pw / 2 : (i * pw) / (n - 1));
    const Y = v => padT + ph - (v / sc.top) * ph;
    const base = padT + ph;

    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>`;
    series.forEach((se, k) => {
      s += `<linearGradient id="lg${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${se.color}" stop-opacity=".28"/><stop offset="1" stop-color="${se.color}" stop-opacity="0"/></linearGradient>`;
    });
    s += `</defs>`;
    // 横向网格 + Y 轴标签
    sc.ticks.forEach((v, i) => {
      const y = Y(v);
      s += `<line class="gl ${i === 0 ? 'base' : ''}" x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}"/>`;
      s += `<text class="al" x="${padL - 10}" y="${y + 4}" text-anchor="end">${yl[i]}</text>`;
    });
    // X 轴标签（自动抽稀）
    const maxL = Math.max(2, Math.floor(pw / 44));
    const k = Math.ceil(n / maxL);
    labels.forEach((lb, i) => {
      if (i % k === 0 || (i === n - 1 && (n - 1) % k >= k / 2)) {
        s += `<text class="al" x="${X(i)}" y="${H - 8}" text-anchor="middle">${lb}</text>`;
      }
    });
    // 曲线 + 面积
    series.forEach((se, si) => {
      const pts = [];
      se.values.forEach((v, i) => { if (v != null) pts.push([X(i), Y(v)]); });
      if (!pts.length) return;
      const d = monotonePath(pts);
      s += `<path class="ar" d="${d}L${pts[pts.length - 1][0]},${base}L${pts[0][0]},${base}Z" fill="url(#lg${si})"/>`;
      s += `<path class="ln" d="${d}" stroke="${se.color}" pathLength="1"/>`;
      if (n <= 12) pts.forEach(p => { s += `<circle class="pt" cx="${p[0]}" cy="${p[1]}" r="3.6" stroke="${se.color}"/>`; });
    });
    // 悬停元素
    s += `<line class="guide" x1="0" x2="0" y1="${padT}" y2="${base}"/>`;
    series.forEach((se, si) => { s += `<circle class="hdot" data-s="${si}" r="5.5" fill="${se.color}" stroke="#0c0c0e" stroke-width="2.5" cx="-20" cy="-20"/>`; });
    s += `<rect class="ov" x="${padL - 10}" y="0" width="${pw + 20}" height="${H}" fill="transparent"/></svg>`;
    el.innerHTML = s + `<div class="chart-tip"></div>`;

    const tip = el.querySelector('.chart-tip'), guide = el.querySelector('.guide'), ov = el.querySelector('.ov');
    const dots = el.querySelectorAll('.hdot');
    const move = e => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      let i = n === 1 ? 0 : Math.round(((x - padL) / pw) * (n - 1));
      i = Math.max(0, Math.min(n - 1, i));
      if (series.every(se => se.values[i] == null)) { el.classList.remove('hover'); return; }
      el.classList.add('hover');
      const xi = X(i);
      guide.setAttribute('x1', xi); guide.setAttribute('x2', xi);
      let minY = base;
      dots.forEach(dn => {
        const v = series[+dn.dataset.s].values[i];
        if (v == null) { dn.setAttribute('cx', -20); return; }
        const y = Y(v); minY = Math.min(minY, y);
        dn.setAttribute('cx', xi); dn.setAttribute('cy', y);
      });
      tip.innerHTML = cfg.tip ? cfg.tip(i) : '';
      const tw = tip.offsetWidth || 160;
      const left = Math.max(tw / 2 + 4, Math.min(W - tw / 2 - 4, xi));
      tip.style.left = left + 'px';
      tip.style.top = Math.max(minY, tip.offsetHeight + 18) + 'px';
    };
    ov.addEventListener('pointermove', move);
    ov.addEventListener('pointerdown', move);
    ov.addEventListener('pointerleave', () => el.classList.remove('hover'));
  }

  /* ---------- K 线 / 实线图（总资产趋势） ----------
     cfg: { bars:[{label,o,h,l,c}], style:'candle'|'line', up, down, fmtY, tip(i),
            onPan(deltaBars), onZoom(dir) }  —— 后两个可选，用于日K拖动/缩放 */
  function candle(el, cfg) {
    const W = Math.max(280, Math.floor(el.clientWidth || 600));
    const H = Math.max(180, Math.floor(el.clientHeight || 270));
    const bars = cfg.bars, n = bars.length;
    if (!n) { el.innerHTML = ''; return; }
    let lo = Infinity, hi = -Infinity;
    bars.forEach(b => {
      const l = cfg.style === 'line' ? b.c : b.l, h = cfg.style === 'line' ? b.c : b.h;
      if (l < lo) lo = l; if (h > hi) hi = h;
    });
    if (hi === lo) { hi += Math.abs(hi) * 0.01 || 1; lo -= Math.abs(lo) * 0.01 || 1; }
    const step = niceNum((hi - lo) / 4);
    const y0 = Math.floor(lo / step) * step, y1 = Math.ceil(hi / step) * step;
    const ticks = [];
    for (let v = y0; v <= y1 + step / 1e6; v += step) ticks.push(+v.toFixed(8));
    const yl = ticks.map(cfg.fmtY || String);
    const padL = Math.ceil(Math.max(...yl.map(s => s.length)) * 6.8) + 14, padR = 14, padT = 16, padB = 30;
    const pw = W - padL - padR, ph = H - padT - padB;
    const bw = pw / n;
    const X = i => padL + bw * (i + 0.5);
    const Y = v => padT + ph - ((v - y0) / (y1 - y0)) * ph;
    const base = padT + ph;
    const first = bars[0].o, last = bars[n - 1].c;
    const trendC = last >= first ? cfg.up : cfg.down;

    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="kg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${trendC}" stop-opacity=".26"/><stop offset="1" stop-color="${trendC}" stop-opacity="0"/></linearGradient></defs>`;
    ticks.forEach((v, i) => {
      const y = Y(v);
      s += `<line class="gl ${i === 0 ? 'base' : ''}" x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}"/>`;
      s += `<text class="al" x="${padL - 10}" y="${y + 4}" text-anchor="end">${yl[i]}</text>`;
    });
    const maxL = Math.max(2, Math.floor(pw / 52)), k = Math.ceil(n / maxL);
    bars.forEach((b, i) => {
      if (i % k === 0) s += `<text class="al" x="${X(i)}" y="${H - 8}" text-anchor="middle">${b.label}</text>`;
    });
    if (cfg.style === 'line') {
      const pts = bars.map((b, i) => [X(i), Y(b.c)]);
      const d = monotonePath(pts);
      s += `<path class="ar" d="${d}L${pts[n - 1][0]},${base}L${pts[0][0]},${base}Z" fill="url(#kg)"/>`;
      s += `<path class="ln" d="${d}" stroke="${trendC}" pathLength="1"/>`;
    } else {
      const cw = Math.max(1, Math.min(18, bw * 0.64));
      s += `<g class="kbars">`;
      bars.forEach((b, i) => {
        const col = b.c >= b.o ? cfg.up : cfg.down, x = X(i);
        const yt = Y(Math.max(b.o, b.c)), yb = Y(Math.min(b.o, b.c));
        s += `<line x1="${x}" x2="${x}" y1="${Y(b.h)}" y2="${Y(b.l)}" stroke="${col}" stroke-width="1.2"/>`;
        s += `<rect x="${x - cw / 2}" y="${yt}" width="${cw}" height="${Math.max(1.2, yb - yt)}" rx="${cw > 6 ? 1.5 : 0}" fill="${col}"/>`;
      });
      s += `</g>`;
    }
    s += `<line class="guide" x1="0" x2="0" y1="${padT}" y2="${base}"/>`;
    s += `<circle class="hdot" r="5" fill="${trendC}" stroke="#0c0c0e" stroke-width="2.5" cx="-20" cy="-20"/>`;
    s += `<rect class="ov" x="${padL}" y="0" width="${pw}" height="${H}" fill="transparent" style="cursor:${cfg.onPan ? 'grab' : 'crosshair'}"/></svg>`;
    el.innerHTML = s + `<div class="chart-tip"></div>`;

    const tip = el.querySelector('.chart-tip'), guide = el.querySelector('.guide'), ov = el.querySelector('.ov'), dot = el.querySelector('.hdot');
    let dragX = null;
    const move = e => {
      const rect = el.getBoundingClientRect(), x = e.clientX - rect.left;
      if (dragX != null && cfg.onPan) { ov.style.cursor = 'grabbing'; el.classList.remove('hover'); return; }
      const i = Math.max(0, Math.min(n - 1, Math.floor((x - padL) / bw)));
      el.classList.add('hover');
      const xi = X(i), yc = Y(bars[i].c);
      guide.setAttribute('x1', xi); guide.setAttribute('x2', xi);
      dot.setAttribute('cx', xi); dot.setAttribute('cy', yc);
      tip.innerHTML = cfg.tip ? cfg.tip(i) : '';
      const tw = tip.offsetWidth || 160;
      tip.style.left = Math.max(tw / 2 + 4, Math.min(W - tw / 2 - 4, xi)) + 'px';
      tip.style.top = Math.max(Y(cfg.style === 'line' ? bars[i].c : bars[i].h), tip.offsetHeight + 18) + 'px';
    };
    ov.addEventListener('pointermove', move);
    ov.addEventListener('pointerleave', () => el.classList.remove('hover'));
    ov.addEventListener('pointerdown', e => { dragX = e.clientX; move(e); if (cfg.onPan) ov.setPointerCapture(e.pointerId); });
    ov.addEventListener('pointerup', e => {
      if (dragX != null && cfg.onPan) {
        const delta = Math.round((e.clientX - dragX) / bw);
        dragX = null; ov.style.cursor = 'grab';
        if (delta) cfg.onPan(delta);
      }
      dragX = null;
    });
    if (cfg.onZoom) {
      ov.addEventListener('wheel', e => { e.preventDefault(); cfg.onZoom(e.deltaY > 0 ? 1 : -1); }, { passive: false });
    }
  }

  window.AVCharts = { donut, line, candle, yScale };
})();
