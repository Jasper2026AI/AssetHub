/* =========================================================
   AssetHub — 行情 / 汇率 / 云同步接口
   全部为浏览器可直接调用（支持 CORS）的免费公开接口：

   汇率：
     · ExchangeRate-API 开放接口  https://open.er-api.com/v6/latest/USD   （免费、无需 Key）
     · Currency-API (jsDelivr CDN)  （免费、无需 Key，备用）
   加密货币（同时取“今日开盘价”用于计算当日盈亏）：
     · Binance Public API          https://api.binance.com/api/v3/ticker/tradingDay
     · Binance 行情镜像            https://data-api.binance.vision
     · OKX Public API              https://www.okx.com/api/v5/market/ticker
   股票 / 基金（需免费注册拿 Key，同时取昨收价）：
     · Finnhub / Twelve Data / Alpha Vantage
   黄金：
     · PAXG/USDT（1 PAXG = 1 金衡盎司伦敦金），无需 Key
   多端同步：
     · GitHub Gist API（私有 Gist）
   ========================================================= */
(function () {
  'use strict';

  async function fetchJSON(url, opts) {
    opts = opts || {};
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeout || 12000);
    try {
      const r = await fetch(url, Object.assign({}, opts, { signal: ctl.signal }));
      if (!r.ok) {
        let msg = 'HTTP ' + r.status;
        try { const j = await r.json(); msg += ' ' + (j.msg || j.message || j.error || ''); } catch (e) { /* ignore */ }
        throw new Error(msg.trim());
      }
      return await r.json();
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Timeout');
      throw e;
    } finally { clearTimeout(timer); }
  }

  /* ---------------- 汇率 ---------------- */
  const FX_SOURCES = {
    erapi: {
      name: 'ExchangeRate-API (open.er-api.com)',
      async fn() {
        const j = await fetchJSON('https://open.er-api.com/v6/latest/USD');
        if (j.result !== 'success') throw new Error(j['error-type'] || 'FX error');
        return j.rates;
      }
    },
    fawaz: {
      name: 'Currency-API (jsDelivr)',
      async fn() {
        let j;
        try { j = await fetchJSON('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json'); }
        catch (e) { j = await fetchJSON('https://latest.currency-api.pages.dev/v1/currencies/usd.min.json'); }
        const out = { USD: 1 };
        Object.keys(j.usd || {}).forEach(k => { out[k.toUpperCase()] = j.usd[k]; });
        return out;
      }
    }
  };
  async function fetchRates(src) {
    const order = [src].concat(Object.keys(FX_SOURCES).filter(k => k !== src)).filter(k => FX_SOURCES[k]);
    let err;
    for (const k of order) {
      try {
        const r = await FX_SOURCES[k].fn();
        if (r && r.CNY && r.HKD && r.TWD) return { rates: r, src: k };
      } catch (e) { err = e; }
    }
    throw err || new Error('FX error');
  }

  /* ---------------- 加密货币 ---------------- */
  const STABLE = ['USDT', 'USDC', 'FDUSD', 'BUSD', 'DAI', 'TUSD', 'USD1', 'USDP', 'PYUSD'];
  function cryptoPair(code) {
    const c = String(code || '').toUpperCase().replace(/[\s\-\/_]/g, '');
    if (!c) throw new Error('NEED_CODE');
    if (STABLE.includes(c)) return null;
    const m = c.match(/^(.+?)(USDT|USDC|FDUSD)$/);
    if (m) return { base: m[1], quote: m[2] };
    return { base: c, quote: 'USDT' };
  }
  // 浏览器所在时区（用于 Binance 交易日开盘价）
  function tzParam() {
    const off = -new Date().getTimezoneOffset();
    const h = Math.trunc(off / 60), m = Math.abs(off % 60);
    return m ? `${h}:${String(m).padStart(2, '0')}` : String(h);
  }
  async function binanceQuote(host, p) {
    const sym = p.base + p.quote;
    try {
      const j = await fetchJSON(`${host}/api/v3/ticker/tradingDay?symbol=${sym}&timeZone=${encodeURIComponent(tzParam())}`);
      return { price: +j.lastPrice, prev: +j.openPrice };
    } catch (e) {
      const j = await fetchJSON(`${host}/api/v3/ticker/24hr?symbol=${sym}`);
      return { price: +j.lastPrice, prev: +j.openPrice };
    }
  }
  const CRYPTO_SOURCES = {
    binance: { name: 'Binance Public API (api.binance.com)', fn: p => binanceQuote('https://api.binance.com', p) },
    binanceVision: { name: 'Binance Market Data (data-api.binance.vision)', fn: p => binanceQuote('https://data-api.binance.vision', p) },
    okx: {
      name: 'OKX Public API',
      async fn(p) {
        const j = await fetchJSON(`https://www.okx.com/api/v5/market/ticker?instId=${p.base}-${p.quote}`);
        if (j.code !== '0' || !j.data || !j.data.length) throw new Error(j.msg || 'Not found');
        const d = j.data[0], off = -new Date().getTimezoneOffset();
        const prev = off === 480 ? d.sodUtc8 : off === 0 ? d.sodUtc0 : d.open24h;
        return { price: +d.last, prev: +prev };
      }
    }
  };
  /** 返回 { price, prev }（USD 计价，prev = 今日开盘价） */
  async function cryptoQuote(code, src) {
    const p = cryptoPair(code);
    if (!p) return { price: 1, prev: 1 };
    const order = [src].concat(Object.keys(CRYPTO_SOURCES).filter(k => k !== src)).filter(k => CRYPTO_SOURCES[k]);
    let err;
    for (const k of order) {
      try { const v = await CRYPTO_SOURCES[k].fn(p); if (v.price > 0) return v; } catch (e) { err = e; }
    }
    throw err || new Error('Not found');
  }
  const cryptoPriceUSD = async (code, src) => (await cryptoQuote(code, src)).price;

  /* ---------------- 股票 / 基金 ---------------- */
  function stockCcy(code) {
    const c = String(code).toUpperCase();
    if (/\.HK$/.test(c)) return 'HKD';
    if (/\.(TW|TWO)$/.test(c)) return 'TWD';
    if (/\.(SS|SZ|SH)$/.test(c)) return 'CNY';
    return 'USD';
  }
  const STOCK_SOURCES = {
    finnhub: {
      name: 'Finnhub', keyField: 'finnhubKey', signup: 'https://finnhub.io/register',
      async fn(code, key) {
        const j = await fetchJSON(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(code)}&token=${encodeURIComponent(key)}`);
        if (!j || !j.c) throw new Error('No data');
        return { price: +j.c, prev: +j.pc || 0 };
      }
    },
    twelve: {
      name: 'Twelve Data', keyField: 'twelveKey', signup: 'https://twelvedata.com/register',
      async fn(code, key) {
        const j = await fetchJSON(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(code)}&apikey=${encodeURIComponent(key)}`);
        if (!j.close) throw new Error(j.message || 'No data');
        return { price: +j.close, prev: +j.previous_close || 0 };
      }
    },
    alphavantage: {
      name: 'Alpha Vantage', keyField: 'avKey', signup: 'https://www.alphavantage.co/support/#api-key',
      async fn(code, key) {
        const j = await fetchJSON(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(code)}&apikey=${encodeURIComponent(key)}`);
        const q = j['Global Quote'];
        if (!q || !q['05. price']) throw new Error(j.Note || j.Information || 'No data');
        return { price: +q['05. price'], prev: +q['08. previous close'] || 0 };
      }
    }
  };
  async function stockQuote(code, S) {
    code = String(code || '').trim().toUpperCase();
    if (!code) throw new Error('NEED_CODE');
    const order = [S.stockSrc].concat(Object.keys(STOCK_SOURCES).filter(k => k !== S.stockSrc))
      .filter(k => STOCK_SOURCES[k] && S[STOCK_SOURCES[k].keyField]);
    if (!order.length) throw new Error('NO_KEY');
    let err;
    for (const k of order) {
      try {
        const src = STOCK_SOURCES[k];
        const v = await src.fn(code, S[src.keyField]);
        if (v.price > 0) return Object.assign(v, { ccy: stockCcy(code) });
      } catch (e) { err = e; }
    }
    throw err || new Error('No data');
  }

  /* ---------------- 黄金 ---------------- */
  const OZ_G = 31.1034768;
  const GOLD_CODES = ['XAU', 'XAUUSD', 'PAXG', 'XAUT', '黄金', 'AU'];
  const isGold = code => GOLD_CODES.includes(String(code || '').trim().toUpperCase());

  /* ---------------- 统一报价入口 ---------------- */
  const tagsOf = a => (Array.isArray(a.cls) ? a.cls : [a.cls]);
  /** 判断资产用哪种行情：crypto / stock（含基金） / gold，返回 null 表示只能手动 */
  function quoteKind(a) {
    if (!a || !a.code) return null;
    const t = tagsOf(a);
    if (t.includes('crypto')) return 'crypto';
    if (t.includes('stock') || t.includes('fund')) return 'stock';
    if (isGold(a.code)) return 'gold';
    return null;
  }
  /** 返回 { price, prev, ccy }，价格为“每 1 单位资产”的报价，prev 为昨收/今开 */
  async function quoteAsset(a, S) {
    const k = quoteKind(a);
    if (k === 'crypto') return Object.assign(await cryptoQuote(a.code, S.cryptoSrc), { ccy: 'USD' });
    if (k === 'stock') return await stockQuote(a.code, S);
    if (k === 'gold') {
      const q = await cryptoQuote('PAXG', S.cryptoSrc);
      const unit = a.unit || 'oz';
      const f = unit === 'g' ? 1 / OZ_G : unit === 'kg' ? 1000 / OZ_G : 1;
      return { price: q.price * f, prev: q.prev * f, ccy: 'USD' };
    }
    throw new Error('MANUAL');
  }
  const canQuote = a => !!quoteKind(a);

  /* ---------------- GitHub Gist 同步 ---------------- */
  const GIST_FILE = 'assethub.json';
  function gistHeaders(token) {
    const h = { Accept: 'application/vnd.github+json' };
    if (token) h.Authorization = 'Bearer ' + token;
    return h;
  }
  async function gistPush(token, id, content, desc) {
    const body = { description: desc || 'AssetHub data', files: { [GIST_FILE]: { content } } };
    const headers = Object.assign(gistHeaders(token), { 'Content-Type': 'application/json' });
    let j;
    if (id) j = await fetchJSON(`https://api.github.com/gists/${encodeURIComponent(id)}`, { method: 'PATCH', headers, body: JSON.stringify(body), timeout: 20000 });
    else { body.public = false; j = await fetchJSON('https://api.github.com/gists', { method: 'POST', headers, body: JSON.stringify(body), timeout: 20000 }); }
    return j.id;
  }
  async function gistPull(token, id) {
    const j = await fetchJSON(`https://api.github.com/gists/${encodeURIComponent(id)}`, { headers: gistHeaders(token), timeout: 20000 });
    const f = j.files && (j.files[GIST_FILE] || j.files['assetview.json'] || Object.values(j.files)[0]);
    if (!f) throw new Error('Empty gist');
    if (f.truncated && f.raw_url) { const r = await fetch(f.raw_url); return await r.text(); }
    return f.content;
  }

  window.AVApi = {
    FX_SOURCES, CRYPTO_SOURCES, STOCK_SOURCES,
    fetchRates, cryptoQuote, cryptoPriceUSD, stockQuote, stockCcy, quoteAsset, quoteKind, canQuote, isGold, OZ_G,
    gistPush, gistPull
  };
})();
