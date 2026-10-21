/* =========================================================
   AssetHub — 主程序
   结构：
     1. 常量与配置（颜色、币种、类别、分类…想改的基本都在这里）
     2. 数据存储（localStorage）与每日快照
     3. 工具函数（格式化、汇率换算、盈亏统计）
     4. 页面渲染：顶栏 / 目录 / 指标卡 / 四个页面
     5. 弹窗：记一笔、资产、确认框、密码、日期选择
     6. 行情刷新、导入导出、云同步、演示数据
     7. 事件绑定与启动
   ========================================================= */
(function () {
  'use strict';
  const I18N = window.AV_I18N, Charts = window.AVCharts, Api = window.AVApi;

  /* ============ 1. 常量与配置 ============ */
  const STORE_KEY = 'assethub.data.v1';
  const LEGACY_KEYS = ['assetview.data.v1'];                      // 旧版本数据自动迁移
  const DISPLAY_CCYS = ['USD', 'CNY', 'HKD', 'TWD', 'TRY'];
  const CCY_SYM = { USD: '$', CNY: '¥', HKD: 'HK$', TWD: 'NT$', TRY: '₺', EUR: '€', JPY: 'JP¥', GBP: '£', KRW: '₩' };
  const CCY_SHORT = { USD: 'USD', CNY: 'CNY', HKD: 'HKD', TWD: 'NTD', TRY: 'TRY' };
  const FALLBACK_RATES = { USD: 1, CNY: 7.12, HKD: 7.78, TWD: 30.5, TRY: 42, EUR: 0.86, JPY: 148, GBP: 0.75, SGD: 1.29, AUD: 1.52, CAD: 1.38, KRW: 1380 };
  // 资产类别（可多选；第一个选中的为“主类别”，用于占比图，避免重复计算）
  const CLASSES = ['stock', 'crypto', 'gold', 'fund', 'cash', 'liability', 'physical', 'other'];
  const CLASS_COLOR = { stock: '#0A84FF', crypto: '#FF9000', gold: '#FFD60A', fund: '#30B0C7', cash: '#BF5AF2', liability: '#8E8E93', physical: '#AC8E68', other: '#5E5CE6' };
  /** 资产类别列表（内置类别可改名 / 改颜色 / 排序；自定义类别 x… 还可以删除），随账本云同步：[{ k, n: 名称（空 = 默认）, c: 颜色 }] */
  function clsList() {
    const m = DB.meta;
    if (!Array.isArray(m.assetCls)) m.assetCls = CLASSES.map(k => ({ k, n: '', c: '' }));
    CLASSES.forEach(k => { if (!m.assetCls.some(x => x.k === k)) m.assetCls.push({ k, n: '', c: '' }); });
    DB.assets.forEach(a => (Array.isArray(a.cls) ? a.cls : [a.cls]).forEach(c => { if (c && !m.assetCls.some(x => x.k === c)) m.assetCls.push({ k: c, n: '', c: '' }); }));
    return m.assetCls;
  }
  const clsKeys = () => clsList().map(x => x.k);
  const clsItem = c => (DB.meta.assetCls || []).find(y => y.k === c);
  const clsName = c => { const x = clsItem(c); return (x && x.n) || (CLASSES.includes(c) ? t('cls_' + c) : c); };
  const clsColor = c => { const x = clsItem(c); return x && x.c ? x.c : (CLASS_COLOR[c] || CLS_EXTRA[[...String(c)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % CLS_EXTRA.length]); };
  const CLS_EXTRA = ['#FF375F', '#30D158', '#64D2FF', '#FF6B3D', '#66D4CF', '#FF6482', '#32ADE6'];
  /** 仓库列表（预设 + 用到的，顺序 = 筛选 / 下拉 / 分组顺序），随账本云同步 */
  function whList() {
    const m = DB.meta;
    if (!Array.isArray(m.whs)) m.whs = WAREHOUSE_PRESETS.slice();
    DB.assets.forEach(a => { if (a.warehouse && !m.whs.includes(a.warehouse)) m.whs.push(a.warehouse); });
    return m.whs;
  }
  const whOrd = w => { const i = (DB.meta.whs || []).indexOf(w); return i < 0 ? 1e9 : i; };
  const PNL_CLASSES = ['stock', 'crypto', 'gold', 'fund'];        // 总览第二、三行指标卡
  const EXP_CATS = ['food', 'daily', 'transport', 'housing', 'leisure', 'digital', 'subscription', 'medical', 'social', 'investLoss', 'otherExp'];
  const INC_CATS = ['salary', 'bonus', 'invest', 'parttime', 'gift', 'refund', 'otherInc'];
  const CAT_ICON = {
    food: '🍜', daily: '🛒', transport: '🚇', housing: '🏠', leisure: '🎮', digital: '💻', subscription: '🔁', medical: '💊', social: '🎁', investLoss: '📉', otherExp: '📦',
    transfer: '🔄', salary: '💼', bonus: '🏆', invest: '📈', parttime: '🧑‍💻', gift: '🧧', refund: '↩️', otherInc: '💰'
  };
  const DEFAULT_LOGO = 'assets/img/logo/C.svg';   // 默认品牌图标（木牛 · 单色剪影）
  // 可选的木牛图标样式（设置 → 外观）：C 默认，wood = 原版木雕照片
  const LOGO_STYLES = ['C', 'D', 'B', 'E', 'A', 'wood'];
  const logoKey = () => (LOGO_STYLES.includes(DB.meta.logo) ? DB.meta.logo : 'C');
  const logoOf = k => (k === 'wood' ? 'assets/img/logo/wood.png' : `assets/img/logo/${k}.svg`);
  const logoSrc = () => DB.meta.icon || logoOf(logoKey());
  /** 浏览器标签页图标、iPhone“添加到主屏幕”图标跟着所选样式走 */
  function applyLogoLinks() {
    const k = logoKey(), fav = document.querySelector('link[rel="icon"]'), touch = document.querySelector('link[rel="apple-touch-icon"]');
    if (fav) { fav.href = DB.meta.icon || logoOf(k); fav.type = DB.meta.icon || k === 'wood' ? 'image/png' : 'image/svg+xml'; }
    if (touch) touch.href = `assets/img/logo/touch-${k}.png`;
  }
  const WAREHOUSE_PRESETS = ['Binance', 'BIT', 'OKX', 'Bitget Wallet', 'fomo', '支付宝', '微信', '招商银行卡', '建设银行卡', '中国银行卡', '农业银行卡'];
  const PNL_STYLES = {
    ios: { up: '#30D158', down: '#FF453A' },
    classic: { up: '#22C55E', down: '#EF4444' },
    soft: { up: '#63E6A4', down: '#FF8A80' },
    neon: { up: '#00F5A0', down: '#FF2E63' },
    mint: { up: '#34C3A6', down: '#F2546B' },
    gold: { up: '#FFD60A', down: '#BF5AF2' },
    ocean: { up: '#0A84FF', down: '#FF9F0A' },
    sakura: { up: '#5AC8FA', down: '#FF6B9D' },
    mono: { up: '#F5F5F7', down: '#8E8E93' },
    custom: { up: '#30D158', down: '#FF453A' }      // 自定义：实际颜色取设置里的 pnlUp / pnlDown
  };
  /** 当前配色（自定义时读取设置里的两个颜色） */
  const pnlPair = k => (k === 'custom' ? { up: S().pnlUp || '#30D158', down: S().pnlDown || '#FF453A' } : PNL_STYLES[k] || PNL_STYLES.ios);
  const PAGES = [
    { id: 'overview', icon: 'pie', k: 'navOverview' },
    { id: 'holdings', icon: 'trend', k: 'navHoldings' },
    { id: 'ledger', icon: 'receipt', k: 'navLedger' },
    { id: 'subs', icon: 'repeat', k: 'navSubs' },
    { id: 'settings', icon: 'sliders', k: 'navSettings' }
  ];
  const APP_VER = '8.0';   // 显示在页脚，方便确认手机 / 电脑是不是最新版
  const API_KEYS = ['finnhubKey', 'twelveKey', 'avKey'];   // 行情 API Key：随加密云端同步
  const SECRET_KEYS = ['devId', 'lastPush', 'finnhubKey', 'twelveKey', 'avKey', 'gistToken', 'passHash', 'syncedStamp', 'syncKey', 'syncSalt', 'syncIter', 'syncKeyPrev', 'passChangedAt', 'keysAt', 'snapsGist'];
  const K_SPANS = { '1M': 31, '3M': 92, '6M': 183, '1Y': 366, ALL: 1e9 };

  const ICON = {
    user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c.9-3.6 3.9-5.6 7.5-5.6s6.6 2 7.5 5.6"/>',
    globe: '<circle cx="12" cy="12" r="8.8"/><path d="M3.4 12h17.2M12 3.2c2.4 2.5 3.6 5.4 3.6 8.8s-1.2 6.3-3.6 8.8c-2.4-2.5-3.6-5.4-3.6-8.8s1.2-6.3 3.6-8.8z"/>',
    copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.6"/><path d="M15.5 8.5V6.6A2.6 2.6 0 0 0 12.9 4H6.6A2.6 2.6 0 0 0 4 6.6v6.3a2.6 2.6 0 0 0 2.6 2.6h1.9"/>',
    ext: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
    repeat: '<path d="M17 3l3.5 3.5L17 10"/><path d="M4 11.5V10a3.5 3.5 0 0 1 3.5-3.5h13"/><path d="M7 21l-3.5-3.5L7 14"/><path d="M20 12.5V14a3.5 3.5 0 0 1-3.5 3.5h-13"/>',
    logo: '<path d="M4 17.5l5.2-6.2 4.1 3.6L20 6.5"/><path d="M15 6.5h5v5"/>',
    pie: '<path d="M21 12.5A9 9 0 1 1 11.5 3v9.5z"/><path d="M14.5 2.8A9 9 0 0 1 21.2 9.5h-6.7z"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6"/><path d="M20.5 3.5v5h-5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2.5"/><path d="M8.5 20h7M12 16v4"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.8"/><path d="M11 18.5h2"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    'chev-r': '<path d="M9 6l6 6-6 6"/>',
    'chev-l': '<path d="M15 6l-6 6 6 6"/>',
    'chev-d': '<path d="M6 9l6 6 6-6"/>',
    'chev-u': '<path d="M6 15l6-6 6 6"/>',
    archive: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4"/>',
    unarchive: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9M12 17v-5M9.5 14.5 12 12l2.5 2.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    wallet: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M16 15h2"/><path d="M6 6l9-3 1.5 3"/>',
    in: '<path d="M12 4v12M6 10l6 6 6-6"/><path d="M5 20h14"/>',
    out: '<path d="M12 20V8M6 14l6-6 6 6"/><path d="M5 4h14"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>',
    upload: '<path d="M12 20V9M7 14l5-5 5 5"/><path d="M5 4h14"/>',
    cloud: '<path d="M7 18a4.5 4.5 0 0 1-.5-9A6 6 0 0 1 18 8.5a4.5 4.5 0 0 1-.5 9.5z"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    db: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.2-1-1.6-1-2.6 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10" cy="7" r="1.2"/><circle cx="15" cy="7" r="1.2"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    unlock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.8"/>',
    shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.4-7.5 9.5-4.3-1.1-7.5-4.9-7.5-9.5V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
    select: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8 12.2l2.8 2.8L16.5 9"/>',
    sort: '<path d="M7 4v16M3.5 16.5L7 20l3.5-3.5M17 20V4M13.5 7.5L17 4l3.5 3.5"/>',
    candle: '<path d="M7 3v4M7 17v4M17 3v6M17 15v6"/><rect x="4.5" y="7" width="5" height="10" rx="1"/><rect x="14.5" y="9" width="5" height="6" rx="1"/>',
    linechart: '<path d="M3 17l5-6 4 3 4-6 5 4"/><path d="M3 21h18"/>',
    cloudsync: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 17.8 8.6 4.5 4.5 0 0 1 17.5 18.5z"/><path d="M9.5 13.2a2.6 2.6 0 0 1 4.4-1.4l.6.6M14.5 10.6v1.8h-1.8"/><path d="M14.5 14.8a2.6 2.6 0 0 1-4.4 1.4l-.6-.6M9.5 17.4v-1.8h1.8"/>',
    sortdesc: '<path d="M4 6h16M4 12h11M4 18h6"/><path d="M19 13v7M16.5 17.5L19 20l2.5-2.5"/>',
    sortasc: '<path d="M4 6h6M4 12h11M4 18h16"/><path d="M19 11V4M16.5 6.5L19 4l2.5 2.5"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    swap: '<path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
    sync: '<path d="M4.5 12a7.5 7.5 0 0 1 12.9-5.2L20 9"/><path d="M20 4v5h-5"/><path d="M19.5 12a7.5 7.5 0 0 1-12.9 5.2L4 15"/><path d="M4 20v-5h5"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M4 4l16 16"/><path d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5C18 5.5 21.5 12 21.5 12a17 17 0 0 1-3.2 4M6.6 7.4C3.9 9.2 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'
  };
  const ic = (name, cls) => `<svg class="i ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name] || ''}</svg>`;

  /* ============ 2. 数据存储 ============ */
  function defaultSettings() {
    return {
      lang: 'zh', ccy: 'USD', layout: 'desktop',
      pnlStyle: 'ios', pnlSwap: false,
      cryptoSrc: 'binance', goldSrc: 'goldapi', stockSrc: 'finnhub', finnhubKey: '', twelveKey: '', avKey: '',
      fxSrc: 'erapi', autoRefresh: 5,
      trendMode: 'asset', chartRange: 'month', yStep: 'auto',
      assetRange: 'day', kSpan: '1M', kStyle: 'line', rankCls: 'all', moveCls: 'all', rankSort: 'desc', moveSort: 'desc', rankMode: 'day', leftMode: 'alloc',
      gistToken: '', gistId: '', gistLast: 0,
      passHash: '', lockMinutes: 5, hideAmt: false,
      autoSync: true, syncedStamp: 0
    };
  }
  function defaultDB() {
    return {
      app: 'AssetHub', version: 2,
      meta: { name: '', subtitle: '', icon: '' },
      settings: defaultSettings(),
      rates: { rates: Object.assign({}, FALLBACK_RATES), ts: 0, src: '' },
      lastQuote: 0, assets: [], txs: [], subs: [], snaps: {}
    };
  }
  /** 旧版单一类别 → 新版多选类别 */
  function migrateAsset(a) {
    if (!Array.isArray(a.cls)) {
      const c = a.cls;
      if (c === 'realestate') a.cls = Api.isGold(a.code) ? ['gold', 'physical'] : ['physical'];
      else a.cls = CLASSES.includes(c) ? [c] : ['other'];
    }
    a.cls = a.cls.filter(c => CLASSES.includes(c) || /^x[a-z0-9]{6,}$/.test(c));   // x… = 自定义类别
    if (!a.cls.length) a.cls = ['other'];
    if (a.warehouse == null) a.warehouse = '';
    // v5.3：类别里含现金 / 负债的多类别资产改为“余额”填写；把原来的 数量 × 单价 折成余额，市值不变
    const t2 = a.cls, hasB = t2.some(c => c === 'cash' || c === 'liability'), allB = t2.every(c => c === 'cash' || c === 'liability');
    if (hasB && !allB && !a.balConv) {
      const p = +a.price || 0;
      if (p > 0 && p !== 1) a.qty = Math.round((+a.qty || 0) * p * 1e8) / 1e8;
      a.price = 1; a.cost = 1; a.source = 'manual'; a.noQty = false; a.balConv = true;
    }
    return a;
  }
  function migrate(d) {
    const def = defaultDB();
    d = d && typeof d === 'object' ? d : {};
    d.app = 'AssetHub'; d.version = 2;
    d.meta = Object.assign(def.meta, d.meta || {});
    if (d.meta.name) d.meta.name = d.meta.name.replace(/AssetView/g, 'AssetHub');
    d.settings = Object.assign(def.settings, d.settings || {});
    d.rates = d.rates && d.rates.rates ? d.rates : def.rates;
    d.rates.rates = Object.assign({}, FALLBACK_RATES, d.rates.rates);
    d.lastQuote = +d.lastQuote || 0;
    d.assets = (Array.isArray(d.assets) ? d.assets.filter(a => a && a.id) : []).map(migrateAsset);
    d.txs = Array.isArray(d.txs) ? d.txs.filter(x => x && x.id && x.date) : [];
    d.subs = Array.isArray(d.subs) ? d.subs.filter(x => x && x.id) : [];
    d.snaps = d.snaps && typeof d.snaps === 'object' ? d.snaps : {};
    d.audit = Array.isArray(d.audit) ? d.audit : [];
    if (!['day', 'total'].includes(d.settings.rankMode)) d.settings.rankMode = 'day';
    if (!d.settings.v21) { d.settings.trendMode = 'asset'; d.settings.v21 = true; }   // v2.1：资产趋势改为默认
    if (!d.settings.v50) { Object.assign(d.settings, { assetRange: 'day', kSpan: '1M', kStyle: 'line', v50: true }); }   // v5.0：资产趋势默认 日 · 1M · 实线
    return d;
  }
  function load() {
    try {
      let raw = localStorage.getItem(STORE_KEY);
      if (!raw) for (const k of LEGACY_KEYS) { raw = localStorage.getItem(k); if (raw) break; }
      return raw ? migrate(JSON.parse(raw)) : null;
    } catch (e) { return null; }
  }
  function save() {
    recordSnap();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(DB)); }
    catch (e) { toast(t('saveFail'), 'err'); }
  }

  /* ---- 多端同步（GitHub Gist） ----
     DB.meta.updatedAt：本机资产 / 记账最后一次被修改的时间
     S().syncedStamp：最近一次与云端一致时的版本时间
     本机有改动 = updatedAt > syncedStamp；云端有改动 = 云端 updatedAt > syncedStamp */
  function markDirty() { DB.meta.updatedAt = Date.now(); }
  /** 用户数据（资产 / 记账 / 账本信息）发生变化时调用：保存 + 稍后自动同步 */
  function commit() { markDirty(); save(); scheduleSync(); }
  /* ---- 操作记录 ----
     每条资产 / 记账自带 log：[{ts, act, diffs:[[字段, 旧值, 新值]], extra}]
     DB.audit 为全局操作日志（含已删除的记录），最多保留 2000 条 */
  const ASSET_FIELDS = ['name', 'code', 'cls', 'warehouse', 'ccy', 'qty', 'cost', 'price', 'unit', 'source', 'note', 'locked', 'balMode'];
  const TX_FIELDS = ['date', 'type', 'cat', 'amount', 'ccy', 'accountId', 'toId', 'toAmount', 'fee', 'feeId', 'subId', 'note'];
  const same = (x, y) => JSON.stringify(x == null ? '' : x) === JSON.stringify(y == null ? '' : y);
  function diffOf(oldR, newR, fields) {
    const d = [];
    fields.forEach(f => { if (!same(oldR[f], newR[f])) d.push([f, oldR[f] == null ? '' : oldR[f], newR[f] == null ? '' : newR[f]]); });
    return d;
  }
  function logOp(kind, rec, act, diffs, extra) {
    const e = { ts: Date.now(), act };
    if (diffs && diffs.length) e.diffs = diffs;
    if (extra) e.extra = extra;
    if (rec) {
      rec.log = rec.log || [];
      rec.log.push(e);
      if (rec.log.length > 200) rec.log.splice(0, rec.log.length - 200);
    }
    DB.audit = DB.audit || [];
    DB.audit.push(Object.assign({ kind, id: rec ? rec.id : '', name: rec ? recTitle(kind, rec) : '' }, e));
    if (DB.audit.length > 2000) DB.audit.splice(0, DB.audit.length - 2000);
  }
  function recTitle(kind, r) {
    if (kind === 'asset' || kind === 'sub') return r.name || r.code || '';
    return `${r.date || ''} ${r.type === 'transfer' ? t('transfer') : catName(r.cat)} ${r.fromUnit || r.ccy || ''} ${trim8(r.amount || 0)}`;
  }
  /** 记录一次操作前后所有现金 / 负债账户的余额变化（记账同步、转账引起的） */
  function balSnapshot() { const m = {}; DB.assets.forEach(a => { m[a.id] = { q: +a.qty || 0, c: +a.cost || 0 }; }); return m; }
  function logBalChanges(before, txRec, act) {
    DB.assets.forEach(a => {
      const b = before[a.id]; if (b == null) return;
      const q = +a.qty || 0, c = +a.cost || 0, d = [];
      if (Math.abs(q - b.q) > 1e-9) d.push(['qty', b.q, q]);
      if (!isBalance(a) && Math.abs(c - b.c) > 1e-9) d.push(['cost', b.c, c]);
      if (d.length) logOp('asset', a, 'balByTx', d, { tx: txRec ? recTitle('tx', txRec) : '', txAct: act });
    });
  }
  const syncReady = () => !!(S().gistToken && S().gistId);
  const SYNC = { busy: false, state: 'idle', timer: null, lastErr: '', lastCheck: 0 };
  function scheduleSync() {
    if (!S().autoSync || !syncReady()) { renderSyncBtn(); return; }
    clearTimeout(SYNC.timer);
    SYNC.timer = setTimeout(() => syncNow({ silent: true }), 10000);   // 停止操作 10 秒后再上传，减少 Gist 版本数
    renderSyncBtn();
  }
  /** 合并每日快照（同一个账本的几台设备之间）：同一天整份采用“最后记录”的那一份（价格、余额、日盈亏、当天总资产一起），
      最高 / 最低取两边的最大 / 最小；今天的“今日起点”（po / bo）以本机为准。这样几台设备的历史记录完全一致。
      返回 { changed: 本机有变化, needPush: 本机有云端没有 / 比云端新的过去记录 } */
  function mergeSnaps(cs) {
    cs = cs || {};
    const tk = todayKey(), num = v => typeof v === 'number' && isFinite(v), since = DB.meta.since || '';
    const sig0 = JSON.stringify(DB.snaps);
    let changed = false, needPush = false;
    Object.keys(cs).forEach(k => {
      const c = cs[k], l = DB.snaps[k];
      if (!c || (since && k < since)) return;   // 新建账本之前的记录不属于这个账本
      if (!l) { DB.snaps[k] = JSON.parse(JSON.stringify(c)); changed = true; return; }
      const hi = Math.max(num(l.h) ? l.h : -Infinity, num(c.h) ? c.h : -Infinity), lo = Math.min(num(l.l) ? l.l : Infinity, num(c.l) ? c.l : Infinity);
      if ((c.dt || 0) > (l.dt || 0)) {
        const m = JSON.parse(JSON.stringify(c));
        ['p', 'b', 'd', 'tp', 'pc'].forEach(f => { if (m[f] == null && l[f] != null) m[f] = l[f]; });
        if (k === tk) { m.po = Object.assign({}, c.po, l.po); m.bo = Object.assign({}, c.bo, l.bo); }
        if (isFinite(hi)) m.h = hi; if (isFinite(lo)) m.l = lo;
        DB.snaps[k] = m; changed = true;
      } else {
        if (isFinite(hi) && hi !== l.h) { l.h = hi; changed = true; }
        if (isFinite(lo) && lo !== l.l) { l.l = lo; changed = true; }
        ['p', 'b', 'd', 'tp', 'pc'].forEach(f => { if (l[f] == null && c[f] != null) { l[f] = JSON.parse(JSON.stringify(c[f])); changed = true; } });
        if (k < tk && (l.dt || 0) > (c.dt || 0)) needPush = true;
      }
    });
    Object.keys(DB.snaps).forEach(k => { if (k < tk && !cs[k]) needPush = true; });
    if (changed) { pruneSnaps(); changed = JSON.stringify(DB.snaps) !== sig0; }   // 合并进来又会被清理掉的明细不算变化，避免每次同步都重绘
    return { changed, needPush };
  }
  /** 把云端的数据套用到本机：只替换资产、记账、账本信息，设备自己的设置（布局、配色、密码等）保持不变 */
  function applyCloud(obj) {
    backupNow('pull');
    const c = migrate(JSON.parse(JSON.stringify(obj)));
    DB.assets = c.assets; DB.txs = c.txs; DB.subs = c.subs || [];
    DB.meta = Object.assign({}, DB.meta, { name: c.meta.name, subtitle: c.meta.subtitle, icon: c.meta.icon, logo: c.meta.logo || '', subCats: c.meta.subCats || DB.meta.subCats, assetCls: c.meta.assetCls || DB.meta.assetCls, whs: c.meta.whs || DB.meta.whs, updatedAt: c.meta.updatedAt || 0, demo: c.meta.demo, since: c.meta.since || '' });
    // 每日快照：同一个 Gist 的两台设备互相合并；换了 Gist（另一个账本）就直接用云端的，不把旧账本的历史带进来
    const sameBook = S().snapsGist === S().gistId;
    if (sameBook) mergeSnaps(c.snaps); else DB.snaps = c.snaps || {};
    const seen = new Set(), merged = [];
    (sameBook ? DB.audit || [] : []).concat(obj.audit || []).sort((x, y) => x.ts - y.ts).forEach(e => { const k = e.ts + e.kind + e.id + e.act; if (!seen.has(k)) { seen.add(k); merged.push(e); } });
    DB.audit = merged.slice(-2000);
    S().snapsGist = S().gistId;
    pruneSnaps();
    S().syncedStamp = c.meta.updatedAt || 0;
  }
  /** 合并行情 API Key（每次同步都做，和资产数据谁新谁旧无关）：
      本机没填而云端有 → 用云端；两边都有 → 以最后修改的为准。返回 true 表示本机的 Key 更新，需要上传 */
  function mergeKeys(cloud) {
    const ak = cloud.apiKeys || {}, cAt = +ak.at || 0, lAt = S().keysAt || 0;
    let changed = false, needPush = false;
    API_KEYS.forEach(k => {
      const lv = S()[k] || '', cv = ak[k] || '';
      if (lv === cv) return;
      if ((!lv && cv) || (cAt > lAt && (cv || cAt))) { S()[k] = cv; changed = true; }
      else needPush = true;
    });
    if (changed && cAt > lAt) S().keysAt = cAt;
    if (changed) save();
    return needPush;
  }
  async function pushCloud(interactive) {
    await ensureSyncKey(interactive);
    const body = await encodeCloud(JSON.stringify(exportable(true)));
    SYNC.phase = 'push';    // 加密后再上传（含行情 API Key）
    const id = await Api.gistPush(S().gistToken, S().gistId, body, `AssetHub · ${bookName()}`);
    const pm = Api.gistPush.meta || {};
    S().lastPush = { at: pm.updated || '', ver: pm.version || '', ts: Date.now() };
    S().gistId = id; S().snapsGist = id; S().syncedStamp = DB.meta.updatedAt || 0; S().gistLast = Date.now();
  }
  /* ================= 同步加密 =================
     云端 Gist 只保存密文 {assethub:'enc1', salt, iter, iv, data}：锁定密码 → PBKDF2 → AES-GCM。
     本机只保存派生出的密钥（syncKey），不保存密码，也不导出、不同步。
     新设备第一次拉取时输入一次密码，解密成功后本机锁定密码自动改成同一个 —— 即“密码多端同步”。 */
  const ENC_ITER = 200000;
  const b64 = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));
  async function deriveKeyRaw(pw, saltB64, iter) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
    return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(saltB64), iterations: iter || ENC_ITER, hash: 'SHA-256' }, base, 256));
  }
  const aesKey = raw => crypto.subtle.importKey('raw', unb64(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
  async function setSyncKey(pw) {
    const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
    S().syncKey = await deriveKeyRaw(pw, salt, ENC_ITER); S().syncSalt = salt; S().syncIter = ENC_ITER;
  }
  // gzip 压缩（浏览器支持时）→ 加密 → base64 分行保存：体积约为原来的 1/5，且不会出现超长单行
  // 压缩 / 解压优先用打包进来的 pako（各浏览器结果一致）；浏览器自带的 CompressionStream 在部分 iPhone 上处理大数据会出错
  const hasStreams = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
  const canZip = () => !!window.pako || hasStreams();
  async function streamZip(bytes, mode) {
    const st = new Blob([bytes]).stream().pipeThrough(mode === 'gzip' ? new CompressionStream('gzip') : new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(st).arrayBuffer());
  }
  async function zipBytes(bytes, mode) {
    if (mode === 'gzip') return window.pako ? window.pako.gzip(bytes) : streamZip(bytes, 'gzip');
    if (window.pako) { try { return window.pako.ungzip(bytes); } catch (e) { if (!hasStreams()) throw e; } }   // 解压失败再换一种方式试
    return streamZip(bytes, 'gunzip');
  }
  /** 本设备的名字和编号（写进云端数据的明文头，方便看出是哪台设备上传的；不包含任何个人数据） */
  function devInfo() {
    if (!S().devId) { S().devId = Math.random().toString(36).slice(2, 6); }
    const ua = navigator.userAgent || '', tp = navigator.maxTouchPoints > 1;
    const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && tp) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Linux';
    const app = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    return { id: S().devId, name: `${os} ${app ? 'App' : (/Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'Web')}` };
  }
  async function encodeCloud(text) {
    const dv = devInfo();
    // 上传前先在本机解开一遍核对：读回来和原文一模一样才上传；压缩版核对不通过就改传不压缩的
    for (const z of canZip() ? [true, false] : [false]) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      let bytes = new TextEncoder().encode(text);
      if (z) bytes = await zipBytes(bytes, 'gzip');
      const ct = b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(S().syncKey), bytes));
      const lines = ct.match(/.{1,100}/g) || [''];
      const head = { assethub: 'enc1', salt: S().syncSalt, iter: S().syncIter || ENC_ITER, pc: S().passChangedAt || 0, z: z ? 'gzip' : '', iv: b64(iv), dev: dv.id, dn: dv.name, ts: Date.now() };
      let ok = false;
      try { ok = (await decryptWith(S().syncKey, Object.assign({}, head, { data: lines }))) === text; } catch (e) { ok = false; }
      if (ok) return JSON.stringify(head).slice(0, -1) + ',"data":[\n' + lines.map(l => JSON.stringify(l)).join(',\n') + '\n]}';
    }
    throw new Error('ENC_VERIFY');
  }
  /** 解密：密钥不对抛 KEY；密钥对了但解压 / 读取失败抛 CORRUPT（不是密码问题，不该再要密码） */
  async function decryptWith(raw, env) {
    const data = Array.isArray(env.data) ? env.data.join('') : env.data;
    let pt;
    try { pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, await aesKey(raw), unb64(data))); }
    catch (e) { throw new Error('KEY'); }
    try {
      if (env.z === 'gzip') pt = await zipBytes(pt, 'gunzip');
      return new TextDecoder().decode(pt);
    } catch (e) { throw new Error('CORRUPT'); }
  }
  /** 用某个密钥打开云端数据：密钥不对返回 null；数据坏了抛 CORRUPT */
  async function openWith(raw, env) {
    let txt;
    try { txt = await decryptWith(raw, env); } catch (e) { if (e.message === 'KEY') return null; throw e; }
    try { return JSON.parse(txt); } catch (e) { throw new Error('CORRUPT'); }
  }
  const isEnc = o => !!(o && o.assethub === 'enc1' && o.data);
  /** 上传前确保有加密密钥：没有密码先设密码，有密码就输入一次 */
  async function ensureSyncKey(interactive) {
    if (S().syncKey) return;
    if (!interactive) throw new Error('NEED_PASS');
    if (!S().passHash) { if (!(await setPasswordFlow(t('syncSetPassMsg')))) throw new Error('CANCEL'); if (S().syncKey) return; }
    const r = await passDialog(t('syncEncT'), t('syncEncM'), ['cur']);
    if (!r) throw new Error('CANCEL');
    if ((await hashPass(r.cur)) !== S().passHash) throw new Error('PASS_WRONG');
    await setSyncKey(r.cur); save();
  }
  /** 密码 / 密钥正确，但云端这份数据解压或读取失败：说明原因，提供“用本机重新上传”（上传前会核对能正常打开） */
  async function corruptFlow(e, opt) {
    if (e.message !== 'CORRUPT') throw e;
    if (!opt.old && opt.allowForce && opt.interactive) {
      const go = await confirmDialog({ title: t('cloudCorruptT'), msg: t('cloudCorruptM'), ok: t('cloudForcePush'), cancel: t('cancel'), danger: true, noBackdrop: true });
      if (go) throw new Error('FORCE_PUSH');
      throw new Error('CANCEL');
    }
    throw e;
  }
  /** 云端文本 → 数据对象。加密数据先用本机密钥解；解不开（新设备 / 别的设备改过密码）就请你输入密码。
      opt.old = 读取历史版本：只解密，不改本机密码 */
  async function decodeCloud(text, opt) {
    opt = opt || {};
    const obj = JSON.parse(text);
    if (!isEnc(obj)) return obj;
    try {
      if (S().syncKey) { const d = await openWith(S().syncKey, obj); if (d) return d; }
      // 云端还是用本机以前的密码加密的：用本机记住的旧密钥解开，之后用现在的密码重新加密上传
      for (const pk of (S().syncKeyPrev || [])) { const d = await openWith(pk, obj); if (d) { if (!opt.old) SYNC.reenc = true; return d; } }
    } catch (e) { return corruptFlow(e, opt); }
    if (!opt.interactive) throw new Error('NEED_PASS');
    const who = obj.dev ? (obj.dev === S().devId ? t('cloudByThis') : `${esc(obj.dn || '?')}（${esc(obj.dev)}）`) : '';
    const pcTxt = (obj.pc ? '<br><span class="dim">' + t('cloudPassPc', { d: fullTime(obj.pc) }) + '</span>' : '') +
      (obj.ts ? '<br><span class="dim">' + t('cloudUpBy', { d: fullTime(obj.ts), w: who || '?' }) + '</span>' : '') +
      '<br><span class="dim">' + t('cloudThisDev', { w: esc(devInfo().name) + '（' + esc(S().devId) + '）' }) + '</span>';
    for (let i = 0; i < 3; i++) {
      const r = await passDialog(t('cloudPassT'), (i ? t('passWrongRetry') : t(opt.old ? 'cloudPassOldM' : 'cloudPassM')) + pcTxt, ['cur']);
      if (!r) throw new Error('CANCEL');
      let raw, data;
      try {
        raw = await deriveKeyRaw(r.cur, obj.salt, obj.iter);
        try { data = await openWith(raw, obj); } catch (e2) { return corruptFlow(e2, opt); }
        if (!data) throw new Error('KEY');
      } catch (e) {
        if (e.message === 'FORCE_PUSH' || e.message === 'CORRUPT' || e.message === 'CANCEL') throw e;
        // 输入的是本机锁定密码却解不开：云端是用另一个密码加密的，说明原因并给出“用本机覆盖云端”的办法
        if (!opt.old && opt.allowForce && S().passHash && (await hashPass(r.cur)) === S().passHash) {
          const force = await confirmDialog({ title: t('cloudOtherPassT'), msg: t('cloudOtherPassM', { d: obj.pc ? fullTime(obj.pc) : '—' }), ok: t('cloudForcePush'), cancel: t('cloudTryOther'), danger: true, noBackdrop: true });
          if (force) throw new Error('FORCE_PUSH');
        }
        continue;
      }
      if (!opt.old) {
        // 你输入的就是云端的密码：本设备改用它（和提示里说的一致），本机原来的密钥留着读取旧数据。
        // 以前这里会在“本机密码更新”时保留本机密码并重新加密云端，导致两台设备来回改密码、反复要求输入。
        const h = await hashPass(r.cur), changed = !!S().passHash && S().passHash !== h;
        if (S().syncKey && S().syncKey !== raw) S().syncKeyPrev = [S().syncKey].concat(S().syncKeyPrev || []).filter((x, j, a) => a.indexOf(x) === j).slice(0, 5);
        S().syncKey = raw; S().syncSalt = obj.salt; S().syncIter = obj.iter || ENC_ITER; S().passHash = h; S().passChangedAt = obj.pc || 0;
        unlockFor(); save(); toast(t(changed ? 'passSyncedChanged' : 'passSynced'), 'ok');
      }
      return data;
    }
    throw new Error('PASS_WRONG');
  }

  /* ================= 本机自动备份（加载演示 / 导入 / 清空 / 云端覆盖 / 恢复 之前） ================= */
  const BACKUP_KEY = 'assethub.backups.v1';
  function readBackups() { try { const l = JSON.parse(localStorage.getItem(BACKUP_KEY) || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
  function backupNow(reason) {
    if (!DB.assets.length && !DB.txs.length && !(DB.subs || []).length) return;
    const data = JSON.stringify({ assets: DB.assets, txs: DB.txs, subs: DB.subs, meta: DB.meta, snaps: DB.snaps, audit: DB.audit });
    let list = readBackups().filter(b => b.data !== data);
    list.unshift({ ts: Date.now(), reason, n: DB.assets.length, m: DB.txs.length, name: DB.meta.name || '', demo: !!DB.meta.demo, data });
    list = list.slice(0, 10);
    while (list.length) { try { localStorage.setItem(BACKUP_KEY, JSON.stringify(list)); return; } catch (e) { list.pop(); } }
  }
  /** 变成空白账本：清空资产 / 记账 / 快照 / 日志（先自动备份），不再填充演示数据；
      保留本机设置（Token、密码、API Key、语言、配色等），但断开当前 Gist，避免云端旧数据被拉回来 */
  function blankBook() {
    backupNow('clear');
    const keep = Object.assign({}, S()), rates = DB.rates;
    DB = defaultDB(); Object.assign(DB.settings, keep);
    DB.rates = rates; DB.audit = [];
    DB.settings.gistId = ''; DB.settings.syncedStamp = 0; DB.settings.gistLast = 0;
    DB.meta.noDemo = true;   // 不再自动填充演示数据
    DB.meta.since = todayKey();   // 账本起始日：之前的快照不属于这个账本
    UI.unlockUntil = 0; UI.hold.sel.clear(); UI.led.sel.clear(); UI.sub.sel.clear();
    clearTimeout(SYNC.timer); SYNC.state = 'idle'; SYNC.lastErr = '';
  }
  /** 清理走势记录：删除某一天之前的每日快照（例如旧账本混进来的历史），并设为账本起始日，同步到其他设备 */
  function trimSnapsFlow() {
    const keys = Object.keys(DB.snaps).sort();
    if (!keys.length) { toast(t('trimNone')); return; }
    // 默认起始日：这个账本里最早录入资产 / 记账的那一天
    const born = DB.assets.concat(DB.txs).map(x => x.createdAt).filter(Boolean);
    const def = born.length ? ymd(new Date(Math.min(...born))) : todayKey();
    const root = $('#dialog-root');
    root.innerHTML = `<div class="modal-backdrop"></div><form class="alert pass" autocomplete="off"><h4>${ic('linechart')} ${t('trimT')}</h4>
      <p>${t('trimM', { a: keys[0], b: keys[keys.length - 1], n: keys.length })}</p>
      <div class="pass-fields"><input class="input" type="date" name="d" value="${def}" min="${keys[0]}" max="${todayKey()}"><div class="hint" id="trim-hint"></div></div>
      <div class="alert-btns"><button type="button" data-r="0">${t('cancel')}</button><button type="submit" class="ok">${t('trimOk')}</button></div></form>`;
    root.classList.add('open');
    const form = $('form', root), inp = form.elements.d;
    const hint = () => { const n = keys.filter(k => k < inp.value).length; $('#trim-hint', form).textContent = t('trimHint', { n, d: inp.value }); };
    inp.addEventListener('input', hint); hint();
    const done = () => { root.classList.remove('open'); root.innerHTML = ''; };
    $('[data-r="0"]', form).addEventListener('click', done);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const d = inp.value; done();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
      if (!(await requireUnlock())) return;
      backupNow('trim');
      const n = keys.filter(k => k < d).length;
      DB.meta.since = d; pruneSnaps();
      logOp('system', null, 'trim', null, { from: d });
      commit(); renderAll(); toast(t('trimDone', { n }), 'ok');
    });
  }
  /** 用某个版本替换当前数据（先自动备份当前数据），并上传到云端 */
  function restoreData(obj, label) {
    backupNow('restore');
    const cur = JSON.parse(JSON.stringify(DB));
    DB = migrate(Object.assign(cur, { assets: obj.assets, txs: obj.txs, subs: obj.subs || [], snaps: obj.snaps || {}, audit: obj.audit || cur.audit, meta: Object.assign({}, cur.meta, obj.meta || {}) }));
    DB.meta.demo = !!(obj.meta && obj.meta.demo);
    DB.meta.since = (obj.meta && obj.meta.since) || '';   // 起始日跟着恢复的版本走，避免误删历史
    logOp('system', null, 'restore', null, { from: label });
    UI.hold.sel.clear(); UI.led.sel.clear();
    commit(); renderAll(); toast(t('restoreDone'), 'ok');
    refreshQuotes({ silent: true });
  }
  const dataSummary = o => `${t('nAssets', { n: o.assets.length })} · ${t('statTx', { n: o.txs.length })}${o.meta && o.meta.name ? ' · ' + esc(o.meta.name) : ''}${o.meta && o.meta.demo ? ` · <span class="down">${t('demoTag')}</span>` : ''}`;
  /** 数据恢复：本机自动备份 / 旧版本数据 / 云端 Gist 历史版本 */
  function openRecovery() {
    const locals = readBackups();
    let legacy = null;
    LEGACY_KEYS.forEach(k => { try { const o = JSON.parse(localStorage.getItem(k) || 'null'); if (validData(o) && (o.assets.length || o.txs.length)) legacy = o; } catch (e) { /* ignore */ } });
    const cloudOK = !!(S().gistToken && S().gistId);
    const cache = {};
    const row = (title, sub, attrs, btn) => `<div class="rc-row"><div class="rc-main"><b>${title}</b><small>${sub}</small></div><button class="btn btn-soft sm" ${attrs}>${btn || t('restore')}</button></div>`;
    const body = `
      <p class="hint" style="margin:0 0 14px">${t('recoverIntro')}</p>
      <div class="rc-sec"><h5>${ic('db')}${t('recoverLocal')}</h5>
        ${locals.length ? locals.map((b, i) => row(`${dateTimeStr(b.ts)} · ${t('bk_' + b.reason) || b.reason}`, `${t('nAssets', { n: b.n })} · ${t('statTx', { n: b.m })}${b.name ? ' · ' + esc(b.name) : ''}${b.demo ? ` · <span class="down">${t('demoTag')}</span>` : ''}`, `data-rc="local" data-i="${i}"`)).join('') : `<div class="rc-empty">${t('recoverNoLocal')}</div>`}
        ${legacy ? row(t('recoverLegacy'), dataSummary(legacy), 'data-rc="legacy"') : ''}
      </div>
      <div class="rc-sec"><h5>${ic('cloud')}${t('recoverCloud')}</h5>
        ${cloudOK ? `<div id="rc-cloud"><button class="btn btn-glass sm" data-rc="load-cloud">${ic('download')}${t('recoverLoadCloud')}</button></div>` : `<div class="rc-empty">${t('recoverNoCloud')}</div>`}
      </div>`;
    openModal({
      title: t('recoverT'), body, wide: true,
      footer: `<button class="btn btn-glass" data-modal-close>${t('close')}</button>`,
      onMount(m) {
        const doRestore = async (obj, label) => {
          if (!validData(obj)) { toast(t('importBad'), 'err'); return; }
          if (!(await confirmDialog({ title: t('restoreT'), msg: t('restoreM', { s: dataSummary(obj) }), ok: t('restore'), danger: false }))) return;
          if (!(await requireUnlock())) return;
          closeModal(); restoreData(obj, label);
        };
        m.addEventListener('click', async e => {
          const b = e.target.closest('[data-rc]'); if (!b) return;
          const k = b.dataset.rc;
          if (k === 'local') { const it = readBackups()[+b.dataset.i]; if (it) doRestore(JSON.parse(it.data), 'local ' + dateTimeStr(it.ts)); return; }
          if (k === 'legacy') { doRestore(legacy, 'AssetView'); return; }
          if (k === 'load-cloud') {
            b.disabled = true; b.classList.add('spin');
            try {
              const list = await Api.gistHistory(S().gistToken, S().gistId);
              $('#rc-cloud', m).innerHTML = list.length ? `<div class="rc-list">${list.map(v => row(dateTimeStr(new Date(v.at).getTime()), `<span id="rcs-${v.sha}">+${v.add} / −${v.del} · ${t('recoverClickView')}</span>`, `data-rc="ver" data-sha="${v.sha}" data-at="${esc(v.at)}"`, t('recoverView'))).join('')}</div>` : `<div class="rc-empty">${t('recoverNoCloud')}</div>`;
            } catch (err) { toast(t('syncFail') + ' · ' + syncErrText(err), 'err'); b.disabled = false; b.classList.remove('spin'); }
            return;
          }
          if (k === 'ver') {
            const sha = b.dataset.sha;
            if (cache[sha]) { doRestore(cache[sha], 'cloud ' + dateTimeStr(new Date(b.dataset.at).getTime())); return; }
            b.disabled = true; b.classList.add('spin');
            try {
              const obj = await decodeCloud(await Api.gistVersion(S().gistToken, S().gistId, sha), { interactive: true, old: true });
              if (!validData(obj)) throw new Error('BAD_DATA');
              cache[sha] = obj;
              const sEl = $('#rcs-' + sha, m); if (sEl) sEl.innerHTML = dataSummary(obj);
              b.textContent = t('restore');
            } catch (err) { if (err.message !== 'CANCEL') toast(t('syncFail') + ' · ' + syncErrText(err), 'err'); }
            b.disabled = false; b.classList.remove('spin');
          }
        });
      }
    });
  }

  /** 同步一次：自动判断该上传还是下载；两边都改过时让你选 */
  async function syncNow(opt) {
    opt = opt || {};
    if (SYNC.busy) return;
    if (!S().gistToken) { if (!opt.silent) { toast(t('syncNeedSetup'), 'err'); UI.page = 'settings'; renderNav(); renderPage(); } return; }
    SYNC.busy = true; SYNC.state = 'busy'; renderSyncBtn();
    const inter = !opt.silent || !!opt.interactive;
    try {
      const localDirty = (DB.meta.updatedAt || 0) > (S().syncedStamp || 0);
      if (!S().gistId) {                                       // 还没有 Gist：直接创建
        if (!DB.meta.updatedAt) markDirty();
        await pushCloud(inter); save();
        if (!opt.silent) toast(t('syncPushed'), 'ok');
      } else {
        SYNC.phase = 'pull';
        const fresh = await pullFresh();
        if (fresh.stale) {
          // GitHub 还在返回比我们刚上传的更旧的副本：不要去解密 / 要密码，当作已是最新，稍后再同步
          S().gistLast = Date.now(); save();
          if (!opt.silent) toast(t('syncStale'), 'ok');
          SYNC.reenc = false; SYNC.state = 'ok'; SYNC.lastErr = ''; SYNC.busy = false; SYNC.lastCheck = Date.now(); renderSyncBtn();
          return;
        }
        const cloud = await decodeCloud(fresh.content, { interactive: inter, allowForce: true });
        if (!validData(cloud)) throw new Error('BAD_DATA');
        const keysPush = mergeKeys(cloud);
        // 每日快照每次同步都合并（不只在拉取时），并把本机较新的过去记录补传上去，几台设备的日历就会一致
        const sm = S().snapsGist === S().gistId ? mergeSnaps(cloud.snaps) : { changed: false, needPush: false };
        if (sm.changed) { pruneSnaps(); save(); }
        const cStamp = (cloud.meta && cloud.meta.updatedAt) || 0;
        const cloudNew = (cStamp > (S().syncedStamp || 0) && cStamp !== DB.meta.updatedAt) || (!cStamp && !S().syncedStamp && !localDirty && (cloud.assets.length || cloud.txs.length || (cloud.subs || []).length));
        let action = 'none';
        const sw = S().switchPull; S().switchPull = false;
        if (sw && (cloud.assets.length || cloud.txs.length || (cloud.subs || []).length)) action = 'pull';
        else if (cloudNew && localDirty) {
          const keepCloud = await confirmDialog({ title: t('syncConflictT'), msg: t('syncConflictM', { c: dateTimeStr(cStamp), l: dateTimeStr(DB.meta.updatedAt) }), ok: t('syncUseCloud'), cancel: t('syncUseLocal'), danger: false, noBackdrop: true });
          action = keepCloud ? 'pull' : 'push';
        } else if (cloudNew) action = 'pull';
        else if (localDirty) action = 'push';
        // 本机是演示数据、云端是真实数据：绝不自动上传覆盖，询问是否用云端替换本机
        if (action === 'push' && DB.meta.demo && !(cloud.meta && cloud.meta.demo) && (cloud.assets.length || cloud.txs.length || (cloud.subs || []).length)) {
          if (!inter) throw new Error('DEMO_BLOCK');
          action = (await confirmDialog({ title: t('demoBlockT'), msg: t('demoBlockM', { s: dataSummary(cloud) }), ok: t('syncUseCloud'), cancel: t('cancel'), danger: false })) ? 'pull' : 'none';
        }
        if (action === 'pull') { applyCloud(cloud); logOp('system', null, 'cloudPull'); S().gistLast = Date.now(); save(); renderAll(); toast(t('syncPulled'), 'ok'); }
        else if (action === 'push') { await pushCloud(inter); save(); if (!opt.silent) toast(t('syncPushed'), 'ok'); }
        else { S().gistLast = Date.now(); save(); if (!opt.silent) toast(t('syncUpToDate'), 'ok'); }
        if (SYNC.reenc && action !== 'push') { await pushCloud(inter); save(); toast(t('reencDone'), 'ok'); }
        else if ((keysPush || sm.needPush) && action !== 'push') { await pushCloud(inter); save(); }   // 只有 Key / 每日记录变了也要上传
        if (sm.changed && action === 'none') renderAll();
        if (UI.page === 'settings') renderPage();
      }
      SYNC.reenc = false;
      SYNC.state = 'ok'; SYNC.lastErr = '';
    } catch (e) {
      if (e && e.message === 'FORCE_PUSH') {
        // 用本机数据 + 本机密码重新加密，覆盖云端（云端原来的版本仍在 Gist 历史里）
        try {
          backupNow('forcePush'); markDirty(); await pushCloud(true); save();
          logOp('system', null, 'forcePush');
          SYNC.reenc = false; SYNC.state = 'ok'; SYNC.lastErr = ''; SYNC.busy = false; SYNC.lastCheck = Date.now();
          renderSyncBtn(); if (UI.page === 'settings') renderPage(); toast(t('cloudForceDone'), 'ok'); return;
        } catch (e2) { e = e2; }
      }
      SYNC.reenc = false; SYNC.state = 'err'; SYNC.lastErr = (e && e.message) || 'error'; SYNC.lastPhase = SYNC.phase;   // 存原始错误，显示时按当前语言翻译
      if (!opt.silent && e.message !== 'CANCEL') toast(t('syncFail') + ' · ' + syncErrNow(), 'err');
    }
    SYNC.busy = false; SYNC.lastCheck = Date.now(); renderSyncBtn();
    if (UI.page === 'settings') renderPage();
  }
  /** 读取云端；如果读到的版本比本机上一次上传的还旧（GitHub 服务器延迟），等一下再读，最多 4 次 */
  async function pullFresh() {
    const lp = S().lastPush || {};
    for (let i = 0; i < 4; i++) {
      const r = await Api.gistPullMeta(S().gistToken, S().gistId);
      const older = lp.at && r.updated && r.updated < lp.at;
      if (!older) return r;
      await new Promise(res => setTimeout(res, 1500 * (i + 1)));
    }
    return { stale: true };
  }
  /** 把 GitHub 错误码翻译成看得懂的原因 */
  function syncErrText(e, phase) {
    const m = String((e && e.message) || 'error'), code = (m.match(/HTTP (\d{3})/) || [])[1];
    if (m === 'NEED_PASS') return t('syncNeedPass');
    if (m === 'CANCEL') return t('syncCanceled');
    if (m === 'DEMO_BLOCK') return t('syncDemoBlock');
    if (m === 'PASS_WRONG') return t('passWrong');
    if (m === 'CORRUPT') return t('syncCorrupt');
    if (m === 'ENC_VERIFY') return t('syncEncVerify');
    if (m === 'BAD_DATA') return t('importBad');
    if (code === '401') return t('syncE401');
    if (code === '404') return t('syncE404');
    if (code === '403') return t('syncE403');
    if (code === '422') return t('syncE422');
    if (code && code[0] === '5') return t('syncE5xx', { c: code, p: t((phase || SYNC.phase) === 'pull' ? 'phasePull' : 'phasePush') }) + ((m.match(/req:(\S+)/) || [])[1] ? ` [${m.match(/req:(\S+)/)[1]}]` : '');
    if (/Timeout|Failed to fetch|NetworkError|Load failed/i.test(m)) return t('syncENet');
    if (/Empty gist/i.test(m)) return t('syncEEmpty');
    if (/Unexpected token|JSON/i.test(m)) return t('importBad');
    if (code) return t('syncEOther') + ' (HTTP ' + code + ')';
    return /[\u4e00-\u9fff]/.test(m) === (S().lang === 'zh') ? m : t('syncEOther');   // 不显示与当前语言不符的原始报错
  }
  const syncErrNow = () => (SYNC.lastErr ? syncErrText({ message: SYNC.lastErr }, SYNC.lastPhase) : '');
  function syncBtnHTML() {
    let st = 'off', tip = t('syncOff');
    if (syncReady() || S().gistToken) {
      const dirty = (DB.meta.updatedAt || 0) > (S().syncedStamp || 0);
      st = SYNC.busy ? 'busy' : SYNC.state === 'err' ? 'err' : dirty ? 'dirty' : 'ok';
      tip = SYNC.busy ? t('syncing') : st === 'err' ? t('syncFail') + ' · ' + syncErrNow() : st === 'dirty' ? t('syncDirty') : `${t('syncOk')} · ${dateTimeStr(S().gistLast)}`;
    }
    return `<button class="icon-btn sync-btn st-${st} ${st === 'busy' ? 'spin' : ''}" data-action="sync-now" title="${esc(tip)}">${ic('cloud')}</button>`;
  }
  /** 原地更新按钮状态（不替换元素，避免点击过程中按钮被重建导致点击失效） */
  function renderSyncBtn() {
    const tmp = document.createElement('div'); tmp.innerHTML = syncBtnHTML();
    const n = tmp.firstElementChild;
    $$('.sync-btn').forEach(b => { b.className = n.className; b.title = n.title; });
  }

  let DB = load() || defaultDB();
  const S = () => DB.settings;
  const UI = {
    page: 'overview',
    busy: false,
    unlockUntil: 0,
    kEnd: 0,                                            // 日K 视窗末端偏移（0 = 最新）
    hold: { q: '', cls: 'all', src: 'all', wh: '__all', sort: 'valDesc', batch: false, sel: new Set() },
    rankDay: '',
    sub: { period: 'month', q: '', cat: 'all', sort: 'expireAsc', pmode: 'cycle', batch: false, sel: new Set(), view: 'active' },                                        // 资产日盈亏查看的历史日期（空 = 今天）
    led: { mode: 'month', date: '', type: 'all', cat: 'all', acct: 'all', q: '', sort: 'dateDesc', batch: false, sel: new Set() }
  };

  /* ============ 3. 工具函数 ============ */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  function pad(n) { return String(n).padStart(2, '0'); }
  function ym(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
  function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  const todayKey = () => ymd(new Date());
  const round8 = v => Number((+v || 0).toFixed(8));
  const locale = () => (S().lang === 'zh' ? 'zh-CN' : 'en-US');
  const zh = () => S().lang === 'zh';
  UI.led.date = todayKey();

  function t(k, vars) {
    const L = I18N[S().lang] || I18N.zh;
    let s = L[k] != null ? L[k] : (I18N.zh[k] != null ? I18N.zh[k] : k);
    if (vars) s = s.replace(/\{(\w+)\}/g, (_, n) => (vars[n] != null ? vars[n] : ''));
    return s;
  }
  function parseNum(v) {
    if (v == null) return NaN;
    const s = String(v).replace(/[,\s，]/g, '');
    if (s === '' || !/^-?\d*\.?\d*$/.test(s) || s === '-' || s === '.') return NaN;
    return round8(parseFloat(s));
  }
  const nfCache = {};
  function fmtNum(v, min, max) {
    min = min == null ? 2 : min; max = max == null ? Math.max(2, min) : max;
    const key = min + '_' + max;
    nfCache[key] = nfCache[key] || new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: max });
    return nfCache[key].format(v);
  }
  const symOf = c => (CCY_SYM[c] != null ? CCY_SYM[c] : c + ' ');
  const MASK = '••••';
  const hidden = () => !!S().hideAmt;
  /** 金额格式化；开启“隐藏金额”时显示 ••••（o.raw = true 时不隐藏，用于输入预览） */
  function money(v, o) {
    o = o || {};
    if (hidden() && !o.raw) return symOf(o.ccy || S().ccy) + MASK;
    v = +v || 0;
    if (Math.abs(v) < 1e-12) v = 0;
    const ccy = o.ccy || S().ccy;
    const sign = v < 0 ? '-' : (o.sign && v > 0 ? '+' : '');
    return sign + symOf(ccy) + fmtNum(Math.abs(v), o.min == null ? 2 : o.min, o.max == null ? 2 : o.max);
  }
  function moneyHTML(v, o) {
    const s = money(v, o);
    if (hidden() && !(o && o.raw)) return esc(s);
    const i = s.lastIndexOf('.');
    return i < 0 ? esc(s) : `${esc(s.slice(0, i))}<span class="dec">${esc(s.slice(i))}</span>`;
  }
  const qtyStr = a => (hidden() ? MASK : a.noQty ? '<span class="dim">—</span>' : fmtNum(+a.qty || 0, 0, 8));
  /** 计量单位：预设 oz / g / kg / pc 显示翻译，其余为自定义文字 */
  const UNIT_KEYS = ['oz', 'g', 'kg', 'pc'];
  const unitLabel = u => (UNIT_KEYS.includes(u) ? t('unitS_' + u) : String(u || ''));
  const pct = v => (v > 0 ? '+' : '') + (isFinite(v) ? v.toFixed(2) : '0.00') + '%';
  const upDown = v => (v > 1e-9 ? 'up' : v < -1e-9 ? 'down' : '');
  const tone = v => (v > 1e-9 ? 'pos' : v < -1e-9 ? 'neg' : 'flat');
  const trim8 = v => String(round8(v));
  function compact(v) {
    const a = Math.abs(v);
    if (a >= 1e9) return +(v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return +(v / 1e6).toFixed(2) + 'M';
    if (a >= 1e4) return +(v / 1e3).toFixed(1) + 'K';
    return fmtNum(v, 0, 2);
  }
  const timeStr = ts => (ts ? new Date(ts).toLocaleTimeString(locale(), { hour12: false }) : t('never'));
  const dateTimeStr = ts => (ts ? new Date(ts).toLocaleString(locale(), { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : t('never'));

  /* ---- 汇率 ---- */
  function rateOf(c) {
    const r = DB.rates.rates[c] != null ? DB.rates.rates[c] : FALLBACK_RATES[c];
    return r > 0 ? r : null;
  }
  function conv(v, from, to) {
    to = to || S().ccy;
    if (!from || from === to) return v;
    const a = rateOf(from), b = rateOf(to);
    if (!a || !b) return v;
    return (v / a) * b;
  }

  /* ---- 资产 ---- */
  const findAsset = id => DB.assets.find(a => a.id === id);
  const tagsOf = a => (Array.isArray(a.cls) ? a.cls : [a.cls]);
  const primary = a => tagsOf(a)[0];
  const hasTag = (a, c) => c === 'all' || tagsOf(a).includes(c);
  /** 按类别筛选 / 统计时只认主类别（第一个选中的类别），多类别资产不会被重复计入 */
  const inCls = (a, c) => c === 'all' || primary(a) === c;
  // 余额型资产（数量 = 金额，不计盈亏）：类别里有现金或负债（主或副），或手动维护时选了“按余额填写”
  const isBalance = a => !!a.balMode || tagsOf(a).some(c => c === 'cash' || c === 'liability');
  const hasBalTag = a => tagsOf(a).some(c => c === 'cash' || c === 'liability');
  const aCcy = a => (a.ccy || 'USD').toUpperCase();
  const aVal = a => (+a.qty || 0) * (isBalance(a) ? 1 : (+a.price || 0));
  const aCost = a => (isBalance(a) ? aVal(a) : (+a.qty || 0) * (+a.cost || 0));
  const aValD = a => conv(aVal(a), aCcy(a));
  const aCostD = a => conv(aCost(a), aCcy(a));
  const netD = () => DB.assets.reduce((s, a) => s + aValD(a), 0);
  const netUSD = () => DB.assets.reduce((s, a) => s + conv(aVal(a), aCcy(a), 'USD'), 0);
  const clsLabel = a => tagsOf(a).map(c => clsName(c)).join(' · ');
  const tagHTML = a => tagsOf(a).map(c => `<span class="tag" style="--tc:${clsColor(c)}">${clsName(c)}</span>`).join('');

  /** 每日快照：记录总资产 OHLC（USD）与各资产价格，用于当月/当年盈亏和资产趋势图 */
  function recordSnap() {
    if (!DB.assets.length) return;
    const k = todayKey(), net = netUSD();
    const keys = Object.keys(DB.snaps).sort();
    const prevK = keys.filter(x => x < k).pop();
    let s = DB.snaps[k];
    if (!s) {
      const o = prevK ? DB.snaps[prevK].c : net;
      s = DB.snaps[k] = { o, h: Math.max(o, net), l: Math.min(o, net), c: net };
    }
    s.h = Math.max(s.h, net); s.l = Math.min(s.l, net); s.c = net;
    // 账本第一天（新建账本 / 清理走势后的起始日）：开 = 高 = 低 = 收 = 当前总资产，不沿用之前（旧账本）的数值
    if (DB.meta.since && k <= DB.meta.since) { s.o = s.h = s.l = net; }
    // p / b：当日最新的单价 / 余额；po / bo：当日第一次看到的单价 / 余额（作为“今日变化”的起点）
    s.p = {}; s.b = {}; s.pc = {}; s.po = s.po || {}; s.bo = s.bo || {};
    DB.assets.forEach(a => {
      if (isBalance(a)) {
        s.b[a.id] = +a.qty || 0;
        if (a.addBal == null) a.addBal = +a.qty || 0;            // 录入时余额（用于总变化排行）
        if (s.bo[a.id] == null) s.bo[a.id] = +a.qty || 0;
        return;
      }
      s.p[a.id] = +a.price || 0;
      if (s.po[a.id] == null) s.po[a.id] = +a.price || 0;
      if (a.realPrev && a.prevRaw > 0 && a.prevDay === k) (s.pc = s.pc || {})[a.id] = a.prevRaw;   // 这天看到的接口昨收
      if (!a.addPrice && a.price > 0) a.addPrice = +a.price;
    });
    // d：当天每项资产的日盈亏 [USD, 涨跌%]，用于“资产日盈亏”按日期查看历史排行
    s.d = {};
    DB.assets.forEach(a => {
      const x = dayChange(a, keys);
      if (Math.abs(x.ch) < 1e-9 && !isBalance(a) && !(+a.qty)) return;
      const r2 = v => Math.round(conv(v, S().ccy, 'USD') * 100) / 100;
      s.d[a.id] = [r2(x.ch), Math.round((x.pct || 0) * 100) / 100, r2(x.pct ? x.ch / (x.pct / 100) : 0)];
    });
    // tp：当天的投资总盈亏 [盈亏, 成本]（USD），用于按日期查看投资总盈亏
    const it = investTotal();
    s.tp = [Math.round(conv(it.pnl, S().ccy, 'USD') * 100) / 100, Math.round(conv(it.c, S().ccy, 'USD') * 100) / 100];
    s.dt = Date.now();
  }
  function pruneSnaps() {
    // 只保留最近 60 天 + 每月最后一天的价格明细，控制存储体积
    // 新建空白账本那天之前的快照不属于这个账本（可能是旧账本同步带进来的），删掉
    if (DB.meta.since) {
      Object.keys(DB.snaps).forEach(k => { if (k < DB.meta.since) delete DB.snaps[k]; });
      const first = DB.snaps[DB.meta.since];
      if (first) { first.o = first.h = first.l = first.c; }   // 起始日那根 K 线只保留收盘值
    }
    const keys = Object.keys(DB.snaps).sort();
    const cut = ymd(new Date(Date.now() - 60 * 864e5)), dCut = ymd(new Date(Date.now() - 400 * 864e5));
    keys.forEach((k, i) => {
      const next = keys[i + 1];
      const monthEnd = !next || next.slice(0, 7) !== k.slice(0, 7);
      const sn = DB.snaps[k];
      if (k < cut && !monthEnd) { delete sn.p; delete sn.b; delete sn.pc; }
      if (k < todayKey()) { delete sn.po; delete sn.bo; }
      if (k < dCut) { delete sn.d; delete sn.tp; }
    });
  }
  const snapKeys = () => Object.keys(DB.snaps).sort();
  /** 某资产在周期开始时的参考价（周期开始前最后一次快照价 → 期内买入用成本价 → 最早记录价） */
  function refPrice(a, startKey, keys) {
    keys = keys || snapKeys();
    for (let i = keys.length - 1; i >= 0; i--) {
      const k = keys[i];
      if (k >= startKey) continue;
      const p = DB.snaps[k].p;
      if (p && p[a.id] != null) return p[a.id];
    }
    if ((a.createdAt || 0) >= new Date(startKey + 'T00:00:00').getTime()) return +a.addPrice || +a.price || 0;   // 期内新录入：从录入时价格起算
    for (const k of keys) {
      if (k < startKey) continue;
      const p = DB.snaps[k].p;
      if (p && p[a.id] != null && k < todayKey()) return p[a.id];
    }
    if (a.prevClose > 0) return a.prevClose;
    return +a.price || 0;
  }
  /** 某天之前最近一次（7 天内）的记录：{ p: 单价, pc: 那次看到的接口昨收（没有为 undefined） } */
  function prevSnap(a, keys, k) {
    const lim = addDate(k, -7, 'day');
    for (let i = keys.length - 1; i >= 0; i--) {
      const kk = keys[i];
      if (kk >= k) continue;
      if (kk < lim) break;
      const sn = DB.snaps[kk], m = sn.p;
      if (m && m[a.id] != null) return { p: m[a.id], pc: sn.pc ? sn.pc[a.id] : undefined };
    }
    return null;
  }
  /** 某天之前最近一次（7 天内）记录的单价；没有返回 null */
  function prevSnapPrice(a, keys, k) {
    const lim = addDate(k, -7, 'day');
    for (let i = keys.length - 1; i >= 0; i--) {
      const kk = keys[i];
      if (kk >= k) continue;
      if (kk < lim) break;
      const m = DB.snaps[kk].p;
      if (m && m[a.id] != null) return m[a.id];
    }
    return null;
  }
  /** v7.3 修正历史“每日盈亏”记录：股票 / 黄金按“上一次记录的价格”重算（休市日 = 0）。
      d[id] = [盈亏, 涨跌%, 起点市值]（USD）；起点市值 + 盈亏 = 当天市值，按价格比例拆分，不需要当时的数量 / 汇率。可重复执行，结果不变 */
  const isStaleKind = a => a.source === 'online' && ['stock', 'gold'].includes(Api.quoteKind(a));
  function fixDayRecords(backup) {
    const keys = snapKeys(), tk = todayKey(), bak = {};
    let days = 0;
    keys.forEach(k => {
      const sn = DB.snaps[k];
      if (k >= tk || !sn.d || !sn.p) return;
      let changed = false;
      DB.assets.forEach(a => {
        const v = sn.d[a.id]; if (!v || !isStaleKind(a)) return;
        const pk = sn.p[a.id], pp = prevSnapPrice(a, keys, k);
        if (!(pk > 0) || pp == null) return;
        const base0 = v[2] != null ? +v[2] : v[1] ? v[0] / (v[1] / 100) : null;
        if (base0 == null) return;
        const mv = base0 + v[0];                       // 当天市值（USD）
        const ch = Math.round(mv * (1 - pp / pk) * 100) / 100, base = Math.round(mv * (pp / pk) * 100) / 100;
        if (Math.abs(ch - v[0]) < 0.006) return;
        if (backup) (bak[k] = bak[k] || {})[a.id] = v.slice();
        sn.d[a.id] = [ch, base ? Math.round((ch / Math.abs(base)) * 10000) / 100 : 0, base];
        changed = true;
      });
      if (changed) { sn.dt = Date.now(); days++; }
    });
    if (backup && days) { try { localStorage.setItem('assethub.dfix.bak', JSON.stringify({ at: Date.now(), d: bak })); } catch (e) { /* 存不下就算了 */ } }
    return days;
  }
  function restoreDayRecords() {
    let b; try { b = JSON.parse(localStorage.getItem('assethub.dfix.bak') || 'null'); } catch (e) { b = null; }
    if (!b || !b.d) return 0;
    let n = 0;
    Object.keys(b.d).forEach(k => { const sn = DB.snaps[k]; if (!sn || !sn.d) return; Object.assign(sn.d, b.d[k]); sn.dt = Date.now(); n++; });
    S().dfix = 'restored'; save();
    return n;
  }
  /** “今日变化”的起点：在线行情的昨收 / 今开 → 昨天最后一次记录 → 今天第一次记录 → 当前值 */
  function dayRef(a, keys) {
    const tk = todayKey(), bal = isBalance(a);
    if (a.dayBase && a.dayBase.d === tk) return +a.dayBase.v;           // 手动“清零今日盈亏”后的起点
    if (!bal && a.prevClose > 0 && a.prevDay === tk) {
      // 加密货币 24 小时交易：用接口给的起点。股票 / 黄金等：用“上一次记录的价格”做起点——
      // 休市（周末 / 节假日）时价格不变，当天盈亏就是 0，不会把上一个交易日的涨跌再算一遍
      const kind = Api.quoteKind(a);
      if (kind === 'crypto' || !kind) return a.prevClose;
      const pv = prevSnap(a, keys, tk);
      if (!pv) return a.prevClose;
      // v7.6：接口给的是交易所真实昨收（股票 / 上海金）时，用“昨收有没有变”判断是不是新的一场交易：
      //   昨收变了 → 新的一场：今日盈亏 = 现价 − 昨收（和券商一致）；没变 → 同一场：只算上次记录之后的变动（休市 = 0，不重复）
      //   上一次的记录里没有昨收（升级前的记录 / 那天没取到行情）：直接按交易所昨收算，和券商一致
      if (a.realPrev && a.prevRaw > 0 && (pv.pc == null || Math.abs(pv.pc - a.prevRaw) > 1e-9 * Math.max(1, a.prevRaw))) return a.prevClose;
      return pv.p;
    }
    const f = bal ? 'b' : 'p';
    for (let i = keys.length - 1; i >= 0; i--) {
      const k = keys[i];
      if (k >= tk) continue;
      const m = DB.snaps[k][f];
      if (m && m[a.id] != null) return m[a.id];
    }
    const today = DB.snaps[tk], o = today && today[bal ? 'bo' : 'po'];
    if (o && o[a.id] != null) return o[a.id];
    return bal ? +a.qty || 0 : +a.price || 0;
  }
  /** 补记更新市值：把这次变化记到过去的某一天 D。D 当天记录这笔变化（日盈亏 / 走势），之后每天的记录整体平移同样的差额，
      今天的“今日盈亏”起点也随之平移（今天不再重复计入）。old = 更新前的 { qty, price } */
  function backdateVal(a, old, D) {
    const tk = todayKey(); if (!D || D >= tk) return;
    const bal = isBalance(a), f = bal ? 'b' : 'p', ccy = aCcy(a);
    const du = bal ? (+a.qty || 0) - (+old.qty || 0) : (+a.price || 0) - (+old.price || 0);       // 单价 / 余额的变化
    const q = bal ? 1 : +a.qty || 0;
    const vOld = bal ? +old.qty || 0 : (+old.qty || 0) * (+old.price || 0);
    const dUSD = conv((bal ? +a.qty || 0 : q * (+a.price || 0)) - vOld, ccy, 'USD');
    if (Math.abs(du) < 1e-12 && Math.abs(dUSD) < 1e-9) return;
    const unitOld = bal ? +old.qty || 0 : +old.price || 0;
    if (!DB.snaps[D]) {   // 那天没打开过：照前一天（没有就照今天）补一条记录
      const ks = snapKeys(), pk = ks.filter(k => k < D).pop(), base = DB.snaps[pk || tk] || {};
      const c = base.c != null ? base.c : netUSD() - dUSD;
      DB.snaps[D] = { o: c, h: c, l: c, c, p: Object.assign({}, base.p), b: Object.assign({}, base.b) };
    }
    const r2 = x => Math.round(x * 100) / 100;
    snapKeys().forEach(k => {
      if (k < D) return;
      const sn = DB.snaps[k];
      if (k < tk) {
        const uK = sn[f] && sn[f][a.id] != null ? +sn[f][a.id] : unitOld;   // 那天原来记录的单价 / 余额
        if (sn[f] || k === D) { sn[f] = sn[f] || {}; sn[f][a.id] = round8(uK + du); }
        sn.c += dUSD; sn.h = Math.max(sn.h, sn.c); sn.l = Math.min(sn.l, sn.c);
        if (k > D) sn.o += dUSD;
        if (!bal && sn.tp) sn.tp = [r2(sn.tp[0] + dUSD), sn.tp[1]];
        if (k === D && sn.d) {
          const v0 = sn.d[a.id] || [0, 0, null];
          const baseV = v0[2] != null ? +v0[2] : r2(conv(bal ? uK : q * uK, ccy, 'USD') - v0[0]);   // 当天开始时的市值 = 当天原收盘市值 − 原当天盈亏
          const ch = r2(+v0[0] + dUSD);
          sn.d[a.id] = [ch, baseV ? Math.round((ch / Math.abs(baseV)) * 10000) / 100 : 0, baseV];
        }
        sn.dt = Date.now();
      } else {   // 今天：开盘 = 昨天收盘，今日起点同步平移
        sn.o += dUSD; sn.h = Math.max(sn.h, sn.o); sn.l = Math.min(sn.l, sn.o);
        const of = bal ? 'bo' : 'po';
        if (sn[of] && sn[of][a.id] != null) sn[of][a.id] = round8(+sn[of][a.id] + du);
      }
    });
    if (a.dayBase && a.dayBase.d === tk) a.dayBase.v = round8(+a.dayBase.v + du);
  }
  /** 把这项资产“今日盈亏”的起点设为当前值（录错后修正用）；当天新录入的资产连同录入起点一起改 */
  function rebaseDay(a) {
    const tk = todayKey(), bal = isBalance(a), v = bal ? +a.qty || 0 : +a.price || 0;
    a.dayBase = { d: tk, v };
    const s = DB.snaps[tk];
    if (s) { if (bal) { s.bo = s.bo || {}; s.bo[a.id] = v; } else { s.po = s.po || {}; s.po[a.id] = v; } }
    if (ymd(new Date(a.createdAt || 0)) === tk) { if (bal) a.addBal = v; else a.addPrice = v; }   // 今天才录入：月 / 年 / 总变化也从这里起算
  }
  const canResetDay = a => a.source === 'manual' || isBalance(a) || !Api.canQuote(a);
  /** 单项资产今日变化（显示币种）：价格类 = 数量 ×（现价 − 起点价）；现金 / 负债 = 余额 − 起点余额 */
  function dayChange(a, keys) {
    keys = keys || snapKeys();
    const ref = dayRef(a, keys), ccy = aCcy(a);
    if (isBalance(a)) {
      const ch = conv((+a.qty || 0) - ref, ccy);
      return { ch, pct: ref ? (ch / Math.abs(conv(ref, ccy))) * 100 : 0 };
    }
    const q = +a.qty || 0, ch = conv(q * ((+a.price || 0) - ref), ccy), base = conv(q * ref, ccy);
    return { ch, pct: base ? (ch / Math.abs(base)) * 100 : 0 };
  }
  /** 单项资产累计变化：价格类 = 浮动盈亏（市值 − 成本）；现金 / 负债 = 当前余额 − 录入时余额 */
  function totalChange(a) {
    const ccy = aCcy(a);
    if (isBalance(a)) {
      const base = a.addBal != null ? +a.addBal : +a.qty || 0, ch = conv((+a.qty || 0) - base, ccy);
      return { ch, pct: base ? (ch / Math.abs(conv(base, ccy))) * 100 : 0 };
    }
    const v = aValD(a), c = aCostD(a);
    return { ch: v - c, pct: c ? ((v - c) / Math.abs(c)) * 100 : 0 };
  }
  function periodStart(period) {
    const d = new Date();
    if (period === 'day') return ymd(d);
    if (period === 'month') return `${ym(d)}-01`;
    return `${d.getFullYear()}-01-01`;
  }
  /** 周期盈亏（只计价格变动，不含现金收支），list 默认全部资产 */
  function periodPnl(period, list) {
    list = list || DB.assets;
    const keys = snapKeys(), start = periodStart(period);
    let pnl = 0, base = 0;
    list.forEach(a => {
      if (isBalance(a)) return;
      let ref;
      if (period === 'day') ref = dayRef(a, keys);
      else ref = refPrice(a, start, keys);
      const q = +a.qty || 0, p = +a.price || 0;
      pnl += conv(q * (p - ref), aCcy(a));
      base += conv(q * ref, aCcy(a));
    });
    return { pnl, pct: base ? (pnl / Math.abs(base)) * 100 : 0 };
  }
  /** 某一类别的累计持仓盈亏 */
  function classTotal(c) {
    let v = 0, cost = 0, n = 0;
    DB.assets.forEach(a => { if (primary(a) !== c || isBalance(a)) return; v += aValD(a); cost += aCostD(a); n++; });   // 多类别资产只算进主类别
    return { v, pnl: v - cost, pct: cost ? ((v - cost) / Math.abs(cost)) * 100 : 0, n };
  }

  /* ---- 记账 ---- */
  // 转账可在任意资产之间进行：amount / fee 是转出资产的“数量”（现金类即金额），value / feeValue 是折算成 ccy 的价值
  const txD = x => conv(x.type === 'transfer' && x.value != null ? +x.value : +x.amount || 0, x.ccy || S().ccy);
  const feeD = x => (x.type === 'transfer' && x.fee > 0 ? conv(x.feeValue != null ? +x.feeValue : +x.fee, x.feeCcy || x.ccy || S().ccy) : 0) + Math.max(0, -recvD(x));
  /** 同币种转账到账 ≠ 转出：正 = 红包 / 优惠（计收入），负 = 到账扣费（计支出，并入手续费） */
  const recvD = x => (x.type === 'transfer' && x.recvDiff ? conv(+x.recvDiff, x.toCcy || x.ccy || S().ccy) : 0);
  const bonusD = x => Math.max(0, recvD(x));
  const recvTag = x => (x.type === 'transfer' && x.recvDiff ? `<small class="${x.recvDiff > 0 ? 'up' : 'down'}">${t(x.recvDiff > 0 ? 'recvBonusS' : 'recvLossS')} ${money(Math.abs(x.recvDiff), { ccy: x.toCcy || x.ccy, max: 8, sign: false })}</small>` : '');
  /** 手续费显示：单独的手续费账户按它自己的数量 / 币种显示（如 0.0012 BNB） */
  const feeTxt = x => qtyTxt(x.fee, x.feeId ? x.feeUnit : x.fromUnit, x.feeCcy || x.ccy) + (x.feeId && !x.feeUnit ? ` · ${esc(acctName(x.feeId))}` : '');
  /** 数量单位：现金 / 负债按金额（返回空串），其他资产按代码或单位 */
  const qtyUnit = a => (!a || isBalance(a) ? '' : (a.code || (a.unit ? unitLabel(a.unit) : '') || a.name));
  const unitPx = a => (!a || isBalance(a) ? 1 : +a.price || 0);
  /** 显示“数量 + 单位”或金额 */
  const qtyTxt = (n, unit, ccy) => (unit ? `${hidden() ? MASK : trim8(n)} ${esc(unit)}` : money(n, { ccy, max: 8 }));   // 转账手续费（计入支出）
  const catName = c => t('cat_' + c);
  function statsOf(pred) {
    const r = { inc: 0, exp: 0, n: 0 };
    DB.txs.forEach(x => { if (!pred(x)) return; if (x.type === 'transfer') { r.exp += feeD(x); r.inc += bonusD(x); return; } r.n++; if (x.type === 'income') r.inc += txD(x); else r.exp += txD(x); });
    return r;
  }
  const sortTxDate = list => list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
  const isMobile = () => S().layout === 'mobile';

  /* ============ 4. 渲染 ============ */
  function hexRGB(hex) { const n = parseInt(hex.slice(1), 16); return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`; }
  function applyTheme() {
    const st = pnlPair(S().pnlStyle);
    const up = S().pnlSwap ? st.down : st.up, down = S().pnlSwap ? st.up : st.down;
    const root = document.documentElement.style;
    root.setProperty('--up', up); root.setProperty('--down', down);
    root.setProperty('--up-rgb', hexRGB(up)); root.setProperty('--down-rgb', hexRGB(down));
    root.setProperty('--up-soft', `rgba(${hexRGB(up)},.14)`); root.setProperty('--down-soft', `rgba(${hexRGB(down)},.14)`);
    document.body.classList.toggle('mobile', isMobile());
    document.documentElement.lang = zh() ? 'zh-CN' : 'en';
  }
  const colors = () => { const cs = getComputedStyle(document.documentElement); return { up: cs.getPropertyValue('--up').trim(), down: cs.getPropertyValue('--down').trim() }; };
  const bookName = () => DB.meta.name || t('defaultBookName');

  function renderAll() {
    applyTheme();
    renderHeader();
    renderNav();
    renderKPIs();
    renderPage();
    renderFoot();
    document.title = DB.meta.name ? `${DB.meta.name} · AssetHub` : 'AssetHub';
  }

  /* ---- 顶栏 ---- */
  function langBtn() {
    // 中文状态显示 EN（点击切到英文），英文状态显示 CN
    return `<button class="icon-btn txt" data-action="lang" data-v="${zh() ? 'en' : 'zh'}" title="${zh() ? 'English' : '中文'}">${zh() ? 'EN' : 'CN'}</button>`;
  }
  function layoutBtn() {
    // 显示“将要切换到”的模式图标
    return isMobile()
      ? `<button class="icon-btn" data-action="layout" data-v="desktop" title="${t('layoutDesktop')}">${ic('monitor')}</button>`
      : `<button class="icon-btn" data-action="layout" data-v="mobile" title="${t('layoutMobile')}">${ic('phone')}</button>`;
  }
  /** 一键切换盈亏配色：按钮里两个小圆点即当前的涨 / 跌颜色 */
  function pnlBtn() {
    const st = pnlPair(S().pnlStyle);
    const up = S().pnlSwap ? st.down : st.up, dn = S().pnlSwap ? st.up : st.down;
    return `<button class="icon-btn pnl-cycle" data-action="pnl-cycle" title="${t('pnlCycle')}: ${t('pnl_' + S().pnlStyle)}"><i style="background:${up}"></i><i style="background:${dn}"></i></button>`;
  }
  function eyeBtn() {
    const h = hidden();
    return `<button class="icon-btn eye ${h ? 'on' : ''}" data-action="toggle-hide" title="${h ? t('showAmt') : t('hideAmt')}">${ic(h ? 'eyeoff' : 'eye')}</button>`;
  }
  function renderHeader() {
    const s = S(), m = isMobile();
    const icon = `<img src="${esc(logoSrc())}" alt="AssetHub">`;
    applyLogoLinks();
    const ccy = `<div class="mini-select ccy-select" title="${t('ccyUnit')}"><select data-change="ccy">${DISPLAY_CCYS.map(c => `<option value="${c}" ${c === s.ccy ? 'selected' : ''}>${CCY_SHORT[c]}</option>`).join('')}</select></div>`;
    const refresh = `<button class="icon-btn ${UI.busy ? 'spin' : ''}" data-action="refresh" title="${t('refresh')}">${ic('refresh')}</button>`;
    $('#topbar').innerHTML = `<div class="topbar-inner">
      <div class="brand">
        <button class="brand-home" data-action="nav" data-page="overview" title="${t('navOverview')}">
          <span class="brand-icon ${DB.meta.icon ? 'custom' : 'bull'}">${icon}</span>
          <h1 class="brand-title"><span>Asset</span><span class="hub">Hub</span></h1>
        </button>
        <span class="brand-sub" id="brand-sub">${esc(DB.meta.subtitle)}</span>
      </div>
      <div class="actions">${syncBtnHTML()}${ccy}${refresh}${pnlBtn()}${eyeBtn()}${langBtn()}${layoutBtn()}</div>
    </div>`;
  }
  function renderNav() {
    $('#navrow').innerHTML = `<div class="tabs">${PAGES.map(p =>
      `<button class="tab ${UI.page === p.id ? 'on' : ''}" data-action="nav" data-page="${p.id}">${ic(p.icon)}<span>${t(p.k)}</span></button>`).join('')}</div>
`;
    $('#tabbar').innerHTML = PAGES.map(p =>
      `<button class="${UI.page === p.id ? 'on' : ''}" data-action="nav" data-page="${p.id}">${ic(p.icon)}<span>${t(p.k)}</span></button>`).join('');
  }

  /* ---- 指标卡 ---- */
  /** 迷你走势（卡片底部的淡色背景曲线），values 为数值数组 */
  function sparkSVG(values, color) {
    const v = values.filter(x => x != null && isFinite(x));
    if (v.length < 2) return '';
    const lo = Math.min(...v), hi = Math.max(...v), rg = hi - lo || 1;
    const pts = v.map((x, i) => [(i / (v.length - 1)) * 100, 36 - ((x - lo) / rg) * 30]);
    const d = 'M' + pts.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join('L');
    const id = 'sp' + Math.random().toString(36).slice(2, 7);
    return `<svg class="spark" viewBox="0 0 100 40" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".32"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <path d="${d}L100,40L0,40Z" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
  }
  /** 总资产走势序列（取自每日快照，单位 USD，仅用于画形状） */
  function netSeries(kind) {
    const keys = snapKeys(), tk = todayKey();
    let ks;
    if (kind === 'net') ks = keys.slice(-30);
    else if (kind === 'day') ks = keys.slice(-8);
    else {
      const start = periodStart(kind);
      const before = keys.filter(k => k < start).pop();
      ks = (before ? [before] : []).concat(keys.filter(k => k >= start && k <= tk));
    }
    const out = ks.map(k => DB.snaps[k].c);
    if (kind === 'year' && out.length > 120) return out.filter((_, i) => i % Math.ceil(out.length / 120) === 0 || i === out.length - 1);
    return out;
  }
  /** 某类别近 30 天市值序列（用快照里的单价 × 当前数量） */
  function classSeries(c) {
    const list = DB.assets.filter(a => primary(a) === c && !isBalance(a));
    if (!list.length) return [];
    return snapKeys().slice(-30).filter(k => DB.snaps[k].p).map(k => {
      const p = DB.snaps[k].p;
      return list.reduce((s, a) => s + conv((+a.qty || 0) * (p[a.id] != null ? p[a.id] : +a.price || 0), aCcy(a), 'USD'), 0);
    });
  }
  function kpiCard(o) {
    return `<div class="kpi glass ${o.cls || ''}" ${o.attr || ''}>
      <div class="lbl"><span class="ico">${ic(o.icon)}</span>${o.label}</div>
      <div class="val num">${o.val}</div>
      <div class="sub">${o.sub || ''}</div>${o.spark || ''}${o.extra || ''}</div>`;
  }
  /* ---- 指标卡：日历按钮 / 历史日期标签 ---- */
  const kd = k => ((UI.kd || {})[k] || '');
  const calBtn = k => `<button class="eye-mini cal-mini ${kd(k) ? 'on' : ''}" data-action="kpi-cal" data-k="${k}" title="${t('calTip')}" aria-label="${t('calTip')}">${ic('cal')}</button>`;
  function kdLabel(v) {
    if (v.length === 4) return zh() ? v + '年' : v;
    if (v.length === 7) return zh() ? `${v.slice(0, 4)}年${+v.slice(5)}月` : `${t('mon' + (+v.slice(5) - 1))} ${v.slice(0, 4)}`;
    return `${v.slice(5).replace('-', '/')} ${t('wd' + ((new Date(v + 'T00:00:00').getDay() + 6) % 7))}`;
  }
  const kdChip = k => `<button class="day-chip sm" data-action="kpi-live" data-k="${k}" title="${t('rankCalToday')}">${kdLabel(kd(k))}${ic('x')}</button>`;
  /** 取历史值；那天没数据就回到实时 */
  function kdHist(k, fn) {
    const v = kd(k); if (!v) return null;
    const r = fn(v); if (!r) { UI.kd[k] = ''; return null; }
    return r;
  }
  const kdSub = (k, r) => `${kdChip(k)} <b class="num ${upDown(r.pnl)}">${pct(r.pct)}</b>${r.est ? ` <span class="est-tag" title="${t('calEstTip')}">${t('calEst')}</span>` : ''}`;
  function refreshKpis() {
    renderKPIs();
    const el = $('.kpis-dual'); if (el) el.outerHTML = classKpisHTML();
  }
  /** 投资总盈亏：所有非余额型资产的（市值 − 成本）合计 */
  function investTotal() {
    let v = 0, c = 0;
    DB.assets.forEach(a => { if (isBalance(a)) return; v += aValD(a); c += aCostD(a); });
    return { pnl: v - c, v, c, pct: c ? ((v - c) / Math.abs(c)) * 100 : 0 };
  }
  /** 第四张卡：投资年盈亏 ⇄ 投资总盈亏（底部图标翻转） */
  function yearFlipHTML(anim) {
    const C = colors(), col = v => (v > 1e-9 ? C.up : v < -1e-9 ? C.down : '#8E8E93'), face = UI.yearFace || 'year';
    const btn = `<button class="flip-btn" data-action="flip-year" title="${face === 'year' ? t('flipToTotal') : t('flipToYear')}" aria-label="${face === 'year' ? t('flipToTotal') : t('flipToYear')}">${ic('swap')}</button>`;
    if (face === 'year') {
      const h = kdHist('year', invYear), r = h || periodPnl('year');
      return kpiCard({ cls: `${tone(r.pnl)} flip-card ${anim || ''}`, attr: 'id="year-flip"', icon: 'sparkle', label: t('kpiYear') + calBtn('year'), val: moneyHTML(r.pnl, { sign: true }),
        sub: h ? kdSub('year', h) : `${t('vsYear')} <b class="num">${pct(r.pct)}</b>`, spark: sparkSVG(netSeries('year'), col(r.pnl)), extra: btn });
    }
    const h = kdHist('total', invTotalAt), r = h || investTotal();
    return kpiCard({ cls: `${tone(r.pnl)} flip-card ${anim || ''}`, attr: 'id="year-flip"', icon: 'pie', label: t('kpiInvTotal') + calBtn('total'), val: moneyHTML(r.pnl, { sign: true }),
      sub: h ? kdSub('total', h) : `${t('costBasis')} ${money(r.c)} · <b class="num">${pct(r.pct)}</b>`, extra: btn });
  }
  /** 第一行：所有页面固定显示 */
  function renderKPIs() {
    const net = netD(), C = colors(), accent = '#FF9000';
    const col = v => (v > 1e-9 ? C.up : v < -1e-9 ? C.down : '#8E8E93');
    const pnlCard = (label, icon, live, ref, kind, fn) => {
      const h = kdHist(kind, fn), r = h || live;
      return kpiCard({
        cls: tone(r.pnl), icon, label: label + calBtn(kind),
        val: moneyHTML(r.pnl, { sign: true }),
        sub: h ? kdSub(kind, h) : `${ref} <b class="num">${pct(r.pct)}</b>`,
        spark: sparkSVG(netSeries(kind), col(r.pnl))
      });
    };
    $('#kpis').innerHTML =
      kpiCard({ cls: 'hero', icon: 'wallet', label: `${t('kpiNet')}<button class="eye-mini" data-action="toggle-total" title="${t('hideTotal')}">${ic(S().hideTotal ? 'eyeoff' : 'eye')}</button>`,
        val: `<span class="net-val">${S().hideTotal ? MASK : moneyHTML(net)}</span>`, sub: `${t('quoteAt')}: ${timeStr(DB.lastQuote)} · ${t('nAssets', { n: DB.assets.length })}`, spark: sparkSVG(netSeries('net'), accent) }) +
      pnlCard(t('kpiDay'), 'trend', periodPnl('day'), t('vsDay'), 'day', d => invDay(d)) +
      pnlCard(t('kpiMonth'), 'cal', periodPnl('month'), t('vsMonth'), 'month', invMonth) +
      yearFlipHTML();
  }
  /** 第二行：仅资产总览页 —— 每个类别一张卡，左“总盈亏”右“日盈亏” */
  function classKpisHTML() {
    return `<section class="kpis kpis-dual">${PNL_CLASSES.map(c => c === 'fund' ? fundFlipHTML() : classCardHTML(c)).join('')}</section>`;
  }
  /** 某一类别的“总盈亏 / 日盈亏”双栏卡片 */
  function classCardHTML(c, extra) {
    const icon = { stock: 'trend', crypto: 'bolt', gold: 'sparkle', fund: 'pie' }, C = colors();
    const col = v => (v > 1e-9 ? C.up : v < -1e-9 ? C.down : '#8E8E93');
    const tot = classTotal(c), name = clsName(c), ck = 'cls_' + c;
    const h = kdHist(ck, d => invDay(d, c)), day = h || periodPnl('day', DB.assets.filter(a => primary(a) === c));
    return `<div class="kpi glass dual ${tone(tot.pnl)} ${extra ? extra.cls : ''}" ${extra ? extra.attr : ''}>
        <div class="dual-grid">
          <div><div class="lbl"><span class="ico">${ic(icon[c])}</span>${t('kpiClsTotal', { c: name })}</div>
            <div class="val num ${upDown(tot.pnl)}">${moneyHTML(tot.pnl, { sign: true })}</div>
            <div class="sub">${t('mktValue')} ${money(tot.v)} · <b class="num ${upDown(tot.pnl)}">${pct(tot.pct)}</b></div></div>
          <div class="dual-r"><div class="lbl">${t('kpiClsDay', { c: name })}${calBtn(ck)}</div>
            <div class="val num ${upDown(day.pnl)}">${moneyHTML(day.pnl, { sign: true })}</div>
            <div class="sub">${h ? kdSub(ck, h) : `${t('vsDay')} <b class="num ${upDown(day.pnl)}">${pct(day.pct)}</b>`}</div></div>
        </div>${sparkSVG(classSeries(c), col(tot.pnl))}${extra ? extra.btn : ''}</div>`;
  }
  /** 现金：总余额（主类别为现金的资产市值合计）+ 今日记账收入 / 支出 */
  function cashStats() {
    const list = DB.assets.filter(a => primary(a) === 'cash');
    const total = list.reduce((s2, a) => s2 + aValD(a), 0);
    const st = statsOf(x => x.date === todayKey());
    const series = snapKeys().slice(-30).filter(k => DB.snaps[k].b).map(k => list.reduce((s2, a) => s2 + conv(DB.snaps[k].b[a.id] != null ? DB.snaps[k].b[a.id] : 0, aCcy(a), 'USD'), 0));
    return { total, n: list.length, inc: st.inc, exp: st.exp, series };
  }
  /** 第四张卡：默认显示现金，底部中间按钮翻转到基金 */
  function fundFlipHTML(anim) {
    const face = UI.fundFace || 'cash';
    const btn = `<button class="flip-btn" data-action="flip-fund" title="${face === 'cash' ? t('flipToFund') : t('flipToCash')}" aria-label="${face === 'cash' ? t('flipToFund') : t('flipToCash')}">${ic('swap')}</button>`;
    const extra = { cls: 'flip-card ' + (anim || ''), attr: 'id="fund-flip"', btn };
    if (face === 'fund') return classCardHTML('fund', extra);
    const cs = cashStats();
    return `<div class="kpi glass dual cash-face ${extra.cls}" ${extra.attr}>
        <div class="dual-grid">
          <div><div class="lbl"><span class="ico">${ic('wallet')}</span>${t('cashTotal')}</div>
            <div class="val num">${moneyHTML(cs.total)}</div>
            <div class="sub">${t('cls_cash')} · ${t('nItems', { n: cs.n })}</div></div>
          <div class="dual-r"><div class="lbl">${t('cashDayInc')}</div>
            <div class="val num ${cs.inc > 0 ? 'up' : ''}">${moneyHTML(cs.inc, { sign: cs.inc > 0 })}</div>
            <div class="sub">${t('cashDayExp')} <b class="num ${cs.exp > 0 ? 'down' : ''}">${money(-cs.exp, { sign: cs.exp > 0 })}</b></div></div>
        </div>${sparkSVG(cs.series, '#BF5AF2')}${btn}</div>`;
  }
  function renderFoot() {
    $('#foot').innerHTML = `<b>${esc(bookName())}</b> · ${t('footLocal')} · AssetHub v${APP_VER}`;
  }
  function renderPage() {
    closePopover();
    // 订阅明细、数据设置不显示顶部的总资产 / 投资盈亏指标卡
    const k = $('#kpis'); if (k) k.style.display = ['subs', 'settings'].includes(UI.page) ? 'none' : '';
    ({ overview: renderOverview, holdings: renderHoldings, ledger: renderLedger, subs: renderSubs, settings: renderSettings })[UI.page]();
  }
  function emptyState(kind) {
    if (kind === 'assets') return `<div class="empty"><div class="em">🪙</div><h4>${t('emptyAssets')}</h4><p>${t('emptyAssetsSub')}</p>
      <div class="btns"><button class="btn btn-accent sm" data-action="add-asset">${ic('plus')}${t('addAsset')}</button><button class="btn btn-glass sm" data-action="demo">${ic('sparkle')}${t('loadDemo')}</button></div></div>`;
    if (kind === 'nomatch') return `<div class="empty"><div class="em">🔍</div><h4>${t('noMatch')}</h4><p>${t('noMatchSub')}</p></div>`;
    return `<div class="empty"><div class="em">🧾</div><h4>${t('emptyTx')}</h4><p>${t('emptyTxSub')}</p>
      <div class="btns"><button class="btn btn-accent sm" data-action="add-tx">${ic('plus')}${t('addTx')}</button></div></div>`;
  }
  const liveBadge = () => `<span class="live"><i></i>${t('live')}</span>`;
  const clsOptions = (sel, withAll) => (withAll ? `<option value="all" ${sel === 'all' ? 'selected' : ''}>${t('allCls')}</option>` : '') +
    clsKeys().map(c => `<option value="${c}" ${sel === c ? 'selected' : ''}>${clsName(c)}</option>`).join('');

  /* ================= 页面一：资产总览 ================= */
  function renderOverview() {
    const recent = sortTxDate(DB.txs.slice()).slice(0, 6);
    const mode = S().trendMode;

    $('#page').innerHTML = `
      ${classKpisHTML()}
      <div class="grid g-ov">
        <div class="card glass">
          <div class="card-head"><div class="card-title"><div class="seg seg-title sm">
              <button class="${S().leftMode !== 'rank' ? 'on' : ''}" data-action="left-mode" data-v="alloc">${t('allocTitle')}</button>
              <button class="${S().leftMode === 'rank' ? 'on' : ''}" data-action="left-mode" data-v="rank">${t('rankTitle')}</button></div>${liveBadge()}</div>
            <div class="head-tools" id="left-tools"></div></div>
          <div id="left-body"></div>
        </div>
        <div class="card glass">
          <div class="card-head"><div class="card-title"><div class="seg seg-title sm">
              <button class="${S().rankMode !== 'total' ? 'on' : ''}" data-action="rank-mode" data-v="day">${t('rankDayTitle')}</button>
              <button class="${S().rankMode === 'total' ? 'on' : ''}" data-action="rank-mode" data-v="total">${t('rankTotalTitle')}</button></div><span id="rank-live">${liveBadge()}</span></div>
            <div class="head-tools"><span id="rank-cal"></span><span id="sort-moveSort">${sortBtnHTML('moveSort')}</span><button class="pill-select" data-action="rank-menu" data-key="moveCls" id="pill-moveCls">${rankPillHTML('moveCls')}</button>
            <button class="link" data-action="nav" data-page="holdings">${t('viewAll')}${ic('chev-r')}</button></div></div>
          <div id="rank"></div>
        </div>
      </div>
      <div class="card glass mb">
        <div class="card-head">
          <div class="seg seg-title">
            <button class="${mode === 'asset' ? 'on' : ''}" data-action="trend-mode" data-v="asset">${t('assetTrendTitle')}</button>
            <button class="${mode === 'flow' ? 'on' : ''}" data-action="trend-mode" data-v="flow">${t('trendTitle')}</button>
          </div>
          <div class="head-tools" id="trend-tools"></div>
        </div>
        <div class="chart-legend" id="trend-legend"></div>
        <div class="chart" id="trend"></div>
      </div>
      <div class="card glass">
        <div class="card-head"><div class="card-title">${t('recentTitle')}</div>
          <div class="head-tools"><button class="btn btn-soft sm" data-action="add-tx">${ic('plus')}${t('addTx')}</button><button class="link" data-action="nav" data-page="ledger">${t('viewAll')}${ic('chev-r')}</button></div></div>
        ${recent.length ? `<div class="tx-list">${recent.map(x => txRowHTML(x, false)).join('')}</div>` : emptyState('tx')}
      </div>`;

    renderLeft();
    renderMoves();
    drawTrend();
  }
  /** 左侧卡片：资产占比（圆环）/ 资产排行（按市值），点击标题切换 */
  /** 颜色变浅 / 变深（用于同一类别下各资产的配色） */
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const m = v => Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f));
    return '#' + [m(r), m(g), m(b)].map(v => v.toString(16).padStart(2, '0')).join('');
  }
  function renderLeft() {
    const body = $('#left-body'); if (!body) return;
    // 资产排行只在资产总占比下可用
    $$('[data-action="left-mode"][data-v="rank"]').forEach(b => { b.disabled = !!UI.allocCls; b.title = UI.allocCls ? t('rankOnlyTotal') : ''; });
    if (S().leftMode === 'rank' && !UI.allocCls) {
      $('#left-tools').innerHTML = `${sortBtnHTML('rankSort')}<button class="pill-select" data-action="rank-menu" data-key="rankCls" id="pill-rankCls">${rankPillHTML('rankCls')}</button>
        <button class="link" data-action="nav" data-page="holdings">${t('viewAll')}${ic('chev-r')}</button>`;
      renderRank();
      return;
    }
    const so = S().allocSort === 'asc' ? 'asc' : 'desc', drill = UI.allocCls;
    $('#left-tools').innerHTML = `${drill ? `<button class="back-pill" data-action="alloc-back">${ic('chev-l')}${t('backAlloc')}</button>` : ''}<button class="icon-btn sm sort-btn" data-action="alloc-sort" title="${t('allocSortTip')} · ${t('allocSort_' + so)}">${ic(so === 'asc' ? 'sortasc' : 'sortdesc')}</button>`;
    if (!DB.assets.length) { body.innerHTML = emptyState('assets'); return; }
    const net = netD();
    let segs, rows, center;
    if (!drill) {
      // 资产总占比：按“主类别”统计；负债不进圆环，单独列出
      const by = {}; clsKeys().forEach(c => { by[c] = 0; });
      DB.assets.forEach(a => { by[primary(a)] += aValD(a); });
      const order = clsKeys().filter(c => c !== 'liability');
      order.sort((x, y) => (so === 'asc' ? by[x] - by[y] : by[y] - by[x]));
      order.push('liability');
      segs = order.filter(c => c !== 'liability').map(c => ({ key: c, label: clsName(c), value: Math.max(0, by[c]), color: clsColor(c) }));
      const pos = segs.reduce((x, y) => x + y.value, 0);
      rows = order.map(c => ({ key: c, label: clsName(c), color: clsColor(c), v: by[c], p: c === 'liability' ? null : (pos ? (Math.max(0, by[c]) / pos) * 100 : 0), click: DB.assets.some(a => primary(a) === c) }));
      center = k => {
        if (!k) return `<div class="t">${t('kpiNet')}</div><div class="v num">${money(net)}</div><div class="p">${t('nAssets', { n: DB.assets.length })}</div><div class="p dim2">${t('allocDrillTip')}</div>`;
        const sg = segs.find(x => x.key === k);
        return `<div class="t">${sg.label}</div><div class="v num">${money(sg.value)}</div><div class="p">${pos ? ((sg.value / pos) * 100).toFixed(2) : 0}%</div>`;
      };
    } else {
      // 某一类别的占比：类别内每项资产的占比（负债按绝对值画圆环）
      const list = DB.assets.filter(a => primary(a) === drill).map(a => ({ a, v: aValD(a) }));
      list.sort((x, y) => (so === 'asc' ? Math.abs(x.v) - Math.abs(y.v) : Math.abs(y.v) - Math.abs(x.v)));
      const base = clsColor(drill), n = list.length;
      const color = i => (n <= 1 ? base : shade(base, -0.35 + (0.9 * i) / (n - 1)));
      segs = list.map((x, i) => ({ key: x.a.id, label: x.a.name, value: Math.abs(x.v), color: color(i) }));
      const tot = list.reduce((x, y) => x + y.v, 0), absTot = segs.reduce((x, y) => x + y.value, 0);
      const allPos = DB.assets.reduce((x, a) => x + Math.max(0, aValD(a)), 0);
      rows = list.map((x, i) => ({ key: x.a.id, label: x.a.name, sub: x.a.code || '', wh: x.a.warehouse || '', color: color(i), v: x.v, p: absTot ? (Math.abs(x.v) / absTot) * 100 : 0, click: false }));
      center = k => {
        if (!k) return `<div class="t">${t('clsAlloc', { c: clsName(drill) })}</div><div class="v num">${money(tot)}</div><div class="p">${drill === 'liability' ? t('nItems', { n }) : t('ofTotal', { p: (allPos ? (Math.max(0, tot) / allPos) * 100 : 0).toFixed(2) + '%' })}</div>`;
        const sg = segs.find(x => x.key === k), r = rows.find(x => x.key === k);
        return `<div class="t">${esc(sg.label)}</div><div class="v num">${money(r.v)}</div><div class="p">${r.p.toFixed(2)}%</div>`;
      };
    }
    const legend = rows.map(r => `<div class="legend-row lg-line ${r.click ? 'clickable' : ''}" data-k="${esc(r.key)}" ${r.click ? 'data-action="alloc-drill" data-v="' + r.key + '"' : ''}><i class="dot" style="background:${r.color}"></i>
        <div class="lg-name">${esc(r.label)}${r.sub ? `<span class="code">${esc(r.sub)}</span>` : ''}${r.wh ? `<span class="rk-wh">${esc(r.wh)}</span>` : ''}</div>
        <div class="lg-val num ${r.v < 0 ? 'down' : ''}">${money(r.v)}</div>
        <div class="lg-pct num">${r.p == null ? '—' : r.p.toFixed(1) + '%'}</div>
        <div class="lg-bar"><i style="width:${r.p || 0}%;background:${r.color}"></i></div>${r.click ? `<span class="lg-go">${ic('chev-r')}</span>` : ''}</div>`).join('');
    const head = drill ? `<div class="alloc-crumb"><button data-action="alloc-back">${t('backAlloc')}</button>${ic('chev-r')}<b style="--tc:${clsColor(drill)}">${t('clsAlloc', { c: clsName(drill) })}</b></div>` : '';
    body.innerHTML = `${head}<div class="donut-wrap ${UI.allocAnim || ''}"><div class="donut ${drill ? 'drilled' : 'drillable'}" id="donut"></div><div class="legend">${legend}</div></div>`;
    UI.allocAnim = '';
    const d = Charts.donut($('#donut'), segs, {
      id: drill ? 'alloc-' + drill : 'alloc',
      center,
      onHover: k => $$('.legend-row').forEach(r => r.classList.toggle('hl', r.dataset.k === k)),
      onClick: drill ? null : k => openAllocCls(k),
      onCenter: drill ? () => closeAllocCls() : null
    });
    $$('.legend-row').forEach(r => {
      r.addEventListener('mouseenter', () => { if (segs.some(x => x.key === r.dataset.k)) d.hl(r.dataset.k); });
      r.addEventListener('mouseleave', () => d.hl(null));
    });
  }
  /** 进入 / 返回某一类别的占比（带翻转动画） */
  function openAllocCls(c) {
    if (!c || !DB.assets.some(a => primary(a) === c)) return;
    UI.allocCls = c; UI.allocAnim = 'flip-in'; renderLeft();
  }
  function closeAllocCls() { UI.allocCls = null; UI.allocAnim = 'flip-in'; renderLeft(); }
  /** 排序切换按钮（由高到低 ⇄ 由低到高），key 为设置项名 */
  function sortBtnHTML(key) {
    const asc = S()[key] === 'asc';
    return `<button class="icon-btn sm sort-btn" data-action="sort-toggle" data-key="${key}" title="${t('allocSortTip')} · ${t(asc ? 'allocSort_asc' : 'allocSort_desc')}">${ic(asc ? 'sortasc' : 'sortdesc')}</button>`;
  }
  function rankPillHTML(key) {
    const c = S()[key || 'rankCls'];
    return `${c === 'all' ? '<i class="cdot all"></i>' : `<i class="cdot" style="background:${clsColor(c)}"></i>`}<span>${c === 'all' ? t('allCls') : clsName(c)}</span>${ic('chev-d')}`;
  }
  /** 资产排行的类别筛选菜单 */
  function openRankMenu(anchor) {
    if (popEl) { closePopover(); return; }
    const key = anchor.dataset.key || 'rankCls', cur = S()[key];
    const cnt = c => DB.assets.filter(a => inCls(a, c)).length;
    const pop = document.createElement('div');
    pop.className = 'popover menu';
    pop.innerHTML = ['all'].concat(clsKeys()).map(c => `<button class="menu-item ${cur === c ? 'on' : ''}" data-k="${c}">
      ${c === 'all' ? '<i class="cdot all"></i>' : `<i class="cdot" style="background:${clsColor(c)}"></i>`}
      <span>${c === 'all' ? t('allCls') : clsName(c)}</span><em>${cnt(c)}</em></button>`).join('');
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect(), w = pop.offsetWidth;
    pop.style.left = Math.max(12, Math.min(r.right - w, window.innerWidth - w - 12)) + window.scrollX + 'px';
    pop.style.top = r.bottom + 8 + window.scrollY + 'px';
    pop.addEventListener('click', e => {
      const b = e.target.closest('[data-k]'); if (!b) return;
      S()[key] = b.dataset.k; save(); closePopover();
      $('#pill-' + key).innerHTML = rankPillHTML(key);
      key === 'rankCls' ? renderRank() : renderMoves();
    });
    popEl = pop;
    popOutside = e => { if (!pop.contains(e.target) && !anchor.contains(e.target)) closePopover(); };
    document.addEventListener('pointerdown', popOutside, true);
  }
  /** 资产日变化排行：今日变化由大到小（正 → 0 → 负），现金余额变化、手动更新的市值变化都计入 */

  /* ---- 资产日盈亏：按日期查看历史排行 ----
     有记录（v5.6 起每天保存各资产日盈亏）的日子直接用记录；更早的日子用价格 / 余额快照按当前持有数量估算 */
  function histDay(k) {
    const sn = DB.snaps[k];
    if (!sn) return null;
    if (sn.d) {
      const rows = [];
      DB.assets.forEach(a => {
        const v = sn.d[a.id]; if (!v) return;
        const ch = conv(v[0], 'USD');
        rows.push({ a, ch, pct: v[1], base: v[2] != null ? conv(v[2], 'USD') : v[1] ? ch / (v[1] / 100) : 0 });
      });
      return { rows, est: false };
    }
    const keys = snapKeys(), i = keys.indexOf(k);
    if (!sn.p && !sn.b) return null;
    let prev = null;
    for (let j = i - 1; j >= 0; j--) { const ps = DB.snaps[keys[j]]; if (ps.p || ps.b) { prev = ps; break; } }
    if (!prev) return null;
    const rows = [];
    DB.assets.forEach(a => {
      const bal = isBalance(a), f = bal ? 'b' : 'p', cur = sn[f] && sn[f][a.id], ref = prev[f] && prev[f][a.id];
      if (cur == null || ref == null) return;
      const ccy = aCcy(a);
      if (bal) { const ch = conv(cur - ref, ccy), base = conv(ref, ccy); rows.push({ a, ch, base, pct: ref ? (ch / Math.abs(base)) * 100 : 0 }); return; }
      if ((a.createdAt || 0) > new Date(k + 'T23:59:59').getTime()) return;   // 那天之后才录入的资产不算
      const q = +a.qty || 0, ch = conv(q * (cur - ref), ccy), base = conv(q * ref, ccy);
      rows.push({ a, ch, base, pct: base ? (ch / Math.abs(base)) * 100 : 0 });
    });
    return { rows, est: true };
  }
  /** 日历格子里的短金额：≥1000 用 K / M，≥100 不带小数 */
  const calNum = v => {
    const a = Math.abs(v), sg = v > 0 ? '+' : v < 0 ? '-' : '';
    if (a >= 1e6) return sg + +(a / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return sg + +(a / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'K';
    return sg + fmtNum(a, 0, a >= 100 ? 0 : 2);
  };
  const daySum = k => { const h = histDay(k); return h ? h.rows.reduce((s2, x) => s2 + x.ch, 0) : null; };

  /* ---- 指标卡按日期查看 ----
     投资类 = 非现金 / 负债资产；类别卡只算主类别。今天用实时数据，历史用 histDay（记录或估算） */
  const isInv = a => !isBalance(a);
  function invDay(k, c) {
    const pick = a => isInv(a) && (!c || primary(a) === c);
    if (k === todayKey()) { const r = periodPnl('day', DB.assets.filter(pick)); return { pnl: r.pnl, pct: r.pct, est: false }; }
    const h = histDay(k); if (!h) return null;
    let pnl = 0, base = 0;
    h.rows.forEach(x => { if (pick(x.a)) { pnl += x.ch; base += x.base || 0; } });
    return { pnl, pct: base ? (pnl / Math.abs(base)) * 100 : 0, est: h.est };
  }
  /** 某个月 / 某一年的投资盈亏：按期初、期末快照价 × 当前数量计算（与实时卡片同一口径） */
  function invPeriod(start, end) {
    const tk = todayKey(), keys = snapKeys(), inP = keys.filter(k => k >= start && k <= end && k < tk);
    if (end >= tk) return null;
    const endTs = new Date(end + 'T23:59:59').getTime();
    let pnl = 0, base = 0, n = 0;
    DB.assets.forEach(a => {
      if (!isInv(a) || (a.createdAt || 0) > endTs) return;
      let pe = null;
      for (let i = inP.length - 1; i >= 0; i--) { const pm = DB.snaps[inP[i]].p; if (pm && pm[a.id] != null) { pe = pm[a.id]; break; } }
      if (pe == null) return;
      const ref = refPrice(a, start, keys), q = +a.qty || 0;
      pnl += conv(q * (pe - ref), aCcy(a)); base += conv(q * ref, aCcy(a)); n++;
    });
    // v7.3：统一按“期初价格 → 期末价格”计算（和本月 / 本年卡片同一口径），不再把每天的记录相加，避免休市日重复
    if (!n) return null;
    return { pnl, pct: base ? (pnl / Math.abs(base)) * 100 : 0, est: false };
  }
  const monthEnd = m => { const [y, mo] = m.split('-').map(Number); return `${m}-${String(new Date(y, mo, 0).getDate()).padStart(2, '0')}`; };
  const invMonth = m => (m === todayKey().slice(0, 7) ? Object.assign(periodPnl('month'), { est: false }) : invPeriod(m + '-01', monthEnd(m)));
  const invYear = y => (y === todayKey().slice(0, 4) ? Object.assign(periodPnl('year'), { est: false }) : invPeriod(y + '-01-01', y + '-12-31'));
  /** 某天收盘时的投资总盈亏：有记录用记录；否则 = 当前数量 × 那天的单价 − 当前成本（估算） */
  function invTotalAt(k) {
    if (k === todayKey()) { const r = investTotal(); return Object.assign(r, { est: false }); }
    const sn = DB.snaps[k]; if (!sn) return null;
    if (sn.tp) { const pnl = conv(sn.tp[0], 'USD'), c = conv(sn.tp[1], 'USD'); return { pnl, c, pct: c ? (pnl / Math.abs(c)) * 100 : 0, est: false }; }
    if (!sn.p) return null;
    const endTs = new Date(k + 'T23:59:59').getTime();
    let v = 0, c = 0, n = 0;
    DB.assets.forEach(a => {
      if (!isInv(a) || (a.createdAt || 0) > endTs || sn.p[a.id] == null) return;
      const q = +a.qty || 0; v += conv(q * sn.p[a.id], aCcy(a)); c += conv(q * (+a.cost || 0), aCcy(a)); n++;
    });
    if (!n) return null;
    return { pnl: v - c, c, pct: c ? ((v - c) / Math.abs(c)) * 100 : 0, est: true };
  }
  /** 日历弹窗（通用）：o.val(k) 返回当天要显示的数值（null = 没有数据，不能点），o.onPick(k) 选中某天 */
  function openDayCal(o, month) {
    const tk = todayKey(), keys = snapKeys(), first = keys[0] || tk;
    const cur = month || (o.sel || tk).slice(0, 7);
    const [y, mo] = cur.split('-').map(Number);
    const startDow = (new Date(y, mo - 1, 1).getDay() + 6) % 7, days = new Date(y, mo, 0).getDate();
    const shift = n => { const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
    const canPrev = shift(-1) >= first.slice(0, 7), canNext = shift(1) <= tk.slice(0, 7);
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push('<div class="cal-cell empty"></div>');
    let mSum = 0, mDays = 0;
    for (let d = 1; d <= days; d++) {
      const k = `${cur}-${String(d).padStart(2, '0')}`;
      const v = k > tk ? null : o.val(k);
      const has = v != null, sel = (o.sel || tk) === k;
      if (has) { mSum += v; mDays++; }
      cells.push(`<button type="button" class="cal-cell ${has ? upDown(v) || 'flat' : 'none'} ${sel ? 'sel' : ''} ${k === tk ? 'today' : ''}" ${has ? `data-day="${k}"` : 'disabled'}>
        <b>${d}</b><small class="num">${has ? (hidden() ? '•••' : calNum(v)) : ''}</small></button>`);
    }
    const dows = (S().lang === 'en' ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['一', '二', '三', '四', '五', '六', '日']).map(x => `<div class="cal-dow">${x}</div>`).join('');
    const title = S().lang === 'en' ? new Date(y, mo - 1, 1).toLocaleDateString('en-US', { year: 'numeric', month: 'long' }) : `${y} 年 ${mo} 月`;
    const subTxt = o.monthSum === false ? '' : mDays ? t('rankCalMonth', { v: money(mSum, { sign: true }) }) : t('rankCalNone');
    openModal({
      title: o.title,
      body: `<div class="cal-nav"><button class="icon-btn sm" data-cal-m="${shift(-1)}" ${canPrev ? '' : 'disabled'}>${ic('chev-l')}</button>
          <div class="cal-title"><b>${title}</b>${subTxt ? `<small class="num ${o.monthSum === false ? '' : upDown(mDays ? mSum : 0)}">${subTxt}</small>` : ''}</div>
          <button class="icon-btn sm" data-cal-m="${shift(1)}" ${canNext ? '' : 'disabled'}>${ic('chev-r')}</button></div>
        <div class="cal-grid">${dows}${cells.join('')}</div>
        <p class="hint" style="margin-top:12px">${o.hint || ''}</p>`,
      footer: `<button class="btn btn-glass" data-modal-close>${t('cancel')}</button><button class="btn btn-accent" data-cal-today>${ic('clock')}${t('rankCalToday')}</button>`,
      onMount(m) {
        m.addEventListener('click', e => {
          const nb = e.target.closest('[data-cal-m]'); if (nb && !nb.disabled) { openDayCal(o, nb.dataset.calM); return; }
          const db = e.target.closest('[data-day]');
          if (db || e.target.closest('[data-cal-today]')) { closeModal(); o.onPick(db ? db.dataset.day : tk); }
        });
      }
    });
  }
  /** 月份选择：o.val('YYYY-MM') */
  function openMonthCal(o, year) {
    const tk = todayKey(), first = (snapKeys()[0] || tk).slice(0, 4), cy = +tk.slice(0, 4);
    const yr = year || +(o.sel || tk).slice(0, 4);
    const cells = [];
    let ySum = 0, yN = 0;
    for (let i = 1; i <= 12; i++) {
      const m = `${yr}-${String(i).padStart(2, '0')}`;
      const v = m > tk.slice(0, 7) || m < (snapKeys()[0] || tk).slice(0, 7) ? null : o.val(m);
      const has = v != null;
      if (has) { ySum += v.pnl; yN++; }
      cells.push(`<button type="button" class="cal-cell mcell ${has ? upDown(v.pnl) || 'flat' : 'none'} ${(o.sel || tk.slice(0, 7)) === m ? 'sel' : ''} ${m === tk.slice(0, 7) ? 'today' : ''}" ${has ? `data-m="${m}"` : 'disabled'}>
        <b>${S().lang === 'en' ? t('mon' + (i - 1)) : i + '月'}</b><small class="num">${has ? (hidden() ? '•••' : calNum(v.pnl)) : ''}</small>${has && v.est ? '<em>≈</em>' : ''}</button>`);
    }
    openModal({
      title: o.title,
      body: `<div class="cal-nav"><button class="icon-btn sm" data-cal-y="${yr - 1}" ${yr - 1 >= +first ? '' : 'disabled'}>${ic('chev-l')}</button>
          <div class="cal-title"><b>${yr}${S().lang === 'en' ? '' : ' 年'}</b><small class="num ${upDown(yN ? ySum : 0)}">${yN ? t('calYearSum', { v: money(ySum, { sign: true }) }) : t('rankCalNone')}</small></div>
          <button class="icon-btn sm" data-cal-y="${yr + 1}" ${yr + 1 <= cy ? '' : 'disabled'}>${ic('chev-r')}</button></div>
        <div class="cal-grid m4">${cells.join('')}</div>
        <p class="hint" style="margin-top:12px">${o.hint || ''}</p>`,
      footer: `<button class="btn btn-glass" data-modal-close>${t('cancel')}</button><button class="btn btn-accent" data-cal-today>${ic('clock')}${t('calThisMonth')}</button>`,
      onMount(m) {
        m.addEventListener('click', e => {
          const nb = e.target.closest('[data-cal-y]'); if (nb && !nb.disabled) { openMonthCal(o, +nb.dataset.calY); return; }
          const db = e.target.closest('[data-m]');
          if (db || e.target.closest('[data-cal-today]')) { closeModal(); o.onPick(db ? db.dataset.m : tk.slice(0, 7)); }
        });
      }
    });
  }
  /** 年份选择：o.val('YYYY') */
  function openYearCal(o) {
    const tk = todayKey(), first = +(snapKeys()[0] || tk).slice(0, 4), cy = +tk.slice(0, 4), cells = [];
    for (let yr = cy; yr >= first; yr--) {
      const v = o.val(String(yr)), has = v != null;
      cells.push(`<button type="button" class="cal-cell ycell ${has ? upDown(v.pnl) || 'flat' : 'none'} ${(o.sel || String(cy)) === String(yr) ? 'sel' : ''} ${yr === cy ? 'today' : ''}" ${has ? `data-y="${yr}"` : 'disabled'}>
        <b>${yr}</b><small class="num">${has ? (hidden() ? MASK : money(v.pnl, { sign: true })) + ` · ${pct(v.pct)}` : ''}</small>${has && v.est ? '<em>≈</em>' : ''}</button>`);
    }
    openModal({
      title: o.title,
      body: `<div class="cal-grid y1">${cells.join('')}</div><p class="hint" style="margin-top:12px">${o.hint || ''}</p>`,
      footer: `<button class="btn btn-glass" data-modal-close>${t('cancel')}</button><button class="btn btn-accent" data-cal-today>${ic('clock')}${t('calThisYear')}</button>`,
      onMount(m) {
        m.addEventListener('click', e => {
          const db = e.target.closest('[data-y]');
          if (db || e.target.closest('[data-cal-today]')) { closeModal(); o.onPick(db ? db.dataset.y : String(cy)); }
        });
      }
    });
  }
  /** 资产日盈亏排行的日历 */
  function openRankCal() {
    const tk = todayKey();
    openDayCal({
      title: t('rankCalT'), sel: UI.rankDay, hint: t('rankCalHint'),
      val: k => (k === tk ? DB.assets.reduce((s2, a) => s2 + dayChange(a).ch, 0) : daySum(k)),
      onPick: k => { UI.rankDay = k === tk ? '' : k; renderMoves(); }
    });
  }
  /** 指标卡日历：day / month / year / total / cls_stock … */
  function openKpiCal(k) {
    const tk = todayKey(), sel = (UI.kd || {})[k] || '';
    const pick = v => { UI.kd = UI.kd || {}; UI.kd[k] = v; refreshKpis(); };
    if (k === 'month') return openMonthCal({ title: t('kpiCalT_month'), sel, hint: t('kpiCalHint_period'), val: invMonth, onPick: m => pick(m === tk.slice(0, 7) ? '' : m) });
    if (k === 'year') return openYearCal({ title: t('kpiCalT_year'), sel, hint: t('kpiCalHint_period'), val: invYear, onPick: y => pick(y === tk.slice(0, 4) ? '' : y) });
    if (k === 'total') return openDayCal({ title: t('kpiCalT_total'), sel, monthSum: false, hint: t('kpiCalHint_total'), val: d => { const r = invTotalAt(d); return r ? r.pnl : null; }, onPick: d => pick(d === tk ? '' : d) });
    const c = k.startsWith('cls_') ? k.slice(4) : '';
    openDayCal({ title: c ? t('kpiCalT_cls', { c: clsName(c) }) : t('kpiCalT_day'), sel, hint: t('kpiCalHint_day'),
      val: d => { const r = invDay(d, c); return r ? r.pnl : null; }, onPick: d => pick(d === tk ? '' : d) });
  }
  function renderMoves() {
    if (!$('#rank')) return;
    const total = S().rankMode === 'total', c = S().moveCls, keys = snapKeys();
    if (UI.rankDay && (UI.rankDay >= todayKey() || !DB.snaps[UI.rankDay])) UI.rankDay = '';
    const day = !total && UI.rankDay ? UI.rankDay : '', hist = day ? histDay(day) : null;
    // 标题旁：今天显示“实时”，历史日期显示日期标签（点 × 回到今天）；日历按钮只在资产日盈亏下出现
    const cal = $('#rank-cal'), live = $('#rank-live');
    if (cal) cal.innerHTML = total ? '' : `<button class="icon-btn sm cal-btn ${day ? 'on' : ''}" data-action="rank-cal" title="${t('rankCalT')}">${ic('cal')}</button>`;
    if (live) live.innerHTML = day ? `<button class="day-chip" data-action="rank-today" title="${t('rankCalToday')}">${ic('cal')}${day.slice(5).replace('-', '/')} ${t('wd' + ((new Date(day + 'T00:00:00').getDay() + 6) % 7))}${ic('x')}</button>` : liveBadge();
    const src = day ? (hist ? hist.rows : []) : DB.assets.map(a => Object.assign({ a }, total ? totalChange(a) : dayChange(a, keys)));
    const list = src.filter(x => inCls(x.a, c)).sort((x, y) => (S().moveSort === 'asc' ? x.ch - y.ch : y.ch - x.ch));
    const top = Math.max(1e-9, ...list.map(x => Math.abs(x.ch)));
    const sum = list.reduce((s, x) => s + x.ch, 0);
    $('#rank').innerHTML = !DB.assets.length ? emptyState('assets') : day && !hist ? `<div class="empty sm"><p>${t('rankCalNoData')}</p></div>` : !list.length ? `<div class="empty sm"><p>${t('noMatchCls')}</p></div>` :
      `<div class="rank-sum">${day ? t('rankDaySumOn', { d: day.slice(5).replace('-', '/') }) : t(total ? 'rankTotalSum' : 'rankDaySum')} <b class="num ${upDown(sum)}">${money(sum, { sign: true })}</b><span class="dim">· ${day ? t(hist && hist.est ? 'rankDayEst' : 'rankDayRec') : t(total ? 'rankTotalHint' : 'rankDayHint')}</span></div>
      <div class="rank rank-scroll">${list.map((x, i) => {
        const a = x.a, z = Math.abs(x.ch) < 0.005;
        return `<div class="rank-row ${z ? 'zero' : ''}">
          <span class="rank-no">${i + 1}</span>
          <div style="min-width:0"><div class="rank-name"><i class="cdot" style="background:${clsColor(primary(a))}"></i><span class="nm">${esc(a.name)}</span>${a.code ? `<span class="code">${esc(a.code)}</span>` : ''}${a.locked ? ic('lock', 'lk') : ''}${a.warehouse ? `<span class="rk-wh">${esc(a.warehouse)}</span>` : ''}</div>
            <div class="bar"><i style="width:${z ? 0 : Math.max(2, (Math.abs(x.ch) / top) * 100)}%;background:${x.ch < 0 ? 'var(--down)' : 'var(--up)'}"></i></div></div>
          <div class="rank-val num ${z ? 'dim' : upDown(x.ch)}">${z ? '—' : money(x.ch, { sign: true })}<small class="${z ? 'dim' : upDown(x.ch)}">${z ? t('noChange') : pct(x.pct)}${day ? '' : ' · ' + money(aValD(a))}</small></div>
        </div>`;
      }).join('')}</div>`;
  }
  function renderRank() {
    if (!$('#left-body') || S().leftMode !== 'rank') return;
    const c = S().rankCls;
    let list = DB.assets.filter(a => inCls(a, c)).map(a => ({ a, v: aValD(a) }));
    list = list.filter(x => x.v > 0 || c !== 'all');   // 全部类别时不显示负债 / 零值
    const asc = S().rankSort === 'asc';
    // 负债类别按欠款多少排（由多到少为“高到低”）
    if (c === 'liability') list.sort((x, y) => (asc ? y.v - x.v : x.v - y.v)); else list.sort((x, y) => (asc ? x.v - y.v : y.v - x.v));
    // 显示全部资产，框内滚动
    const topV = list.length ? Math.max(...list.map(x => Math.abs(x.v))) || 1 : 1;
    const total = DB.assets.reduce((s, a) => s + Math.max(0, aValD(a)), 0) || 1;
    $('#left-body').innerHTML = !DB.assets.length ? emptyState('assets') : !list.length ? `<div class="empty sm"><p>${t('noMatchCls')}</p></div>` :
      `<div class="rank rank-scroll">${list.map((x, i) => {
        const a = x.a, bal = isBalance(a), cost = aCostD(a), pnl = x.v - cost;
        return `<div class="rank-row">
          <span class="rank-no">${i + 1}</span>
          <div style="min-width:0"><div class="rank-name"><i class="cdot" style="background:${clsColor(primary(a))}"></i><span class="nm">${esc(a.name)}</span>${a.code ? `<span class="code">${esc(a.code)}</span>` : ''}${a.locked ? ic('lock', 'lk') : ''}${a.warehouse ? `<span class="rk-wh">${esc(a.warehouse)}</span>` : ''}</div>
            <div class="bar"><i style="width:${Math.max(2, (Math.abs(x.v) / topV) * 100)}%;${x.v < 0 ? 'background:var(--down)' : ''}"></i></div></div>
          <div class="rank-val num ${x.v < 0 ? 'down' : ''}">${money(x.v)}<small class="${bal ? 'dim' : upDown(pnl)}">${bal ? ((Math.max(0, x.v) / total) * 100).toFixed(1) + '% · ' + clsLabel(a) : pct(cost ? (pnl / Math.abs(cost)) * 100 : 0)}</small></div>
        </div>`;
      }).join('')}</div>`;
  }

  /* ---- 收支趋势 / 资产趋势 ---- */
  function drawTrend() {
    if (!$('#trend')) return;
    if (S().trendMode === 'asset') drawAssetTrend(); else drawFlowTrend();
  }
  function flowData(range) {
    const now = new Date(), tk = todayKey();
    const keys = [], labels = [], tips = [];
    if (range === 'week') {
      const dow = (now.getDay() + 6) % 7;
      for (let i = 0; i < 7; i++) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + i);
        keys.push(ymd(d)); labels.push(t('wd' + i)); tips.push(`${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${t('wd' + i)}`);
      }
    } else if (range === 'month') {
      const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      for (let i = 1; i <= dim; i++) {
        const d = new Date(now.getFullYear(), now.getMonth(), i);
        keys.push(ymd(d)); labels.push(String(i)); tips.push(dayLabel(ymd(d)));
      }
    } else {
      for (let i = 0; i < 12; i++) {
        keys.push(`${now.getFullYear()}-${pad(i + 1)}`); labels.push(t('mon' + i));
        tips.push(zh() ? `${now.getFullYear()}年${i + 1}月` : `${t('mon' + i)} ${now.getFullYear()}`);
      }
    }
    const map = {};
    keys.forEach(k => { map[k] = { inc: 0, exp: 0 }; });
    DB.txs.forEach(x => {
      const k = range === 'year' ? x.date.slice(0, 7) : x.date;
      if (!map[k]) return;
      if (x.type === 'transfer') { map[k].exp += feeD(x); map[k].inc += bonusD(x); return; }
      if (x.type === 'income') map[k].inc += txD(x); else map[k].exp += txD(x);
    });
    const cur = range === 'year' ? tk.slice(0, 7) : tk;
    return { labels, tips, inc: keys.map(k => (k > cur ? null : map[k].inc)), exp: keys.map(k => (k > cur ? null : map[k].exp)) };
  }
  function drawFlowTrend() {
    const range = S().chartRange, D = flowData(range), C = colors();
    $('#trend-tools').innerHTML = `
      <div class="seg">${['week', 'month', 'year'].map(r => `<button class="${range === r ? 'on' : ''}" data-action="range" data-v="${r}">${t('r_' + r)}</button>`).join('')}</div>
      <label class="mini-select">${t('yStep')}<select data-change="yStep">${['auto', '10', '100', '1000', '10000'].map(v =>
        `<option value="${v}" ${String(S().yStep) === v ? 'selected' : ''}>${v === 'auto' ? t('auto') : symOf(S().ccy) + fmtNum(+v, 0, 0)}</option>`).join('')}</select></label>`;
    const sumI = D.inc.reduce((s, v) => s + (v || 0), 0), sumE = D.exp.reduce((s, v) => s + (v || 0), 0);
    $('#trend-legend').innerHTML = `<span><i style="background:${C.up}"></i>${t('income')} <b class="num">${money(sumI)}</b></span>
      <span><i style="background:${C.down}"></i>${t('expense')} <b class="num">${money(sumE)}</b></span>
      <span>${t('balance')} <b class="num ${upDown(sumI - sumE)}">${money(sumI - sumE, { sign: true })}</b></span>`;
    const sym = symOf(S().ccy);
    Charts.line($('#trend'), {
      labels: D.labels, step: S().yStep,
      series: [{ name: t('income'), color: C.up, values: D.inc }, { name: t('expense'), color: C.down, values: D.exp }],
      fmtY: v => (hidden() ? '' : sym + compact(v)),
      tip: i => `<div class="tt">${D.tips[i]}</div>
        <div class="tr"><span><i style="background:${C.up}"></i>${t('income')}</span><b class="num">${money(D.inc[i] || 0)}</b></div>
        <div class="tr"><span><i style="background:${C.down}"></i>${t('expense')}</span><b class="num">${money(D.exp[i] || 0)}</b></div>
        <div class="tr"><span>${t('balance')}</span><b class="num">${money((D.inc[i] || 0) - (D.exp[i] || 0), { sign: true })}</b></div>`
    });
  }
  /** 总资产 K 线数据：月内（每日）/ 年内（每月）/ 日K（全部每日） */
  function assetBars(range) {
    recordSnap();
    const keys = snapKeys(), now = new Date();
    const cv = v => conv(v, 'USD');
    const mk = (k, s, label, tip) => ({ key: k, label, tip, o: cv(s.o), h: cv(s.h), l: cv(s.l), c: cv(s.c) });
    // 月 / 年：把每日快照合并成月线 / 年线（开 = 第一天开，收 = 最后一天收，高低取极值）
    if (range === 'month' || range === 'year') {
      const len = range === 'month' ? 7 : 4, groups = {};
      keys.forEach(k => { (groups[k.slice(0, len)] = groups[k.slice(0, len)] || []).push(k); });
      return Object.keys(groups).sort().map(g => {
        const ss = groups[g].map(k => DB.snaps[k]), y = g.slice(0, 4), m = +g.slice(5, 7);
        return { key: g, label: range === 'month' ? `${y.slice(2)}/${g.slice(5, 7)}` : y,
          tip: range === 'month' ? (zh() ? `${y}年${m}月` : `${t('mon' + (m - 1))} ${y}`) : (zh() ? `${y}年` : y),
          o: cv(ss[0].o), c: cv(ss[ss.length - 1].c), h: cv(Math.max(...ss.map(x => x.h))), l: cv(Math.min(...ss.map(x => x.l))) };
      });
    }
    return keys.map(k => mk(k, DB.snaps[k], `${k.slice(5, 7)}/${k.slice(8)}`, dayLabel(k) + ' ' + k.slice(0, 4)));
  }
  function drawAssetTrend() {
    const s = S(), range = s.assetRange, C = colors();
    // 顺序：实线 / K 线（最左）→ 日 / 月 / 年 → 日线跨度
    $('#trend-tools').innerHTML = `
      <div class="seg">
        <button class="${s.kStyle === 'line' ? 'on' : ''}" data-action="k-style" data-v="line" title="${t('kLine')}">${ic('linechart')}</button>
        <button class="${s.kStyle === 'candle' ? 'on' : ''}" data-action="k-style" data-v="candle" title="${t('kCandle')}">${ic('candle')}</button></div>
      <div class="seg">${['day', 'month', 'year'].map(r => `<button class="${range === r ? 'on' : ''}" data-action="asset-range" data-v="${r}">${t('ar_' + r)}</button>`).join('')}</div>
      ${range === 'day' ? `<div class="seg">${Object.keys(K_SPANS).map(k => `<button class="${s.kSpan === k ? 'on' : ''}" data-action="k-span" data-v="${k}">${k === 'ALL' ? t('all') : k}</button>`).join('')}</div>` : ''}`;
    let bars = assetBars(range);
    const all = bars.length;
    if (range === 'day') {
      const span = Math.min(K_SPANS[s.kSpan], all);
      UI.kEnd = Math.max(0, Math.min(UI.kEnd, all - span));
      bars = bars.slice(all - span - UI.kEnd, all - UI.kEnd);
      // 跨度较长时横轴显示“年/月”
      if (bars.length > 200) bars = bars.map(b => Object.assign({}, b, { label: `${b.key.slice(2, 4)}/${b.key.slice(5, 7)}` }));
    }
    const el = $('#trend');
    if (!bars.length) {
      $('#trend-legend').innerHTML = '';
      el.innerHTML = `<div class="empty"><div class="em">📈</div><h4>${t('noSnap')}</h4><p>${t('noSnapSub')}</p></div>`;
      return;
    }
    const f = bars[0].o, l = bars[bars.length - 1].c, chg = l - f;
    const hi = Math.max(...bars.map(b => b.h)), lo = Math.min(...bars.map(b => b.l));
    $('#trend-legend').innerHTML = `<span>${esc(bars[0].tip)} → ${esc(bars[bars.length - 1].tip)}</span>
      <span>${t('kChange')} <b class="num ${upDown(chg)}">${money(chg, { sign: true })} (${pct(f ? (chg / Math.abs(f)) * 100 : 0)})</b></span>
      <span>${t('kHigh')} <b class="num">${money(hi)}</b></span><span>${t('kLow')} <b class="num">${money(lo)}</b></span>
      ${range === 'day' ? `<span class="dim">${t('kDragHint')}</span>` : ''}${Object.keys(DB.snaps).length < 3 ? `<span class="dim">${t('trendFewHint')}</span>` : ''}`;
    const sym = symOf(s.ccy);
    Charts.candle(el, {
      bars, style: s.kStyle, up: C.up, down: C.down,
      fmtY: v => (hidden() ? '' : sym + compact(v)),
      tip: i => {
        const b = bars[i], prev = i ? bars[i - 1].c : b.o, ch = b.c - prev;
        return `<div class="tt">${esc(b.tip)}</div>
          <div class="tr"><span>${t('kOpen')}</span><b class="num">${money(b.o)}</b></div>
          <div class="tr"><span>${t('kHigh')}</span><b class="num">${money(b.h)}</b></div>
          <div class="tr"><span>${t('kLow')}</span><b class="num">${money(b.l)}</b></div>
          <div class="tr"><span>${t('kClose')}</span><b class="num">${money(b.c)}</b></div>
          <div class="tr"><span>${t('kChange')}</span><b class="num ${upDown(ch)}">${money(ch, { sign: true })} (${pct(prev ? (ch / Math.abs(prev)) * 100 : 0)})</b></div>`;
      },
      onPan: range === 'day' && K_SPANS[s.kSpan] < all ? delta => { UI.kEnd += delta; drawAssetTrend(); } : null,
      onZoom: range === 'day' ? dir => {
        const ks = Object.keys(K_SPANS), i = ks.indexOf(s.kSpan), j = Math.max(0, Math.min(ks.length - 1, i + dir));
        if (j !== i) { s.kSpan = ks[j]; save(); drawAssetTrend(); }
      } : null
    });
  }

  function acctName(id) {
    if (!id) return t('noAccount');
    const a = findAsset(id);
    return a ? a.name : t('deletedAccount');
  }
  const acctWh = id => { const a = id && findAsset(id); return a && a.warehouse ? a.warehouse : ''; };
  /** 关联账户所在仓库（转账显示 转出仓库 → 转入仓库） */
  const txWh = x => (x.type === 'transfer' ? [acctWh(x.accountId), acctWh(x.toId)].some(Boolean) ? `${acctWh(x.accountId) || '—'} → ${acctWh(x.toId) || '—'}` : '' : acctWh(x.accountId));
  const txAcct = x => (x.type === 'transfer' ? `${acctName(x.accountId)} → ${acctName(x.toId)}` : acctName(x.accountId));
  const txSign = x => (x.type === 'income' ? 1 : x.type === 'transfer' ? 0 : -1);
  /** 金额文字：转账不带正负号、不着色 */
  function txAmt(x, ccy, amt, max) {
    const s = txSign(x);
    return s ? money(s * amt, { ccy, sign: true, max }) : '⇄ ' + money(amt, { ccy, max });
  }
  const txCls = x => (x.type === 'income' ? 'up' : x.type === 'expense' ? 'down' : 'muted');
  /** 记账关联的订阅（小标签） */
  const subLinkTag = x => (x.subId ? `<span class="sub-link" title="${t('subLink')}">${ic('repeat')}${esc((findSub(x.subId) || {}).name || t('subDeleted'))}</span>` : '');
  function txRowHTML(x, withOps, batch) {
    const orig = x.ccy && x.ccy !== S().ccy;
    return `<div class="tx-row ${batch ? 'batch' : ''}">
      ${batch ? `<label class="ck"><input type="checkbox" data-sel="tx" value="${x.id}" ${UI.led.sel.has(x.id) ? 'checked' : ''}><i></i></label>` : ''}
      <div class="tx-ico ${x.type}">${CAT_ICON[x.cat] || '•'}</div>
      <div class="tx-main"><div class="tx-title">${catName(x.cat)}${subLinkTag(x)}${x.note ? `<span class="nt">${esc(x.note)}</span>` : ''}</div>
        <div class="tx-meta">${x.date} · ${esc(txAcct(x))}${txWh(x) ? ` <span class="wh-tag">${ic('db')}${esc(txWh(x))}</span>` : ''}</div></div>
      <div class="tx-amt num ${txCls(x)}">${txAmt(x, null, txD(x), orig ? 2 : 8)}
        ${x.fromUnit ? `<small>${qtyTxt(x.amount, x.fromUnit)}</small>` : orig ? `<small>${txAmt(x, x.ccy, x.amount, 8)}</small>` : ''}${x.fee > 0 ? `<small class="down">${t('fee')} ${feeTxt(x)}</small>` : ''}${recvTag(x)}
        ${withOps && !batch ? `<div class="tx-ops">${histBtn('tx', x.id)}<button class="op edit" data-action="edit-tx" data-id="${x.id}">${ic('edit')}</button><button class="op del" data-action="del-tx" data-id="${x.id}">${ic('trash')}</button></div>` : ''}
      </div></div>`;
  }

  /* ================= 页面二：资产明细 ================= */
  function holdList() {
    const H = UI.hold, q = H.q.trim().toLowerCase();
    let list = DB.assets.filter(a => inCls(a, H.cls));
    if (H.src !== 'all') list = list.filter(a => (isOnlineSrc(a) ? 'online' : 'manual') === H.src);
    if (H.wh !== '__all') list = list.filter(a => (a.warehouse || '') === H.wh);
    if (q) list = list.filter(a => [a.name, a.code, a.note, a.warehouse, clsLabel(a)].some(v => String(v || '').toLowerCase().includes(q)));
    const keys = snapKeys();
    const rows = list.map(a => { const v = aValD(a), c = aCostD(a), d = dayChange(a, keys); return { a, v, pnl: isBalance(a) ? 0 : v - c, day: d.ch, dayPct: d.pct }; });
    const by = { valDesc: (x, y) => y.v - x.v, valAsc: (x, y) => x.v - y.v, pnlDesc: (x, y) => y.pnl - x.pnl, pnlAsc: (x, y) => x.pnl - y.pnl, dayDesc: (x, y) => y.day - x.day, dayAsc: (x, y) => x.day - y.day };
    rows.sort(by[H.sort] || by.valDesc);
    return rows;
  }
  function renderHoldings() {
    const H = UI.hold;
    const counts = { all: DB.assets.length };
    clsKeys().forEach(c => { counts[c] = DB.assets.filter(a => inCls(a, c)).length; });
    const chips = ['all'].concat(clsKeys()).map(c =>
      `<button class="chip ${H.cls === c ? 'on' : ''}" data-action="hold-filter" data-v="${c}">${c !== 'all' ? `<i class="cdot" style="background:${clsColor(c)}"></i>` : ''}${c === 'all' ? t('all') : clsName(c)}<em>${counts[c]}</em></button>`).join('');
    $('#page').innerHTML = `
      <div class="section-head">
        <h2>${t('holdTitle')}</h2>
        <div class="head-tools">
          ${lockBtnHTML()}
          <button class="btn ${H.batch ? 'btn-soft' : 'btn-glass'}" data-action="hold-batch">${ic('select')}${H.batch ? t('batchDone') : t('batch')}</button>
          <button class="btn btn-accent" data-action="add-asset">${ic('plus')}${t('addAsset')}</button>
        </div>
      </div>
      <div class="toolbar">
        <label class="search">${ic('search')}<input data-input="holdQ" value="${esc(H.q)}" placeholder="${t('holdSearchPh')}" autocomplete="off"></label>
        <label class="mini-select">${ic('sort')}<select data-change="holdSort">${['valDesc', 'valAsc', 'dayDesc', 'dayAsc', 'pnlDesc', 'pnlAsc'].map(v => `<option value="${v}" ${H.sort === v ? 'selected' : ''}>${t('sort_' + v)}</option>`).join('')}</select></label>
        <span class="src-tool">${srcFilterHTML(false)}</span>
        <span class="src-tool">${whFilterHTML(false)}</span>
        ${colBtnHTML('hold')}
      </div>
      <div class="chips mb">${chips}<button class="chip chip-tool" data-action="asset-cats">${ic('sliders')}${t('assetMgrS')}</button></div>
      <div id="batch-bar"></div>
      <div id="hold-body"></div>`;
    renderHoldBody();
  }
  /* ---- 表格列设置：顺序 / 显示 / 宽度（保存在本设备） ----
     defs: [{ k, label, th, thCls, thAttr, td(row), tdCls, fixed }]；fixed = 不能隐藏、不能移动（操作列固定在最后） */
  function colState(tid, defs) {
    const c = (S().cols || {})[tid] || {}, all = defs.map(d => d.k), fixedK = defs.filter(d => d.fixed).map(d => d.k);
    const order = (c.order || []).filter(k => all.includes(k) && !fixedK.includes(k));
    all.forEach((k, i) => { if (!order.includes(k) && !fixedK.includes(k)) order.splice(Math.min(i, order.length), 0, k); });   // 新增的列放回默认位置
    const hidden = (c.hidden || []).filter(k => all.includes(k) && !fixedK.includes(k));
    const cols = order.concat(fixedK).map(k => defs.find(d => d.k === k)).filter(d => !hidden.includes(d.k));
    return { cols, order, hidden, widths: c.widths || null };
  }
  function tableHTML(tid, defs, rows, o) {
    const st = colState(tid, defs), w = st.widths, sel = o.sel;
    const sum = w ? st.cols.reduce((a, d) => a + (w[d.k] || 120), o.batch ? 44 : 0) : 0;
    const allSel = rows.length && rows.every(r => sel.has(o.id(r)));
    return `<div class="card glass table-card"><div class="table-wrap"><table class="tbl ${o.cls || ''} ${w ? 'fixed' : ''}" data-tid="${tid}" ${w ? `style="width:${sum}px"` : ''}>
      <colgroup>${o.batch ? '<col style="width:44px">' : ''}${st.cols.map(d => `<col data-k="${d.k}" ${w ? `style="width:${w[d.k] || 120}px"` : ''}>`).join('')}</colgroup>
      <thead><tr>${o.batch ? `<th class="ckc"><label class="ck"><input type="checkbox" data-sel-all="${o.kind}" ${allSel ? 'checked' : ''}><i></i></label></th>` : ''}${st.cols.map(d =>
        `<th class="${d.thCls || ''}" data-k="${d.k}" ${d.thAttr || ''}>${d.th}${d.fixed ? '' : `<span class="col-rs" data-rs="${d.k}" title="${t('colResize')}"></span>`}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr class="${sel.has(o.id(r)) ? 'sel' : ''} ${o.rowCls ? o.rowCls(r) : ''}">${o.batch ? `<td class="ckc"><label class="ck"><input type="checkbox" data-sel="${o.kind}" value="${o.id(r)}" ${sel.has(o.id(r)) ? 'checked' : ''}><i></i></label></td>` : ''}${st.cols.map(d =>
        `<td class="${typeof d.tdCls === 'function' ? d.tdCls(r) : d.tdCls || ''}">${d.td(r)}</td>`).join('')}</tr>`).join('')}</tbody>
      <tfoot><tr>${o.batch ? '<td></td>' : ''}${st.cols.map((d, i) => `<td class="${o.foot[d.k] ? (d.tdCls && typeof d.tdCls === 'string' ? d.tdCls : 'r num') : ''} ${i === 0 ? 'foot-l' : ''}">${i === 0 ? `<span class="foot-lbl">${o.footLabel}</span>` : ''}${o.foot[d.k] || ''}</td>`).join('')}</tr></tfoot>
    </table></div></div>`;
  }
  /** 拖动表头右边缘调整列宽：第一次拖动时记下所有列的当前宽度，之后表格按固定列宽显示 */
  function startColResize(e, h) {
    e.preventDefault(); e.stopPropagation();
    const table = h.closest('table'), tid = table.dataset.tid, k = h.dataset.rs;
    S().cols = S().cols || {};
    const c = S().cols[tid] = S().cols[tid] || {};
    if (!c.widths) { c.widths = {}; $$('thead th[data-k]', table).forEach(th => { c.widths[th.dataset.k] = Math.round(th.getBoundingClientRect().width); }); }
    const apply = () => {
      table.classList.add('fixed');
      let sum = $('thead .ckc', table) ? 44 : 0;
      $$('col[data-k]', table).forEach(col => { const v = c.widths[col.dataset.k] || 120; col.style.width = v + 'px'; sum += v; });
      table.style.width = sum + 'px';
    };
    apply();
    const x0 = e.clientX, w0 = c.widths[k] || 120;
    h.classList.add('on');
    const move = ev => { c.widths[k] = Math.max(44, Math.round(w0 + ev.clientX - x0)); apply(); };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); h.classList.remove('on'); UI.colDragAt = Date.now(); save(); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  }
  /** 列设置弹窗：上下移动 = 表格里左右位置；勾选 = 显示 / 隐藏 */
  function openColsModal(tid) {
    const defs = (tid === 'hold' ? holdCols() : subCols()).filter(d => !d.fixed), st = colState(tid, defs.concat([]));
    const order = st.order.slice(), hidden = new Set(st.hidden);
    const draw = m => {
      $('#cl-list', m).innerHTML = order.map((k, i) => { const d = defs.find(x => x.k === k); return `<div class="cl-row ${hidden.has(k) ? 'off' : ''}" data-k="${k}">
        <label class="cl-ck"><input type="checkbox" ${hidden.has(k) ? '' : 'checked'} ${d.lock ? 'disabled' : ''} data-ck="${k}"><span>${esc(d.label)}</span>${d.lock ? `<em>${t('colAlways')}</em>` : ''}</label>
        <button type="button" class="icon-btn sm" data-mv="-1" data-i="${i}" ${i ? '' : 'disabled'} title="${t('colLeft')}">${ic('chev-l')}</button>
        <button type="button" class="icon-btn sm" data-mv="1" data-i="${i}" ${i < order.length - 1 ? '' : 'disabled'} title="${t('colRight')}">${ic('chev-r')}</button></div>`; }).join('');
    };
    openModal({
      title: `${t('colSettings')} · ${t(tid === 'hold' ? 'holdTitle' : 'subTitle')}`,
      body: `<p class="hint" style="margin:0 0 12px">${t('colSettingsHint')}</p><div id="cl-list" class="cl-list"></div>
        <div class="cl-tools"><button type="button" class="btn btn-glass sm" id="cl-w">${ic('refresh')}${t('colResetW')}</button><button type="button" class="btn btn-glass sm" id="cl-all">${ic('refresh')}${t('colResetAll')}</button></div>`,
      footer: `<button class="btn btn-glass" data-modal-close>${t('cancel')}</button><button class="btn btn-accent" id="cl-save">${ic('check')}${t('save')}</button>`,
      onMount(m) {
        draw(m);
        $('#cl-list', m).addEventListener('click', e => {
          const b = e.target.closest('[data-mv]'); if (!b || b.disabled) return;
          const i = +b.dataset.i, j = i + +b.dataset.mv; [order[i], order[j]] = [order[j], order[i]]; draw(m);
        });
        $('#cl-list', m).addEventListener('change', e => { const k = e.target.dataset.ck; if (!k) return; e.target.checked ? hidden.delete(k) : hidden.add(k); draw(m); });
        const done = cfg => { S().cols = S().cols || {}; if (cfg) S().cols[tid] = cfg; else delete S().cols[tid]; save(); closeModal(); selRender(tid === 'hold' ? 'hold' : 'sub'); toast(t('saved'), 'ok'); };
        $('#cl-w', m).addEventListener('click', () => done(Object.assign({}, (S().cols || {})[tid] || {}, { order, hidden: Array.from(hidden), widths: null })));
        $('#cl-all', m).addEventListener('click', () => done(null));
        $('#cl-save', m).addEventListener('click', () => done({ order, hidden: Array.from(hidden), widths: ((S().cols || {})[tid] || {}).widths || null }));
      }
    });
  }
  const colBtnHTML = tid => `<button class="btn btn-glass sm col-btn" data-action="cols" data-v="${tid}" title="${t('colSettings')}">${ic('sliders')}${t('colSettings')}</button>`;
  /* ---- 资产明细的列 ---- */
  function holdCols() {
    const H = UI.hold, D = S().ccy;
    const sortTh = (k, label) => ({ thCls: `r sortable ${H.sort === k + 'Desc' || H.sort === k + 'Asc' ? 'on' : ''}`, thAttr: `data-action="hold-sort-head" data-v="${k}"`, th: `${label}<span class="arr">${H.sort === k + 'Asc' ? '↑' : '↓'}</span>` });
    const cc = r => ({ a: r.a, ccy: aCcy(r.a), bal: isBalance(r.a), orig: aCcy(r.a) !== D });
    return [
      { k: 'name', label: t('colNameOnly'), lock: true, th: t('colNameOnly'), td: r => `<div class="nmcell"><b class="nm-pill" style="--tc:${clsColor(primary(r.a))}">${esc(r.a.name)}</b>${r.a.locked ? ic('lock', 'lk') : ''}</div>${r.a.note ? `<small>${esc(r.a.note)}</small>` : ''}` },
      { k: 'code', label: t('colCode'), th: t('colCode'), td: r => (r.a.code ? `<span class="code">${esc(r.a.code)}</span>` : '<span class="dim">—</span>') },
      { k: 'cls', label: t('colClass'), th: t('colClass'), td: r => `<div class="tags">${tagHTML(r.a)}</div>` },
      { k: 'wh', label: t('colWh'), th: whFilterHTML(true), tdCls: 'wh', td: r => (r.a.warehouse ? esc(r.a.warehouse) : '<span class="dim">—</span>') },
      { k: 'qty', label: t('colQty'), th: t('colQty'), thCls: 'r', tdCls: 'r num', td: r => `${qtyStr(r.a)}${unitSuffix(r.a)}` },
      { k: 'cost', label: t('colCost'), th: t('colCost'), thCls: 'r', tdCls: 'r num muted', td: r => { const x = cc(r); return x.bal ? `<span class="dim">—</span><small>${x.ccy}</small>` : money(conv(+r.a.cost || 0, x.ccy), { max: 8 }) + (x.orig ? `<small>${money(+r.a.cost || 0, { ccy: x.ccy, max: 8 })}</small>` : ''); } },
      { k: 'price', label: t('colPrice'), th: t('colPrice'), thCls: 'r', tdCls: 'r num strong', td: r => { const x = cc(r); return x.bal ? '<span class="dim">—</span>' : money(conv(+r.a.price || 0, x.ccy), { max: 8 }) + (x.orig ? `<small>${money(+r.a.price || 0, { ccy: x.ccy, max: 8 })}</small>` : '') + extTag(r.a); } },
      Object.assign({ k: 'val', label: t('colValue'), tdCls: r => `r num strong ${r.v < 0 ? 'down' : ''}`, td: r => { const x = cc(r); return `${money(r.v, { max: 8 })}${x.orig ? `<small>${money(aVal(r.a), { ccy: x.ccy, max: 8 })}</small>` : ''}`; } }, sortTh('val', t('colValue'))),
      Object.assign({ k: 'day', label: t('colDay'), tdCls: r => `r num ${upDown(r.day)}`, td: r => `${dayCell(r.day, r.dayPct)}${resetDayBtn(r.a, r.day)}` }, sortTh('day', t('colDay'))),
      Object.assign({ k: 'pnl', label: t('colPnl'), tdCls: r => `r num ${isBalance(r.a) ? 'dim' : upDown(r.pnl)}`, td: r => { if (isBalance(r.a)) return t('noPnl'); const c = aCostD(r.a); return `${money(r.pnl, { sign: true })}<small class="${upDown(r.pnl)}">${pct(c ? (r.pnl / Math.abs(c)) * 100 : 0)}</small>`; } }, sortTh('pnl', t('colPnl'))),
      { k: 'src', label: t('colSrc'), th: srcFilterHTML(true), td: r => `<div class="srccell">${srcCell(r.a)}</div>` },
      { k: 'ops', label: t('colOps'), fixed: true, th: t('colOps'), thCls: 'c', tdCls: 'c', td: r => (H.batch ? '' : `<div class="ops icon-ops">${histBtn('asset', r.a.id)}${quickBtn(r.a, true)}<button class="op edit" data-action="edit-asset" data-id="${r.a.id}" title="${t('edit')}">${ic('edit')}</button><button class="op del" data-action="del-asset" data-id="${r.a.id}" title="${t('del')}">${ic('trash')}</button></div>`) }
    ];
  }
  function sortHead(key, label) {
    const H = UI.hold, desc = key + 'Desc', asc = key + 'Asc';
    const on = H.sort === desc || H.sort === asc;
    return `<th class="r sortable ${on ? 'on' : ''}" data-action="hold-sort-head" data-v="${key}">${label}<span class="arr">${H.sort === asc ? '↑' : '↓'}</span></th>`;
  }
  function renderHoldBody() {
    const H = UI.hold, rows = holdList(), D = S().ccy;
    renderBatchBar('hold', rows.map(r => r.a.id));
    let body;
    if (!DB.assets.length) body = `<div class="card glass">${emptyState('assets')}</div>`;
    else if (!rows.length) body = `<div class="card glass">${emptyState('nomatch')}</div>`;
    else if (isMobile()) {
      body = `<div class="hlist">${rows.map(({ a, v, pnl, day, dayPct }) => {
        const c = aCostD(a), bal = isBalance(a);
        return `<div class="hcard glass ${H.sel.has(a.id) ? 'sel' : ''}">
          <div class="hc-top">
            ${H.batch ? `<label class="ck"><input type="checkbox" data-sel="hold" value="${a.id}" ${H.sel.has(a.id) ? 'checked' : ''}><i></i></label>` : ''}
            <div style="flex:1;min-width:0"><div class="nm">${esc(a.name)}${a.code ? `<span class="code">${esc(a.code)}</span>` : ''}${a.locked ? ic('lock', 'lk') : ''}</div>
            <div class="meta">${tagHTML(a)}${srcCell(a)}</div></div>
            <div class="r"><div class="v num ${v < 0 ? 'down' : ''}">${money(v)}</div>
              <div class="p num ${upDown(day)}">${t('colDay')} ${dayCell(day, dayPct, true)}${resetDayBtn(a, day)}</div>
              <div class="p num ${bal ? 'dim' : upDown(pnl)}">${bal ? t('noPnl') : `${money(pnl, { sign: true })} (${pct(c ? (pnl / Math.abs(c)) * 100 : 0)})`}</div></div></div>
          <div class="hc-grid">
            <div><div class="l">${bal ? t('cashBalance') : t('colQty')}</div><div class="x num">${qtyStr(a)}${unitSuffix(a)}</div></div>
            <div><div class="l">${t('colCost')}</div><div class="x num">${bal ? '—' : money(conv(+a.cost || 0, aCcy(a)), { max: 8 })}</div></div>
            <div><div class="l">${t('colPrice')}</div><div class="x num">${bal ? '—' : money(conv(+a.price || 0, aCcy(a)), { max: 8 }) + extTag(a)}</div></div>
          </div>
          ${a.warehouse ? `<div class="hc-wh">${ic('db')}${esc(a.warehouse)}</div>` : ''}
          ${H.batch ? '' : `<div class="hc-ops">${histBtn('asset', a.id)}${quickBtn(a)}<button class="op edit" data-action="edit-asset" data-id="${a.id}">${ic('edit')}${t('edit')}</button><button class="op del" data-action="del-asset" data-id="${a.id}">${ic('trash')}${t('del')}</button></div>`}
        </div>`;
      }).join('')}</div>`;
    } else {
      let sumV = 0, sumC = 0, sumHV = 0, sumDay = 0;
      rows.forEach(r => { sumV += r.v; sumDay += r.day; if (!isBalance(r.a)) { sumC += aCostD(r.a); sumHV += r.v; } });
      const sp = sumHV - sumC;
      body = tableHTML('hold', holdCols(), rows, {
        cls: 'hold-tbl', kind: 'hold', batch: H.batch, sel: H.sel, id: r => r.a.id,
        footLabel: `${t('total')} · ${t('nAssets', { n: rows.length })}`,
        foot: { val: money(sumV), day: `<span class="${upDown(sumDay)}">${money(sumDay, { sign: true })}</span>`, pnl: `<span class="${upDown(sp)}">${money(sp, { sign: true })}</span><small class="${upDown(sp)}">${pct(sumC ? (sp / Math.abs(sumC)) * 100 : 0)}</small>` }
      });
    }
    $('#hold-body').innerHTML = body;
  }
  /** 手动维护的资产显示“更新市值 / 更新余额”快捷按钮 */
  const histBtn = (kind, id) => `<button class="op hist" data-action="history" data-kind="${kind}" data-id="${id}" title="${t('history')}">${ic('clock')}</button>`;
  const canQuickUpdate = a => isBalance(a) || !(a.source === 'online' && Api.canQuote(a));
  /** 盘前 / 盘后参考价（美股常规时段以外才显示；12 小时内取到的） */
  const extTag = a => {
    const e = a.ext;
    if (!e || !(e.p > 0) || !(+a.price > 0) || Date.now() - (e.at || 0) > 12 * 3600e3 || Api.usRegularOpen()) return '';
    const pc = (e.p / +a.price - 1) * 100;
    return `<small class="ext-p">${t(e.k === 'pre' ? 'extPre' : 'extPost')} ${money(conv(e.p, aCcy(a)), { max: 8 })} <b class="${upDown(pc)}">${pc >= 0 ? '+' : ''}${pc.toFixed(2)}%</b>${e.t ? ` <i>${esc(e.t)} ET</i>` : ''}</small>`;
  };
  const quickBtn = (a, iconOnly) => (canQuickUpdate(a) ? `<button class="op upd" data-action="update-val" data-id="${a.id}" title="${isBalance(a) ? t('updBal') : t('updVal')}">${ic('refresh')}${iconOnly ? '' : isBalance(a) ? t('updBalS') : t('updValS')}</button>` : '');
  const resetDayBtn = (a, day) => (!UI.hold.batch && canResetDay(a) && Math.abs(day) >= 0.005
    ? `<button class="reset-day" data-action="reset-day" data-id="${a.id}" title="${t('resetDayTip')}">${ic('refresh')}${t('resetDay')}</button>` : '');
  /** 今日盈亏单元格：没有变化显示 — */
  const dayCell = (ch, p, inline) => (Math.abs(ch) < 0.005 ? '<span class="dim">—</span>'
    : inline ? `${money(ch, { sign: true })} (${pct(p)})` : `${money(ch, { sign: true })}<small class="${upDown(ch)}">${pct(p)}</small>`);
  const unitSuffix = a => (a.unit && !isBalance(a) && !a.noQty ? ` <span class="dim">${esc(unitLabel(a.unit))}</span>` : '');
  const isOnlineSrc = a => a.source === 'online' && Api.canQuote(a);
  /** 行情来源筛选：全部 / 在线同步 / 手动维护（工具栏和表头共用） */
  function srcFilterHTML(compact) {
    const H = UI.hold, n = { all: DB.assets.length, online: DB.assets.filter(isOnlineSrc).length };
    n.manual = n.all - n.online;
    return `<label class="mini-select ${compact ? 'th-select' : ''}">${compact ? '' : ic('bolt')}<select data-change="holdSrc">${['all', 'online', 'manual'].map(v =>
      `<option value="${v}" ${H.src === v ? 'selected' : ''}>${v === 'all' ? (compact ? t('colSrc') : t('srcAll') + ` (${n.all})`) : (v === 'online' ? t('srcOnline') : t('srcManual')) + ` (${n[v]})`}</option>`).join('')}</select></label>`;
  }
  /** 资产仓库筛选：全部 / 每个仓库（数量）/ 未填写 */
  function whFilterHTML(compact) {
    const H = UI.hold, cnt = {};
    DB.assets.forEach(a => { const w = a.warehouse || ''; cnt[w] = (cnt[w] || 0) + 1; });
    if (H.wh !== '__all' && cnt[H.wh] == null) H.wh = '__all';   // 筛选的仓库已不存在
    whList(); const names = Object.keys(cnt).filter(Boolean).sort((x, y) => whOrd(x) - whOrd(y) || cnt[y] - cnt[x] || x.localeCompare(y));
    const opt = (v, label) => `<option value="${esc(v)}" ${H.wh === v ? 'selected' : ''}>${esc(label)}</option>`;
    return `<label class="mini-select ${compact ? 'th-select' : ''}">${compact ? '' : ic('db')}<select data-change="holdWh">${
      opt('__all', compact ? t('colWh') : `${t('whAll')} (${DB.assets.length})`) + names.map(w => opt(w, `${w} (${cnt[w]})`)).join('') + (cnt[''] ? opt('', `${t('whNone')} (${cnt['']})`) : '')}</select></label>`;
  }
  /** 行情来源单元格 */
  const srcCell = a => srcBadge(a);
  function srcBadge(a) {
    const online = a.source === 'online' && Api.canQuote(a), err = online && a.lastErr;
    const title = online ? `${t('updatedAt')}: ${dateTimeStr(a.updatedAt)}${err ? ' · ' + errText({ message: a.lastErr }) : ''}` : '';
    return `<span class="src ${online ? 'online' : ''} ${err ? 'err' : ''}" title="${esc(title)}"><i></i>${online ? t('srcOnline') : t('srcManual')}</span>`;
  }
  const selState = kind => (kind === 'hold' ? UI.hold : kind === 'sub' ? UI.sub : UI.led);
  const selRender = kind => (kind === 'hold' ? renderHoldBody() : kind === 'sub' ? renderSubBody() : renderLedBody());
  const selIds = kind => (kind === 'hold' ? holdList().map(r => r.a.id) : kind === 'sub' ? subList().map(r => r.s.id) : ledList().map(x => x.id));
  /** 批量操作条（资产 / 记账 / 订阅共用） */
  function renderBatchBar(kind, visibleIds) {
    const st = selState(kind), el = $('#batch-bar');
    if (!el) return;
    if (!st.batch) { el.innerHTML = ''; return; }
    const n = st.sel.size;
    el.innerHTML = `<div class="batch-bar glass">
      <span class="bb-n">${t('selectedN', { n })}</span>
      <button class="btn btn-glass sm" data-action="sel-all" data-kind="${kind}" data-ids="${visibleIds.join(',')}">${t('selectAll')}</button>
      <button class="btn btn-glass sm" data-action="sel-none" data-kind="${kind}" ${n ? '' : 'disabled'}>${t('selectNone')}</button>
      <span class="bb-sp"></span>
      ${kind !== 'tx' ? `<button class="btn btn-soft sm" data-action="batch-lock" data-kind="${kind}" ${n ? '' : 'disabled'}>${ic('lock')}${t('batchLock')}</button>
      <button class="btn btn-glass sm" data-action="batch-unlock" data-kind="${kind}" ${n ? '' : 'disabled'}>${ic('unlock')}${t('batchUnlock')}</button>` : ''}
      ${kind === 'sub' ? (UI.sub.view === 'archived' ? `<button class="btn btn-glass sm" data-action="batch-unarch" ${n ? '' : 'disabled'}>${ic('unarchive')}${t('subUnarchive')}</button>`
        : `<button class="btn btn-glass sm" data-action="batch-arch" ${n ? '' : 'disabled'}>${ic('archive')}${t('subArchive')}</button>`) : ''}
      <button class="btn btn-danger sm" data-action="batch-del" data-kind="${kind}" ${n ? '' : 'disabled'}>${ic('trash')}${t('batchDel')}</button>
    </div>`;
  }

  /* ================= 页面三：收支明细 ================= */
  function dayLabel(d) {
    const dt = new Date(d + 'T00:00:00');
    const w = t('wd' + ((dt.getDay() + 6) % 7));
    return zh() ? `${dt.getMonth() + 1}月${dt.getDate()}日 ${w}` : `${w}, ${t('mon' + dt.getMonth())} ${dt.getDate()}`;
  }
  function periodLabel(mode, date) {
    const [y, m, d] = date.split('-').map(Number);
    if (mode === 'day') return zh() ? `${y}年${m}月${d}日` : `${t('mon' + (m - 1))} ${d}, ${y}`;
    if (mode === 'month') return zh() ? `${y}年${m}月` : `${t('mon' + (m - 1))} ${y}`;
    return zh() ? `${y}年` : String(y);
  }
  const inPeriod = (x, mode, date) => (mode === 'day' ? x.date === date : mode === 'month' ? x.date.startsWith(date.slice(0, 7)) : x.date.startsWith(date.slice(0, 4)));
  function ledList() {
    const L = UI.led, q = L.q.trim().toLowerCase();
    let list = DB.txs.filter(x => inPeriod(x, L.mode, L.date)
      && (L.type === 'all' || x.type === L.type)
      && (L.cat === 'all' || x.cat === L.cat)
      && (L.acct === 'all' || (L.acct === 'none' ? !x.accountId : x.accountId === L.acct || x.toId === L.acct || x.feeId === L.acct)));
    if (q) list = list.filter(x => [x.note, catName(x.cat), txAcct(x)].some(v => String(v || '').toLowerCase().includes(q)));
    if (L.sort === 'dateAsc') list = sortTxDate(list).reverse();
    else if (L.sort === 'amtDesc') list.sort((a, b) => txD(b) - txD(a));
    else if (L.sort === 'amtAsc') list.sort((a, b) => txD(a) - txD(b));
    else sortTxDate(list);
    return list;
  }
  function renderLedger() {
    const L = UI.led, unlocked = Date.now() < UI.unlockUntil;
    const cats = L.type === 'income' ? INC_CATS : L.type === 'expense' ? EXP_CATS : L.type === 'transfer' ? [] : EXP_CATS.concat(INC_CATS);
    if (L.cat !== 'all' && !cats.includes(L.cat)) L.cat = 'all';
    const statRow = (mode, key) => {
      const r = statsOf(x => inPeriod(x, mode, L.date)), bal = r.inc - r.exp;
      return `<div class="stat-row-h glass"><span class="ico">${ic(mode === 'day' ? 'clock' : 'cal')}</span><span class="srh-l"><b>${t('per_' + mode)}</b><small>${periodLabel(mode, L.date)}</small></span></div>
        <div class="sumbox glass"><div class="l">${t(key + 'Inc')}</div><div class="v num up">${money(r.inc, { sign: true })}</div></div>
        <div class="sumbox glass"><div class="l">${t(key + 'Exp')}</div><div class="v num down">${money(-r.exp)}</div></div>
        <div class="sumbox glass"><div class="l">${t(key + 'Bal')}</div><div class="v num ${upDown(bal)}">${money(bal, { sign: true })}</div></div>
        <div class="sumbox glass"><div class="l">${t(key + 'N')}</div><div class="v num">${r.n}</div></div>`;
    };
    $('#page').innerHTML = `
      <div class="section-head">
        <h2>${t('ledgerTitle')}</h2>
        <div class="head-tools">
          ${lockBtnHTML()}
          <button class="btn ${L.batch ? 'btn-soft' : 'btn-glass'}" data-action="led-batch">${ic('select')}${L.batch ? t('batchDone') : t('batch')}</button>
          <button class="btn btn-glass" data-action="add-transfer">${ic('swap')}${t('transfer')}</button>
          <button class="btn btn-accent" data-action="add-tx">${ic('plus')}${t('addTx')}</button>
        </div>
      </div>
      <div class="sumgrid">${statRow('day', 'd')}${statRow('month', 'm')}${statRow('year', 'y')}</div>
      <div class="toolbar">
        <div class="seg">${['day', 'month', 'year'].map(m => `<button class="${L.mode === m ? 'on' : ''}" data-action="led-mode" data-v="${m}">${t('per_' + m)}</button>`).join('')}</div>
        <button class="btn btn-glass" data-action="date-picker">${ic('cal')}<span class="num">${periodLabel(L.mode, L.date)}</span>${ic('chev-d')}</button>
        <div class="seg">${['all', 'income', 'expense', 'transfer'].map(v => `<button class="${L.type === v ? 'on' : ''}" data-action="tx-type" data-v="${v}">${t(v)}</button>`).join('')}</div>
        <label class="mini-select"><select data-change="ledCat"><option value="all">${t('allCats')}</option>${cats.map(c => `<option value="${c}" ${L.cat === c ? 'selected' : ''}>${CAT_ICON[c]} ${catName(c)}</option>`).join('')}</select></label>
        <label class="mini-select"><select data-change="ledAcct"><option value="all">${t('allAccts')}</option><option value="none" ${L.acct === 'none' ? 'selected' : ''}>${t('noAccount')}</option>${DB.assets.map(a => `<option value="${a.id}" ${L.acct === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
        <label class="search">${ic('search')}<input data-input="ledQ" value="${esc(L.q)}" placeholder="${t('ledSearchPh')}" autocomplete="off"></label>
        <label class="mini-select">${ic('sort')}<select data-change="ledSort">${['dateDesc', 'dateAsc', 'amtDesc', 'amtAsc'].map(v => `<option value="${v}" ${L.sort === v ? 'selected' : ''}>${t('sort_' + v)}</option>`).join('')}</select></label>
      </div>
      <div id="batch-bar"></div>
      <div id="led-body"></div>`;
    renderLedBody();
  }
  function renderLedBody() {
    const L = UI.led, list = ledList();
    renderBatchBar('tx', list.map(x => x.id));
    let body;
    if (!list.length) body = `<div class="card glass">${DB.txs.length ? emptyState('nomatch') : emptyState('tx')}</div>`;
    else if (isMobile()) {
      const groups = {};
      list.forEach(x => { (groups[x.date] = groups[x.date] || []).push(x); });
      const keys = Object.keys(groups);
      if (L.sort === 'dateAsc') keys.sort(); else if (L.sort === 'dateDesc') keys.sort().reverse();
      body = L.sort.startsWith('amt')
        ? `<div class="card glass"><div class="tx-list">${list.map(x => txRowHTML(x, true, L.batch)).join('')}</div></div>`
        : `<div class="card glass"><div class="tx-list">${keys.map(d => {
          const net = groups[d].reduce((s, x) => s + txSign(x) * txD(x) - feeD(x) + bonusD(x), 0);
          return `<div class="day-head"><span>${dayLabel(d)}</span><span class="num">${money(net, { sign: true })}</span></div>${groups[d].map(x => txRowHTML(x, true, L.batch)).join('')}`;
        }).join('')}</div></div>`;
    } else {
      const allSel = list.every(x => L.sel.has(x.id));
      body = `<div class="card glass table-card"><div class="table-wrap"><table class="tbl">
        <thead><tr>${L.batch ? `<th class="ckc"><label class="ck"><input type="checkbox" data-sel-all="tx" ${allSel ? 'checked' : ''}><i></i></label></th>` : ''}
          <th>${t('colDate')}</th><th>${t('colType')}</th><th>${t('colCat')}</th><th>${t('colAcct')}</th><th>${t('colNote')}</th><th class="r">${t('colAmount')}</th><th class="c">${t('colOps')}</th></tr></thead>
        <tbody>${list.map(x => {
          const orig = x.ccy && x.ccy !== S().ccy;
          return `<tr class="${L.sel.has(x.id) ? 'sel' : ''}">
            ${L.batch ? `<td class="ckc"><label class="ck"><input type="checkbox" data-sel="tx" value="${x.id}" ${L.sel.has(x.id) ? 'checked' : ''}><i></i></label></td>` : ''}
            <td class="num">${x.date}<small>${t('wd' + ((new Date(x.date + 'T00:00:00').getDay() + 6) % 7))}</small></td>
            <td><span class="tag ${x.type}">${t(x.type)}</span></td>
            <td><span style="margin-right:6px">${CAT_ICON[x.cat] || ''}</span>${catName(x.cat)}${subLinkTag(x)}</td>
            <td class="muted">${esc(txAcct(x))}${txWh(x) ? `<small class="wh-sm">${ic('db')}${esc(txWh(x))}</small>` : ''}${x.applied ? `<small>${t('synced')}</small>` : ''}</td>
            <td class="note" title="${esc(x.note)}">${esc(x.note) || '<span class="dim">—</span>'}</td>
            <td class="r num strong ${txCls(x)}">${txAmt(x, null, txD(x), orig ? 2 : 8)}${x.fromUnit ? `<small>${qtyTxt(x.amount, x.fromUnit)}</small>` : orig ? `<small>${txAmt(x, x.ccy, x.amount, 8)}</small>` : ''}${x.type === 'transfer' && (x.toUnit || x.fromUnit || (x.toCcy && x.toCcy !== x.ccy)) ? `<small>${t('received')} ${qtyTxt(x.toAmount, x.toUnit, x.toCcy)}</small>` : ''}${x.fee > 0 ? `<small class="down">${t('fee')} ${feeTxt(x)}</small>` : ''}${recvTag(x)}</td>
            <td class="c">${L.batch ? '' : `<div class="ops">${histBtn('tx', x.id)}<button class="op edit" data-action="edit-tx" data-id="${x.id}">${ic('edit')}${t('edit')}</button><button class="op del" data-action="del-tx" data-id="${x.id}">${ic('trash')}${t('del')}</button></div>`}</td>
          </tr>`;
        }).join('')}</tbody></table></div></div>`;
    }
    $('#led-body').innerHTML = body;
  }

  /* ================= 页面：订阅明细 =================
     订阅只记录会员 / 订阅类支出：不计入总资产，也不参与投资盈亏。
     每个订阅的扣费 = 关联到它的记账支出（tx.subId）+ 其余各期按开始时间和周期推算的账单（有记账付款的那期不再推算） */
  const SUB_CATS = ['vps', 'ai', 'domain', 'media', 'software', 'cloud'];
  const SUB_CAT_COLOR = { vps: '#0A84FF', ai: '#BF5AF2', domain: '#30D158', media: '#FF375F', software: '#64D2FF', cloud: '#FF9F0A', '': '#8E8E93' };
  const SUB_EXTRA_COLORS = ['#FFD60A', '#FF6B3D', '#5E5CE6', '#66D4CF', '#AC8E68', '#FF6482', '#32ADE6'];
  const SUB_CYCLES = ['month', 'quarter', 'year', 'once', 'custom'];
  const SUB_FIELDS = ['name', 'alias', 'account', 'site', 'cat', 'price', 'ccy', 'cycle', 'cycleN', 'cycleU', 'start', 'trialDays', 'expire', 'payId', 'remind', 'nextPrice', 'note', 'locked', 'icon'];
  const SUB_PERIODS = ['today', 'month', 'year', 'total'];
  const subCatColorAuto = c => (SUB_CAT_COLOR[c] != null ? SUB_CAT_COLOR[c] : SUB_EXTRA_COLORS[[...String(c)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % SUB_EXTRA_COLORS.length]);
  const subCatColor = c => { const x = c && (DB.meta.subCats || []).find(y => y.k === c); return x && x.c ? x.c : subCatColorAuto(c); };
  const subCatName = c => { if (!c) return t('subCatNone'); const x = (DB.meta.subCats || []).find(y => y.k === c); return (x && x.n) || (SUB_CATS.includes(c) ? t('subCat_' + c) : c); };
  const findSub = id => (DB.subs || []).find(s => s.id === id);
  /** 订阅分类列表（全部可改名 / 改颜色 / 排序 / 删除 / 新增，随账本一起云同步）：[{ k: 编号, n: 名称（空 = 预设名称）, c: 颜色 }] */
  function subCatList() {
    const m = DB.meta;
    if (!Array.isArray(m.subCats)) m.subCats = SUB_CATS.map(k => ({ k, n: '', c: '' }));
    DB.subs.forEach(s => { if (s.cat && !m.subCats.some(x => x.k === s.cat)) m.subCats.push({ k: s.cat, n: '', c: '' }); });   // 旧版本 / 其他设备用到的分类自动补进来
    return m.subCats;
  }
  const subCats = () => subCatList().map(x => x.k);
  /** 按名称找分类（不分大小写），没有就新建，返回分类编号 */
  function findOrAddCat(name) {
    name = String(name || '').trim(); if (!name) return '';
    const list = subCatList(), hit = list.find(x => subCatName(x.k).toLowerCase() === name.toLowerCase());
    if (hit) return hit.k;
    const k = 'c' + uid(); list.push({ k, n: name, c: '' }); return k;
  }
  /** 通用列表管理（订阅分类 / 资产类别 / 仓库共用）：改名、改颜色、上下排序、删除、新增
      spec: { list() 背后的数组, key(x), name(k), color(k)（无 = 不显示色点）, count(k), unit, canDel(k), delTip,
              rename(k, v) → 'exists' | 真, recolor(k, c), add(name) → 'exists' | 真, del(k)（async，自己确认）, hint, ph } */
  function mgrHTML(sp) {
    const list = sp.list();
    return list.map((x, i) => { const k = sp.key(x), col = sp.color && sp.color(k), cd = sp.canDel ? sp.canDel(k) : true; return `<div class="cm-row${col ? '' : ' nocolor'}" data-c="${esc(k)}">
        ${col ? `<label class="cm-color" style="--cc:${col}" title="${t('subCatColor')}"><input type="color" value="${col}" data-cm-color></label>` : '<span></span>'}
        <input class="input" value="${esc(sp.name(k))}" maxlength="40" data-cm-name>
        <span class="dim">${t(sp.unit || 'subNSubs', { n: sp.count(k) })}</span>
        <button type="button" class="icon-btn sm" data-cm-mv="-1" ${i ? '' : 'disabled'} title="${t('moveUp')}">${ic('chev-u')}</button>
        <button type="button" class="icon-btn sm" data-cm-mv="1" ${i < list.length - 1 ? '' : 'disabled'} title="${t('moveDown')}">${ic('chev-d')}</button>
        <button type="button" class="icon-btn sm" data-cm-del ${cd ? '' : 'disabled'} title="${cd ? t('del') : esc(sp.delTip || '')}">${ic('trash')}</button></div>`; }).join('') +
      `<div class="cm-add"><input class="input" maxlength="40" placeholder="${esc(sp.ph || t('subCatNewPh'))}" data-cm-new><button type="button" class="btn btn-glass sm" data-cm-add>${ic('plus')}${t('subCatAdd')}</button></div>
      <p class="hint">${sp.hint || t('subCatManageHint')}</p>`;
  }
  function bindMgr(box, sp, onChange) {
    const draw = () => { box.querySelector('.cm-body').innerHTML = mgrHTML(sp); };
    const done = () => { commit(); draw(); if (onChange) onChange(); };
    const keyOf = el => el.closest('.cm-row').dataset.c;
    box._draw = draw;
    box.addEventListener('click', async e => {
      const mv = e.target.closest('[data-cm-mv]');
      if (mv && !mv.disabled) { const list = sp.list(), i = list.findIndex(x => sp.key(x) === keyOf(mv)), j = i + +mv.dataset.cmMv; [list[i], list[j]] = [list[j], list[i]]; done(); return; }
      if (e.target.closest('[data-cm-add]')) {
        const inp = box.querySelector('[data-cm-new]'), name = inp.value.trim(); if (!name) { inp.focus(); return; }
        if (sp.add(name) === 'exists') toast(t('subCatExists'), 'err'); else done();
        return;
      }
      const del = e.target.closest('[data-cm-del]'); if (!del || del.disabled) return;
      if (await sp.del(keyOf(del))) done();
    });
    box.addEventListener('change', e => {
      const nm = e.target.closest('[data-cm-name]'), cl = e.target.closest('[data-cm-color]');
      if (nm) { const k = keyOf(nm), v = nm.value.trim(); if (!v || v === sp.name(k)) { nm.value = sp.name(k); return; } if (sp.rename(k, v) === 'exists') { toast(t('subCatExists'), 'err'); nm.value = sp.name(k); return; } done(); }
      if (cl) { sp.recolor(keyOf(cl), cl.value); done(); }
    });
    box.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest('[data-cm-new]')) { e.preventDefault(); box.querySelector('[data-cm-add]').click(); } });
    draw();
  }
  function openMgr(title, sp, onChange) {
    openModal({ title, body: `<div class="cat-mgr solo"><div class="cm-body"></div></div>`, footer: `<button class="btn btn-accent" data-modal-close>${ic('check')}${t('done')}</button>`,
      onMount(m) { bindMgr($('.cat-mgr', m), sp, onChange); } });
  }
  const SUB_CAT_SPEC = {
    list: subCatList, key: x => x.k, name: subCatName, color: subCatColor, count: k => DB.subs.filter(s => s.cat === k).length,
    rename(k, v) { const o = subCatList().find(x => x.k !== k && subCatName(x.k).toLowerCase() === v.toLowerCase()); if (o) return 'exists'; subCatList().find(x => x.k === k).n = v; return true; },
    recolor(k, c) { subCatList().find(x => x.k === k).c = c; },
    add(name) { const had = subCats().length; findOrAddCat(name); return subCats().length === had ? 'exists' : true; },
    async del(k) {
      const name = subCatName(k), n = DB.subs.filter(x => x.cat === k).length;
      if (!(await confirmDialog({ title: t('subCatDelT'), msg: t('subCatDelM', { c: esc(name), n }), ok: t('del') }))) return false;
      DB.subs.filter(x => x.cat === k).forEach(x => { logOp('sub', x, 'edit', [['cat', name, '']]); x.cat = ''; });
      DB.meta.subCats = subCatList().filter(x => x.k !== k);
      toast(t('subCatDeleted', { c: name }), 'ok'); return true;
    }
  };
  const ASSET_CLS_SPEC = {
    list: clsList, key: x => x.k, name: clsName, color: clsColor, unit: 'nAssets', count: k => DB.assets.filter(a => tagsOf(a).includes(k)).length,
    canDel: k => !CLASSES.includes(k), get delTip() { return t('clsBuiltinTip'); },
    get hint() { return t('clsMgrHint'); }, get ph() { return t('clsNewPh'); },
    rename(k, v) { if (clsList().some(x => x.k !== k && clsName(x.k).toLowerCase() === v.toLowerCase())) return 'exists'; clsItem(k).n = v; return true; },
    recolor(k, c) { clsItem(k).c = c; },
    add(name) { if (clsList().some(x => clsName(x.k).toLowerCase() === name.toLowerCase())) return 'exists'; clsList().push({ k: 'x' + uid(), n: name, c: '' }); return true; },
    async del(k) {
      const name = clsName(k), hit = DB.assets.filter(a => tagsOf(a).includes(k));
      if (!(await confirmDialog({ title: t('clsDelT'), msg: t('clsDelM', { c: esc(name), n: hit.length, o: esc(clsName('other')) }), ok: t('del') }))) return false;
      hit.forEach(a => { const nc = tagsOf(a).filter(c => c !== k); a.cls = nc.length ? nc : ['other']; logOp('asset', a, 'edit', [['cls', [k], a.cls.slice()]]); a.updatedAt = Date.now(); });
      DB.meta.assetCls = clsList().filter(x => x.k !== k);
      if (UI.hold.cls === k) UI.hold.cls = 'all';
      Object.keys(S()).forEach(x => { if (/^rank/.test(x) && S()[x] === k) S()[x] = 'all'; });
      toast(t('subCatDeleted', { c: name }), 'ok'); return true;
    }
  };
  const WH_SPEC = {
    list: whList, key: x => x, name: k => k, unit: 'nAssets', count: k => DB.assets.filter(a => a.warehouse === k).length,
    get hint() { return t('whMgrHint'); }, get ph() { return t('whNewPh'); },
    rename(k, v) {
      const list = whList(); if (list.includes(v)) return 'exists';
      list[list.indexOf(k)] = v;
      DB.assets.filter(a => a.warehouse === k).forEach(a => { logOp('asset', a, 'edit', [['warehouse', k, v]]); a.warehouse = v; a.updatedAt = Date.now(); });
      if (UI.hold.wh === k) UI.hold.wh = v;
      return true;
    },
    add(name) { const list = whList(); if (list.includes(name)) return 'exists'; list.push(name); return true; },
    async del(k) {
      const hit = DB.assets.filter(a => a.warehouse === k);
      if (hit.length && !(await confirmDialog({ title: t('whDelT'), msg: t('whDelM', { c: esc(k), n: hit.length }), ok: t('del') }))) return false;
      hit.forEach(a => { logOp('asset', a, 'edit', [['warehouse', k, '']]); a.warehouse = ''; a.updatedAt = Date.now(); });
      DB.meta.whs = whList().filter(x => x !== k);
      if (UI.hold.wh === k) UI.hold.wh = '__all';
      toast(t('mgrDeleted', { c: k }), 'ok'); return true;
    }
  };
  /** 资产明细：资产类别 / 仓库 管理（两个标签页） */
  function openAssetMgr(tab) {
    const rerender = () => renderPage();
    openModal({ title: t('assetMgrT'),
      body: `<div class="seg seg-full mb" id="am-tab"><button type="button" data-v="cls">${t('assetClass')}</button><button type="button" data-v="wh">${t('warehouse')}</button></div>
        <div class="cat-mgr solo" id="am-cls"><div class="cm-body"></div></div><div class="cat-mgr solo" id="am-wh"><div class="cm-body"></div></div>`,
      footer: `<button class="btn btn-accent" data-modal-close>${ic('check')}${t('done')}</button>`,
      onMount(m) {
        bindMgr($('#am-cls', m), ASSET_CLS_SPEC, rerender); bindMgr($('#am-wh', m), WH_SPEC, rerender);
        const show = v => { $$('#am-tab button', m).forEach(b => b.classList.toggle('on', b.dataset.v === v)); $('#am-cls', m).style.display = v === 'cls' ? '' : 'none'; $('#am-wh', m).style.display = v === 'wh' ? '' : 'none'; };
        $('#am-tab', m).addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) show(b.dataset.v); });
        show(tab || 'cls');
      } });
  }
  function openCatMgr() { openMgr(t('subCatManage'), SUB_CAT_SPEC, () => { if (UI.page === 'subs') renderSubs(); }); }
  const dOf = k => new Date(k + 'T00:00:00');
  /** 日期加减：月 / 年按日历走（1 月 31 日 + 1 个月 = 2 月 28 日） */
  function addDate(k, n, u) {
    const d = dOf(k);
    if (u === 'day') d.setDate(d.getDate() + n);
    else {
      const day = d.getDate();
      d.setDate(1); d.setMonth(d.getMonth() + (u === 'year' ? 12 * n : n));
      d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    }
    return ymd(d);
  }
  const cycleSpec = s => (s.cycle === 'month' ? [1, 'month'] : s.cycle === 'quarter' ? [3, 'month'] : s.cycle === 'year' ? [1, 'year']
    : s.cycle === 'custom' ? [Math.max(1, +s.cycleN || 1), s.cycleU || 'month'] : null);
  const addCycle = (k, s) => { const c = cycleSpec(s); return c ? addDate(k, c[0], c[1]) : null; };
  /** 第 n 期的扣费日：始终从起点按 n 个周期计算，避免月底日期越推越早（1/31 → 2/28 → 3/31） */
  const cycleAt = (k0, s, n) => { const c = cycleSpec(s); return c ? addDate(k0, c[0] * n, c[1]) : null; };
  /** 起点之后第一个晚于 after 的扣费日 */
  function nextBill(k0, s, after) { let n = 0, d = k0; while (d && d <= after && n < 5000) d = cycleAt(k0, s, ++n); return d; }
  const daysTo = k => Math.round((dOf(k) - dOf(todayKey())) / 864e5);
  const billStart = s => (+s.trialDays > 0 ? addDate(s.start, +s.trialDays, 'day') : s.start);
  /** 某天适用的价格（续费时涨价会记一笔价格变动，之前的推算账单仍按旧价） */
  function priceAt(s, d) {
    // 价格时间线（账单明细里设置的“从某天起每期价格”）+ 续费时涨价生效的记录
    const tl = (s.prices || []).map(x => ({ from: x.from, p: x.p })).concat((s.priceHist || []).map(x => ({ from: x.from, p: x.p })))
      .filter(x => x.from).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    const h = tl.filter(x => x.from <= d);
    if (h.length) return +h[h.length - 1].p || 0;
    if (s.prices && s.prices.length) return +tl[0].p || 0;                 // 早于第一段：按第一段价格
    return s.priceHist && s.priceHist.length ? +s.priceHist[0].old || +s.price || 0 : +s.price || 0;
  }
  /** 折合每月：月付 = 价格；季付 ÷ 3；年付 ÷ 12；自定义按天数换算；一次性不折算 */
  function perMonth(s) {
    const c = cycleSpec(s); if (!c) return 0;
    const months = c[1] === 'day' ? c[0] / 30.4375 : c[1] === 'year' ? c[0] * 12 : c[0];
    return (+s.price || 0) / months;
  }
  const cycleLabel = s => (s.cycle === 'custom' ? t('cycEvery', { n: Math.max(1, +s.cycleN || 1), u: t('unitD_' + (s.cycleU || 'month')) }) : t('cyc_' + (s.cycle || 'month')));
  const cycleShort = s => (s.cycle === 'custom' ? `${Math.max(1, +s.cycleN || 1)}${t('unitS2_' + (s.cycleU || 'month'))}` : t('cycS_' + (s.cycle || 'month')));
  /** 一个订阅的全部扣费（显示币种） */
  function subPays(s, all) {
    const real = DB.txs.filter(x => x.subId === s.id && x.type === 'expense').map(x => ({ date: x.date, v: conv(+x.amount || 0, x.ccy), amt: +x.amount || 0, ccy: x.ccy, real: true, id: x.id }));
    const est = [], tk = todayKey();
    const b0 = s.start ? billStart(s) : '';
    // v7.6：从开始到今天（或到期日）的每一期都计入；某一期在扣费日前后半个周期内有关联的记账付款，就用实际付款代替这期推算（不重复计算）
    const cs = cycleSpec(s), cyDays = !cs ? 36500 : cs[1] === 'year' ? 365 * cs[0] : cs[1] === 'month' ? 30.44 * cs[0] : cs[0];
    const win = Math.max(3, cyDays / 2), dn = k => Math.round(new Date(k + 'T00:00:00').getTime() / 864e5), used = new Set();
    let d = b0, n = 0;
    while (d && d <= tk && (!s.expire || d < s.expire) && n < 3000) {
      let best = -1, bd = Infinity;
      real.forEach((r, i) => { if (used.has(i)) return; const g = Math.abs(dn(r.date) - dn(d)); if (g <= win && g < bd) { bd = g; best = i; } });
      if (best >= 0) { used.add(best); if (s.cycle === 'once') break; d = cycleAt(b0, s, ++n); continue; }
      // 单期调整：折扣（自定义金额）/ 免费（0）/ 跳过（这期没扣费，不计入）
      const base = priceAt(s, d), a = s.adj && s.adj[d];
      const amt = a ? (a.t === 'free' || a.t === 'skip' ? 0 : +a.amt || 0) : base;
      if (!(a && a.t === 'skip') || all) est.push({ date: d, v: conv(amt, s.ccy), amt, base, ccy: s.ccy, real: false, tag: a ? a.t : '', note: a ? a.n || '' : '' });
      if (s.cycle === 'once') break;
      d = cycleAt(b0, s, ++n);
    }
    return real.concat(est);
  }
  function allSubPays() { const out = []; DB.subs.forEach(s => subPays(s).forEach(p => out.push(Object.assign({ s }, p)))); return out; }
  const subTotal = s => subPays(s).reduce((a, p) => a + p.v, 0);
  const subInPeriod = (d, p) => { const tk = todayKey(); return p === 'today' ? d === tk : p === 'month' ? d.slice(0, 7) === tk.slice(0, 7) : p === 'year' ? d.slice(0, 4) === tk.slice(0, 4) : true; };
  /** 状态：试用中 / 无限期 / 已过期 / 快到期 / 正常 */
  function subState(s) {
    const tk = todayKey();
    if (s.cycle === 'once') return 'forever';
    if (s.expire && daysTo(s.expire) < 0) return 'expired';   // 已过到期日：不管是否还在试用期，都算已过期
    if (+s.trialDays > 0 && s.start && tk >= s.start && tk < billStart(s)) return 'trial';
    if (!s.expire) return 'forever';
    const d = daysTo(s.expire);
    if (d < 0) return 'expired';
    if (d <= Math.max(7, +s.remind || 0)) return 'soon';
    return 'active';
  }
  function subIconHTML(s, cls) {
    if (s.icon) return `<span class="sub-ic ${cls || ''}"><img src="${esc(s.icon)}" alt=""></span>`;
    const ch = (String(s.name || '?').trim()[0] || '?').toUpperCase();
    return `<span class="sub-ic letter ${cls || ''}" style="--tc:${subCatColor(s.cat || '')}">${esc(ch)}</span>`;
  }
  const subCatTag = c => `<span class="tag" style="--tc:${subCatColor(c || '')}">${esc(subCatName(c))}</span>`;
  function expireHTML(s, inline) {
    if (s.cycle === 'once') return `<span class="exp-b forever">${t('subBuyout')}</span>`;
    const st = subState(s);
    if (!s.expire) return `<span class="exp-b forever">${t('subForever')}</span>`;
    const d = daysTo(s.expire);
    const badge = st === 'expired' ? t('subExpiredN', { n: -d }) : d === 0 ? t('subDueToday') : t('subLeftN', { n: d });
    return `${inline ? '' : `<span class="num">${s.expire}</span>`}<span class="exp-b ${st === 'trial' ? 'active' : st}">${inline ? s.expire + ' · ' : ''}${badge}</span>`;
  }
  /** 柱状图数据：今日 = 最近 14 天；本月 = 本月每天；本年 = 每月；总计 = 每月（超过 24 个月按年） */
  function subBarData(p, pays) {
    const tk = todayKey();
    let keys = [], keyOf = d => d, label, tipOf;
    if (p === 'today') { for (let i = 13; i >= 0; i--) keys.push(addDate(tk, -i, 'day')); label = k => `${+k.slice(5, 7)}/${+k.slice(8)}`; tipOf = k => dayLabel(k); }
    else if (p === 'month') {
      const n = new Date(+tk.slice(0, 4), +tk.slice(5, 7), 0).getDate();
      for (let d = 1; d <= n; d++) keys.push(`${tk.slice(0, 7)}-${pad(d)}`);
      label = k => String(+k.slice(8)); tipOf = k => dayLabel(k);
    } else if (p === 'year') {
      for (let m = 1; m <= 12; m++) keys.push(`${tk.slice(0, 4)}-${pad(m)}`);
      keyOf = d => d.slice(0, 7); label = k => (zh() ? `${+k.slice(5)}月` : t('mon' + (+k.slice(5) - 1))); tipOf = k => periodLabel('month', k + '-01');
    } else {
      const first = pays.reduce((m, x) => (!m || x.date < m ? x.date : m), '') || tk;
      const months = (+tk.slice(0, 4) - +first.slice(0, 4)) * 12 + (+tk.slice(5, 7) - +first.slice(5, 7)) + 1;
      if (months <= 24) {
        let k = first.slice(0, 7); for (let i = 0; i < Math.max(1, months); i++) { keys.push(k); k = addDate(k + '-01', 1, 'month').slice(0, 7); }
        keyOf = d => d.slice(0, 7); label = k => `${k.slice(2, 4)}/${k.slice(5)}`; tipOf = k => periodLabel('month', k + '-01');
      } else {
        for (let y = +first.slice(0, 4); y <= +tk.slice(0, 4); y++) keys.push(String(y));
        keyOf = d => d.slice(0, 4); label = k => k; tipOf = k => periodLabel('year', k + '-01-01');
      }
    }
    const idx = {}; keys.forEach((k, i) => { idx[k] = i; });
    const buckets = keys.map(() => ({}));
    pays.forEach(x => { const i = idx[keyOf(x.date)]; if (i == null) return; const c = x.s.cat || ''; buckets[i][c] = (buckets[i][c] || 0) + x.v; });
    const nowK = keyOf(tk);
    return { keys, labels: keys.map(label), tips: keys.map(tipOf), buckets, totals: buckets.map(o => Object.values(o).reduce((a, b) => a + b, 0)),
      stacks: buckets.map(o => Object.keys(o).sort((a, b) => o[b] - o[a]).map(c => ({ key: c, color: subCatColor(c), v: o[c] }))), mark: i => keys[i] === nowK };
  }
  /** 归档：已过期的订阅可以归档。归档后不在订阅列表里、不再提醒；以前的扣费仍计入费用统计。续费或把到期日改到以后会自动取消归档 */
  const subsInView = () => DB.subs.filter(s => (UI.sub.view === 'archived') === !!s.archived);
  const canArchive = s => !s.archived && subState(s) === 'expired';
  function setArchived(list, on) {
    const hit = list.filter(s => (on ? canArchive(s) : !!s.archived));
    hit.forEach(s => { if (on) s.archived = todayKey(); else delete s.archived; s.updatedAt = Date.now(); logOp('sub', s, on ? 'archive' : 'unarchive'); });
    if (!hit.length) { toast(t(on ? 'subArchNone' : 'subUnarchNone'), 'err'); return 0; }
    UI.sub.sel.clear(); commit(); renderSubs(); checkSubReminders();
    toast(t(on ? 'subArchivedN' : 'subUnarchivedN', { n: hit.length }) + (list.length > hit.length ? ' · ' + t('subArchSkipN', { n: list.length - hit.length }) : ''), 'ok');
    return hit.length;
  }
  function subList() {
    const U = UI.sub, q = U.q.trim().toLowerCase();
    let list = subsInView().map(s => ({ s, total: subTotal(s), pm: conv(perMonth(s), s.ccy), cyc: conv(+s.price || 0, s.ccy) }));
    list = list.filter(x => U.cat === 'all' || (x.s.cat || '') === U.cat);
    if (q) list = list.filter(x => [x.s.name, x.s.alias, subCatName(x.s.cat), x.s.note, x.s.payId ? acctName(x.s.payId) : ''].some(v => String(v || '').toLowerCase().includes(q)));
    const pv = x => (U.pmode === 'month' ? (x.s.cycle === 'once' ? 0 : x.pm) : x.cyc), ex = x => x.s.expire || '9999-12-31';
    const cmp = {
      expireAsc: (a, b) => (ex(a) < ex(b) ? -1 : ex(a) > ex(b) ? 1 : 0), expireDesc: (a, b) => (ex(a) < ex(b) ? 1 : ex(a) > ex(b) ? -1 : 0),
      priceDesc: (a, b) => pv(b) - pv(a), priceAsc: (a, b) => pv(a) - pv(b),
      totalDesc: (a, b) => b.total - a.total, totalAsc: (a, b) => a.total - b.total,
      name: (a, b) => String(a.s.name).localeCompare(String(b.s.name))
    }[U.sort] || ((a, b) => 0);
    return list.sort(cmp);
  }
  const subPeriodIcon = { today: 'clock', month: 'cal', year: 'sparkle', total: 'pie' };
  function renderSubs() {
    const U = UI.sub, pays = allSubPays(), tk = todayKey();
    const inP = p => pays.filter(x => subInPeriod(x.date, p));
    const card = p => {
      const list = inP(p), v = list.reduce((a, x) => a + x.v, 0), n = list.length;
      let sub;
      if (p === 'today') sub = t('subTodaySub', { n });
      else if (p === 'month') sub = t('subMonthSub', { n, v: money(v / (+tk.slice(8)), { max: 2 }) });
      else if (p === 'year') sub = t('subYearSub', { n, v: money(v / (+tk.slice(5, 7)), { max: 2 }) });
      else { const first = pays.reduce((m, x) => (!m || x.date < m ? x.date : m), ''); sub = t('subTotalSub', { n: DB.subs.length, d: first ? first.slice(0, 7) : '—' }); }
      return kpiCard({ cls: `sub-kpi ${U.period === p ? 'sel' : ''}`, attr: `data-action="sub-period" data-v="${p}" role="button" tabindex="0"`, icon: subPeriodIcon[p],
        label: t('subK_' + p), val: moneyHTML(v), sub, spark: sparkSVG(subBarData(p, pays).totals, U.period === p ? '#FF9000' : '#8E8E93') });
    };
    const inView = subsInView(), nArch = DB.subs.filter(s => s.archived).length, nExp = DB.subs.filter(canArchive).length;
    if (U.view === 'archived' && !nArch) U.view = 'active';
    const cnt = { all: subsInView().length }; subsInView().forEach(s => { const c = s.cat || ''; cnt[c] = (cnt[c] || 0) + 1; });
    const catsShown = subCats().filter(c => cnt[c]).concat(cnt[''] ? [''] : []);
    if (U.cat !== 'all' && !cnt[U.cat]) U.cat = 'all';
    const chips = [`<button class="chip ${U.cat === 'all' ? 'on' : ''}" data-action="sub-cat" data-v="all">${t('all')}<em>${cnt.all}</em></button>`].concat(catsShown.map(c =>
      `<button class="chip ${U.cat === c ? 'on' : ''}" data-action="sub-cat" data-v="${esc(c)}"><i class="cdot" style="background:${subCatColor(c)}"></i>${esc(subCatName(c))}<em>${cnt[c]}</em></button>`)).join('');
    const sorts = ['expireAsc', 'expireDesc', 'priceDesc', 'priceAsc', 'totalDesc', 'totalAsc', 'name'];
    $('#page').innerHTML = `
      <div class="section-head">
        <h2>${t('subTitle')}</h2>
        <div class="head-tools">
          ${lockBtnHTML()}
          <button class="btn ${U.batch ? 'btn-soft' : 'btn-glass'}" data-action="sub-batch">${ic('select')}${U.batch ? t('batchDone') : t('batch')}</button>
          <button class="btn btn-accent" data-action="add-sub">${ic('plus')}${t('subAdd')}</button>
        </div>
      </div>
      <section class="kpis sub-kpis">${SUB_PERIODS.map(card).join('')}</section>
      <div class="grid g-ov">
        <div class="card glass">
          <div class="card-head"><div class="card-title">${t('subAllocT')}<span class="per-pill">${t('subK_' + U.period)}</span></div></div>
          <div id="sub-alloc"></div>
        </div>
        <div class="card glass">
          <div class="card-head"><div class="card-title">${t('subTrendT')}<span class="per-pill">${t('subBarRange_' + U.period)}</span></div>
            <div class="head-tools"><label class="mini-select">${t('yStep')}<select data-change="subStep">${['auto', '10', '100', '1000', '10000'].map(v =>
              `<option value="${v}" ${String(S().subStep || 'auto') === v ? 'selected' : ''}>${v === 'auto' ? t('auto') : symOf(S().ccy) + fmtNum(+v, 0, 0)}</option>`).join('')}</select></label></div></div>
          <div class="chart-legend" id="sub-legend"></div>
          <div class="chart" id="sub-bars"></div>
        </div>
      </div>
      <div class="toolbar">
        <label class="search">${ic('search')}<input data-input="subQ" value="${esc(U.q)}" placeholder="${t('subSearchPh')}" autocomplete="off"></label>
        <label class="mini-select">${ic('sort')}<select data-change="subSort">${sorts.map(v => `<option value="${v}" ${U.sort === v ? 'selected' : ''}>${t('subSort_' + v)}</option>`).join('')}</select></label>
        <div class="seg" title="${t('subPmodeTip')}"><button class="${U.pmode !== 'month' ? 'on' : ''}" data-action="sub-pmode" data-v="cycle">${t('subPmCycle')}</button><button class="${U.pmode === 'month' ? 'on' : ''}" data-action="sub-pmode" data-v="month">${t('subPmMonth')}</button></div>
        ${colBtnHTML('sub')}
      </div>
      <div class="chips mb">${chips}<button class="chip chip-tool" data-action="sub-cats">${ic('sliders')}${t('subCatManageS')}</button>
        ${U.view !== 'archived' && nExp ? `<button class="chip chip-tool" data-action="sub-arch-all">${ic('archive')}${t('subArchAll', { n: nExp })}</button>` : ''}
        ${nArch || U.view === 'archived' ? `<button class="chip chip-arch ${U.view === 'archived' ? 'on' : ''}" data-action="sub-view">${ic('archive')}${t('subArchived')}<em>${nArch}</em></button>` : ''}</div>
      ${U.view === 'archived' ? `<div class="arch-bar glass">${ic('archive')}<span>${t('subArchHint')}</span><button class="btn btn-glass sm" data-action="sub-view">${t('subArchBack')}</button></div>` : ''}
      <div id="batch-bar"></div>
      <div id="sub-body"></div>`;
    drawSubCharts(pays);
    renderSubBody();
  }
  function drawSubCharts(pays) {
    const U = UI.sub, p = U.period, list = pays.filter(x => subInPeriod(x.date, p));
    // 左：分类占比（同资产总占比的圆环 + 图例）
    const byCat = {}; list.forEach(x => { const c = x.s.cat || ''; byCat[c] = (byCat[c] || 0) + x.v; });
    const tot = Object.values(byCat).reduce((a, b) => a + b, 0);
    const segs = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]).map(c => ({ key: c || '__none', label: subCatName(c), value: byCat[c], color: subCatColor(c), c }));
    const box = $('#sub-alloc');
    if (box) {
      if (!tot) box.innerHTML = `<div class="empty sm"><div class="em">🧾</div><p>${t(DB.subs.length ? 'subNoPay_' + p : 'subEmpty')}</p>${DB.subs.length ? '' : `<div class="btns"><button class="btn btn-accent sm" data-action="add-sub">${ic('plus')}${t('subAdd')}</button></div>`}</div>`;
      else {
        const legend = segs.map(x => {
          const n = list.filter(y => (y.s.cat || '') === x.c).length, pc = (x.value / tot) * 100;
          return `<div class="legend-row lg-line clickable" data-k="${esc(x.key)}" data-action="sub-cat" data-v="${esc(x.c)}"><i class="dot" style="background:${x.color}"></i>
            <div class="lg-name">${esc(x.label)}<span class="rk-wh">${t('subPayN', { n })}</span></div>
            <div class="lg-val num">${money(x.value)}</div><div class="lg-pct num">${pc.toFixed(1)}%</div>
            <div class="lg-bar"><i style="width:${pc}%;background:${x.color}"></i></div><span class="lg-go">${ic('chev-r')}</span></div>`;
        }).join('');
        box.innerHTML = `<div class="donut-wrap"><div class="donut" id="sub-donut"></div><div class="legend">${legend}</div></div>`;
        const d = Charts.donut($('#sub-donut'), segs, {
          id: 'sub-' + p,
          center: k => {
            if (!k) return `<div class="t">${t('subK_' + p)}</div><div class="v num">${money(tot)}</div><div class="p">${t('subPayN', { n: list.length })}</div>`;
            const sg = segs.find(x => x.key === k);
            return `<div class="t">${esc(sg.label)}</div><div class="v num">${money(sg.value)}</div><div class="p">${((sg.value / tot) * 100).toFixed(2)}%</div>`;
          },
          onHover: k => $$('#sub-alloc .legend-row').forEach(r => r.classList.toggle('hl', r.dataset.k === k)),
          onClick: k => { const sg = segs.find(x => x.key === k); if (sg) { UI.sub.cat = sg.c; renderSubs(); } }
        });
        $$('#sub-alloc .legend-row').forEach(r => { r.addEventListener('mouseenter', () => d.hl(r.dataset.k)); r.addEventListener('mouseleave', () => d.hl(null)); });
      }
    }
    // 右：费用柱状图（横向时间、竖向金额，按分类堆叠）
    const B = subBarData(p, pays), sym = symOf(S().ccy), el = $('#sub-bars');
    const used = Array.from(new Set(B.stacks.flat().map(x => x.key)));
    $('#sub-legend').innerHTML = used.length ? used.map(c => `<span><i style="background:${subCatColor(c)}"></i>${esc(subCatName(c))}</span>`).join('') + `<span>${t('total')} <b class="num">${money(B.totals.reduce((a, b) => a + b, 0))}</b></span>` : '';
    if (!el) return;
    Charts.bars(el, {
      labels: B.labels, stacks: B.stacks, step: S().subStep || 'auto', mark: B.mark,
      fmtY: v => (hidden() ? '' : sym + compact(v)),
      tip: i => `<div class="tt">${B.tips[i]}</div>${B.stacks[i].map(x => `<div class="tr"><span><i style="background:${x.color}"></i>${esc(subCatName(x.key))}</span><b class="num">${money(x.v)}</b></div>`).join('')}
        <div class="tr"><span>${t('total')}</span><b class="num">${money(B.totals[i])}</b></div>`
    });
  }
  function subPriceCell(x, inline) {
    const s = x.s, U = UI.sub, orig = s.ccy !== S().ccy;
    let main, small = '';
    if (U.pmode === 'month' && s.cycle !== 'once') {
      main = `${money(x.pm, { max: 2 })}<span class="per">/${t('cycS_month')}</span>`;
      small = `${money(+s.price || 0, { ccy: s.ccy, max: 2 })}/${cycleShort(s)}`;
    } else {
      main = s.cycle === 'once' ? money(x.cyc, { max: 2 }) : `${money(x.cyc, { max: 2 })}<span class="per">/${cycleShort(s)}</span>`;
      if (orig) small = `${money(+s.price || 0, { ccy: s.ccy, max: 2 })}`;
      else if (s.cycle === 'once') small = t('subBuyout');
      else if (s.cycle !== 'month' && s.cycle !== 'once') small = `≈ ${money(x.pm, { max: 2 })}/${t('cycS_month')}`;
    }
    const up = s.nextPrice != null && s.nextPrice !== '' ? `<span class="np-b" title="${t('subNextTip')}">${ic('trend')}${t('subNext')} ${money(+s.nextPrice, { ccy: s.ccy, max: 2 })}</span>` : '';
    return inline ? `<span class="pm">${main}</span>${up}` : `${main}${small ? `<small>${small}</small>` : ''}${up}`;
  }
  /** 订阅明细的列（h：行内用到的小工具；列设置弹窗里只用到名字时可不传） */
  function subCols(h) {
    const U = UI.sub; h = h || {};
    const sortTh = (k, label) => ({ thCls: `r sortable ${U.sort === k + 'Desc' || U.sort === k + 'Asc' ? 'on' : ''}`, thAttr: `data-action="sub-sort-head" data-v="${k}"`, th: `${label}<span class="arr">${U.sort === k + 'Asc' ? '↑' : '↓'}</span>` });
    return [
      { k: 'name', label: t('subColName'), lock: true, th: t('subColName'), td: x => `<div class="sub-name">${subIconHTML(x.s)}<div><div class="nmcell"><b>${esc(x.s.name)}</b>${x.s.locked ? ic('lock', 'lk') : ''}${h.trial(x.s)}</div>${x.s.note ? `<small>${esc(x.s.note)}</small>` : ''}</div></div>` },
      { k: 'alias', label: t('subColAlias'), th: t('subColAlias'), tdCls: 'muted alias-cell', td: x => (x.s.alias ? esc(x.s.alias) : '<span class="dim">—</span>') },
      { k: 'account', label: t('subColAccount'), th: t('subColAccount'), thCls: 'c', tdCls: 'c', td: x => h.infoBtn(x.s, 'account') },
      { k: 'site', label: t('subColSite'), th: t('subColSite'), thCls: 'c', tdCls: 'c', td: x => h.infoBtn(x.s, 'site') },
      { k: 'cat', label: t('subColCat'), th: t('subColCat'), td: x => subCatTag(x.s.cat) },
      { k: 'cycle', label: t('subColCycle'), th: t('subColCycle'), thCls: 'c', tdCls: 'c', td: x => `<span class="cyc-b">${esc(cycleLabel(x.s))}</span>` },
      Object.assign({ k: 'price', label: t('subColPrice'), tdCls: 'r num strong', td: x => subPriceCell(x) }, sortTh('price', U.pmode === 'month' ? t('subColPriceM') : t('subColPrice'))),
      { k: 'pay', label: t('subColPay'), th: t('subColPay'), tdCls: 'muted', td: x => h.payTxt(x.s) },
      { k: 'start', label: t('subColStart'), th: t('subColStart'), tdCls: 'num', td: x => `${x.s.start || '—'}${x.s.cycle === 'once' ? `<small>${t('subBuyDate')}</small>` : x.s.trialDays > 0 ? `<small>${t('subBillFrom', { d: billStart(x.s) })}</small>` : ''}` },
      Object.assign({ k: 'expire', label: t('subColExpire'), tdCls: 'num exp-cell', td: x => expireHTML(x.s) }, sortTh('expire', t('subColExpire'))),
      { k: 'remind', label: t('subColRemind'), th: t('subColRemind'), thCls: 'c', tdCls: 'c', td: x => (+x.s.remind ? `<span class="rm-b">${ic('clock')}${t('subRemindN', { n: x.s.remind })}</span>` : '<span class="dim">—</span>') },
      Object.assign({ k: 'total', label: t('subColTotal'), tdCls: 'r num strong', td: x => `${money(x.total)}<small>${t('subPayN', { n: subPays(x.s).length })}${(x.s.prices && x.s.prices.length > 1) || (x.s.adj && Object.keys(x.s.adj).length) ? ` · <span class="adj-mk">${t('subBillAdjMk')}</span>` : ''}</small>` }, sortTh('total', t('subColTotal'))),
      { k: 'ops', label: t('colOps'), fixed: true, th: t('colOps'), thCls: 'c', tdCls: 'c', td: x => (U.batch ? '' : h.ops(x.s)) }
    ];
  }
  function renderSubBody() {
    const U = UI.sub, rows = subList();
    const archBtn = (s, txt) => (s.archived ? `<button class="op arch" data-action="sub-unarchive" data-id="${s.id}" title="${t('subUnarchive')}">${ic('unarchive')}${txt ? t('subUnarchive') : ''}</button>`
      : canArchive(s) ? `<button class="op arch" data-action="sub-archive" data-id="${s.id}" title="${t('subArchive')}">${ic('archive')}${txt ? t('subArchive') : ''}</button>` : '');
    renderBatchBar('sub', rows.map(r => r.s.id));
    const ops = s => `<div class="ops icon-ops">${histBtn('sub', s.id)}<button class="op bills" data-action="sub-bills" data-id="${s.id}" title="${t('subBillsT')}">${ic('receipt')}</button><button class="op upd" data-action="sub-price" data-id="${s.id}" title="${t('subPriceUp')}">${ic('trend')}</button>${archBtn(s)}<button class="op edit" data-action="edit-sub" data-id="${s.id}" title="${t('edit')}">${ic('edit')}</button><button class="op del" data-action="del-sub" data-id="${s.id}" title="${t('del')}">${ic('trash')}</button></div>`;
    const payTxt = s => (s.payId ? `${esc(acctName(s.payId))}${acctWh(s.payId) ? `<small class="wh-sm">${ic('db')}${esc(acctWh(s.payId))}</small>` : ''}` : '<span class="dim">—</span>');
    const trial = s => (+s.trialDays > 0 && s.cycle !== 'once' ? `<span class="trial-b ${subState(s) === 'trial' ? 'on' : ''}">${t('subTrialN', { n: s.trialDays })}</span>` : '');
    // 账号 / 网站：只显示图标，点开才显示内容
    const infoBtn = (s, k) => (s[k] ? `<button class="info-ic" data-action="sub-info" data-k="${k}" data-id="${s.id}" title="${t(k === 'account' ? 'subAccountShow' : 'subSiteShow')}">${ic(k === 'account' ? 'user' : 'globe')}</button>` : '<span class="dim">—</span>');
    let body;
    if (!subsInView().length && DB.subs.length) body = U.view === 'archived' ? `<div class="card glass"><div class="empty"><div class="em">🗄️</div><h4>${t('subArchEmpty')}</h4></div></div>`
      : `<div class="card glass"><div class="empty"><div class="em">🗄️</div><h4>${t('subAllArchived')}</h4><div class="btns"><button class="btn btn-glass sm" data-action="sub-view">${ic('archive')}${t('subArchived')}</button><button class="btn btn-accent sm" data-action="add-sub">${ic('plus')}${t('subAdd')}</button></div></div></div>`;
    else if (!DB.subs.length) body = `<div class="card glass"><div class="empty"><div class="em">🔁</div><h4>${t('subEmpty')}</h4><p>${t('subEmptySub')}</p><div class="btns"><button class="btn btn-accent sm" data-action="add-sub">${ic('plus')}${t('subAdd')}</button></div></div></div>`;
    else if (!rows.length) body = `<div class="card glass">${emptyState('nomatch')}</div>`;
    else if (isMobile() || window.innerWidth < 760) {   // 手机布局或窄屏：卡片列表
      body = `<div class="hlist">${rows.map(x => { const s = x.s; return `<div class="hcard glass sub-card ${U.sel.has(s.id) ? 'sel' : ''} ${s.archived ? 'archived' : ''}">
        <div class="hc-top">
          ${U.batch ? `<label class="ck"><input type="checkbox" data-sel="sub" value="${s.id}" ${U.sel.has(s.id) ? 'checked' : ''}><i></i></label>` : ''}
          ${subIconHTML(s)}
          <div style="flex:1;min-width:0"><div class="nm">${esc(s.name)}${s.locked ? ic('lock', 'lk') : ''}</div>${s.alias ? `<div class="sub-alias">${esc(s.alias)}</div>` : ''}<div class="meta">${subCatTag(s.cat)}${trial(s)}${s.account ? infoBtn(s, 'account') : ''}${s.site ? infoBtn(s, 'site') : ''}</div></div>
          <div class="r"><div class="v num">${subPriceCell(x, true)}</div><div class="p">${expireHTML(s, true)}</div></div></div>
        <div class="hc-grid">
          <div><div class="l">${t('subColTotal')}</div><div class="x num">${money(x.total)}</div></div>
          <div><div class="l">${t('subColPay')}</div><div class="x">${s.payId ? esc(acctName(s.payId)) : '—'}</div></div>
          <div><div class="l">${t('subColRemind')}</div><div class="x">${+s.remind ? t('subRemindN', { n: s.remind }) : '—'}</div></div>
        </div>
        ${U.batch ? '' : `<div class="hc-ops">${histBtn('sub', s.id)}<button class="op bills" data-action="sub-bills" data-id="${s.id}">${ic('receipt')}${t('subBillsS')}</button><button class="op upd" data-action="sub-price" data-id="${s.id}">${ic('trend')}${t('subPriceUpS')}</button>${archBtn(s, true)}<button class="op edit" data-action="edit-sub" data-id="${s.id}">${ic('edit')}${t('edit')}</button><button class="op del" data-action="del-sub" data-id="${s.id}">${ic('trash')}${t('del')}</button></div>`}
      </div>`; }).join('')}</div>`;
    } else {
      let sumM = 0, sumT = 0;
      rows.forEach(x => { sumM += x.s.cycle === 'once' ? 0 : x.pm; sumT += x.total; });
      body = tableHTML('sub', subCols({ ops, payTxt, trial, infoBtn }), rows, {
        cls: 'sub-tbl', kind: 'sub', batch: U.batch, sel: U.sel, id: x => x.s.id, rowCls: x => `st-${subState(x.s)}${x.s.archived ? ' archived' : ''}`,
        footLabel: `${t('total')} · ${t('subNSubs', { n: rows.length })}`,
        foot: { price: `${money(sumM)}<small>${t('subPerMonthSum')}</small>`, total: money(sumT) }
      });
    }
    $('#sub-body').innerHTML = body;
  }

  /* ---- 账单明细：价格时间线 + 每期账单调整（只影响订阅统计，不动账户余额和到期时间） ---- */
  function openSubBills(s, keep) {
    const tk = todayKey();
    const st = keep || { prices: JSON.parse(JSON.stringify(s.prices || [])), adj: JSON.parse(JSON.stringify(s.adj || {})), edit: null, asc: false };
    if (!st.prices.length) st.prices = [{ from: s.start || tk, p: priceAt(s, s.start || tk) }];   // 没设置过：第一段 = 开始价格
    const cs = s.ccy, mny = v => money(v, { ccy: cs, max: 2, raw: true });
    openModal({
      title: `${t('subBillsT')} · ${esc(s.name)}`,
      body: `<div class="bl-head">${subIconHTML(s, 'lg')}<div id="bl-sum" class="bl-sum"></div></div>
        <div class="bl-sec"><div class="bl-h"><b>${ic('trend')}${t('subPriceTl')}</b><button type="button" class="btn btn-glass sm" id="bl-add">${ic('plus')}${t('subPriceAdd')}</button></div>
          <div id="bl-prices"></div><p class="hint">${t('subPriceTlHint')}</p></div>
        <div class="bl-sec"><div class="bl-h"><b>${ic('receipt')}${t('subBillList')}</b>
            <div class="seg sm" id="bl-order"><button type="button" data-v="desc" class="on">${t('subBillNewFirst')}</button><button type="button" data-v="asc">${t('subBillOldFirst')}</button></div></div>
          <div class="bl-range" id="bl-range"></div>
          <div id="bl-list" class="bl-list"></div></div>`,
      footer: `<button class="btn btn-glass" data-modal-close>${t('cancel')}</button><button class="btn btn-accent" id="bl-save">${ic('check')}${t('save')}</button>`,
      onMount(m) {
        const fake = () => Object.assign({}, s, { prices: st.prices.filter(x => x.from && x.p !== '' && !isNaN(+x.p)), adj: st.adj });
        const drawPrices = () => {
          $('#bl-prices', m).innerHTML = st.prices.map((x, i) => `<div class="pt-row">
            <span class="pt-l">${i ? t('subPriceFrom') : t('subPriceStart')}</span>
            <input class="input" type="date" data-i="${i}" data-f="from" value="${esc(x.from || '')}">
            <div class="price-row"><input class="input num" inputmode="decimal" data-i="${i}" data-f="p" value="${x.p === '' ? '' : esc(trim8(x.p))}"><span class="unit-txt">${esc(cs)} / ${esc(cycleShort(s))}</span></div>
            ${st.prices.length > 1 ? `<button type="button" class="icon-btn sm" data-del="${i}" title="${t('del')}">${ic('trash')}</button>` : '<span></span>'}</div>`).join('');
        };
        const drawList = () => {
          const f = fake(), bills = subPays(f, true).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) * (st.asc ? -1 : 1));
          const counted = bills.filter(b => b.tag !== 'skip'), tot = counted.reduce((a, b) => a + b.v, 0);
          const nAdj = bills.filter(b => b.tag).length;
          $('#bl-sum', m).innerHTML = `<div class="dim">${t('subColTotal')}</div><b class="num">${money(tot)}</b>
            <small>${t('subPayN', { n: counted.length })}${counted.length ? ` · ${t('subBillAvg', { v: money(tot / counted.length) })}` : ''}${nAdj ? ` · ${t('subBillAdjN', { n: nAdj })}` : ''}</small>`;
          // 账单范围：从哪天到哪天、为什么在这里停（到期日 / 第一笔记账续费 / 今天）
          const ds = bills.map(b => b.date).sort();
          const why = [];
          if (s.trialDays > 0 && s.cycle !== 'once') why.push(t('subBillWhyTrial', { d: billStart(s) }));
          if (s.expire && s.expire <= tk) why.push(t('subBillWhyExp', { d: s.expire }));
          $('#bl-range', m).innerHTML = ds.length ? `${ic('cal')}${t('subBillRange', { a: ds[0], b: ds[ds.length - 1], n: bills.length })}${why.length ? `<small>${why.join('；')}</small>` : ''}` : '';
          if (!bills.length) { $('#bl-list', m).innerHTML = `<div class="empty sm"><p>${t('subBillNone')}</p></div>`; return; }
          const rows = bills.map(b => {
            if (b.real) return `<div class="bl-row real"><span class="num bl-d">${b.date}</span><span class="bl-tag rec">${t('subBillRec')}</span>
              <span class="num bl-a">${money(b.amt, { ccy: b.ccy, max: 2 })}</span><button type="button" class="icon-btn sm" data-tx="${b.id}" title="${t('subBillOpenTx')}">${ic('edit')}</button></div>`;
            const tag = b.tag === 'free' ? t('subBillFree') : b.tag === 'skip' ? t('subBillSkip') : b.tag === 'custom' ? t('subBillDisc') : t('subBillEst');
            const changed = b.tag && Math.abs(b.amt - b.base) > 1e-9;
            const row = `<div class="bl-row ${b.tag ? 'adj ' + b.tag : ''} ${st.edit === b.date ? 'open' : ''}" data-d="${b.date}"><span class="num bl-d">${b.date}</span><span class="bl-tag ${b.tag || 'est'}">${tag}</span>
              <span class="num bl-a">${changed ? `<s>${mny(b.base)}</s>` : ''}${b.tag === 'skip' ? '—' : mny(b.amt)}${b.note ? `<small>${esc(b.note)}</small>` : ''}</span>
              <button type="button" class="icon-btn sm" data-edit="${b.date}" title="${t('subBillEdit')}">${ic('edit')}</button></div>`;
            if (st.edit !== b.date) return row;
            const a = st.adj[b.date] || {};
            return row + `<div class="bl-ed" data-d="${b.date}">
              <div class="seg seg-full" data-k="t">${['custom', 'free', 'skip'].map(k => `<button type="button" data-v="${k}" class="${(a.t || 'custom') === k ? 'on' : ''}">${t(k === 'custom' ? 'subBillDiscS' : k === 'free' ? 'subBillFree' : 'subBillSkip')}</button>`).join('')}</div>
              <div class="price-row" style="margin-top:8px"><input class="input num" inputmode="decimal" data-k="amt" value="${a.t === 'custom' || !a.t ? esc(trim8(a.t ? a.amt : b.base)) : '0'}" ${a.t && a.t !== 'custom' ? 'disabled' : ''}><span class="unit-txt">${esc(cs)}</span>
                <input class="input" data-k="n" maxlength="40" placeholder="${t('subBillNotePh')}" value="${esc(a.n || '')}"></div>
              <div class="bl-ed-btns">${a.t ? `<button type="button" class="btn btn-glass sm" data-reset="${b.date}">${t('subBillReset')}</button>` : ''}<button type="button" class="btn btn-accent sm" data-ok="${b.date}">${ic('check')}${t('subBillApply')}</button></div></div>`;
          }).join('');
          $('#bl-list', m).innerHTML = rows;
        };
        drawPrices(); drawList();
        $('#bl-order', m).addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; st.asc = b.dataset.v === 'asc'; $$('#bl-order button', m).forEach(x => x.classList.toggle('on', x === b)); drawList(); });
        $('#bl-add', m).addEventListener('click', () => { const last = st.prices[st.prices.length - 1]; st.prices.push({ from: tk, p: last ? last.p : s.price }); drawPrices(); drawList(); });
        $('#bl-prices', m).addEventListener('input', e => { const i = +e.target.dataset.i; if (isNaN(i)) return; const f = e.target.dataset.f; st.prices[i][f] = f === 'p' ? (e.target.value.trim() === '' ? '' : parseNum(e.target.value)) : e.target.value; drawList(); });
        $('#bl-prices', m).addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (!b) return; st.prices.splice(+b.dataset.del, 1); drawPrices(); drawList(); });
        $('#bl-list', m).addEventListener('click', e => {
          const tx = e.target.closest('[data-tx]'); if (tx) { closeModal(); setTimeout(() => actions['edit-tx'](tx), 220); return; }
          const ed = e.target.closest('[data-edit]'); if (ed) { st.edit = st.edit === ed.dataset.edit ? null : ed.dataset.edit; drawList(); return; }
          const box = e.target.closest('.bl-ed'); if (!box) return;
          const d = box.dataset.d, sg = e.target.closest('[data-k="t"] [data-v]');
          if (sg) { $$('[data-k="t"] button', box).forEach(x => x.classList.toggle('on', x === sg)); const inp = $('[data-k="amt"]', box); inp.disabled = sg.dataset.v !== 'custom'; if (inp.disabled) inp.value = '0'; return; }
          if (e.target.closest('[data-reset]')) { delete st.adj[d]; st.edit = null; drawList(); return; }
          if (e.target.closest('[data-ok]')) {
            const k = ($('[data-k="t"] .on', box) || {}).dataset.v || 'custom', amt = parseNum($('[data-k="amt"]', box).value), n = $('[data-k="n"]', box).value.trim();
            if (k === 'custom' && !(amt >= 0)) { toast(t('errAmount'), 'err'); return; }
            st.adj[d] = k === 'custom' ? { t: 'custom', amt: round8(amt), n } : { t: k, n };
            st.edit = null; drawList();
          }
        });
        $('#bl-save', m).addEventListener('click', () => {
          const pr = st.prices.filter(x => x.from || x.p !== '');
          if (pr.some(x => !/^\d{4}-\d{2}-\d{2}$/.test(x.from || '') || x.p === '' || isNaN(+x.p) || +x.p < 0)) { toast(t('subPriceBad'), 'err'); return; }
          const seen = {}; pr.forEach(x => { seen[x.from] = { from: x.from, p: round8(+x.p) }; });
          const prices = Object.values(seen).sort((a, b) => (a.from < b.from ? -1 : 1));
          const adj = {}; Object.keys(st.adj).forEach(k => { adj[k] = st.adj[k]; });
          const d = [];
          if (JSON.stringify(prices) !== JSON.stringify(s.prices || [])) d.push(['prices', s.prices || '', prices]);
          if (JSON.stringify(adj) !== JSON.stringify(s.adj || {})) d.push(['adj', Object.keys(s.adj || {}).length, Object.keys(adj).length]);
          s.prices = prices; s.adj = adj;
          s.price = round8(priceAt(s, tk));   // 列表里显示的“当前价格”跟着时间线走
          if (d.length) logOp('sub', s, 'bills', d);
          commit(); closeModal(); renderAll(); toast(t('saved'), 'ok');
        });
      }
    });
  }
  /** 账号 / 网站：点击图标后弹出显示，可复制、打开网站 */
  function openSubInfo(anchor, s, k) {
    if (popEl) { const same = popEl.dataset.for === s.id + k; closePopover(); if (same) return; }
    const v = s[k] || '';
    const pop = document.createElement('div');
    pop.className = 'popover info-pop'; pop.dataset.for = s.id + k;
    pop.innerHTML = `<div class="ip-h">${ic(k === 'account' ? 'user' : 'globe')}<b>${t(k === 'account' ? 'subAccount' : 'subSite')}</b><span>${esc(s.name)}</span></div>
      <div class="ip-v">${esc(v)}</div>
      <div class="ip-btns"><button class="btn btn-glass sm" data-ip="copy">${ic('copy')}${t('copy')}</button>${k === 'site' ? `<a class="btn btn-accent sm" href="${esc(v)}" target="_blank" rel="noopener noreferrer">${ic('ext')}${t('subOpenSite')}</a>` : ''}</div>`;
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect(), w = pop.offsetWidth;
    pop.style.left = Math.max(12, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 12)) + window.scrollX + 'px';
    pop.style.top = r.bottom + 8 + window.scrollY + 'px';
    pop.addEventListener('click', e => {
      if (!e.target.closest('[data-ip="copy"]')) { if (e.target.closest('a')) setTimeout(closePopover, 50); return; }
      const done = () => toast(t('copied'), 'ok');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(done, () => fallbackCopy(v) && done());
      else if (fallbackCopy(v)) done();
    });
    popEl = pop;
    popOutside = ev => { if (!pop.contains(ev.target) && !anchor.contains(ev.target)) closePopover(); };
    setTimeout(() => document.addEventListener('pointerdown', popOutside, true), 0);
  }
  function fallbackCopy(v) {
    const ta = document.createElement('textarea'); ta.value = v; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove(); return ok;
  }
  /* ---- 新增 / 编辑订阅 ---- */
  function subCatOptions(sel) {
    const list = subCats();
    return `<option value="" ${!sel ? 'selected' : ''}>${t('subCatNone')}</option>` + list.map(c => `<option value="${esc(c)}" ${sel === c ? 'selected' : ''}>${esc(subCatName(c))}</option>`).join('') + `<option value="__custom">${t('subCatCustom')}…</option><option value="__manage">${t('subCatManage')}…</option>`;
  }
  function openSubModal(id) {
    const ex = id ? findSub(id) : null;
    const st = ex ? JSON.parse(JSON.stringify(ex)) : { name: '', alias: '', account: '', site: '', cat: '', price: '', ccy: S().ccy, cycle: 'month', cycleN: 1, cycleU: 'month', start: todayKey(), trialDays: '', expire: '', payId: '', remind: 3, nextPrice: null, note: '', icon: '' };
    let expTouched = !!ex;
    const ccyOpts = c => txCcyList(c).map(x => `<option value="${x}" ${x === c ? 'selected' : ''}>${CCY_SHORT[x] || x}</option>`).join('') + `<option value="__other">${t('ccy_OTHER')}…</option>`;
    const body = `
      <div class="sub-form-top">
        <button type="button" class="sub-ic-pick" id="sf-icon" title="${t('subIconPick')}">${st.icon ? `<img src="${esc(st.icon)}" alt="">` : `<span>${ic('upload')}<small>${t('subIcon')}</small></span>`}</button>
        <div style="flex:1;min-width:0">
          <div class="field"><label>${t('subName')}</label><input class="input" id="sf-name" value="${esc(st.name)}" maxlength="40" placeholder="${t('subNamePh')}"></div>
          <div class="sub-ic-tools"><button type="button" class="link" id="sf-icon-btn">${t('subIconPick')}</button><button type="button" class="link dim" id="sf-icon-rm" style="${st.icon ? '' : 'display:none'}">${t('removeIcon')}</button><span class="dim">· ${t('subIconHint')}</span></div>
        </div>
      </div>
      <div class="field"><label>${t('subColAlias')} <span class="dim">· ${t('codeOpt')}</span></label><input class="input" id="sf-alias" value="${esc(st.alias || '')}" maxlength="40" placeholder="${t('subAliasPh')}"></div>
      <div class="row2">
        <div class="field"><label>${ic('user')}${t('subAccount')} <span class="dim">· ${t('codeOpt')}</span></label><input class="input" id="sf-account" value="${esc(st.account || '')}" maxlength="120" autocomplete="off" spellcheck="false" placeholder="${t('subAccountPh')}"></div>
        <div class="field"><label>${ic('globe')}${t('subSite')} <span class="dim">· ${t('codeOpt')}</span></label><input class="input" id="sf-site" value="${esc(st.site || '')}" maxlength="300" autocomplete="off" spellcheck="false" inputmode="url" placeholder="${t('subSitePh')}"></div>
      </div>
      <div class="row2">
        <div class="field"><label>${t('subColCat')} <span class="dim">· ${t('codeOpt')}</span></label><select class="input" id="sf-cat">${subCatOptions(st.cat)}</select>
          <input class="input" id="sf-cat-c" maxlength="20" placeholder="${t('subCatCustomPh')}" style="display:none;margin-top:8px">
          <div class="cat-mgr" id="sf-cat-mgr" style="display:none"></div></div>
        <div class="field"><label>${t('subPrice')}</label><div class="price-row"><input class="input num" id="sf-price" inputmode="decimal" value="${st.price !== '' ? esc(trim8(st.price)) : ''}" placeholder="0.00"><select class="input" id="sf-ccy">${ccyOpts(st.ccy)}</select></div>
          <input class="input" id="sf-ccy-o" maxlength="5" placeholder="${t('ccyOtherPh')}" style="display:none;margin-top:8px;text-transform:uppercase"><div class="hint" id="sf-ccy-h"></div></div>
      </div>
      <div class="field"><label>${t('subColCycle')}</label><div class="seg seg-full seg-wrap" id="sf-cycle">${SUB_CYCLES.map(c => `<button type="button" data-v="${c}" class="${st.cycle === c ? 'on' : ''}">${t('cyc_' + c)}</button>`).join('')}</div>
        <div class="cyc-custom" id="sf-cyc-c" style="${st.cycle === 'custom' ? '' : 'display:none'}">${t('cycEveryPre')}<input class="input num" id="sf-cn" inputmode="numeric" value="${esc(st.cycleN || 1)}"><select class="input" id="sf-cu">${['day', 'month', 'year'].map(u => `<option value="${u}" ${st.cycleU === u ? 'selected' : ''}>${t('unitD_' + u)}</option>`).join('')}</select></div></div>
      <div class="row2">
        <div class="field"><label id="sf-start-l">${t('subColStart')}</label><input class="input" type="date" id="sf-start" value="${esc(st.start || '')}"></div>
        <div class="field" id="sf-trial-f"><label>${t('subTrial')} <span class="dim">· ${t('codeOpt')}</span></label><div class="price-row"><input class="input num" id="sf-trial" inputmode="numeric" value="${st.trialDays ? esc(st.trialDays) : ''}" placeholder="0"><span class="unit-txt">${t('unitD_day')}</span></div></div>
      </div>
      <div class="field" id="sf-exp-f"><label>${t('subColExpire')}</label><div class="price-row">
        <input class="input" type="date" id="sf-expire" value="${esc(st.expire || '')}" ${st.expire || !ex ? '' : 'disabled'}>
        <label class="switch-inline"><input type="checkbox" id="sf-forever" ${ex && !ex.expire ? 'checked' : ''}><span>${t('subForever')}</span></label>
        <button type="button" class="btn btn-glass sm" id="sf-auto">${ic('refresh')}${t('subAutoExp')}</button></div>
        <div class="hint" id="sf-exp-hint"></div></div>
      <div class="row2">
        <div class="field"><label>${t('subColPay')} <span class="dim">· ${t('codeOpt')}</span></label><select class="input" id="sf-pay">${balOptions(st.payId || '', t('subPayNone'))}</select></div>
        <div class="field" id="sf-remind-f"><label>${t('subColRemind')}</label><div class="seg seg-full" id="sf-remind">${[0, 1, 3, 7].map(n => `<button type="button" data-v="${n}" class="${+st.remind === n ? 'on' : ''}">${n ? t('subRemindB', { n }) : t('subRemind0')}</button>`).join('')}</div></div>
      </div>
      <div class="field" style="margin-bottom:4px"><label>${t('noteOpt')}</label><input class="input" id="sf-note" maxlength="120" value="${esc(st.note || '')}" placeholder="${t('notePh')}"></div>
      <div class="sub-preview" id="sf-preview"></div>`;
    openModal({
      title: ex ? t('subEdit') : t('subAdd'),
      body,
      footer: `${ex ? `<span class="foot-meta">${t('createdAt')} ${fullTime(ex.createdAt)}</span>` : ''}<button class="btn btn-glass" data-modal-close>${t('cancel')}</button><button class="btn btn-accent" id="sf-save">${ic('check')}${t('save')}</button>`,
      onMount(m) {
        const read = () => ({
          cycle: st.cycle, cycleN: Math.max(1, parseInt($('#sf-cn', m).value, 10) || 1), cycleU: $('#sf-cu', m).value,
          start: $('#sf-start', m).value, trialDays: Math.max(0, parseInt($('#sf-trial', m).value, 10) || 0),
          price: parseNum($('#sf-price', m).value), ccy: $('#sf-ccy', m).value === '__other' ? $('#sf-ccy-o', m).value.trim().toUpperCase() : $('#sf-ccy', m).value
        });
        /** 自动到期日：从计费开始日按周期往后推，直到超过今天（一次性 = 无限期） */
        const autoExp = () => {
          const r = read(); if (!r.start) return '';
          if (r.cycle === 'once') return '';
          const d = billStart(r);
          return d > todayKey() ? d : nextBill(d, r, todayKey());
        };
        const preview = () => {
          const r = read(), forever = $('#sf-forever', m).checked, buy = r.cycle === 'once';
          // 买断：只填购买时间（没有试用期和过期时间）
          $('#sf-start-l', m).textContent = buy ? t('subBuyDate') : t('subColStart');
          $('#sf-trial-f', m).style.visibility = buy ? 'hidden' : '';
          $('#sf-exp-f', m).style.display = buy ? 'none' : '';
          $('#sf-remind-f', m).style.visibility = buy ? 'hidden' : '';
          const oc = $('#sf-ccy', m).value === '__other';
          $('#sf-ccy-o', m).style.display = oc ? '' : 'none';
          $('#sf-ccy-h', m).textContent = oc && r.ccy ? (validCcy(r.ccy) ? t('ccyRateOk', { c: r.ccy, v: fmtNum(rateOf(r.ccy), 0, 4) }) : t('errRate', { c: r.ccy })) : '';
          $('#sf-expire', m).disabled = forever;
          if (!expTouched && !forever) { const a = autoExp(); $('#sf-expire', m).value = a; if (!a) { $('#sf-forever', m).checked = true; $('#sf-expire', m).disabled = true; } }
          const fake = Object.assign({ id: '__p' }, r, { expire: buy || $('#sf-forever', m).checked ? '' : $('#sf-expire', m).value, trialDays: buy ? 0 : r.trialDays, priceHist: ex ? ex.priceHist : null, prices: ex ? ex.prices : null, adj: ex ? ex.adj : null });
          if (isNaN(fake.price)) fake.price = 0;
          if (!validCcy(fake.ccy)) fake.ccy = S().ccy;
          const pays = ex ? subPays(Object.assign({}, fake, { id: ex.id })) : subPays(fake);
          const tot = pays.reduce((a, p) => a + p.v, 0);
          $('#sf-exp-hint', m).textContent = r.trialDays > 0 && r.start ? t('subBillFrom', { d: billStart(r) }) : '';
          $('#sf-preview', m).innerHTML = r.start ? `<span>${ic('pie')}${t('subTotalPrev')}</span><b class="num">${money(tot)}</b><small>${t('subPayN', { n: pays.length })}${r.cycle !== 'once' && fake.price ? ` · ≈ ${money(conv(perMonth(fake), r.ccy))}/${t('cycS_month')}` : ''}</small>` : '';
        };
        $('#sf-cycle', m).addEventListener('click', e => {
          const b = e.target.closest('[data-v]'); if (!b) return;
          st.cycle = b.dataset.v; $$('#sf-cycle button', m).forEach(x => x.classList.toggle('on', x === b));
          $('#sf-cyc-c', m).style.display = st.cycle === 'custom' ? '' : 'none';
          if (st.cycle === 'once' && !expTouched) $('#sf-forever', m).checked = true;
          if (st.cycle !== 'once' && !expTouched) $('#sf-forever', m).checked = false;
          preview();
        });
        $('#sf-remind', m).addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; st.remind = +b.dataset.v; $$('#sf-remind button', m).forEach(x => x.classList.toggle('on', x === b)); });
        // 分类管理（全部分类都能改名 / 改颜色 / 排序 / 删除 / 新增）
        let catPrev = st.cat || '';
        const refreshCats = () => { const sel = $('#sf-cat', m); sel.innerHTML = subCatOptions(subCats().includes(catPrev) ? catPrev : ''); };
        const mgr = $('#sf-cat-mgr', m);
        mgr.innerHTML = `<div class="cm-h"><b>${t('subCatManage')}</b><button type="button" class="link" data-cm-close>${t('close')}</button></div><div class="cm-body"></div>`;
        bindMgr(mgr, SUB_CAT_SPEC, refreshCats);
        mgr.addEventListener('click', e => { if (e.target.closest('[data-cm-close]')) mgr.style.display = 'none'; });
        $('#sf-cat', m).addEventListener('change', e => {
          const v = e.target.value;
          if (v === '__manage') { e.target.value = catPrev; mgr._draw(); mgr.style.display = ''; return; }
          if (v !== '__custom') catPrev = v;
          const c = v === '__custom'; $('#sf-cat-c', m).style.display = c ? '' : 'none'; if (c) $('#sf-cat-c', m).focus();
        });
        ['#sf-price', '#sf-cn', '#sf-start', '#sf-trial'].forEach(q => $(q, m).addEventListener('input', preview));
        ['#sf-cu', '#sf-ccy'].forEach(q => $(q, m).addEventListener('change', preview));
        $('#sf-ccy-o', m).addEventListener('input', preview);
        $('#sf-ccy', m).addEventListener('change', e => { if (e.target.value === '__other') setTimeout(() => $('#sf-ccy-o', m).focus(), 20); });
        $('#sf-expire', m).addEventListener('input', () => { expTouched = true; preview(); });
        $('#sf-forever', m).addEventListener('change', () => { expTouched = true; preview(); });
        $('#sf-auto', m).addEventListener('click', () => { expTouched = false; $('#sf-forever', m).checked = false; preview(); });
        // 图标：任意图片 → 裁成正方形 96×96
        const pick = () => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = () => { const f = inp.files[0]; if (f) squareIcon(f, 96, url => { st.icon = url; $('#sf-icon', m).innerHTML = `<img src="${url}" alt="">`; $('#sf-icon-rm', m).style.display = ''; }); }; inp.click(); };
        $('#sf-icon', m).addEventListener('click', pick); $('#sf-icon-btn', m).addEventListener('click', pick);
        $('#sf-icon-rm', m).addEventListener('click', () => { st.icon = ''; $('#sf-icon', m).innerHTML = `<span>${ic('upload')}<small>${t('subIcon')}</small></span>`; $('#sf-icon-rm', m).style.display = 'none'; });
        preview();
        setTimeout(() => $('#sf-name', m).focus(), 60);
        $('#sf-save', m).addEventListener('click', () => {
          const r = read(), name = $('#sf-name', m).value.trim();
          if (!name) { toast(t('subErrName'), 'err'); $('#sf-name', m).focus(); return; }
          if (isNaN(r.price) || r.price < 0) { toast(t('errAmount'), 'err'); $('#sf-price', m).focus(); return; }
          if (!validCcy(r.ccy)) { toast(t('errRate', { c: r.ccy }), 'err'); return; }
          if (!r.start) { toast(t('errDate'), 'err'); return; }
          let cat = $('#sf-cat', m).value;
          if (cat === '__custom') { const nm = $('#sf-cat-c', m).value.trim(); if (!nm) { toast(t('subErrCat'), 'err'); $('#sf-cat-c', m).focus(); return; } cat = findOrAddCat(nm); }
          if (cat === '__manage') cat = catPrev;
          const buy = r.cycle === 'once', forever = buy || $('#sf-forever', m).checked, expire = forever ? '' : $('#sf-expire', m).value;
          if (expire && expire < r.start) { toast(t('subErrExpire'), 'err'); $('#sf-expire', m).focus(); return; }
          if (buy) { r.trialDays = 0; st.remind = 0; }   // 买断：没有试用期、过期时间和提醒
          let site = $('#sf-site', m).value.trim();
          if (site && !/^[a-z][a-z0-9+.-]*:\/\//i.test(site)) site = 'https://' + site;   // 没写 http(s):// 自动补上
          const rec = { name, alias: $('#sf-alias', m).value.trim(), account: $('#sf-account', m).value.trim(), site, cat, price: round8(r.price), ccy: r.ccy, cycle: r.cycle, cycleN: r.cycle === 'custom' ? r.cycleN : 1, cycleU: r.cycle === 'custom' ? r.cycleU : 'month',
            start: r.start, trialDays: r.trialDays, expire, payId: $('#sf-pay', m).value || '', remind: +st.remind || 0, note: $('#sf-note', m).value.trim(), icon: st.icon || '' };
          if (ex) {
            if (ex.price !== rec.price) {
              if (ex.prices && ex.prices.length) {
                // 有价格时间线：只改“当前这一段”的价格，之前的价格段不变
                const arr = ex.prices.map(x => Object.assign({}, x)), tk = todayKey();
                let i = -1; arr.forEach((x, j) => { if (x.from <= tk) i = j; });
                arr[i < 0 ? 0 : i].p = rec.price; rec.prices = arr;
              } else rec.priceHist = [];   // 手动改价格视为更正：之前的推算账单也按新价格
            }
            const d = diffOf(ex, rec, SUB_FIELDS);
            Object.assign(ex, rec);
            const unA = ex.archived && subState(ex) !== 'expired';
            if (d.length) logOp('sub', ex, 'edit', d.map(x => (x[0] === 'icon' ? ['icon', x[1] ? 1 : '', x[2] ? 1 : ''] : x)));
            if (unA) { delete ex.archived; logOp('sub', ex, 'unarchive'); setTimeout(() => toast(t('subAutoUnarch'), 'ok'), 1200); }   // 到期日改到以后：自动取消归档
          } else {
            const s = Object.assign({ id: uid(), createdAt: Date.now(), nextPrice: null, locked: false }, rec);
            DB.subs.push(s);
            logOp('sub', s, 'create', SUB_FIELDS.filter(k => !['locked', 'nextPrice'].includes(k) && s[k] !== '' && s[k] != null && !(k === 'trialDays' && !s[k])).map(k => [k, '', k === 'icon' ? 1 : s[k]]));
          }
          commit(); closeModal(); renderAll();
          toast(ex ? t('saved') : t('subAdded', { n: name }), 'ok');
        });
      }
    });
  }
  /** 图片裁成正方形并缩放到 N×N（订阅图标统一大小） */
  function squareIcon(file, N, cb) {
    const rd = new FileReader();
    rd.onload = () => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = c.height = N;
        const g = c.getContext('2d'), s = Math.min(img.width, img.height) || N;
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, N, N);
        cb(c.toDataURL('image/png'));
      };
      img.onerror = () => toast(t('importBad'), 'err');
      img.src = rd.result;
    };
    rd.readAsDataURL(file);
  }
  /** 涨价：设置下一期账单金额（记一笔续费时自动带出这个金额） */
  function openSubPrice(s) {
    openModal({
      title: `${t('subPriceUp')} · ${esc(s.name)}`,
      body: `<div class="sub-price-cur">${subIconHTML(s, 'lg')}<div><div class="dim">${t('subPriceNow')}</div><b class="num">${money(+s.price || 0, { ccy: s.ccy, max: 2 })}<span class="per">/${cycleShort(s)}</span></b></div></div>
        <div class="field"><label>${t('subNextPrice')} (${esc(s.ccy)})</label><input class="input num" id="sp-next" inputmode="decimal" value="${s.nextPrice != null && s.nextPrice !== '' ? esc(trim8(s.nextPrice)) : ''}" placeholder="${esc(trim8(s.price || 0))}"></div>
        <div class="hint" id="sp-hint"></div>
        <p class="hint" style="margin-top:10px">${t('subPriceUpHint')}</p>`,
      footer: `${s.nextPrice != null && s.nextPrice !== '' ? `<button class="btn btn-danger" id="sp-clear">${t('subPriceClear')}</button>` : ''}<button class="btn btn-glass" data-modal-close>${t('cancel')}</button><button class="btn btn-accent" id="sp-save">${ic('check')}${t('save')}</button>`,
      onMount(m) {
        const hint = () => { const v = parseNum($('#sp-next', m).value); const d = v - (+s.price || 0); $('#sp-hint', m).innerHTML = v > 0 && Math.abs(d) > 1e-9 ? `<span class="${d > 0 ? 'down' : 'up'}">${d > 0 ? '+' : ''}${money(d, { ccy: s.ccy, max: 2, raw: true })} (${pct((+s.price ? d / +s.price : 0) * 100)})</span>` : ''; };
        $('#sp-next', m).addEventListener('input', hint); hint();
        setTimeout(() => $('#sp-next', m).focus(), 60);
        const done = v => { const old = s.nextPrice == null ? '' : s.nextPrice; s.nextPrice = v; logOp('sub', s, 'priceUp', [['nextPrice', old, v == null ? '' : v]]); commit(); closeModal(); renderAll(); toast(t('saved'), 'ok'); };
        $('#sp-save', m).addEventListener('click', () => { const v = parseNum($('#sp-next', m).value); if (!(v >= 0)) { toast(t('errAmount'), 'err'); return; } done(round8(v)); });
        const c = $('#sp-clear', m); if (c) c.addEventListener('click', () => done(null));
      }
    });
  }
  async function deleteSub(s) {
    if (!(await confirmDialog({ title: t('subDelT'), msg: t('subDelM', { n: esc(s.name) }), ok: t('del') }))) return;
    if (!(await requireUnlock(s.locked ? t('verifyLockedMsg') : null, s.locked))) return;
    logOp('sub', s, 'delete', null, { value: subTotal(s), ccy: S().ccy });
    DB.subs = DB.subs.filter(x => x !== s);
    UI.sub.sel.delete(s.id);
    commit(); renderAll(); toast(t('deleted'), 'ok');
  }

  /* ---- 记一笔：支出关联订阅（续期 / 新建） ---- */
  function subOptions(sel) {
    const groups = {};
    DB.subs.forEach(s => { const g = s.archived ? '\u0000arch' : s.cat || ''; (groups[g] = groups[g] || []).push(s); });
    return `<option value="">${t('subLinkNone')}</option><option value="__new" ${sel === '__new' ? 'selected' : ''}>${t('subLinkNew')}</option>` +
      Object.keys(groups).sort((a, b) => (a === '\u0000arch' ? 1 : b === '\u0000arch' ? -1 : !a ? 1 : !b ? -1 : 0)).map(c => `<optgroup label="${esc(c === '\u0000arch' ? t('subArchived') : subCatName(c))}">${groups[c].map(s =>
        `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)} · ${esc(money(+(s.nextPrice != null && s.nextPrice !== '' ? s.nextPrice : s.price) || 0, { ccy: s.ccy, max: 2, raw: true }))}/${esc(cycleShort(s))}${s.expire ? ' · ' + s.expire : ''}</option>`).join('')}</optgroup>`).join('');
  }
  /** 续期到哪天：没到期就从原到期日往后顺延，已过期 / 新订阅从付款日起算 */
  function renewTo(s, cur, date, renew, custom) {
    if (renew === 'forever') return '';
    if (renew === 'custom') return custom || '';
    const base = cur && cur > date ? cur : date;
    if (renew === 'm1') return addDate(base, 1, 'month');
    if (renew === 'y1') return addDate(base, 1, 'year');
    return addCycle(base, s) || '';   // 按订阅周期；一次性 = 无限期
  }
  function subApply(tx, sel) {
    if (!sel || !sel.id || tx.type !== 'expense') return null;
    let s = sel.id === '__new' ? null : findSub(sel.id);
    if (sel.id === '__new') {
      s = { id: uid(), createdAt: Date.now(), name: sel.name, cat: sel.cat || '', price: round8(+tx.amount || 0), ccy: tx.ccy, cycle: sel.cycle || 'month', cycleN: 1, cycleU: 'month',
        start: tx.date, trialDays: 0, expire: '', payId: tx.accountId || '', remind: 3, nextPrice: null, note: '', locked: false, icon: '' };
      DB.subs.push(s);
      logOp('sub', s, 'create', ['name', 'cat', 'price', 'ccy', 'cycle', 'start', 'payId'].filter(k => s[k] !== '' && s[k] != null).map(k => [k, '', s[k]]), { tx: recTitle('tx', tx) });
      tx.subMade = true;
    }
    if (!s) return null;
    const prev = { expire: s.expire || '', price: s.price, nextPrice: s.nextPrice == null ? null : s.nextPrice, archived: s.archived || '' };
    const ne = renewTo(s, sel.id === '__new' ? '' : s.expire, tx.date, sel.renew, sel.date);
    Object.assign(tx, { subId: s.id, subPrev: prev, subNew: ne, subRenew: sel.renew });
    if (sel.renew === 'custom') tx.subDate = sel.date; else delete tx.subDate;
    s.expire = ne;
    const d = [['expire', prev.expire, ne]];
    if (s.nextPrice != null && s.nextPrice !== '') {
      // 涨价生效：从这次续费起按新价格，之前的推算账单仍按旧价
      s.priceHist = (s.priceHist || []).concat([{ from: tx.date, p: +s.nextPrice, old: prev.price, tx: tx.id }]);
      s.price = +s.nextPrice; s.nextPrice = null; d.push(['price', prev.price, s.price]);
    }
    logOp('sub', s, 'renew', d, { tx: recTitle('tx', tx) });
    if (s.archived && subState(s) !== 'expired') { delete s.archived; logOp('sub', s, 'unarchive'); }   // 续费后自动取消归档
    return s;
  }
  function subRevert(x) {
    if (!x || !x.subId) return;
    const s = findSub(x.subId); if (!s) return;
    if ((s.expire || '') !== (x.subNew || '') || !x.subPrev) return;   // 之后又续过 / 手动改过到期日：不动
    s.expire = x.subPrev.expire || '';
    if (x.subPrev.price != null) s.price = x.subPrev.price;
    s.nextPrice = x.subPrev.nextPrice == null ? null : x.subPrev.nextPrice;
    if (x.subPrev.archived && subState(s) === 'expired') s.archived = x.subPrev.archived;
    if (s.priceHist) s.priceHist = s.priceHist.filter(h => h.tx !== x.id);
    logOp('sub', s, 'unrenew', [['expire', x.subNew || '', s.expire]], { tx: recTitle('tx', x) });
  }

  /* ---- 到期提醒：打开 AssetHub 时右下角弹出 ---- */
  function checkSubReminders() {
    const box = $('#sub-remind') || (() => { const d = document.createElement('div'); d.id = 'sub-remind'; d.className = 'sub-remind'; document.body.appendChild(d); return d; })();
    const tk = todayKey(), seen = S().subSeen || {};
    const due = (DB.subs || []).filter(s => !s.archived && +s.remind > 0 && s.expire && daysTo(s.expire) >= 0 && daysTo(s.expire) <= +s.remind && seen[s.id] !== tk + '|' + s.expire)
      .sort((a, b) => (a.expire < b.expire ? -1 : 1));
    box.innerHTML = due.map(s => {
      const d = daysTo(s.expire), amt = +(s.nextPrice != null && s.nextPrice !== '' ? s.nextPrice : s.price) || 0;
      return `<div class="sr-card glass" data-id="${s.id}">${subIconHTML(s)}
        <div class="sr-txt"><b>${esc(s.name)}</b><span>${d === 0 ? t('subDueToday') : t('subDueIn', { n: d })} · ${s.expire}</span><small class="num">${t('subRenewAmt')} ${money(amt, { ccy: s.ccy, max: 2 })}</small></div>
        <div class="sr-btns"><button class="btn btn-accent sm" data-action="sub-renew" data-id="${s.id}">${t('subRenew')}</button><button class="icon-btn sm" data-action="sub-remind-x" data-id="${s.id}" title="${t('subRemindX')}">${ic('x')}</button></div></div>`;
    }).join('');
    box.classList.toggle('on', !!due.length);
  }

  /* ================= 页面四：数据设置 ================= */
  function auditCardHTML() {
    const kindF = UI.logKind || 'all', n = UI.logN || 50;
    const all = (DB.audit || []).filter(e => kindF === 'all' || e.kind === kindF).slice().reverse();
    return `<div class="card glass">
      <div class="card-head"><div class="card-title"><span class="ico">${ic('clock')}</span>${t('auditT')}</div>
        <div class="seg">${['all', 'asset', 'tx', 'sub', 'system'].map(k => `<button class="${kindF === k ? 'on' : ''}" data-action="log-filter" data-v="${k}">${k === 'all' ? t('all') : t('kind_' + k)}</button>`).join('')}</div></div>
      <p class="set-desc">${t('auditSub')}</p>
      ${all.length ? `<div class="lg-list audit">${all.slice(0, n).map(e => logEntryHTML(e, null, true)).join('')}</div>
        ${all.length > n ? `<button class="btn btn-glass sm" data-action="log-more" style="margin-top:12px">${t('loadMore')} (${all.length - n})</button>` : ''}` : `<div class="empty sm"><p>${t('noLog')}</p></div>`}
    </div>`;
  }
  /* ---- PWA：安装到桌面 / 主屏幕 ---- */
  const PWA = { prompt: null };
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function pwaCardHTML() {
    let body;
    if (isStandalone()) body = `<div class="pwa-state ok">${ic('check')}${t('pwaInstalled')}</div>`;
    else if (PWA.prompt) body = `<button class="btn btn-accent" data-action="pwa-install">${ic('download')}${t('pwaInstallBtn')}</button>`;
    else if (isIOS()) body = `<div class="pwa-tip">${t('pwaIOS')}</div>`;
    else body = `<div class="pwa-tip">${t('pwaManual')}</div>`;
    return `<div class="card glass">
          <div class="card-head"><div class="card-title"><span class="ico">${ic('phone')}</span>${t('pwaT')}</div></div>
          <p class="set-desc">${t('pwaSub')}</p>${body}</div>`;
  }

  function dfixNoteHTML() {
    let b; try { b = JSON.parse(localStorage.getItem('assethub.dfix.bak') || 'null'); } catch (e) { b = null; }
    if (!b || !b.d) return '';
    const n = Object.keys(b.d).length, restored = S().dfix === 'restored';
    return `<div class="dfix-note">${ic('cal')}<span>${restored ? t('dfixRestored', { n }) : t('dfixNote', { n, d: fullTime(b.at) })}</span>${restored ? '' : `<button class="btn btn-glass sm" data-action="dfix-restore">${t('dfixRestore')}</button>`}</div>`;
  }
  function renderSettings() {
    const s = S();
    const size = (new Blob([JSON.stringify(DB)]).size / 1024).toFixed(1);
    const stockSrc = Api.STOCK_SOURCES[s.stockSrc] || Api.STOCK_SOURCES.finnhub;
    const r = DB.rates.rates;
    const pnlOpts = Object.keys(PNL_STYLES).map(k => {
      const p = pnlPair(k), up = s.pnlSwap ? p.down : p.up, dn = s.pnlSwap ? p.up : p.down;
      return `<button class="pnl-opt ${s.pnlStyle === k ? 'on' : ''}" data-action="pnl-style" data-v="${k}">
        <div class="sw"><i style="background:${up}"></i><i style="background:${dn}"></i></div>
        <div class="nm">${t('pnl_' + k)}</div><div class="ex num"><span style="color:${up}">+8.52%</span> <span style="color:${dn}">-3.10%</span></div></button>`;
    }).join('');
    const unlocked = Date.now() < UI.unlockUntil;
    $('#page').innerHTML = `
    <div class="grid g-set">
      <div class="set-col">
        <div class="card glass">
          <div class="card-head"><div class="card-title"><span class="ico">${ic('db')}</span>${t('setDataT')}</div></div>
          <p class="set-desc">${t('setDataSub')}</p>
          <div class="field"><label>${t('bookName')}</label><input class="input" data-meta="name" value="${esc(DB.meta.name)}" placeholder="${t('bookNamePh')}" maxlength="60"></div>
          <div class="stat-row"><span>${t('nAssets', { n: DB.assets.length })}</span><span>${t('statTx', { n: DB.txs.length })}</span><span>${t('statSnap', { n: Object.keys(DB.snaps).length })}</span><span>${t('statSize', { n: size })}</span></div>
          <div class="btn-row">
            <button class="btn btn-accent" data-action="export">${ic('download')}${t('export')}</button>
            <button class="btn btn-glass" data-action="import">${ic('upload')}${t('import')}</button>
            <button class="btn btn-soft" data-action="demo">${ic('sparkle')}${t('loadDemo')}</button>
            <button class="btn btn-glass" data-action="new-book">${ic('plus')}${t('newBook')}</button>
            <button class="btn btn-glass" data-action="trim-snaps">${ic('linechart')}${t('trimT')}</button>
            <button class="btn btn-glass" data-action="recover">${ic('clock')}${t('recoverT')}</button>
            <button class="btn btn-danger" data-action="clear">${ic('trash')}${t('clearAll')}</button>
          </div>
          ${dfixNoteHTML()}
        </div>
        <div class="card glass">
          <div class="card-head"><div class="card-title"><span class="ico">${ic('shield')}</span>${t('setSecT')}</div>
            <span class="src ${s.passHash ? 'online' : ''}"><i></i>${s.passHash ? t('passSet') : t('passNotSet')}</span></div>
          <p class="set-desc">${t('setSecSub')}</p>
          <div class="row2">
            <div class="field"><label>${t('lockMinutes')}</label><select class="input" data-set="lockMinutes">${[0, 1, 5, 15, 30].map(n => `<option value="${n}" ${+s.lockMinutes === n ? 'selected' : ''}>${n ? t('everyMinLock', { n }) : t('alwaysVerify')}</option>`).join('')}</select></div>
            <div class="field"><label>${t('lockState')}</label><div class="fx-box" style="padding:11px 14px">${unlocked ? `${ic('unlock')} ${t('unlockedUntil', { t: timeStr(UI.unlockUntil) })}` : `${ic('lock')} ${t('lockedState')}`}</div></div>
          </div>
          <div class="btn-row">
            <button class="btn btn-accent" data-action="set-pass">${ic('shield')}${s.passHash ? t('changePass') : t('setPass')}</button>
            <button class="btn btn-glass" data-action="lock-now" ${unlocked ? '' : 'disabled'}>${ic('lock')}${t('lockNow')}</button>
          </div>
        </div>
        ${auditCardHTML()}
        <div class="card glass">
          <div class="card-head"><div class="card-title"><span class="ico">${ic('cloud')}</span>${t('setSyncT')}</div></div>
          <p class="set-desc">${t('setSyncSub')}</p>
          <div class="field"><label>${t('gistToken')}</label><input class="input" type="password" data-set="gistToken" value="${esc(s.gistToken)}" placeholder="ghp_xxx / github_pat_xxx" autocomplete="new-password" data-lpignore="true">
            <div class="hint">${t('gistTokenHint')} <a href="https://github.com/settings/tokens/new?scopes=gist&description=AssetHub" target="_blank" rel="noopener">${t('createToken')} ↗</a></div></div>
          <div class="field"><label class="lbl-eye">${t('gistId')}<button type="button" class="eye-btn" data-action="toggle-gistid" title="${t('showHide')}">${ic(UI.showGistId ? 'eyeoff' : 'eye')}</button></label><input class="input" type="${UI.showGistId ? 'text' : 'password'}" data-set="gistId" value="${esc(s.gistId)}" placeholder="${t('gistIdPh')}" autocomplete="new-password" data-lpignore="true" spellcheck="false"></div>
          <label class="switch-row"><span>${t('autoSync')}<small>${t('autoSyncSub')}</small></span>
            <span class="switch"><input type="checkbox" data-set="autoSync" ${s.autoSync ? 'checked' : ''}><i></i></span></label>
          <div class="btn-row">
            <button class="btn btn-accent" data-action="sync-now">${ic('cloud')}${t('syncNowBtn')}</button>
            <button class="btn btn-glass" data-action="gist-push">${ic('upload')}${t('gistPush')}</button>
            <button class="btn btn-glass" data-action="gist-pull">${ic('download')}${t('gistPull')}</button>
            <button class="btn btn-glass" data-action="gist-new">${ic('plus')}${t('gistNew')}</button>
          </div>
          <div class="hint" style="margin-top:10px">${ic('lock')} ${S().syncKey ? t('encOn') : t('encOff')}</div>
          ${SYNC.state === 'err' && SYNC.lastErr ? `<div class="hint down" style="margin-top:10px">${t('syncFail')} · ${esc(syncErrNow())}</div>` : ''}
          <div class="hint" style="margin-top:12px">${t('lastSync')}: ${s.gistLast ? new Date(s.gistLast).toLocaleString(locale(), { hour12: false }) : t('never')}</div>
        </div>
      </div>
      <div class="set-col">
        <div class="card glass">
          <div class="card-head"><div class="card-title"><span class="ico">${ic('bolt')}</span>${t('setQuoteT')}</div></div>
          <p class="set-desc">${t('setQuoteSub')}</p>
          <div class="field"><label>${t('cryptoSrc')}</label><select class="input" data-set="cryptoSrc">${Object.keys(Api.CRYPTO_SOURCES).map(k => `<option value="${k}" ${s.cryptoSrc === k ? 'selected' : ''}>${Api.CRYPTO_SOURCES[k].name}</option>`).join('')}</select>
            <div class="hint">${t('cryptoSrcHint')}</div></div>
          <div class="field"><label>${t('goldSrc')}</label><select class="input" data-set="goldSrc">${Object.keys(Api.GOLD_SOURCES).map(k => `<option value="${k}" ${(s.goldSrc || 'goldapi') === k ? 'selected' : ''}>${t('goldSrc_' + k)}</option>`).join('')}</select>
            <div class="hint">${t('goldSrcHint')}</div></div>
          <div class="row2">
            <div class="field"><label>${t('stockSrc')}</label><select class="input" data-set="stockSrc">${Object.keys(Api.STOCK_SOURCES).map(k => `<option value="${k}" ${s.stockSrc === k ? 'selected' : ''}>${Api.STOCK_SOURCES[k].name}</option>`).join('')}</select></div>
            <div class="field"><label>${stockSrc.name} API Key</label><input class="input" type="password" data-set="${stockSrc.keyField}" value="${esc(s[stockSrc.keyField])}" placeholder="${t('apiKeyPh')}" autocomplete="off"></div>
          </div>
          <div class="hint" style="margin:-6px 0 14px">${t('stockSrcHint')} <a href="${stockSrc.signup}" target="_blank" rel="noopener">${t('getKey')} ${stockSrc.name} ↗</a></div>
          <div class="row2">
            <div class="field"><label>${t('fxSrc')}</label><select class="input" data-set="fxSrc">${Object.keys(Api.FX_SOURCES).map(k => `<option value="${k}" ${s.fxSrc === k ? 'selected' : ''}>${Api.FX_SOURCES[k].name}</option>`).join('')}</select></div>
            <div class="field"><label>${t('autoRefresh')}</label><select class="input" data-set="autoRefresh">${[0, 1, 5, 15, 30, 60].map(n => `<option value="${n}" ${+s.autoRefresh === n ? 'selected' : ''}>${n ? t('everyMin', { n }) : t('off')}</option>`).join('')}</select></div>
          </div>
          <div class="fx-box num">${t('fxNow')}: <b>1 USD</b> = <b>${fmtNum(r.CNY, 4, 4)}</b> CNY · <b>${fmtNum(r.HKD, 4, 4)}</b> HKD · <b>${fmtNum(r.TWD, 3, 3)}</b> NTD<br>
            <span class="dim">${t('updatedAt')}: ${DB.rates.ts ? new Date(DB.rates.ts).toLocaleString(locale(), { hour12: false }) : t('fxDefault')}${DB.rates.src && Api.FX_SOURCES[DB.rates.src] ? ' · ' + Api.FX_SOURCES[DB.rates.src].name : ''}</span></div>
          <div class="btn-row" style="margin-top:14px">
            <button class="btn btn-glass sm" data-action="update-fx">${ic('refresh')}${t('updateFx')}</button>
            <button class="btn btn-glass sm" data-action="test-api">${ic('bolt')}${t('testApi')}</button>
          </div>
          <div class="test-out" id="test-out"></div>
        </div>
        <div class="card glass">
          <div class="card-head"><div class="card-title"><span class="ico">${ic('palette')}</span>${t('setLookT')}</div></div>
          <div class="row2">
            <div class="field"><label>${t('language')}</label><div class="seg seg-full">${['zh', 'en'].map(l => `<button class="${s.lang === l ? 'on' : ''}" data-action="lang" data-v="${l}">${l === 'zh' ? 'CN 中文' : 'EN English'}</button>`).join('')}</div></div>
            <div class="field"><label>${t('layout')}</label><div class="seg seg-full">
              <button class="${!isMobile() ? 'on' : ''}" data-action="layout" data-v="desktop" title="${t('layoutDesktop')}">${ic('monitor')}</button>
              <button class="${isMobile() ? 'on' : ''}" data-action="layout" data-v="mobile" title="${t('layoutMobile')}">${ic('phone')}</button></div></div>
          </div>
          <div class="field"><label>${t('pnlStyle')}</label><div class="pnl-opts">${pnlOpts}</div>
            <div class="pnl-custom ${s.pnlStyle === 'custom' ? '' : 'dim-off'}"><span>${t('pnlCustom')}</span>
              <label>${t('pnlUpC')}<input type="color" data-change="pnlUp" value="${esc(s.pnlUp || '#30D158')}"></label>
              <label>${t('pnlDownC')}<input type="color" data-change="pnlDown" value="${esc(s.pnlDown || '#FF453A')}"></label></div></div>
          <div class="field"><label>${t('pnlDir')}</label><div class="seg seg-full">
            <button class="${!s.pnlSwap ? 'on' : ''}" data-action="pnl-swap" data-v="0">${t('dirGreenUp')}</button>
            <button class="${s.pnlSwap ? 'on' : ''}" data-action="pnl-swap" data-v="1">${t('dirRedUp')}</button></div></div>
          <div class="divider"></div>
          <div class="field"><label>${t('logoStyle')}</label><div class="logo-opts">${LOGO_STYLES.map(k => `<button class="logo-opt ${logoKey() === k ? 'on' : ''}" data-action="logo-style" data-v="${k}" title="${t('logo_' + k)}">
              <span class="lo-img"><img src="${logoOf(k)}" alt=""></span><span class="lo-nm">${t('logo_' + k)}${k === 'C' ? `<em>${t('logoDefault')}</em>` : ''}</span></button>`).join('')}</div>
            <div class="hint">${DB.meta.icon ? t('logoCustomOn') : t('logoStyleHint')}</div></div>
          <div class="field"><label>${t('customIcon')}</label><div class="icon-row">
            <div class="brand-icon icon-preview ${DB.meta.icon ? 'custom' : 'bull'}"><img src="${esc(logoSrc())}" alt=""></div>
            <button class="btn btn-glass sm" data-action="pick-icon">${ic('upload')}${t('uploadIcon')}</button>
            ${DB.meta.icon ? `<button class="btn btn-danger sm" data-action="remove-icon">${t('removeIcon')}</button>` : ''}
          </div></div>
          <div class="field" style="margin-bottom:0"><label>${t('subtitle')}</label><input class="input" data-meta="subtitle" value="${esc(DB.meta.subtitle)}" placeholder="${t('subtitlePh')}" maxlength="80"></div>
        </div>
        ${pwaCardHTML()}
      </div>
    </div>`;
  }

  /* ============ 5. 弹窗 ============ */
  let modalTimer = null;
  function openModal(o) {
    clearTimeout(modalTimer);
    const root = $('#modal-root');
    root.classList.remove('closing');
    root.innerHTML = `<div class="modal-backdrop" data-modal-close></div>
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-head"><h3>${o.title}</h3><button class="icon-btn sm" data-modal-close aria-label="close">${ic('x')}</button></div>
        <div class="modal-body">${o.body}</div>
        ${o.footer ? `<div class="modal-foot">${o.footer}</div>` : ''}
      </div>`;
    root.classList.add('open');
    document.body.classList.add('noscroll');
    if (o.onMount) o.onMount($('.modal', root));
  }
  function closeModal() {
    const root = $('#modal-root');
    if (!root.classList.contains('open')) return;
    root.classList.add('closing');
    modalTimer = setTimeout(() => { root.classList.remove('open', 'closing'); root.innerHTML = ''; document.body.classList.remove('noscroll'); }, 190);
  }
  function confirmDialog(o) {
    return new Promise(res => {
      const root = $('#dialog-root');
      root.innerHTML = `<div class="modal-backdrop" ${o.noBackdrop ? '' : 'data-r="0"'}></div><div class="alert"><h4>${o.title}</h4><p>${o.msg || ''}</p>
        <div class="alert-btns"><button data-r="0">${o.cancel || t('cancel')}</button><button data-r="1" class="${o.danger === false ? 'ok' : 'danger'}">${o.ok || t('confirm')}</button></div></div>`;
      root.classList.add('open');
      root.onclick = e => {
        const b = e.target.closest('[data-r]');
        if (!b) return;
        root.classList.remove('open'); root.innerHTML = ''; root.onclick = null;
        res(b.dataset.r === '1');
      };
    });
  }
  /** 密码输入框；fields: ['old','new','confirm'] 的子集，返回 {old,new,confirm} 或 null */
  function passDialog(title, msg, fields) {
    return new Promise(res => {
      const root = $('#dialog-root');
      const lab = { old: t('passOld'), new: t('passNew'), confirm: t('passConfirm'), cur: t('passInput') };
      root.innerHTML = `<div class="modal-backdrop"></div><form class="alert pass" autocomplete="off"><h4>${ic('lock')} ${title}</h4><p>${msg || ''}</p>
        <div class="pass-fields">${fields.map((f, i) => `<input class="input" type="password" name="${f}" placeholder="${lab[f]}" ${i === 0 ? 'autofocus' : ''} maxlength="64">`).join('')}</div>
        <div class="alert-btns"><button type="button" data-r="0">${t('cancel')}</button><button type="submit" class="ok">${t('confirm')}</button></div></form>`;
      root.classList.add('open');
      const form = $('form', root);
      setTimeout(() => { const f = $('input', form); if (f) f.focus(); }, 50);
      const done = v => { root.classList.remove('open'); root.innerHTML = ''; res(v); };
      form.addEventListener('submit', e => { e.preventDefault(); const out = {}; fields.forEach(f => { out[f] = form.elements[f].value; }); done(out); });
      $('[data-r="0"]', form).addEventListener('click', () => done(null));
    });
  }
  /** 单输入框弹窗（用于“更新市值”），返回输入字符串或 null */
  function promptDialog(o) {
    return new Promise(res => {
      const root = $('#dialog-root');
      root.innerHTML = `<div class="modal-backdrop"></div><form class="alert pass" autocomplete="off"><h4>${o.icon ? ic(o.icon) : ''} ${o.title}</h4><p>${o.msg || ''}</p>
        <div class="pass-fields"><input class="input num" name="v" inputmode="decimal" value="${esc(o.value || '')}" placeholder="${esc(o.placeholder || '')}">${o.hint ? `<div class="hint">${o.hint}</div>` : ''}${o.date ? `<label class="pd-date"><span>${t('updDate')}</span><input class="input" type="date" name="d" value="${esc(o.date)}" max="${esc(o.date)}" min="${esc(o.dateMin || '')}"></label><div class="hint" id="pd-date-hint"></div>` : ''}</div>
        <div class="alert-btns"><button type="button" data-r="0">${t('cancel')}</button><button type="submit" class="ok">${t('save')}</button></div></form>`;
      root.classList.add('open');
      const form = $('form', root), inp = form.elements.v;
      setTimeout(() => { inp.focus(); inp.select(); }, 50);
      const done = v => { root.classList.remove('open'); root.innerHTML = ''; res(v); };
      if (o.date) {
        const di = form.elements.d, dh = $('#pd-date-hint', form);
        const upd = () => { dh.textContent = di.value && di.value < o.date ? t('updDateHint', { d: di.value }) : ''; };
        di.addEventListener('input', upd); upd();
      }
      form.addEventListener('submit', e => { e.preventDefault(); done(o.date ? { v: inp.value, d: form.elements.d.value || o.date } : inp.value); });
      $('[data-r="0"]', form).addEventListener('click', () => done(null));
    });
  }
  async function hashPass(p) {
    const data = new TextEncoder().encode('AssetHub::' + p);
    try {
      const buf = await crypto.subtle.digest('SHA-256', data);
      return 'sha256:' + Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      let h = 2166136261; data.forEach(b => { h ^= b; h = Math.imul(h, 16777619); });
      return 'fnv:' + (h >>> 0).toString(16);
    }
  }
  /** 自检：本机的同步密钥必须由当前锁定密码生成；不一致时（旧版本 / 多个窗口互相覆盖等）用当前密码重新生成，旧密钥留着读取云端旧数据 */
  async function healSyncKey(pw) {
    try {
      if (!S().syncKey || !S().syncSalt) return;
      const k = await deriveKeyRaw(pw, S().syncSalt, S().syncIter || ENC_ITER);
      if (k === S().syncKey) return;
      S().syncKeyPrev = [S().syncKey].concat(S().syncKeyPrev || []).filter((x, i, a) => a.indexOf(x) === i).slice(0, 5);
      await setSyncKey(pw); SYNC.reenc = true; save();
    } catch (e) { /* 浏览器不支持加密时忽略 */ }
  }
  async function setPasswordFlow(msg) {
    const hasOld = !!S().passHash;
    const r = await passDialog(hasOld ? t('changePass') : t('setPass'), hasOld ? t('changePassMsg') : (msg || t('setPassMsg')), hasOld ? ['old', 'new', 'confirm'] : ['new', 'confirm']);
    if (!r) return false;
    if (hasOld && (await hashPass(r.old)) !== S().passHash) { toast(t('passWrong'), 'err'); return false; }
    if (!r.new || r.new.length < 4) { toast(t('passShort'), 'err'); return false; }
    if (r.new !== r.confirm) { toast(t('passMismatch'), 'err'); return false; }
    const oldKey = S().syncKey;
    try { await setSyncKey(r.new); } catch (e) { /* 浏览器不支持加密时仅设置锁定密码 */ }   // 先生成新密钥，再改密码，两者始终一致
    if (oldKey && oldKey !== S().syncKey) S().syncKeyPrev = [oldKey].concat(S().syncKeyPrev || []).slice(0, 5);   // 记住旧密钥，用来读取还没重新加密的云端数据
    S().passHash = await hashPass(r.new); S().passChangedAt = Date.now();
    unlockFor();
    save(); toast(t('passSaved'), 'ok');
    if (syncReady()) { SYNC.reenc = true; clearTimeout(SYNC.timer); syncNow({ silent: true, interactive: true }); }   // 立即用新密码重新加密云端
    return true;
  }
  function unlockFor() {
    const m = +S().lockMinutes;
    UI.unlockUntil = Date.now() + (m > 0 ? m * 60000 : 1500);
    clearTimeout(UI.relockTimer);
    UI.relockTimer = setTimeout(() => { if (UI.page === 'ledger' || UI.page === 'settings') renderPage(); else refreshLockBtn(); }, Math.max(0, UI.unlockUntil - Date.now()) + 200);
  }
  /** 需要密码的操作前调用；未设置密码时先引导设置 */
  /** force = true 时即使已解锁也要重新输入（用于“锁仓”资产） */
  async function requireUnlock(reason, force) {
    if (!force && Date.now() < UI.unlockUntil) return true;
    if (!S().passHash) return await setPasswordFlow();
    const r = await passDialog(t('verifyPass'), reason || t('verifyMsg'), ['cur']);
    if (!r) return false;
    if ((await hashPass(r.cur)) !== S().passHash) { toast(t('passWrong'), 'err'); return false; }
    healSyncKey(r.cur);
    unlockFor();
    if ((UI.page === 'ledger' || UI.page === 'holdings') && $('[data-action="lock-toggle"]')) refreshLockBtn();
    return true;
  }
  function lockBtnHTML() {
    const u = Date.now() < UI.unlockUntil;
    return `<button class="btn ${u ? 'btn-soft' : 'btn-glass'}" data-action="lock-toggle" title="${t('lockTip')}">${ic(u ? 'unlock' : 'lock')}${u ? t('unlockedState') : t('lockedState')}</button>`;
  }
  function refreshLockBtn() { const b = $('[data-action="lock-toggle"]'); if (b) b.outerHTML = lockBtnHTML(); }
  function toast(msg, type) {
    const el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.innerHTML = `<i class="tdot"></i><span>${esc(msg)}</span>`;
    $('#toast-root').appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, type === 'err' ? 4200 : 2600);
  }

  /* ---- 记一笔 ---- */
  /** 账户按“资产仓库”分组（未填写仓库的放最后） */
  function whGroups() {
    const g = {};
    DB.assets.forEach(a => { const w = a.warehouse || ''; (g[w] = g[w] || []).push(a); });
    whList(); const keys = Object.keys(g).filter(Boolean).sort((x, y) => whOrd(x) - whOrd(y) || g[y].length - g[x].length || x.localeCompare(y));
    if (g['']) keys.push('');
    return keys.map(k => ({ label: k || t('whNone'), list: g[k] }));
  }
  function accountOptions(sel) {
    return `<option value="">${t('noAccount')}</option>` + whGroups().map(gr =>
      `<optgroup label="${esc(gr.label)}">${gr.list.map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}${a.code ? ' · ' + esc(a.code) : ''} (${aCcy(a)})</option>`).join('')}</optgroup>`).join('');
  }
  function txCcyList(extra) {
    const set = new Set(DISPLAY_CCYS);
    DB.assets.forEach(a => set.add(aCcy(a)));
    DB.txs.forEach(x => { if (x.ccy) set.add(x.ccy); });
    if (extra) set.add(extra);
    return Array.from(set);
  }
  const validCcy = c => /^[A-Z]{3,5}$/.test(c) && !!rateOf(c);
  /** 转账账户：所有资产按仓库分组；现金类显示余额，其他显示持有数量 */
  const NEW_OPT = () => `<option value="__new">${t('newAssetOpt')}</option>`;
  function balOptions(sel, first, extra) {
    return `<option value="">${first || t('pickAcct')}</option>` + (extra || '') + whGroups().map(gr =>
      `<optgroup label="${esc(gr.label)}">${gr.list.map(a => {
        const u = qtyUnit(a), amt = hidden() ? MASK : u ? `${trim8(+a.qty || 0)} ${u}` : `${aCcy(a)} ${fmtNum(+a.qty || 0, 0, 2)}`;
        return `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)} (${esc(amt)})</option>`;
      }).join('')}</optgroup>`).join('');
  }
  function openTxModal(ex, presetType, presetSub) {
    const st = ex ? Object.assign({}, ex, { sync: !!ex.applied })
      : { type: presetType || 'expense', date: todayKey(), cat: '', amount: '', ccy: S().ccy, accountId: '', note: '', sync: true };
    let ccyTouched = !!ex;
    const ccyOpts = c => txCcyList(c).map(x => `<option value="${x}" ${x === c ? 'selected' : ''}>${CCY_SHORT[x] || x}</option>`).join('') + `<option value="__other">${t('ccy_OTHER')}…</option>`;
    const body = `
      <div class="field"><div class="seg seg-full tx-type-seg" id="tf-type">
        <button type="button" data-v="expense" class="${st.type === 'expense' ? 'on' : ''}">${ic('out')}${t('expense')}</button>
        <button type="button" data-v="income" class="${st.type === 'income' ? 'on' : ''}">${ic('in')}${t('income')}</button>
        <button type="button" data-v="transfer" class="${st.type === 'transfer' ? 'on' : ''}">${ic('swap')}${t('transfer')}</button></div></div>
      <div class="amount-box"><span class="sym" id="tf-sym">${esc(symOf(st.ccy).trim())}</span>
        <input class="amount-input num" id="tf-amount" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${st.amount !== '' ? esc(trim8(st.amount)) : ''}">
        <span class="unit" id="tf-unit" style="display:none"></span><select id="tf-ccy">${ccyOpts(st.ccy)}</select></div>
      <div class="field" id="tf-other-wrap" style="display:none;margin-top:-6px"><input class="input" id="tf-ccy-other" maxlength="5" placeholder="${t('ccyOtherPh')}" style="text-transform:uppercase"></div>
      <div class="row2">
        <div class="field"><label>${t('date')}</label><input class="input" type="date" id="tf-date" value="${esc(st.date)}"></div>
        <div class="field"><label id="tf-acct-l">${t('account')}</label><select class="input" id="tf-acct">${accountOptions(st.accountId)}</select></div>
      </div>
      <div class="row2" id="tf-to-row" style="display:none">
        <div class="field"><label>${t('transferTo')}</label><select class="input" id="tf-to">${balOptions(st.toId, '', NEW_OPT())}</select></div>
        <div class="field" id="tf-recv-wrap" style="visibility:hidden"><label id="tf-recv-l">${t('received')}</label><input class="input num" id="tf-recv" inputmode="decimal" autocomplete="off" value="${st.toAmount != null ? esc(trim8(st.toAmount)) : ''}"><div class="recv-diff" id="tf-recv-diff"></div></div>
      </div>
      <div class="tf-new" id="tf-new" style="display:none">
        <div class="tf-new-h">${ic('plus')}<b>${t('newAssetT')}</b><small>${t('newAssetSub')}</small></div>
        <div class="row2">
          <div class="field"><label>${t('assetClass')}</label><select class="input" id="tn-cls">${clsKeys().filter(c => c !== 'liability').map(c => `<option value="${c}">${clsName(c)}</option>`).join('')}</select></div>
          <div class="field"><label>${t('priceCcy')}</label><select class="input" id="tn-ccy">${txCcyList().map(c => `<option value="${c}">${CCY_SHORT[c] || c}</option>`).join('')}</select></div>
        </div>
        <div class="row2">
          <div class="field"><label>${t('assetCode')}</label><input class="input" id="tn-code" maxlength="20" autocomplete="off" spellcheck="false" style="text-transform:uppercase" placeholder="BTC / ETH / AAPL"></div>
          <div class="field"><label>${t('assetName')} <span class="dim">· ${t('codeOpt')}</span></label><input class="input" id="tn-name" maxlength="40" autocomplete="off"></div>
        </div>
        <div class="field" style="margin-bottom:0"><label>${t('warehouse')} <span class="dim">· ${t('codeOpt')}</span></label><input class="input" id="tn-wh" list="tn-wh-list" maxlength="40" placeholder="${t('warehousePh')}">
          <datalist id="tn-wh-list">${whList().slice().map(w => `<option value="${esc(w)}">`).join('')}</datalist></div>
      </div>
      <div class="hint" id="tf-val-hint" style="display:none;margin:-6px 0 12px"></div>
      <div id="tf-fee-wrap" style="display:none">
        <div class="row2">
          <div class="field"><label>${t('feeAcct')}</label><select class="input" id="tf-fee-acct">${balOptions(st.feeId || '', t('feeSame'))}</select></div>
          <div class="field"><label id="tf-fee-l">${t('fee')}</label><input class="input num" id="tf-fee" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${st.fee > 0 ? esc(trim8(st.fee)) : ''}"></div>
        </div>
        <div class="hint" id="tf-fee-hint" style="margin:-6px 0 12px"></div></div>
      <div class="field" id="tf-cats-wrap"><label>${t('category')}</label><div class="cat-grid" id="tf-cats"></div></div>
      <div class="field tf-sub" id="tf-sub-wrap" style="display:none"><label>${t('subLink')} <span class="dim">· ${t('subLinkTip')}</span></label>
        <select class="input" id="tf-sub">${subOptions((ex && ex.subId) || presetSub || '')}</select>
        <div class="tf-new" id="tf-sub-new" style="display:none;margin:10px 0 0">
          <div class="tf-new-h">${ic('plus')}<b>${t('subNewT')}</b><small>${t('subNewSub')}</small></div>
          <div class="row2">
            <div class="field"><label>${t('subName')}</label><input class="input" id="tn-sname" maxlength="40" placeholder="${t('subNamePh')}"></div>
            <div class="field"><label>${t('subColCat')}</label><select class="input" id="tn-scat">${subCatOptions('').replace(/<option value="__manage">[^<]*<\/option>/, '')}</select><input class="input" id="tn-scat-c" maxlength="20" placeholder="${t('subCatCustomPh')}" style="display:none;margin-top:8px"></div>
          </div>
          <div class="field" style="margin-bottom:6px"><label>${t('subColCycle')}</label><div class="seg seg-full" id="tn-scyc">${['month', 'quarter', 'year', 'once'].map(c => `<button type="button" data-v="${c}" class="${c === 'month' ? 'on' : ''}">${t('cyc_' + c)}</button>`).join('')}</div></div>
        </div>
        <div id="tf-sub-renew-wrap" style="display:none;margin-top:12px"><div class="sub-lbl">${t('subRenewTo')}</div>
          <div class="seg seg-full seg-wrap" id="tf-sub-renew">${['cycle', 'm1', 'y1', 'forever', 'custom'].map(r => `<button type="button" data-v="${r}">${t('renew_' + r)}</button>`).join('')}</div>
          <input class="input" type="date" id="tf-sub-date" value="${esc((ex && ex.subDate) || '')}" style="display:none;margin-top:8px">
          <div class="hint sub-hint" id="tf-sub-hint"></div></div>
      </div>
      <label class="switch-row" id="tf-sync-row"><span>${t('syncBalance')}<small id="tf-sync-sub">${t('syncBalanceSub')}</small></span>
        <span class="switch"><input type="checkbox" id="tf-sync" ${st.sync ? 'checked' : ''}><i></i></span></label>
      <div class="field" style="margin-bottom:4px"><label>${t('noteOpt')}</label><input class="input" id="tf-note" maxlength="120" value="${esc(st.note)}" placeholder="${t('notePh')}"></div>`;
    openModal({
      title: ex ? t('txEdit') : t('txNew'),
      body,
      footer: `${ex ? `<span class="foot-meta">${t('createdAt')} ${fullTime(ex.createdAt)}</span>` : ''}<button class="btn btn-glass" data-modal-close>${t('cancel')}</button><button class="btn btn-accent" id="tf-save">${ic('check')}${t('save')}</button>`,
      onMount(m) {
        const curCcy = () => { const v = $('#tf-ccy', m).value; return v === '__other' ? $('#tf-ccy-other', m).value.trim().toUpperCase() : v; };
        const drawCats = () => {
          const cats = st.type === 'income' ? INC_CATS : EXP_CATS;
          if (!cats.includes(st.cat)) st.cat = cats[0];
          $('#tf-cats', m).innerHTML = cats.map(c => `<button type="button" class="cat ${st.cat === c ? 'on' : ''}" data-v="${c}"><span class="e">${CAT_ICON[c]}</span>${catName(c)}</button>`).join('');
        };
        const isTr = () => st.type === 'transfer';
        /** 同步余额：现金 / 负债按金额加减；其他资产按现价折算成数量加减（收入按价值计入成本，支出不改平均成本） */
        const syncRow = () => {
          const a = findAsset($('#tf-acct', m).value), row = $('#tf-sync-row', m), sub = $('#tf-sync-sub', m);
          row.style.display = !isTr() && a ? '' : 'none';
          if (!a || isTr()) return;
          if (isBalance(a)) { sub.textContent = t('syncBalanceSub'); return; }
          const px = syncPx(a), amt = parseNum($('#tf-amount', m).value) || 0, c = curCcy();
          if (!(px > 0)) { sub.textContent = t('syncNoPrice'); return; }
          const dq = validCcy(c) ? conv(amt, c, aCcy(a)) / px : 0, u = a.noQty ? t('syncLots') : (qtyUnit(a) || '');
          sub.textContent = t('syncQtySub', { q: `${st.type === 'income' ? '+' : '−'}${trim8(round8(dq))} ${u}`.trim(), p: money(px, { ccy: aCcy(a), max: 8, raw: true }) });
        };
        // 编辑已同步过的记录时沿用当时的价格，避免因行情变化导致数量对不上
        const syncPx = a => (ex && ex.applied && ex.accountId === a.id && ex.appliedPx > 0 ? +ex.appliedPx : +a.price || 0);
        // 编辑已有转账：跨币种 / 按数量 / 有到账差额的保留原到账；同币种且到账 = 转出的，到账继续跟着金额走（改金额不会凭空多出差额）
        let recvTouched = !!(ex && ex.type === 'transfer' && (ex.recvDiff || ex.fromUnit || ex.toUnit || (ex.toCcy && ex.toCcy !== ex.ccy) || Math.abs((+ex.toAmount || 0) - (+ex.amount || 0)) > 1e-9));
        /** 转入“新建资产”：按小表单生成一项新资产（还没保存），保存转账时才加入资产列表 */
        const draftAsset = () => {
          const cls = $('#tn-cls', m).value, code = $('#tn-code', m).value.trim().toUpperCase(), name = $('#tn-name', m).value.trim();
          const a = { cls: [cls], code, name: name || code, ccy: $('#tn-ccy', m).value, qty: 0, cost: 0, price: 0, unit: '', note: '', warehouse: $('#tn-wh', m).value.trim(), locked: false, noQty: false, balMode: false, source: 'online' };
          if (isBalance(a)) { a.cost = 1; a.price = 1; a.source = 'manual'; a.code = ''; a.name = name || code; }
          else if (!Api.canQuote(a)) a.source = 'manual';
          return a;
        };
        /** 转账：可在任意资产之间互转。金额框填转出“数量”（现金类为金额）；到账数量按价值自动折算，可手动改 */
        const trSync = () => {
          if (!isTr()) return;
          const f = findAsset($('#tf-acct', m).value), isNew = $('#tf-to', m).value === '__new', sel = $('#tf-ccy', m);
          $('#tf-new', m).style.display = isNew ? '' : 'none';
          const to = isNew ? draftAsset() : findAsset($('#tf-to', m).value);
          const fu = qtyUnit(f), tu = isNew ? (isBalance(to) ? '' : (to.code || to.name || '—')) : qtyUnit(to);
          const fa = findAsset($('#tf-fee-acct', m).value) || f, feeU = qtyUnit(fa), feeOther = fa && f && fa.id !== f.id;
          if (f) {
            if (![...sel.options].some(o => o.value === aCcy(f))) sel.insertAdjacentHTML('afterbegin', `<option value="${aCcy(f)}">${aCcy(f)}</option>`);
            sel.value = aCcy(f); $('#tf-sym', m).textContent = fu ? '' : symOf(aCcy(f)).trim();
          }
          sel.style.display = fu ? 'none' : '';
          $('#tf-unit', m).textContent = fu; $('#tf-unit', m).style.display = fu ? '' : 'none';
          $('#tf-amount', m).placeholder = fu ? '0.00000000' : '0.00';
          $('#tf-fee-l', m).innerHTML = `${t('fee')}${fa ? ` (${esc(feeU || aCcy(fa))})` : ''} <span class="dim">· ${t('codeOpt')}</span>`;
          const amt = parseNum($('#tf-amount', m).value) || 0, fee0 = parseNum($('#tf-fee', m).value) || 0;
          const feeQ = n => (feeU ? `${trim8(round8(n))} ${esc(feeU)}` : money(n, { ccy: aCcy(fa), max: 8, raw: true }));
          $('#tf-fee-hint', m).innerHTML = feeOther
            ? t('feeHintOther', { n: esc(fa.name), a: fee0 > 0 ? feeQ(fee0) : '—', h: feeU ? `${hidden() ? MASK : trim8(+fa.qty || 0)} ${esc(feeU)}` : money(+fa.qty || 0, { ccy: aCcy(fa) }) })
            : f && fee0 > 0 ? t('feeHint', { a: fu ? `${trim8(round8(amt + fee0))} ${esc(fu)}` : money(amt + fee0, { ccy: aCcy(f), max: 8, raw: true }) }) : t('feeHint0');
          const val = f ? amt * unitPx(f) : 0, vh = $('#tf-val-hint', m), recv = parseNum($('#tf-recv', m).value) || 0;
          const showAvg = isNew && f && !isBalance(to) && amt > 0 && recv > 0;
          vh.style.display = (f && fu && amt > 0) || showAvg ? '' : 'none';
          const parts = [];
          if (f && fu && amt > 0) parts.push(t('transferValue', { v: money(val, { ccy: aCcy(f), max: 2, raw: true }), q: `${trim8(+f.qty || 0)} ${esc(fu)}` }));
          if (showAvg) parts.push(t('newAssetAvg', { p: money(conv(val, aCcy(f), aCcy(to)) / recv, { ccy: aCcy(to), max: 8, raw: true }), u: esc(tu) }));
          vh.innerHTML = parts.join('<br>');
          const diff = f && to && (isNew ? !(isBalance(to) && !fu && aCcy(f) === aCcy(to)) : (fu || tu || aCcy(f) !== aCcy(to)));
          // 同币种现金类互转也显示「到账金额」：默认 = 转出金额，可改（红包抵扣 / 到账扣费时两者不一样）
          const same = f && to && !diff;
          $('#tf-recv-wrap', m).style.visibility = f && to ? 'visible' : 'hidden';
          const dEl = $('#tf-recv-diff', m); dEl.innerHTML = ''; dEl.className = 'recv-diff';
          if (same) {
            $('#tf-recv-l', m).textContent = `${t('received')} (${aCcy(to)})`;
            if (!recvTouched) $('#tf-recv', m).value = amt > 0 ? trim8(amt) : '';
            const rv = parseNum($('#tf-recv', m).value), dv = amt > 0 && rv > 0 ? round8(rv - amt) : 0;
            if (Math.abs(dv) > 1e-9) {
              dEl.className = `recv-diff ${dv > 0 ? 'up' : 'down'}`;
              dEl.innerHTML = t(dv > 0 ? 'recvBonus' : 'recvLoss', { v: money(Math.abs(dv), { ccy: aCcy(to), max: 8, raw: true }) });
            }
          }
          if (diff) {
            $('#tf-recv-l', m).textContent = `${t('received')} (${tu || aCcy(to)})`;
            const px = unitPx(to);
            if (!isNew && !recvTouched && amt > 0 && px > 0) $('#tf-recv', m).value = trim8(round8(conv(val, aCcy(f), aCcy(to)) / px));
            if (isNew && !recvTouched && isBalance(to) && amt > 0) $('#tf-recv', m).value = trim8(round8(conv(val, aCcy(f), aCcy(to))));
          }
        };
        const setMode = () => {
          const tr = isTr(), acct = $('#tf-acct', m), cur = acct.value;
          $('#tf-cats-wrap', m).style.display = tr ? 'none' : '';
          $('#tf-to-row', m).style.display = tr ? '' : 'none';
          $('#tf-fee-wrap', m).style.display = tr ? '' : 'none';
          $('#tf-acct-l', m).textContent = tr ? t('transferFrom') : t('account');
          acct.innerHTML = tr ? balOptions(cur) : accountOptions(cur);
          $('#tf-ccy', m).disabled = tr;
          if (!tr) { drawCats(); $('#tf-ccy', m).style.display = ''; $('#tf-unit', m).style.display = 'none'; $('#tf-val-hint', m).style.display = 'none'; }
          syncRow(); trSync();
        };
        // 关联订阅（只在支出时出现）：选已有订阅 → 续期并更新到期时间；选“新建订阅” → 同时建一个订阅
        let subRenew = (ex && ex.subRenew) || 'cycle', subCyc = 'month';
        const subSync = fill => {
          const show = st.type === 'expense', v = show ? $('#tf-sub', m).value : '';
          $('#tf-sub-wrap', m).style.display = show ? '' : 'none';
          $('#tf-sub-new', m).style.display = v === '__new' ? '' : 'none';
          $('#tf-sub-renew-wrap', m).style.display = v ? '' : 'none';
          if (!v) return;
          $$('#tf-sub-renew button', m).forEach(b => b.classList.toggle('on', b.dataset.v === subRenew));
          const s = v === '__new' ? { cycle: subCyc, cycleN: 1, cycleU: 'month' } : findSub(v);
          if (!s) return;
          if (fill) {
            st.cat = 'subscription'; drawCats();
            if (v !== '__new') {
              const amtEl = $('#tf-amount', m), sel = $('#tf-ccy', m);
              if (!amtEl.value) {
                amtEl.value = trim8(+(s.nextPrice != null && s.nextPrice !== '' ? s.nextPrice : s.price) || 0);
                if (![...sel.options].some(o => o.value === s.ccy)) sel.insertAdjacentHTML('afterbegin', `<option value="${s.ccy}">${CCY_SHORT[s.ccy] || s.ccy}</option>`);
                sel.value = s.ccy; $('#tf-sym', m).textContent = symOf(s.ccy).trim(); ccyTouched = true;
              }
              const acct = $('#tf-acct', m);
              if (!acct.value && s.payId && [...acct.options].some(o => o.value === s.payId)) acct.value = s.payId;
              syncRow();
            }
          }
          let cur = v === '__new' ? '' : s.expire || '';
          if (ex && ex.subId === v && (s.expire || '') === (ex.subNew || '') && ex.subPrev) cur = ex.subPrev.expire || '';   // 编辑：按这笔续费之前的到期日预览
          const date = $('#tf-date', m).value || todayKey(), dEl = $('#tf-sub-date', m);
          if (subRenew === 'custom' && !dEl.value) dEl.value = renewTo(s, cur, date, 'cycle') || addDate(date, 1, 'month');
          dEl.style.display = subRenew === 'custom' ? '' : 'none';
          const ne = renewTo(s, cur, date, subRenew, dEl.value);
          const nx = v !== '__new' && s.nextPrice != null && s.nextPrice !== '' ? `<br>${ic('trend')}${t('subUseNext', { a: money(+s.nextPrice, { ccy: s.ccy, max: 2, raw: true }) })}` : '';
          $('#tf-sub-hint', m).innerHTML = `${t('subExpPrev')} <b>${cur || (v === '__new' ? '—' : t('subForever'))}</b> → <b class="acc">${ne || t('subForever')}</b>${nx}`;
        };
        $('#tf-sub', m).addEventListener('change', e => { subRenew = 'cycle'; subSync(true); if (e.target.value === '__new') setTimeout(() => $('#tn-sname', m).focus(), 30); });
        $('#tf-sub-renew', m).addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; subRenew = b.dataset.v; subSync(); });
        $('#tf-sub-date', m).addEventListener('input', () => subSync());
        $('#tf-date', m).addEventListener('input', () => subSync());
        $('#tn-scyc', m).addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; subCyc = b.dataset.v; $$('#tn-scyc button', m).forEach(x => x.classList.toggle('on', x === b)); subSync(); });
        $('#tn-scat', m).addEventListener('change', e => { const c = e.target.value === '__custom'; $('#tn-scat-c', m).style.display = c ? '' : 'none'; if (c) $('#tn-scat-c', m).focus(); });
        drawCats(); setMode(); subSync(!!presetSub);
        $('#tf-type', m).addEventListener('click', e => {
          const b = e.target.closest('[data-v]'); if (!b) return;
          st.type = b.dataset.v; $$('#tf-type button', m).forEach(x => x.classList.toggle('on', x === b)); setMode(); subSync();
        });
        $('#tf-to', m).addEventListener('change', e => {
          recvTouched = false;
          if (e.target.value === '__new') {
            $('#tf-recv', m).value = '';
            const f = findAsset($('#tf-acct', m).value);
            if (f) {
              const pc = primary(f);
              $('#tn-cls', m).value = pc === 'cash' || pc === 'liability' ? 'crypto' : pc;
              if (!$('#tn-wh', m).value) $('#tn-wh', m).value = f.warehouse || '';
              const sel = $('#tn-ccy', m); if ([...sel.options].some(o => o.value === aCcy(f))) sel.value = aCcy(f);
            }
            setTimeout(() => $('#tn-code', m).focus(), 30);
          }
          trSync();
        });
        ['#tn-cls', '#tn-ccy', '#tn-code', '#tn-name', '#tn-wh'].forEach(q => $(q, m).addEventListener('input', trSync));
        $('#tn-cls', m).addEventListener('change', () => { recvTouched = false; trSync(); });
        $('#tf-fee-acct', m).addEventListener('change', trSync);
        $('#tf-recv', m).addEventListener('input', () => { recvTouched = true; trSync(); });
        $('#tf-fee', m).addEventListener('input', trSync);
        $('#tf-amount', m).addEventListener('input', trSync);
        $('#tf-amount', m).addEventListener('input', syncRow);
        $('#tf-ccy', m).addEventListener('change', syncRow);
        $('#tf-cats', m).addEventListener('click', e => {
          const b = e.target.closest('[data-v]'); if (!b) return;
          st.cat = b.dataset.v; $$('#tf-cats .cat', m).forEach(x => x.classList.toggle('on', x === b));
        });
        $('#tf-ccy', m).addEventListener('change', e => {
          ccyTouched = true;
          const other = e.target.value === '__other';
          $('#tf-other-wrap', m).style.display = other ? '' : 'none';
          if (other) $('#tf-ccy-other', m).focus();
          $('#tf-sym', m).textContent = other ? '' : symOf(e.target.value).trim();
        });
        $('#tf-ccy-other', m).addEventListener('input', e => { $('#tf-sym', m).textContent = symOf(e.target.value.toUpperCase()).trim(); });
        $('#tf-acct', m).addEventListener('change', e => {
          const a = findAsset(e.target.value);
          if (a && !ccyTouched) {
            const sel = $('#tf-ccy', m);
            if (![...sel.options].some(o => o.value === aCcy(a))) sel.insertAdjacentHTML('afterbegin', `<option value="${aCcy(a)}">${aCcy(a)}</option>`);
            sel.value = aCcy(a); $('#tf-sym', m).textContent = symOf(aCcy(a)).trim();
          }
          if (isTr()) recvTouched = false;
          syncRow(); trSync();
        });
        $('#tf-amount', m).addEventListener('input', e => e.target.closest('.amount-box').classList.remove('err'));
        setTimeout(() => $('#tf-amount', m).focus(), 60);
        $('#tf-amount', m).addEventListener('keydown', e => { if (e.key === 'Enter') $('#tf-save', m).click(); });
        $('#tf-save', m).addEventListener('click', () => {
          const amtEl = $('#tf-amount', m), amount = parseNum(amtEl.value);
          if (!(amount > 0) || !/^\d*\.?\d{0,8}$/.test(amtEl.value.replace(/[,\s]/g, ''))) { amtEl.closest('.amount-box').classList.add('err'); toast(t('errAmount'), 'err'); amtEl.focus(); return; }
          const ccy = curCcy();
          if (!validCcy(ccy)) { toast(t('errRate', { c: ccy || '?' }), 'err'); return; }
          const date = $('#tf-date', m).value;
          if (!date) { toast(t('errDate'), 'err'); return; }
          if (isTr()) {
            const fromId = $('#tf-acct', m).value, isNew = $('#tf-to', m).value === '__new', f = findAsset(fromId);
            let to = isNew ? draftAsset() : findAsset($('#tf-to', m).value);
            if (isNew && f && !to.code && !to.name) { toast(t('errNeedName'), 'err'); $('#tn-code', m).focus(); return; }
            if (isNew && to) to = Object.assign({ id: uid(), createdAt: Date.now(), updatedAt: Date.now() }, to);
            const toId = to ? to.id : '';
            if (!f || !to) { toast(t('errTransferAcct'), 'err'); return; }
            if (fromId === toId) { toast(t('errTransferSame'), 'err'); return; }
            const fee = parseNum($('#tf-fee', m).value || '0');
            if (isNaN(fee) || fee < 0) { toast(t('errAmount'), 'err'); return; }
            let feeId = $('#tf-fee-acct', m).value || '';
            if (feeId === fromId || !(fee > 0)) feeId = '';
            const fa = feeId ? findAsset(feeId) : f, feeU = qtyUnit(fa);
            const fu = qtyUnit(f), tu = isNew ? (isBalance(to) ? '' : (to.code || to.name)) : qtyUnit(to), value = round8(amount * unitPx(f));
            if (isNew && !isBalance(to)) {
              // 新资产：单价 = 转出价值 ÷ 到账数量（行情资产保存后会自动刷新为最新价）
              const rq = parseNum($('#tf-recv', m).value);
              if (!(rq > 0)) { toast(t('errRecv'), 'err'); $('#tf-recv', m).focus(); return; }
              to.price = round8(conv(value, aCcy(f), aCcy(to)) / rq);
            }
            let toAmount = amount, recvDiff = 0;
            if (!(fu || tu || aCcy(f) !== aCcy(to))) {
              // 同币种现金类：到账可以和转出不一样（红包 / 优惠抵扣 → 多出的记收入；到账扣费 → 少的记支出）
              const rv = parseNum($('#tf-recv', m).value);
              if ($('#tf-recv', m).value.trim() !== '' && !(rv > 0)) { toast(t('errRecv'), 'err'); $('#tf-recv', m).focus(); return; }
              if (rv > 0) { toAmount = round8(rv); recvDiff = round8(rv - amount); }
            } else {
              toAmount = parseNum($('#tf-recv', m).value);
              if (!(toAmount > 0)) { const px = unitPx(to); toAmount = px > 0 ? round8(conv(value, aCcy(f), aCcy(to)) / px) : 0; }
              if (!(toAmount > 0)) { toast(t('errRecv'), 'err'); $('#tf-recv', m).focus(); return; }
            }
            const tx = ex || { id: uid(), createdAt: Date.now() };
            const old = ex ? JSON.parse(JSON.stringify(ex)) : null, bal0 = balSnapshot();
            if (ex) applyTx(ex, -1);
            // 非现金资产：转出数量（含手续费）不能超过持有数量
            if (fu && amount + (feeId ? 0 : fee) > (+f.qty || 0) + 1e-9) {
              const hq = trim8(+f.qty || 0);
              if (ex) applyTx(ex, 1);
              toast(t('errTransferQty', { q: `${hq} ${fu}` }), 'err'); return;
            }
            // 单独的手续费账户（如用 BNB 抵扣）：扣的数量不能超过它的持有数量
            if (feeId && feeU && fee > (+fa.qty || 0) + 1e-9) {
              const hq = trim8(+fa.qty || 0);
              if (ex) applyTx(ex, 1);
              toast(t('errFeeQty', { n: fa.name, q: `${hq} ${feeU}` }), 'err'); return;
            }
            // 转入非现金资产：按转出部分的成本摊入平均成本
            const inCost = tu ? round8(conv(fu ? amount * (+f.cost || 0) : amount, aCcy(f), aCcy(to))) : null;
            Object.keys(tx).forEach(k => { if (!['id', 'createdAt', 'log'].includes(k)) delete tx[k]; });
            Object.assign(tx, { date, type: 'transfer', cat: 'transfer', amount, ccy: aCcy(f), accountId: fromId, toId, toAmount, toCcy: aCcy(to), fee, value, feeValue: round8(fee * unitPx(fa)), note: $('#tf-note', m).value.trim(), applied: true });
            if (feeId) { tx.feeId = feeId; tx.feeCcy = aCcy(fa); if (feeU) tx.feeUnit = feeU; }
            if (Math.abs(recvDiff) > 1e-9) tx.recvDiff = recvDiff;
            if (fu) tx.fromUnit = fu;
            if (isNew) {
              DB.assets.push(to);
              logOp('asset', to, 'create', ASSET_FIELDS.filter(k => !['locked'].includes(k) && to[k] !== '' && to[k] != null).map(k => [k, '', to[k]]), { tx: recTitle('tx', tx) });
            }
            if (tu) { tx.toUnit = tu; tx.inCost = inCost; }
            if (old) subRevert(old);
            applyTx(tx, 1);
            if (!ex) DB.txs.push(tx);
            if (old) { const d = diffOf(old, tx, TX_FIELDS); if (d.length) logOp('tx', tx, 'edit', d); } else logOp('tx', tx, 'create');
            logBalChanges(bal0, tx, old ? 'edit' : 'create');
            commit(); closeModal(); renderAll();
            const q = (n, u, c) => (u ? `${trim8(n)} ${u}` : money(n, { ccy: c || aCcy(f), max: 8, raw: true }));
            toast(`${t('transferDone')} · ${f.name} → ${to.name} ${q(amount, fu)}${fee > 0 ? ` · ${t('fee')} ${q(fee, feeU, aCcy(fa))}` : ''}${isNew ? ' · ' + t('newAssetMade', { n: to.name }) : ''}`, 'ok');
            if (isNew && to.source === 'online') refreshOne(to);
            return;
          }
          const subV = st.type === 'expense' ? $('#tf-sub', m).value : '';
          let subCat = $('#tn-scat', m).value;
          if (subCat === '__custom') subCat = findOrAddCat($('#tn-scat-c', m).value);
          if (subCat === '__manage') subCat = '';
          if (subV === '__new' && !$('#tn-sname', m).value.trim()) { toast(t('subErrName'), 'err'); $('#tn-sname', m).focus(); return; }
          if (subV && subRenew === 'custom' && !$('#tf-sub-date', m).value) { toast(t('errDate'), 'err'); return; }
          const tx = ex || { id: uid(), createdAt: Date.now() };
          const old = ex ? JSON.parse(JSON.stringify(ex)) : null, bal0 = balSnapshot();
          if (ex) applyTx(ex, -1);
          ['toId', 'toAmount', 'toCcy', 'fee', 'feeId', 'feeCcy', 'feeUnit', 'value', 'feeValue', 'fromUnit', 'toUnit', 'inCost', 'recvDiff'].forEach(k => delete tx[k]);
          Object.assign(tx, { date, type: st.type, cat: st.cat, amount, ccy, accountId: $('#tf-acct', m).value || '', note: $('#tf-note', m).value.trim(), applied: false, appliedDelta: 0 });
          delete tx.appliedPx; delete tx.appliedCost;
          const a = findAsset(tx.accountId), sgn = tx.type === 'income' ? 1 : -1;
          if (a && $('#tf-sync', m).checked) {
            if (isBalance(a)) {
              tx.applied = true;
              tx.appliedDelta = round8(sgn * conv(tx.amount, tx.ccy, aCcy(a)));
            } else {
              const px = syncPx(a), val = conv(tx.amount, tx.ccy, aCcy(a));
              if (!(px > 0)) { if (ex) applyTx(ex, 1); toast(t('syncNoPrice'), 'err'); return; }
              const dq = round8(val / px);
              if (sgn < 0 && dq > (+a.qty || 0) + 1e-9) { if (ex) applyTx(ex, 1); toast(t('errSpendQty', { q: `${trim8(+a.qty || 0)} ${qtyUnit(a)}` }), 'err'); return; }
              tx.applied = true; tx.appliedDelta = sgn * dq; tx.appliedPx = px;
              if (sgn > 0) tx.appliedCost = round8(val);   // 收入：按收到时的价值计入成本（不算投资盈利）
            }
            applyTx(tx, 1);
          }
          // 订阅：先撤销这笔记录之前的续期，再按现在的选择续期 / 新建
          if (old) subRevert(old);
          ['subId', 'subPrev', 'subNew', 'subRenew', 'subDate', 'subMade'].forEach(k => delete tx[k]);
          const sub = subV ? subApply(tx, { id: subV, renew: subRenew, date: $('#tf-sub-date', m).value, name: $('#tn-sname', m).value.trim(), cat: subCat, cycle: subCyc }) : null;
          if (!ex) DB.txs.push(tx);
          if (old) { const d = diffOf(old, tx, TX_FIELDS); if (d.length) logOp('tx', tx, 'edit', d); } else logOp('tx', tx, 'create');
          logBalChanges(bal0, tx, old ? 'edit' : 'create');
          commit(); closeModal(); renderAll();
          toast((ex ? t('saved') : t('txSaved', { a: money((tx.type === 'income' ? 1 : -1) * tx.amount, { ccy: tx.ccy, sign: true, max: 8 }) })) + (sub ? ' · ' + t('subRenewed', { n: sub.name, d: sub.expire || t('subForever') }) : ''), 'ok');
          if (sub) checkSubReminders();
        });
      }
    });
  }
  function applyTx(tx, sign) {
    if (tx.type === 'transfer') {
      if (!tx.applied) return;
      const f = findAsset(tx.accountId), to = findAsset(tx.toId);
      const fa = tx.feeId ? findAsset(tx.feeId) : null;
      if (f) f.qty = round8((+f.qty || 0) - ((+tx.amount || 0) + (tx.feeId ? 0 : +tx.fee || 0)) * sign);   // 手续费默认从转出账户扣
      if (fa) fa.qty = round8((+fa.qty || 0) - (+tx.fee || 0) * sign);                                         // 指定了手续费账户（如 BNB）就从那里扣
      if (to) {
        const q = +to.qty || 0, dq = (+tx.toAmount || 0) * sign, nq = q + dq;
        // 转入非现金资产时同步摊薄 / 还原平均成本：新成本 = (原数量×原成本 + 转入成本) / 新数量
        if (tx.inCost != null && !isBalance(to) && nq > 1e-12) to.cost = round8((q * (+to.cost || 0) + (+tx.inCost || 0) * sign) / nq);
        to.qty = round8(nq);
      }
      return;
    }
    if (!tx.applied || !tx.accountId) return;
    const a = findAsset(tx.accountId);
    if (!a) return;
    if (isBalance(a)) { a.qty = round8((+a.qty || 0) + (+tx.appliedDelta || 0) * sign); return; }
    // 非现金资产：数量按记录时折算的数量加减；收入同时按价值摊入平均成本（与转账一致，可完整回滚）
    const q = +a.qty || 0, nq = q + (+tx.appliedDelta || 0) * sign;
    if (tx.appliedCost && nq > 1e-12) a.cost = round8((q * (+a.cost || 0) + (+tx.appliedCost || 0) * sign) / nq);
    a.qty = round8(nq);
  }

  /* ---- 添加 / 编辑资产 ---- */
  /** 输入的单位 → 存储值：oz / g / kg 和“件 / pc”存成预设键，其余原样保存 */
  const unitKey = v => { const s = String(v || '').trim(); if (!s) return ''; const l = s.toLowerCase(); if (['oz', 'g', 'kg'].includes(l)) return l; if (s === t('unitS_pc') || l === 'pc' || s === '件') return 'pc'; return s; };
  function openAssetModal(id) {
    const ex = id ? findAsset(id) : null;
    const f = ex ? Object.assign({}, ex, { cls: tagsOf(ex).slice() })
      : { cls: [UI.hold.cls !== 'all' ? UI.hold.cls : 'stock'], name: '', code: '', qty: '', cost: '', price: '', ccy: 'USD', unit: '', source: 'online', note: '', warehouse: '' };
    if (!ex && isBalance(f)) { f.ccy = S().ccy; f.source = 'manual'; }
    const isStd = DISPLAY_CCYS.includes(aCcy(f));
    const num = v => (v === '' || v == null ? '' : esc(trim8(v)));
    const whs = whList().slice();
    const body = `
      <div class="field"><label>${t('assetClass')} <span class="dim">· ${t('multiOk')}</span></label>
        <div class="cls-grid" id="af-cls">${clsKeys().map(c => `<button type="button" data-v="${c}" class="${f.cls.includes(c) ? 'on' : ''}" style="--tc:${clsColor(c)}"><i class="cdot"></i>${clsName(c)}<em>${f.cls[0] === c && f.cls.length > 1 ? t('primary') : ''}</em></button>`).join('')}</div>
        <div class="hint" id="af-cls-hint"></div></div>
      <div class="row2">
        <div class="field"><label>${t('assetName')}</label><input class="input" id="af-name" value="${esc(f.name)}" maxlength="40"></div>
        <div class="field" id="af-code-wrap"><label>${t('assetCode')} <span class="dim">· ${t('codeOpt')}</span></label><input class="input" id="af-code" value="${esc(f.code || '')}" autocomplete="off" spellcheck="false" maxlength="20" style="text-transform:uppercase"></div>
      </div>
      <div class="field"><label>${t('priceCcy')}</label><div class="ccy-pick"><div class="seg" id="af-ccy">${DISPLAY_CCYS.concat(['OTHER']).map(c =>
          `<button type="button" data-v="${c}" class="${(isStd ? aCcy(f) === c : c === 'OTHER') ? 'on' : ''}">${c === 'OTHER' ? t('ccy_OTHER') : CCY_SHORT[c]}</button>`).join('')}</div>
          <input class="input" id="af-ccy-other" placeholder="${t('ccyOtherPh')}" maxlength="5" value="${isStd ? '' : esc(aCcy(f))}" style="${isStd ? 'display:none' : ''};text-transform:uppercase"></div></div>
      <div class="field"><label>${t('warehouse')} <span class="dim">· ${t('codeOpt')}</span></label><input class="input" id="af-wh" list="af-wh-list" value="${esc(f.warehouse || '')}" maxlength="40" placeholder="${t('warehousePh')}">
          <datalist id="af-wh-list">${whs.map(w => `<option value="${esc(w)}">`).join('')}</datalist>
          <div class="wh-chips" id="af-wh-chips">${whList().map(w => `<button type="button" data-v="${esc(w)}" class="${f.warehouse === w ? 'on' : ''}">${esc(w)}</button>`).join('')}</div></div>
      <div class="row2">
        <div class="field"><label id="af-qty-l"></label><input class="input num" id="af-qty" inputmode="decimal" autocomplete="off" value="${f.noQty ? '' : num(f.qty)}" placeholder="0.00000000"></div>
        <div class="field" id="af-unit-wrap"><label>${t('unit')} <span class="dim">· ${t('codeOpt')}</span></label><input class="input" id="af-unit" list="af-unit-list" maxlength="12" value="${esc(unitLabel(f.unit))}" placeholder="${t('unitPh')}" autocomplete="off">
          <datalist id="af-unit-list">${['oz', 'g', 'kg'].concat(t('unitPresets').split(',')).map(u => `<option value="${esc(u)}">`).join('')}</datalist></div>
        <div class="field hide-bal" id="af-cost-wrap"><label>${t('avgCost')}</label><input class="input num" id="af-cost" inputmode="decimal" autocomplete="off" value="${num(f.cost)}" placeholder="0.00"></div>
      </div>
      <div class="field hide-bal"><label>${t('curPrice')}</label><div class="input-group">
        <input class="input num" id="af-price" inputmode="decimal" autocomplete="off" value="${num(f.price)}" placeholder="0.00">
        <button type="button" class="btn btn-soft" id="af-fetch">${ic('bolt')}${t('fetchOnline')}</button></div></div>
      <div class="fetch-msg" id="af-msg"></div>
      <div class="field hide-bal" id="af-src-wrap"><label>${t('quoteSource')}</label><div class="seg seg-full" id="af-src">
        <button type="button" data-v="online" class="${f.source === 'online' ? 'on' : ''}">${t('srcOnline')}</button>
        <button type="button" data-v="manual" class="${f.source !== 'online' ? 'on' : ''}">${t('srcManual')}</button></div></div>
      <div class="field" id="af-mode-wrap"><label>${t('fillMode')}</label><div class="seg seg-full" id="af-mode">
        <button type="button" data-v="bal">${t('fillBal')}</button>
        <button type="button" data-v="qty">${t('fillQty')}</button></div><div class="hint" id="af-mode-hint"></div></div>
      <div class="field"><label>${t('noteOpt')}</label><input class="input" id="af-note" value="${esc(f.note || '')}" maxlength="80" placeholder="${t('notePh')}"></div>
      <div class="preview" id="af-preview"></div>`;
    openModal({
      title: ex ? t('editAsset') : t('addAsset'),
      body,
      footer: `${ex ? `<span class="foot-meta">${t('createdAt')} ${fullTime(ex.createdAt)}</span>` : ''}<button class="btn btn-glass" data-modal-close>${t('cancel')}</button><button class="btn btn-accent" id="af-save">${ic('check')}${t('save')}</button>`,
      onMount(m) {
        // balMode：手动维护的非现金资产可选“按余额填写”（新建默认按余额；已有资产保持原方式）
        const st = { cls: f.cls.slice(), ccy: isStd ? aCcy(f) : 'OTHER', source: f.source || 'online', touched: !!ex, balMode: ex ? !!ex.balMode : true };
        const readForm = () => {
          const ccy = st.ccy === 'OTHER' ? ($('#af-ccy-other', m).value.trim().toUpperCase() || 'USD') : st.ccy;
          return {
            cls: st.cls.slice(), name: $('#af-name', m).value.trim(), code: $('#af-code', m).value.trim().toUpperCase(),
            ccy, qty: parseNum($('#af-qty', m).value), cost: parseNum($('#af-cost', m).value), price: parseNum($('#af-price', m).value),
            unit: unitKey($('#af-unit', m).value), source: st.source, note: $('#af-note', m).value.trim(), warehouse: $('#af-wh', m).value.trim(),
            balMode: st.source === 'manual' && st.balMode && !st.cls.some(c => c === 'cash' || c === 'liability')
          };
        };
        const drawCls = () => {
          $$('#af-cls button', m).forEach(b => {
            const i = st.cls.indexOf(b.dataset.v);
            b.classList.toggle('on', i >= 0);
            b.querySelector('em').textContent = i === 0 && st.cls.length > 1 ? t('primary') : '';
          });
        };
        const sync = () => {
          const a = readForm(), bal = isBalance(a), tagBal = hasBalTag(a);
          $$('.hide-bal', m).forEach(el => { el.style.display = bal ? 'none' : ''; });
          // 来源：含现金 / 负债类别时固定手动；按余额填写的其他资产仍可切回“在线”
          $('#af-src-wrap', m).style.display = tagBal ? 'none' : '';
          const showMode = !tagBal && st.source === 'manual';
          $('#af-mode-wrap', m).style.display = showMode ? '' : 'none';
          $$('#af-mode button', m).forEach(x => x.classList.toggle('on', x.dataset.v === (a.balMode ? 'bal' : 'qty')));
          $('#af-mode-hint', m).textContent = a.balMode ? t('fillBalHint') : t('fillQtyHint');
          const showUnit = !bal;   // 所有非现金类资产都可以填计量单位（选填）
          $('#af-unit-wrap', m).style.display = showUnit ? '' : 'none';
          $('#af-cost-wrap', m).style.gridColumn = showUnit ? '1 / -1' : '';
          $('#af-code-wrap', m).style.display = bal ? 'none' : '';
          $('#af-qty-l', m).innerHTML = bal ? t('cashBalance') : `${t('colQty')} <span class="dim">· ${t('codeOpt')}</span>`;
          $('#af-qty', m).placeholder = bal ? '0.00' : t('qtyPh');
          const p = a.cls[0];
          const pk = CLASSES.includes(p) ? p : 'other';
          $('#af-name', m).placeholder = t('namePh_' + pk);
          $('#af-code', m).placeholder = t('codePh_' + pk);
          $('#af-cls-hint', m).textContent = a.cls.filter(c => CLASSES.includes(c)).map(c => t('clsHint_' + c)).join(' ');
          $('#af-fetch', m).disabled = !Api.canQuote(a);
          preview();
        };
        const preview = () => {
          const a = readForm(), ccy = a.ccy, bal = isBalance(a);
          const q = isNaN(a.qty) ? 0 : a.qty, p = bal ? 1 : (isNaN(a.price) ? 0 : a.price), c = bal ? 1 : (isNaN(a.cost) ? 0 : a.cost);
          const qq = a.cls.includes('liability') && q > 0 ? -q : q;
          const v = qq * p, cost = qq * c, pnl = v - cost, showD = ccy !== S().ccy;
          $('#af-preview', m).innerHTML = `<div><div class="l">${t('colValue')}</div><div class="v num ${v < 0 ? 'down' : ''}">${money(v, { ccy, max: 8, raw: true })}${showD ? `<small>≈ ${money(conv(v, ccy), { raw: true })}</small>` : ''}</div></div>
            <div><div class="l">${t('colPnl')}</div><div class="v num ${bal ? 'dim' : upDown(pnl)}">${bal ? '—' : money(pnl, { ccy, sign: true, max: 8, raw: true })}${!bal && cost ? `<small>${pct((pnl / Math.abs(cost)) * 100)}</small>` : ''}</div></div>`;
        };
        const msg = (s, cls) => { const el = $('#af-msg', m); el.className = 'fetch-msg ' + (cls || ''); el.textContent = s; };
        const setCcy = c => {
          st.ccy = c;
          $$('#af-ccy button', m).forEach(x => x.classList.toggle('on', x.dataset.v === c));
          $('#af-ccy-other', m).style.display = c === 'OTHER' ? '' : 'none';
          if (c === 'OTHER') $('#af-ccy-other', m).focus();
          preview();
        };
        $('#af-cls', m).addEventListener('click', e => {
          const b = e.target.closest('[data-v]'); if (!b) return;
          const c = b.dataset.v, i = st.cls.indexOf(c);
          if (!st.touched) { st.cls = [c]; st.touched = true; }          // 新建时第一次点选直接替换默认类别
          else if (i >= 0) { if (st.cls.length > 1) st.cls.splice(i, 1); } else st.cls.push(c);
          drawCls();
          if (!ex) {
            const a = readForm();
            if (st.cls.length === 1 && (c === 'crypto' || c === 'gold')) setCcy('USD');
            st.source = isBalance(a) ? 'manual' : 'online';
            $$('#af-src button', m).forEach(x => x.classList.toggle('on', x.dataset.v === st.source));
          }
          msg(''); sync();
        });
        $('#af-ccy', m).addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) setCcy(b.dataset.v); });
        const whSync = () => { const v = $('#af-wh', m).value.trim(); $$('#af-wh-chips button', m).forEach(b => b.classList.toggle('on', b.dataset.v === v)); };
        $('#af-wh-chips', m).addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; const w = $('#af-wh', m); w.value = w.value.trim() === b.dataset.v ? '' : b.dataset.v; whSync(); });
        $('#af-wh', m).addEventListener('input', whSync);
        $('#af-src', m).addEventListener('click', e => {
          const b = e.target.closest('[data-v]'); if (!b) return;
          st.source = b.dataset.v; $$('#af-src button', m).forEach(x => x.classList.toggle('on', x === b));
          sync();
        });
        // 切换填写方式时换算输入框：数量×单价 → 余额（市值），余额 → 1 份 × 单价
        $('#af-mode', m).addEventListener('click', e => {
          const b = e.target.closest('[data-v]'); if (!b) return;
          const toBal = b.dataset.v === 'bal'; if (toBal === st.balMode) return;
          const q = parseNum($('#af-qty', m).value), p = parseNum($('#af-price', m).value);
          if (toBal) { const v = !isNaN(p) && p > 0 ? (isNaN(q) ? 1 : q) * p : q; $('#af-qty', m).value = isNaN(v) ? '' : trim8(round8(v)); }
          else if (!isNaN(q)) { $('#af-price', m).value = trim8(q); $('#af-cost', m).value = $('#af-cost', m).value || trim8(q); $('#af-qty', m).value = ''; }
          st.balMode = toBal; sync();
        });
        ['#af-qty', '#af-cost', '#af-price', '#af-ccy-other'].forEach(s => $(s, m).addEventListener('input', preview));
        $('#af-code', m).addEventListener('input', sync);
        $('#af-unit', m).addEventListener('input', preview);
        $('#af-fetch', m).addEventListener('click', async () => {
          const a = readForm();
          if (!a.code) { msg(t('errNeedCode'), 'err'); $('#af-code', m).focus(); return; }
          const btn = $('#af-fetch', m);
          btn.disabled = true; btn.classList.add('spin'); msg(t('fetching'));
          try {
            const q = await Api.quoteAsset(a, S());
            const p = conv(q.price, q.ccy, a.ccy);
            $('#af-price', m).value = trim8(p);
            msg(`✓ ${t('fetched')} ${a.code} = ${money(p, { ccy: a.ccy, max: 8, raw: true })} · ${timeStr(Date.now())}${q.asStock ? ' · ' + t('stockHint') : ''}`, 'ok');
            preview();
          } catch (e) { msg(errText(e), 'err'); }
          btn.disabled = false; btn.classList.remove('spin');
        });
        sync();
        setTimeout(() => $('#af-name', m).focus(), 60);
        $('#af-save', m).addEventListener('click', () => {
          const a = readForm(), bal = isBalance(a);
          if (!a.name && !a.code) { toast(t('errNeedName'), 'err'); $('#af-name', m).focus(); return; }
          if (!a.name) a.name = a.code;
          // 数量选填：现金类不填 = 0；其他资产不填 = 按 1 份计（单价就是总市值），列表里数量显示 —
          const qtyRaw = $('#af-qty', m).value.trim();
          a.noQty = false;
          if (!qtyRaw) { if (bal) a.qty = 0; else { a.qty = 1; a.noQty = true; } }
          else if (isNaN(a.qty)) { toast(t('errQty'), 'err'); $('#af-qty', m).focus(); return; }
          if (!validCcy(a.ccy)) { toast(t('errRate', { c: a.ccy }), 'err'); return; }
          if (bal) {
            a.cost = 1; a.price = 1; a.source = 'manual'; a.noQty = false;
            if (!a.balMode) a.code = '';
            if (a.cls.includes('liability') && a.qty > 0) a.qty = -a.qty;     // 负债自动记为负数
          } else {
            if (isNaN(a.cost)) a.cost = 0;
            if (isNaN(a.price)) a.price = 0;
            if (!a.price && a.cost) a.price = a.cost;
            if (!Api.canQuote(a)) a.source = 'manual';
            if (a.cls.includes('liability') && a.qty > 0) a.qty = -a.qty;
          }
          if (bal) a.unit = '';
          if (ex) {
            if (ex.price !== a.price) a.updatedAt = Date.now();
            if (ex.code !== a.code || ex.unit !== a.unit) { a.prevClose = 0; a.prevDay = ''; }
            const d = diffOf(ex, a, ASSET_FIELDS);
            Object.assign(ex, a);
            if (d.length) logOp('asset', ex, 'edit', d);
            // 今天才录入的手动资产：今天的编辑都算“录入设置”，不计入今日盈亏
            if (canResetDay(ex) && ymd(new Date(ex.createdAt || 0)) === todayKey()) rebaseDay(ex);
          } else {
            const na = Object.assign({ id: uid(), createdAt: Date.now(), updatedAt: Date.now() }, a);
            DB.assets.push(na);
            logOp('asset', na, 'create', ASSET_FIELDS.filter(f => !['locked'].includes(f) && na[f] !== '' && na[f] != null).map(f => [f, '', na[f]]));
          }
          commit(); closeModal(); renderAll();
          toast(ex ? t('saved') : t('assetAdded', { n: a.name }), 'ok');
          const target = ex || DB.assets[DB.assets.length - 1];
          if (target.source === 'online') refreshOne(target);
        });
      }
    });
  }
  /** 清理粘贴进来的 API Key：去掉空格、换行、引号、零宽字符和全角字符（只保留英文字母、数字和 - _） */
  const cleanKey = v => String(v || '').normalize('NFKC').replace(/^(token|apikey|api_key|key)\s*[:=]\s*/i, '').replace(/[^A-Za-z0-9_\-]/g, '');
  /** 行情 / 汇率报错 → 当前语言的说明（不直接显示接口返回的英文原文） */
  function errText(e) {
    const m = String((e && e.message) || ''), code = (m.match(/HTTP (\d{3})/) || [])[1];
    if (m === 'NO_KEY') return t('errNoKey');
    if (m === 'MANUAL') return t('errManual');
    if (m === 'NEED_CODE') return t('errNeedCode');
    if (m === 'CRYPTO_NOT_FOUND') return t('errCryptoNF');
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return t('errFetch') + ' · ' + t('errNetwork');
    if (/^Timeout$/i.test(m)) return t('errFetch') + ' · ' + t('errTimeout');
    if (code === '401' || /Invalid API key|apikey.*invalid/i.test(m)) return t('errKey401');
    if (code === '429' || /limit|frequency|per minute|per day/i.test(m)) return t('errKey429');
    if (code === '403' || /access|premium|subscription/i.test(m)) return t('errKey403');
    if (/No data|Not found|symbol|doesn't exist|does not exist|invalid/i.test(m) || code === '404' || code === '400') return t('errNoQuote');
    return t('errFetch') + (code ? ' · HTTP ' + code : '');
  }

  /* ---- 操作记录展示 ---- */
  const fullTime = ts => (ts ? new Date(ts).toLocaleString(locale(), { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');
  function fmtField(f, v, kind) {
    if (kind === 'sub') {
      if (f === 'expire' && (v === '' || v == null)) return esc(t('subForever'));
      if (v === '' || v == null) return '<span class="dim">∅</span>';
      if (f === 'cat') return esc(subCatName(v));
      if (f === 'prices') return esc(Array.isArray(v) ? v.map(x => `${x.from} ${trim8(x.p)}`).join('；') : String(v));
      if (f === 'adj') return esc(t('subBillAdjN', { n: v }));
      if (f === 'account') { const a = String(v); return esc(a.length > 4 ? a.slice(0, 2) + '•••' + a.slice(-2) : '•••'); }   // 记录里不显示完整账号
      if (f === 'cycle') return esc(t('cyc_' + v));
      if (f === 'cycleU') return esc(t('unitD_' + v));
      if (f === 'payId') { const a = findAsset(v); return esc(a ? a.name : t('deletedAccount')); }
      if (f === 'remind') return esc(+v ? t('subRemindS', { n: v }) : t('subRemind0'));
      if (f === 'icon') return esc(v ? t('subIconSet') : '∅');
      if (f === 'trialDays') return esc(v + ' ' + t('unitD_day'));
      if (f === 'locked') return v ? t('lockYes') : t('lockNo');
      if (typeof v === 'number') return hidden() && ['price', 'nextPrice'].includes(f) ? MASK : fmtNum(v, 0, 8);
      return esc(String(v));
    }
    if (v === '' || v == null) return '<span class="dim">∅</span>';
    if (f === 'cls') return esc((Array.isArray(v) ? v : [v]).map(c => clsName(c)).join(' · '));
    if (f === 'subId') { const sb = findSub(v); return esc(sb ? sb.name : t('subDeleted')); }
    if (f === 'accountId' || f === 'toId' || f === 'feeId') { const a = findAsset(v); return esc(a ? a.name : t('deletedAccount')); }
    if (f === 'cat') return esc(catName(v));
    if (f === 'type') return esc(t(v));
    if (f === 'source') return esc(v === 'online' ? t('srcOnline') : t('srcManual'));
    if (f === 'balMode') return v ? t('fillBal') : t('fillQty');
    if (f === 'locked') return v ? t('lockYes') : t('lockNo');
    if (f === 'unit') return esc(t('unit_' + v));
    if (typeof v === 'number') return hidden() && ['qty', 'cost', 'price', 'amount', 'toAmount', 'fee'].includes(f) ? MASK : fmtNum(v, 0, 8);
    return esc(String(v));
  }
  function logEntryHTML(e, kind, withName) {
    const k = kind || e.kind;
    const diffs = (e.diffs || []).map(([f, a, b]) => `<div class="lg-d"><span class="lg-f">${t((k === 'sub' && I18N.zh['fldS_' + f] ? 'fldS_' : 'fld_') + f)}</span>${e.act === 'create' ? '' : `${fmtField(f, a, k)} <i>→</i> `}${fmtField(f, b, k)}</div>`).join('');
    let extra = '';
    if (e.extra) {
      if (e.extra.tx) extra += `<div class="lg-d dim">${t('viaTx')}: ${esc(e.extra.tx)}</div>`;
      if (e.extra.from != null) extra += `<div class="lg-d">${t('fld_value')}: ${money(e.extra.from, { ccy: e.extra.ccy, max: 8 })} <i>→</i> ${money(e.extra.to, { ccy: e.extra.ccy, max: 8 })}</div>`;
      if (e.extra.at) extra += `<div class="lg-d dim">${t('updAtLog', { d: e.extra.at })}</div>`;
      if (e.extra.value != null && e.act === 'delete') extra += `<div class="lg-d dim">${t('fld_value')}: ${money(e.extra.value, { ccy: e.extra.ccy, max: 8 })}</div>`;
      if (e.extra.file) extra += `<div class="lg-d dim">${esc(e.extra.file)}</div>`;
    }
    return `<div class="lg-item act-${e.act}"><div class="lg-h"><span class="lg-act">${t('act_' + e.act)}</span>${withName && e.name ? `<span class="lg-name">${t('kind_' + k)} · ${esc(e.name)}</span>` : ''}<span class="lg-ts num">${fullTime(e.ts)}</span></div>${diffs}${extra}</div>`;
  }
  function openHistory(kind, id) {
    const rec = kind === 'asset' ? findAsset(id) : kind === 'sub' ? findSub(id) : DB.txs.find(x => x.id === id);
    if (!rec) return;
    const log = (rec.log || []).slice().reverse();
    const lastEdit = log.find(e => e.act !== 'create');
    const head = `<div class="hist-meta"><div><span class="dim">${t('createdAt')}</span><b class="num">${fullTime(rec.createdAt)}</b></div>
      <div><span class="dim">${t('lastEdited')}</span><b class="num">${lastEdit ? fullTime(lastEdit.ts) : '—'}</b></div>
      <div><span class="dim">${t('logCount')}</span><b class="num">${log.length}</b></div></div>`;
    openModal({
      title: `${ic('clock')} ${t('history')} · ${esc(kind === 'tx' ? recTitle('tx', rec) : rec.name)}`,
      body: head + (log.length ? `<div class="lg-list">${log.map(e => logEntryHTML(e, kind)).join('')}</div>` : `<div class="empty sm"><p>${t('noLog')}</p></div>`)
    });
  }

  /* ---- 日期选择器（日 / 月 / 年） ---- */
  let popEl = null, popOutside = null;
  function closePopover() {
    if (popEl) { popEl.remove(); popEl = null; }
    if (popOutside) { document.removeEventListener('pointerdown', popOutside, true); popOutside = null; }
  }
  function openDatePicker(anchor) {
    if (popEl) { closePopover(); return; }
    const L = UI.led, mode = L.mode, tk = todayKey();
    let [y, mo] = L.date.split('-').map(Number);
    const hasDay = new Set(DB.txs.map(x => x.date)), hasM = new Set(DB.txs.map(x => x.date.slice(0, 7))), hasY = new Set(DB.txs.map(x => x.date.slice(0, 4)));
    const pop = document.createElement('div');
    pop.className = 'popover' + (mode === 'day' ? ' wide' : '');
    const draw = () => {
      let head, grid;
      if (mode === 'day') {
        head = zh() ? `${y} 年 ${mo} 月` : `${t('mon' + (mo - 1))} ${y}`;
        const first = new Date(y, mo - 1, 1), lead = (first.getDay() + 6) % 7, dim = new Date(y, mo, 0).getDate();
        let cells = Array.from({ length: 7 }, (_, i) => `<span class="wd">${t('wd' + i)}</span>`).join('');
        for (let i = 0; i < lead; i++) cells += '<span></span>';
        for (let d = 1; d <= dim; d++) {
          const k = `${y}-${pad(mo)}-${pad(d)}`;
          cells += `<button data-mp="pick" data-k="${k}" class="${k === L.date ? 'on' : ''} ${k === tk ? 'cur' : ''} ${hasDay.has(k) ? 'has' : ''} ${k > tk ? 'future' : ''}">${d}</button>`;
        }
        grid = `<div class="mp-grid days">${cells}</div>`;
      } else if (mode === 'month') {
        head = zh() ? `${y} 年` : String(y);
        grid = `<div class="mp-grid">${Array.from({ length: 12 }, (_, i) => {
          const k = `${y}-${pad(i + 1)}`;
          return `<button data-mp="pick" data-k="${k}-01" class="${k === L.date.slice(0, 7) ? 'on' : ''} ${k === tk.slice(0, 7) ? 'cur' : ''} ${hasM.has(k) ? 'has' : ''} ${k > tk.slice(0, 7) ? 'future' : ''}">${t('mon' + i)}</button>`;
        }).join('')}</div>`;
      } else {
        const start = y - 7;
        head = `${start} – ${start + 11}`;
        grid = `<div class="mp-grid">${Array.from({ length: 12 }, (_, i) => {
          const k = String(start + i);
          return `<button data-mp="pick" data-k="${k}-01-01" class="${k === L.date.slice(0, 4) ? 'on' : ''} ${k === tk.slice(0, 4) ? 'cur' : ''} ${hasY.has(k) ? 'has' : ''} ${k > tk.slice(0, 4) ? 'future' : ''}">${k}</button>`;
        }).join('')}</div>`;
      }
      pop.innerHTML = `<div class="mp-head"><button class="icon-btn sm" data-mp="prev">${ic('chev-l')}</button><b class="num">${head}</b><button class="icon-btn sm" data-mp="next">${ic('chev-r')}</button></div>
        ${grid}<div class="mp-foot"><span class="hint">${t('mpHint')}</span><button class="link" data-mp="today">${t('per_' + mode + 'Now')}</button></div>`;
    };
    draw();
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect(), w = pop.offsetWidth;
    pop.style.left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12)) + window.scrollX + 'px';
    pop.style.top = r.bottom + 8 + window.scrollY + 'px';
    pop.addEventListener('click', e => {
      const b = e.target.closest('[data-mp]'); if (!b) return;
      const a = b.dataset.mp;
      const step = mode === 'day' ? 1 : mode === 'month' ? 1 : 12;
      if (a === 'prev' || a === 'next') {
        const d = a === 'prev' ? -step : step;
        if (mode === 'day') { mo += d; if (mo < 1) { mo = 12; y--; } if (mo > 12) { mo = 1; y++; } } else y += d;
        draw(); return;
      }
      L.date = a === 'today' ? tk : b.dataset.k;
      if (L.mode !== 'day' && a === 'pick') {
        // 月 / 年模式：若选中的周期包含今天，锚点日期用今天，便于“日统计”
        if ((L.mode === 'month' && tk.startsWith(L.date.slice(0, 7))) || (L.mode === 'year' && tk.startsWith(L.date.slice(0, 4)))) L.date = tk;
      }
      L.sel.clear(); closePopover(); renderLedger();
    });
    popEl = pop;
    popOutside = e => { if (!pop.contains(e.target) && !anchor.contains(e.target)) closePopover(); };
    document.addEventListener('pointerdown', popOutside, true);
  }

  /* ============ 6. 行情、汇率、数据管理 ============ */
  function setBusy(b) { UI.busy = b; $$('[data-action="refresh"]').forEach(x => x.classList.toggle('spin', b)); }
  async function refreshRates(silent) {
    try {
      const r = await Api.fetchRates(S().fxSrc);
      DB.rates = { rates: Object.assign({}, FALLBACK_RATES, r.rates), ts: Date.now(), src: r.src };
      save();
      return true;
    } catch (e) { if (!silent) toast(t('fxFail'), 'err'); return false; }
  }
  async function quoteInto(a) {
    const q = await Api.quoteAsset(a, S());
    const p = conv(q.price, q.ccy, aCcy(a));
    if (!(p > 0)) throw new Error('Bad price');
    a.price = round8(p); a.updatedAt = Date.now(); a.lastErr = '';
    // 美股盘前 / 盘后成交价：只做参考显示（市值、日盈亏仍按收盘价）
    if (q.ext && q.ext.p > 0) a.ext = { p: round8(conv(q.ext.p, q.ccy, aCcy(a))), k: q.ext.k, t: q.ext.t || '', at: Date.now() }; else delete a.ext;
    if (q.prev > 0) { a.prevClose = round8(conv(q.prev, q.ccy, aCcy(a))); a.prevDay = todayKey(); a.prevRaw = +q.prev; a.realPrev = !!q.realPrev; }   // prevRaw：接口原始昨收（不受汇率影响），用来判断是不是新的一场交易
  }
  async function refreshOne(a) {
    try { await quoteInto(a); save(); renderAll(); }
    catch (e) { a.lastErr = (e && e.message) || 'error'; save(); if (UI.page === 'holdings') renderHoldBody(); }
  }
  async function refreshQuotes(opt) {
    opt = opt || {};
    if (UI.busy) return;
    setBusy(true);
    const fxOk = await refreshRates(true);
    const online = DB.assets.filter(a => a.source === 'online' && Api.canQuote(a));
    const res = await Promise.allSettled(online.map(quoteInto));
    let ok = 0, fail = 0, noKey = false;
    res.forEach((r, i) => {
      if (r.status === 'fulfilled') ok++;
      else { fail++; online[i].lastErr = (r.reason && r.reason.message) || 'error'; if (r.reason && r.reason.message === 'NO_KEY') noKey = true; }
    });
    DB.lastQuote = Date.now();
    save(); setBusy(false); renderAll();
    if (opt.silent && !fail) return;
    if (opt.silent && fail === online.length && !fxOk) return;   // 离线时静默，不打扰
    if (!online.length) toast(fxOk ? t('noOnline') : t('fxFail'), fxOk ? '' : 'err');
    else toast(t('quotesOk', { ok }) + (fail ? t('quotesFail', { f: fail }) : '') + (noKey ? ' · ' + t('errNoKeyShort') : '') + (fxOk ? '' : ' · ' + t('fxFail')), fail ? 'err' : 'ok');
  }
  let autoTimer = null;
  function setupAutoRefresh() {
    clearInterval(autoTimer);
    const n = +S().autoRefresh;
    if (n > 0) autoTimer = setInterval(() => { if (!document.hidden) refreshQuotes({ silent: true }); }, n * 60000);
  }

  /** cloud=true：上传到云端（已加密），附带行情 API Key；导出文件（明文）不含任何 Key */
  function exportable(cloud) {
    const d = JSON.parse(JSON.stringify(DB));
    SECRET_KEYS.forEach(k => { d.settings[k] = ''; });
    if (cloud) { d.apiKeys = { at: S().keysAt || 0 }; API_KEYS.forEach(k => { d.apiKeys[k] = S()[k] || ''; }); }
    d.exportedAt = new Date().toISOString();
    return d;
  }
  function restoreFrom(obj) {
    const secrets = {};
    SECRET_KEYS.forEach(k => { secrets[k] = S()[k]; });
    const keep = { gistId: S().gistId };
    DB = migrate(obj);
    SECRET_KEYS.forEach(k => { if (!DB.settings[k]) DB.settings[k] = secrets[k]; });
    if (!DB.settings.gistId) DB.settings.gistId = keep.gistId;
    save();
  }
  const validData = o => o && typeof o === 'object' && Array.isArray(o.assets) && Array.isArray(o.txs);
  function doExport() {
    const name = bookName().replace(/[\\/:*?"<>|]+/g, '_');
    const blob = new Blob([JSON.stringify(exportable(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const now = new Date(), hms = [now.getHours(), now.getMinutes(), now.getSeconds()].map(n => String(n).padStart(2, '0')).join('-');
    a.download = `${name}-${todayKey()}_${hms}.json`;   // 例：Jasper's AssetHub-2026-10-08_03-08-12.json
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(t('exported'), 'ok');
  }
  function doImport(file) {
    const rd = new FileReader();
    rd.onload = async () => {
      let obj;
      try { obj = JSON.parse(rd.result); } catch (e) { toast(t('importBad'), 'err'); return; }
      if (!validData(obj)) { toast(t('importBad'), 'err'); return; }
      const ok = await confirmDialog({ title: t('importT'), msg: t('importM', { n: esc(file.name), a: obj.assets.length, x: obj.txs.length }), ok: t('import'), danger: false });
      if (!ok) return;
      backupNow('import'); restoreFrom(obj); logOp('system', null, 'import', null, { file: file.name }); markDirty(); save(); scheduleSync(); setupAutoRefresh(); renderAll(); toast(t('importOk'), 'ok');
    };
    rd.readAsText(file);
  }
  function pickIcon(file) {
    const rd = new FileReader();
    rd.onload = () => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'), N = 128;
        c.width = c.height = N;
        const g = c.getContext('2d'), s = Math.min(img.width, img.height) || N;
        g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, N, N);
        DB.meta.icon = c.toDataURL('image/png');
        commit(); renderAll(); toast(t('saved'), 'ok');
      };
      img.onerror = () => toast(t('importBad'), 'err');
      img.src = rd.result;
    };
    rd.readAsDataURL(file);
  }

  /* ---- 演示数据（含两年每日快照，K 线和盈亏都有数据） ---- */
  function buildDemo() {
    const N = (a, b) => (zh() ? a : b);
    const now = new Date(), ts = Date.now(), born = ts - 800 * 864e5;
    const A = o => Object.assign({ id: uid(), note: '', unit: '', warehouse: '', source: 'online', createdAt: born, updatedAt: ts, log: [{ ts: born, act: 'create' }] }, o);
    const assets = [
      A({ cls: ['stock'], name: N('苹果', 'Apple'), code: 'AAPL', qty: 15, cost: 182.5, price: 236.42, ccy: 'USD', warehouse: N('富途证券', 'Futu') }),
      A({ cls: ['stock'], name: N('英伟达', 'NVIDIA'), code: 'NVDA', qty: 30, cost: 115, price: 181.25, ccy: 'USD', warehouse: N('盈透证券 IB', 'Interactive Brokers') }),
      A({ cls: ['stock'], name: N('特斯拉', 'Tesla'), code: 'TSLA', qty: 8, cost: 289.4, price: 262.9, ccy: 'USD', warehouse: N('富途证券', 'Futu') }),
      A({ cls: ['stock'], name: N('腾讯控股', 'Tencent'), code: '0700.HK', qty: 100, cost: 380, price: 612.5, ccy: 'HKD', source: 'manual', warehouse: N('富途证券', 'Futu'), note: N('港股手动维护', 'HK stock, manual') }),
      A({ cls: ['crypto'], name: N('比特币', 'Bitcoin'), code: 'BTC', qty: 0.25634821, cost: 58000, price: 112350.5, ccy: 'USD', warehouse: 'Bitget Wallet' }),
      A({ cls: ['crypto'], name: N('以太坊', 'Ethereum'), code: 'ETH', qty: 2.5, cost: 2450, price: 4120.55, ccy: 'USD', warehouse: 'Binance' }),
      A({ cls: ['crypto'], name: 'Solana', code: 'SOL', qty: 18.5, cost: 142.3, price: 205.12, ccy: 'USD', warehouse: 'OKX' }),
      A({ cls: ['fund'], name: N('标普500 ETF', 'S&P 500 ETF'), code: 'VOO', qty: 12, cost: 455, price: 548.3, ccy: 'USD', warehouse: N('嘉信 Schwab', 'Charles Schwab') }),
      A({ cls: ['gold', 'fund'], name: N('黄金 ETF', 'Gold ETF'), code: 'GLD', qty: 10, cost: 215, price: 312.4, ccy: 'USD', warehouse: N('嘉信 Schwab', 'Charles Schwab'), note: N('黄金基金', 'Gold fund') }),
      A({ cls: ['gold', 'physical'], name: N('实物黄金', 'Physical Gold'), code: 'XAU', qty: 100, cost: 72.5, price: 108.6, ccy: 'USD', unit: 'g', warehouse: N('银行保管箱', 'Bank safe box'), note: N('100 克金条', '100g bar'), locked: true }),
      A({ cls: ['cash'], name: N('招商银行储蓄卡', 'CMB Savings'), qty: 86000, cost: 1, price: 1, ccy: 'CNY', source: 'manual', warehouse: N('招商银行卡', 'CMB card') }),
      A({ cls: ['cash'], name: N('Chase 支票账户', 'Chase Checking'), qty: 12500, cost: 1, price: 1, ccy: 'USD', source: 'manual', warehouse: 'Chase' }),
      A({ cls: ['cash'], name: N('钱包现金', 'Wallet Cash'), qty: 15000, cost: 1, price: 1, ccy: 'TWD', source: 'manual', note: N('新台币纸币', 'NT$ notes') }),
      A({ cls: ['liability'], name: N('信用卡待还', 'Credit card balance'), qty: -2860.35, cost: 1, price: 1, ccy: 'USD', source: 'manual', warehouse: 'Chase' }),
      A({ cls: ['physical', 'other'], name: N('劳力士手表', 'Rolex watch'), qty: 1, cost: 9800, price: 11200, ccy: 'USD', unit: 'pc', source: 'manual', warehouse: N('家中保险柜', 'Home safe') })
    ];
    const cmb = assets[10].id, chase = assets[11].id, wallet = assets[12].id, card = assets[13].id;
    let seed = 20261007;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const gauss = () => (rnd() + rnd() + rnd() - 1.5) * 1.15;
    const R = (a, b) => Math.round((a + rnd() * (b - a)) * 100) / 100;

    // —— 每日价格路径（布朗桥：从成本价附近走到当前价）——
    const DAYS = 730, vol = { stock: 0.017, crypto: 0.034, fund: 0.008, gold: 0.008, physical: 0.006, other: 0.002 };
    const paths = {};
    assets.forEach(a => {
      if (isBalance(a)) return;
      const v = vol[a.cls[0]] || 0.01, w = [0];
      for (let i = 1; i <= DAYS; i++) w.push(w[i - 1] + gauss() * v);
      const l0 = Math.log(Math.max(+a.cost || a.price, 1e-6) * 0.92), l1 = Math.log(a.price);
      paths[a.id] = w.map((x, i) => Math.exp(l0 + ((l1 - l0) * i) / DAYS + x - (w[DAYS] * i) / DAYS));
      paths[a.id][DAYS] = a.price;
    });
    const cashUSD = assets.filter(isBalance).reduce((s, a) => s + conv(aVal(a), aCcy(a), 'USD'), 0);
    const snaps = {};
    let prevC = null;
    const keys = [];
    for (let i = 0; i <= DAYS; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (DAYS - i)), k = ymd(d);
      let net = cashUSD - (DAYS - i) * 3.2;     // 现金随时间缓慢增长
      const p = {};
      assets.forEach(a => { if (paths[a.id]) { p[a.id] = round8(paths[a.id][i]); net += conv(a.qty * paths[a.id][i], aCcy(a), 'USD'); } });
      const o = prevC == null ? net : prevC;
      const h = Math.max(o, net) * (1 + rnd() * 0.006), l = Math.min(o, net) * (1 - rnd() * 0.006);
      snaps[k] = { o, h, l, c: net, p };
      keys.push(k); prevC = net;
    }
    // 只保留近 60 天和月末的价格明细
    const cut = ymd(new Date(ts - 60 * 864e5));
    keys.forEach((k, i) => { const nx = keys[i + 1]; if (k < cut && nx && nx.slice(0, 7) === k.slice(0, 7)) delete snaps[k].p; });
    // 昨收价（用于当日盈亏）
    assets.forEach(a => { if (paths[a.id]) { a.prevClose = round8(paths[a.id][DAYS - 1]); a.prevDay = todayKey(); } });

    // —— 记账 ——
    const txs = [];
    const push = (d, type, cat, amount, ccy, acc, note) => txs.push({ id: uid(), date: ymd(d), type, cat, amount: round8(amount), ccy, accountId: acc, note, applied: false, appliedDelta: 0, createdAt: ts - txs.length });
    const foods = N(['午餐', '咖啡', '晚餐', '早餐', '外卖', '奶茶'], ['Lunch', 'Coffee', 'Dinner', 'Breakfast', 'Takeout', 'Bubble tea']);
    for (let m = 14; m >= 0; m--) {
      const first = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const dim = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      const last = m === 0 ? now.getDate() : dim;
      const D = d => new Date(first.getFullYear(), first.getMonth(), d);
      push(D(1), 'expense', 'housing', 1650, 'USD', chase, N('房租', 'Rent'));
      if (last >= 3) push(D(3), 'expense', 'subscription', 19.99, 'USD', card, 'ChatGPT / Claude');
      if (last >= 3) push(D(3), 'expense', 'subscription', 390, 'TWD', wallet, 'Netflix');
      if (last >= 5) push(D(5), 'income', 'salary', 6800, 'USD', chase, N('月度工资', 'Monthly salary'));
      if (last >= 12) push(D(12), 'expense', 'housing', R(90, 160), 'USD', chase, N('水电燃气', 'Utilities'));
      if (last >= 15 && m % 3 === 0) push(D(15), 'income', 'invest', R(300, 520), 'USD', chase, N('股票分红', 'Dividends'));
      if (last >= 16 && m % 4 === 2) push(D(16), 'expense', 'investLoss', R(200, 650), 'USD', '', N('期权到期归零', 'Options expired'));
      if (last >= 20 && m % 2 === 0) push(D(20), 'income', 'parttime', R(2000, 4200), 'CNY', cmb, N('设计外包', 'Freelance design'));
      if (last >= 18 && m % 4 === 1) push(D(18), 'expense', 'digital', R(899, 1499), 'USD', card, N('数码设备', 'Gadgets'));
      if (last >= 9 && m % 5 === 2) push(D(9), 'expense', 'social', 600, 'CNY', cmb, N('朋友婚礼红包', 'Wedding gift'));
      if (last >= 22 && m % 6 === 3) push(D(22), 'expense', 'leisure', 12800, 'JPY', card, N('东京旅行', 'Tokyo trip'));
      // 转账：每月 10 日用支票账户还信用卡；偶尔从招行卡换汇转入支票账户
      if (last >= 10) { const amt = R(1200, 2000); txs.push({ id: uid(), date: ymd(D(10)), type: 'transfer', cat: 'transfer', amount: amt, ccy: 'USD', accountId: chase, toId: card, toAmount: amt, toCcy: 'USD', note: N('信用卡还款', 'Card repayment'), applied: false, createdAt: ts - txs.length }); }
      if (last >= 21 && m % 4 === 0) txs.push({ id: uid(), date: ymd(D(21)), type: 'transfer', cat: 'transfer', amount: 20000, ccy: 'CNY', accountId: cmb, toId: chase, toAmount: 2795.4, toCcy: 'USD', fee: 50, note: N('换汇转入', 'FX transfer'), applied: false, createdAt: ts - txs.length });
      if (last >= 25 && m % 6 === 0) push(D(25), 'income', 'bonus', R(1500, 3000), 'USD', chase, N('季度奖金', 'Quarterly bonus'));
      for (let d = 1; d <= last; d++) {
        if (rnd() < 0.9) push(D(d), 'expense', 'food', R(8, 42), 'USD', card, foods[Math.floor(rnd() * foods.length)]);
        if (rnd() < 0.4) push(D(d), 'expense', 'transport', R(3, 24), 'USD', chase, N('地铁 / 打车', 'Metro / taxi'));
        if (rnd() < 0.14) push(D(d), 'expense', 'daily', R(15, 85), 'USD', card, N('超市采购', 'Groceries'));
        if (rnd() < 0.07) push(D(d), 'expense', 'leisure', R(20, 140), 'USD', card, N('电影 / 游戏', 'Movies / games'));
        if (rnd() < 0.05) push(D(d), 'expense', 'food', R(300, 900), 'TWD', wallet, N('夜市小吃', 'Night market'));
        if (rnd() < 0.025) push(D(d), 'expense', 'medical', R(30, 220), 'USD', chase, N('药房', 'Pharmacy'));
        if (rnd() < 0.02) push(D(d), 'income', 'refund', R(20, 120), 'USD', chase, N('网购退款', 'Online refund'));
      }
    }
    // 演示订阅：开始时间在过去，按周期推算出历史账单；其中一个 2 天后到期（演示到期提醒），一个在试用期
    const tk = todayKey(), soon = addDate(tk, 2, 'day');
    const mkSub = (name, cat, price, ccy, cycle, start, payId, extra) => {
      const sb = Object.assign({ id: uid(), createdAt: ts - 1000, name, cat, price, ccy, cycle, cycleN: 1, cycleU: 'month', start, trialDays: 0, expire: '', payId, remind: 3, nextPrice: null, note: '', locked: false, icon: '' }, extra || {});
      if (!sb.expire && cycle !== 'once') sb.expire = nextBill(billStart(sb), sb, tk);
      return sb;
    };
    const subs = [
      // 开始日错开，扣费分散在每个月的不同日子
      mkSub('ChatGPT Plus', 'ai', 20, 'USD', 'month', addDate(addDate(tk, -19, 'month'), -6, 'day'), chase, { alias: 'OpenAI', account: 'jasper@example.com', site: 'https://chatgpt.com/' }),
      mkSub('Claude Pro', 'ai', 20, 'USD', 'month', addDate(soon, -8, 'month'), chase, { expire: soon, alias: 'Anthropic', account: 'jasper@example.com', site: 'https://claude.ai/settings/billing' }),
      mkSub(N('Vultr 云服务器', 'Vultr VPS'), 'vps', 6, 'USD', 'month', addDate(addDate(tk, -23, 'month'), -17, 'day'), chase, { note: N('东京 1C1G', 'Tokyo 1C1G'), alias: 'Tokyo', site: 'https://my.vultr.com/billing/' }),
      mkSub(N('搬瓦工 VPS', 'BandwagonHost VPS'), 'vps', 49.99, 'USD', 'year', addDate(addDate(tk, -16, 'month'), 9, 'day'), chase, { remind: 7 }),
      mkSub('jasper.dev', 'domain', 12.98, 'USD', 'year', addDate(addDate(tk, -32, 'month'), -3, 'day'), chase, { remind: 7 }),
      mkSub('Netflix', 'media', 15.49, 'USD', 'month', addDate(addDate(tk, -14, 'month'), -9, 'day'), chase, { nextPrice: 17.99, alias: N('标准方案', 'Standard'), account: 'family@example.com', site: 'https://www.netflix.com/account' }),
      mkSub('YouTube Premium', 'media', 129.99, 'TRY', 'month', addDate(addDate(tk, -7, 'month'), -12, 'day'), chase, { alias: N('土耳其区', 'Turkey'), site: 'https://www.youtube.com/paid_memberships' }),
      (() => {
        const st0 = addDate(addDate(tk, -31, 'month'), -2, 'day'), sb = mkSub('Spotify Premium', 'media', 11.99, 'USD', 'month', st0, chase, { alias: N('个人版', 'Individual'), site: 'https://www.spotify.com/account/' });
        sb.prices = [{ from: st0, p: 9.99 }, { from: addDate(st0, 14, 'month'), p: 10.99 }, { from: addDate(st0, 25, 'month'), p: 11.99 }];
        sb.adj = { [addDate(st0, 0, 'month')]: { t: 'free', n: N('新用户免费', 'Free trial month') }, [addDate(st0, 1, 'month')]: { t: 'custom', amt: 0.99, n: N('首三月促销', 'Intro promo') }, [addDate(st0, 2, 'month')]: { t: 'custom', amt: 0.99, n: N('首三月促销', 'Intro promo') }, [addDate(st0, 20, 'month')]: { t: 'custom', amt: 5.99, n: N('黑五五折', 'Black Friday') } };
        return sb;
      })(),
      mkSub(N('iCloud+ 200GB', 'iCloud+ 200GB'), 'cloud', 21, 'CNY', 'month', addDate(addDate(tk, -26, 'month'), -1, 'day'), cmb, { remind: 0 }),
      mkSub('Final Cut Pro', 'software', 299.99, 'USD', 'once', addDate(tk, -20, 'month'), chase, { alias: 'Apple', remind: 0 }),
      mkSub('Notion Plus', 'software', 96, 'USD', 'year', addDate(tk, -4, 'day'), chase, { trialDays: 14 }),
      mkSub(N('1Password 家庭版', '1Password Families'), N('密码管理', 'Passwords'), 59.88, 'USD', 'year', addDate(tk, -9, 'month'), chase, { remind: 7 })
    ];
    return { assets, txs, snaps, subs };
  }
  /** 首次打开（没有任何数据）或仍在使用旧版演示数据时，自动填充演示数据 */
  function autoDemo() {
    if (DB.meta.noDemo) return false;
    const isOldDemo = DB.meta.demo === true && /Jasper's Asset(View|Hub)/.test(DB.meta.name || '') && Object.keys(DB.snaps).length < 30;   // 只替换旧版演示数据，绝不动真实数据
    if (DB.meta.demo === true && !(DB.subs || []).length && DB.assets.length) { DB.subs = buildDemo().subs; save(); }   // 旧版演示账本补上演示订阅
    if ((DB.assets.length || DB.txs.length) && !isOldDemo) return false;
    const d = buildDemo();
    DB.assets = d.assets; DB.txs = d.txs; DB.snaps = d.snaps; DB.subs = d.subs;
    DB.meta.name = DB.meta.name || t('demoBookName'); DB.meta.demo = true;
    save();
    return true;
  }
  async function loadDemo() {
    if (DB.assets.length || DB.txs.length) {
      if (!(await confirmDialog({ title: t('demoT'), msg: t('demoM'), ok: t('loadDemo') }))) return;
      backupNow('demo');
    }
    const d = buildDemo();
    DB.assets = d.assets; DB.txs = d.txs; DB.snaps = d.snaps; DB.subs = d.subs;
    if (!DB.meta.name) DB.meta.name = t('demoBookName');
    DB.meta.demo = true;
    logOp('system', null, 'demo');
    UI.hold.sel.clear(); UI.led.sel.clear(); UI.sub.sel.clear();
    commit(); renderAll(); toast(t('demoLoaded'), 'ok');
    refreshQuotes({ silent: true });
  }

  /* ---- 批量操作 ---- */
  async function batchDelete(kind) {
    const st = selState(kind), ids = Array.from(st.sel);
    if (!ids.length) return;
    if (kind === 'sub') {
      const locked = ids.some(id => (findSub(id) || {}).locked);
      if (!(await confirmDialog({ title: t('batchDelT', { n: ids.length }), msg: t('subBatchDelM') + (locked ? ' ' + t('hasLocked') : ''), ok: t('del') }))) return;
      if (!(await requireUnlock(locked ? t('verifyLockedMsg') : null, locked))) return;
      DB.subs.filter(x => st.sel.has(x.id)).forEach(x => logOp('sub', x, 'delete', null, { value: subTotal(x), ccy: S().ccy, batch: true }));
      DB.subs = DB.subs.filter(x => !st.sel.has(x.id));
    } else if (kind === 'hold') {
      const locked = ids.some(id => (findAsset(id) || {}).locked);
      if (!(await confirmDialog({ title: t('batchDelT', { n: ids.length }), msg: t('batchDelAssetM') + (locked ? ' ' + t('hasLocked') : ''), ok: t('del') }))) return;
      if (!(await requireUnlock(locked ? t('verifyLockedMsg') : t('verifyAssetMsg'), locked))) return;
      DB.assets.filter(a => st.sel.has(a.id)).forEach(a => logOp('asset', a, 'delete', null, { value: aVal(a), ccy: aCcy(a), batch: true }));
      DB.assets = DB.assets.filter(a => !st.sel.has(a.id));
    } else {
      if (!(await confirmDialog({ title: t('batchDelT', { n: ids.length }), msg: t('batchDelTxM'), ok: t('del') }))) return;
      if (!(await requireUnlock())) return;
      const bal0 = balSnapshot();
      DB.txs.filter(x => st.sel.has(x.id)).forEach(x => { applyTx(x, -1); subRevert(x); logOp('tx', x, 'delete', null, { batch: true }); });
      logBalChanges(bal0, null, 'batchDelete');
      DB.txs = DB.txs.filter(x => !st.sel.has(x.id));
    }
    st.sel.clear();
    commit(); renderAll(); toast(t('deletedN', { n: ids.length }), 'ok');
  }

  /* ============ 7. 事件 ============ */
  const actions = {
    nav(el) { UI.page = el.dataset.page; renderNav(); renderPage(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
    lang(el) { S().lang = el.dataset.v; save(); renderAll(); },
    ccy(el) { S().ccy = el.dataset.v; save(); renderAll(); toast(t('ccySwitched', { c: t('ccy_' + el.dataset.v) })); },
    layout(el) { S().layout = el.dataset.v; save(); renderAll(); window.scrollTo({ top: 0 }); },
    refresh() { refreshQuotes(); },
    'toggle-hide'() { S().hideAmt = !S().hideAmt; save(); renderAll(); toast(S().hideAmt ? t('amtHidden') : t('amtShown')); },
    'add-tx'() { openTxModal(); },
    'add-transfer'() { openTxModal(null, 'transfer'); },
    async 'edit-tx'(el) {
      const x = DB.txs.find(v => v.id === el.dataset.id); if (!x) return;
      if (!(await requireUnlock())) return;
      openTxModal(x);
    },
    async 'del-tx'(el) {
      const x = DB.txs.find(v => v.id === el.dataset.id); if (!x) return;
      if (!(await requireUnlock())) return;
      if (!(await confirmDialog({ title: t('delTxT'), msg: t('delTxM', { a: x.fromUnit ? '⇄ ' + qtyTxt(x.amount, x.fromUnit) : txAmt(x, x.ccy, x.amount, 8), c: catName(x.cat) }), ok: t('del') }))) return;
      const bal0 = balSnapshot();
      applyTx(x, -1);
      subRevert(x);
      logOp('tx', x, 'delete');
      logBalChanges(bal0, x, 'delete');
      DB.txs = DB.txs.filter(v => v !== x);
      commit(); renderAll(); toast(t('deleted'), 'ok');
    },
    'add-asset'() { openAssetModal(); },
    'add-sub'() { openSubModal(); },
    cols(el) { openColsModal(el.dataset.v); },
    'sub-cats'() { openCatMgr(); },
    'asset-cats'() { openAssetMgr(); },
    async 'edit-sub'(el) {
      const s = findSub(el.dataset.id); if (!s) return;
      if (!(await requireUnlock(s.locked ? t('verifyLockedMsg') : t('verifySubMsg'), s.locked))) return;
      openSubModal(s.id);
    },
    'del-sub'(el) { const s = findSub(el.dataset.id); if (s) deleteSub(s); },
    async 'sub-price'(el) {
      const s = findSub(el.dataset.id); if (!s) return;
      if (s.locked && !(await requireUnlock(t('verifyLockedMsg'), true))) return;
      openSubPrice(s);
    },
    'sub-period'(el) { UI.sub.period = el.dataset.v; renderSubs(); },
    async 'sub-bills'(el) {
      const s = findSub(el.dataset.id); if (!s) return;
      if (s.locked && !(await requireUnlock(t('verifyLockedMsg'), true))) return;
      openSubBills(s);
    },
    'sub-info'(el) { const s = findSub(el.dataset.id); if (s) openSubInfo(el, s, el.dataset.k); },
    'sub-cat'(el) { UI.sub.cat = UI.sub.cat === el.dataset.v && el.classList.contains('legend-row') ? 'all' : el.dataset.v; renderSubs(); },
    'sub-pmode'(el) { UI.sub.pmode = el.dataset.v; renderSubs(); },
    async 'dfix-restore'() {
      if (!(await confirmDialog({ title: t('dfixRestoreT'), msg: t('dfixRestoreM'), ok: t('dfixRestore'), danger: false }))) return;
      const n = restoreDayRecords(); commit(); renderAll(); toast(t('dfixRestoredT', { n }), 'ok');
    },
    'sub-view'() { UI.sub.view = UI.sub.view === 'archived' ? 'active' : 'archived'; UI.sub.cat = 'all'; UI.sub.sel.clear(); renderSubs(); },
    'sub-archive'(el) { const s = findSub(el.dataset.id); if (s) setArchived([s], true); },
    'sub-unarchive'(el) { const s = findSub(el.dataset.id); if (s) setArchived([s], false); },
    async 'sub-arch-all'() {
      const list = DB.subs.filter(canArchive); if (!list.length) return;
      if (!(await confirmDialog({ title: t('subArchAllT'), msg: t('subArchAllM', { n: list.length, l: list.slice(0, 8).map(s => esc(s.name)).join('、') + (list.length > 8 ? '…' : '') }), ok: t('subArchive'), danger: false }))) return;
      setArchived(list, true);
    },
    'batch-arch'() { setArchived(DB.subs.filter(s => UI.sub.sel.has(s.id)), true); },
    'batch-unarch'() { setArchived(DB.subs.filter(s => UI.sub.sel.has(s.id)), false); },
    'sub-batch'() { UI.sub.batch = !UI.sub.batch; UI.sub.sel.clear(); renderSubs(); },
    'sub-sort-head'(el) {
      const k = el.dataset.v, U = UI.sub;
      U.sort = k === 'expire' ? (U.sort === 'expireAsc' ? 'expireDesc' : 'expireAsc') : (U.sort === k + 'Desc' ? k + 'Asc' : k + 'Desc');
      const sel = $('[data-change="subSort"]'); if (sel) sel.value = U.sort;
      renderSubBody();
    },
    'sub-renew'(el) { const s = findSub(el.dataset.id); if (s) openTxModal(null, 'expense', s.id); },
    'sub-remind-x'(el) { const s = findSub(el.dataset.id); if (!s) return; S().subSeen = Object.assign({}, S().subSeen, { [s.id]: todayKey() + '|' + s.expire }); save(); checkSubReminders(); },
    async 'edit-asset'(el) {
      const a = findAsset(el.dataset.id); if (!a) return;
      if (!(await requireUnlock(a.locked ? t('verifyLockedMsg') : t('verifyAssetMsg'), a.locked))) return;
      openAssetModal(a.id);
    },
    async 'del-asset'(el) {
      const a = findAsset(el.dataset.id); if (!a) return;
      if (!(await requireUnlock(a.locked ? t('verifyLockedMsg') : t('verifyAssetMsg'), a.locked))) return;
      if (!(await confirmDialog({ title: t('delAssetT'), msg: t('delAssetM', { n: esc(a.name) }), ok: t('del') }))) return;
      logOp('asset', a, 'delete', null, { value: aVal(a), ccy: aCcy(a) });
      DB.assets = DB.assets.filter(v => v !== a);
      UI.hold.sel.delete(a.id);
      commit(); renderAll(); toast(t('deleted'), 'ok');
    },
    range(el) { S().chartRange = el.dataset.v; save(); drawTrend(); },
    'trend-mode'(el) { S().trendMode = el.dataset.v; save(); $$('[data-action="trend-mode"]').forEach(b => b.classList.toggle('on', b === el)); drawTrend(); },
    'asset-range'(el) { S().assetRange = el.dataset.v; UI.kEnd = 0; save(); drawTrend(); },
    'k-span'(el) { S().kSpan = el.dataset.v; UI.kEnd = 0; save(); drawTrend(); },
    'k-style'(el) { S().kStyle = el.dataset.v; save(); drawTrend(); },
    /** 立即同步这一项资产的行情（只更新它自己的单价 / 市值） */
    async 'sync-one'(el) {
      const a = findAsset(el.dataset.id); if (!a || el.classList.contains('spin')) return;
      el.classList.add('spin'); el.disabled = true;
      try {
        await refreshRates(true);
        await quoteInto(a); save(); renderAll();
        toast(t('syncOneDone', { n: esc(a.name), p: money(conv(+a.price || 0, aCcy(a)), { max: 8 }) }), 'ok');
      } catch (e) {
        a.lastErr = (e && e.message) || 'error'; save(); renderHoldBody();
        toast(`${esc(a.name)} · ${errText(e)}`, 'err');
      }
    },
    'hold-filter'(el) { UI.hold.cls = el.dataset.v; $$('[data-action="hold-filter"]').forEach(b => b.classList.toggle('on', b === el)); renderHoldBody(); },
    'hold-sort-head'(el) {
      const k = el.dataset.v, H = UI.hold;
      H.sort = H.sort === k + 'Desc' ? k + 'Asc' : k + 'Desc';
      const sel = $('[data-change="holdSort"]'); if (sel) sel.value = H.sort;
      renderHoldBody();
    },
    'hold-batch'() { UI.hold.batch = !UI.hold.batch; UI.hold.sel.clear(); renderHoldings(); },
    'led-batch'() { UI.led.batch = !UI.led.batch; UI.led.sel.clear(); renderLedger(); },
    'sel-all'(el) {
      const st = selState(el.dataset.kind);
      el.dataset.ids.split(',').filter(Boolean).forEach(id => st.sel.add(id));
      selRender(el.dataset.kind);
    },
    'sel-none'(el) { selState(el.dataset.kind).sel.clear(); selRender(el.dataset.kind); },
    'batch-del'(el) { batchDelete(el.dataset.kind); },
    async 'batch-lock'(el) {
      const kind = el.dataset.kind || 'hold', st = selState(kind), ids = Array.from(st.sel); if (!ids.length) return;
      if (!S().passHash && !(await setPasswordFlow())) return;
      (kind === 'sub' ? DB.subs : DB.assets).forEach(a => { if (st.sel.has(a.id) && !a.locked) { a.locked = true; logOp(kind === 'sub' ? 'sub' : 'asset', a, 'lock'); } });
      commit(); selRender(kind); toast(t('lockedN', { n: ids.length }), 'ok');
    },
    async 'batch-unlock'(el) {
      const kind = el.dataset.kind || 'hold', st = selState(kind), ids = Array.from(st.sel); if (!ids.length) return;
      if (!(await requireUnlock(t('verifyLockedMsg'), true))) return;
      (kind === 'sub' ? DB.subs : DB.assets).forEach(a => { if (st.sel.has(a.id) && a.locked) { a.locked = false; logOp(kind === 'sub' ? 'sub' : 'asset', a, 'unlock'); } });
      commit(); selRender(kind); toast(t('unlockedN', { n: ids.length }), 'ok');
    },
    'led-mode'(el) { UI.led.mode = el.dataset.v; UI.led.sel.clear(); renderLedger(); },
    'tx-type'(el) { UI.led.type = el.dataset.v; renderLedger(); },
    'date-picker'(el) { openDatePicker(el); },
    'rank-menu'(el) { openRankMenu(el); },
    'rank-cal'() { openRankCal(); },
    'kpi-cal'(el) { openKpiCal(el.dataset.k); },
    'kpi-live'(el) { UI.kd = UI.kd || {}; UI.kd[el.dataset.k] = ''; refreshKpis(); },
    'rank-today'() { UI.rankDay = ''; renderMoves(); },
    'rank-mode'(el) { S().rankMode = el.dataset.v; save(); $$('[data-action="rank-mode"]').forEach(b => b.classList.toggle('on', b === el)); renderMoves(); },
    'sort-toggle'(el) {
      const k = el.dataset.key; S()[k] = S()[k] === 'asc' ? 'desc' : 'asc'; save();
      if (k === 'moveSort') { $('#sort-moveSort').innerHTML = sortBtnHTML(k); renderMoves(); } else renderLeft();
    },
    'alloc-sort'() {
      S().allocSort = S().allocSort === 'asc' ? 'desc' : 'asc'; save(); renderLeft();
    },
    'left-mode'(el) { S().leftMode = el.dataset.v; save(); $$('[data-action="left-mode"]').forEach(b => b.classList.toggle('on', b === el)); renderLeft(); },
    async 'lock-toggle'() {
      if (Date.now() < UI.unlockUntil) { UI.unlockUntil = 0; refreshLockBtn(); toast(t('lockedNow')); return; }
      if (await requireUnlock(UI.page === 'holdings' ? t('verifyAssetMsg') : null)) { refreshLockBtn(); toast(t('unlockedToast'), 'ok'); }
    },
    recover() { openRecovery(); },
    'alloc-drill'(el) { openAllocCls(el.dataset.v); },
    'alloc-back'() { closeAllocCls(); },
    'flip-year'() {
      const el = $('#year-flip'); if (!el) return;
      el.classList.add('flip-out');
      setTimeout(() => {
        UI.yearFace = (UI.yearFace || 'year') === 'year' ? 'total' : 'year';
        const cur = $('#year-flip'); if (cur) cur.outerHTML = yearFlipHTML('flip-in');
      }, 180);
    },
    'flip-fund'() {
      const el = $('#fund-flip'); if (!el) return;
      el.classList.add('flip-out');
      setTimeout(() => {
        UI.fundFace = (UI.fundFace || 'cash') === 'cash' ? 'fund' : 'cash';
        const cur = $('#fund-flip'); if (cur) cur.outerHTML = fundFlipHTML('flip-in');
      }, 180);
    },
    'toggle-total'() { S().hideTotal = !S().hideTotal; save(); renderKPIs(); },
    'toggle-gistid'(el) {
      UI.showGistId = !UI.showGistId;
      const inp = $('[data-set="gistId"]'); if (inp) inp.type = UI.showGistId ? 'text' : 'password';
      el.innerHTML = ic(UI.showGistId ? 'eyeoff' : 'eye');
    },
    async 'reset-day'(el) {
      const a = findAsset(el.dataset.id); if (!a) return;
      const d = dayChange(a);
      if (!(await confirmDialog({ title: t('resetDayT', { n: esc(a.name) }), msg: t('resetDayM', { v: money(d.ch, { sign: true }) }), ok: t('resetDay'), danger: false }))) return;
      if (!(await requireUnlock(null, !!a.locked))) return;
      rebaseDay(a);
      logOp('asset', a, 'resetDay', [['dayPnl', round8(d.ch), 0]]);
      commit(); renderAll(); toast(t('resetDayDone'), 'ok');
    },
    'trim-snaps'() { trimSnapsFlow(); },
    'set-pass'() { setPasswordFlow().then(ok => { if (ok) renderPage(); }); },
    'lock-now'() { UI.unlockUntil = 0; renderPage(); toast(t('lockedNow')); },
    export() { doExport(); },
    import() { $('#file-import').click(); },
    demo() { loadDemo(); },
    async clear() {
      if (!(await confirmDialog({ title: t('clearT'), msg: t('clearM'), ok: t('clearAll') }))) return;
      blankBook(); save(); setupAutoRefresh(); renderAll(); toast(t('cleared'), 'ok');
    },
    /** 新建空白账本：清空数据（不加载演示）并新建一个 Gist；原 Gist 保留不动 */
    async 'new-book'(el) {
      const cloud = !!S().gistToken;
      if (!(await confirmDialog({ title: t('newBookT'), msg: cloud ? t('newBookM') : t('newBookMLocal'), ok: t('newBook'), danger: false }))) return;
      blankBook();
      if (cloud) {
        el.disabled = true; el.classList.add('spin');
        try { markDirty(); await pushCloud(true); SYNC.state = 'ok'; SYNC.lastErr = ''; save(); toast(t('gistNewDone', { id: S().gistId }), 'ok'); }
        catch (e) { save(); toast(t('syncFail') + ' · ' + syncErrText(e), 'err'); }
      } else { save(); toast(t('newBookDone'), 'ok'); }
      setupAutoRefresh(); renderAll();
    },
    'pick-icon'() { $('#file-icon').click(); },
    'logo-style'(el) { DB.meta.logo = el.dataset.v; commit(); renderAll(); },
    async 'pwa-install'() {
      if (!PWA.prompt) return;
      PWA.prompt.prompt();
      try { const r = await PWA.prompt.userChoice; if (r && r.outcome === 'accepted') toast(t('pwaDone')); } catch (e) {}
      PWA.prompt = null; if (UI.page === 'settings') renderPage();
    },
    'remove-icon'() { DB.meta.icon = ''; commit(); renderAll(); },
    'pnl-cycle'() {
      const ks = Object.keys(PNL_STYLES), i = ks.indexOf(S().pnlStyle);
      S().pnlStyle = ks[(i + 1) % ks.length]; save(); renderAll();
      toast(t('pnlCycle') + ' · ' + t('pnl_' + S().pnlStyle));
    },
    'pnl-style'(el) { S().pnlStyle = el.dataset.v; save(); renderAll(); },
    'pnl-swap'(el) { S().pnlSwap = el.dataset.v === '1'; save(); renderAll(); },
    async 'update-fx'(el) {
      el.classList.add('spin'); el.disabled = true;
      const ok = await refreshRates();
      renderAll(); if (ok) toast(t('fxUpdated'), 'ok');
    },
    async 'test-api'(el) {
      const out = $('#test-out'); el.disabled = true; el.classList.add('spin');
      out.innerHTML = `<div><span>${t('testing')}</span></div>`;
      const row = (name, p) => p.then(v => `<div><span>${name}</span><b class="up">✓ ${v}</b></div>`).catch(e => `<div><span>${name}</span><b class="down">✗ ${esc(errText(e))}</b></div>`);
      const rows = await Promise.all([
        row(t('fxSrc'), Api.fetchRates(S().fxSrc).then(r => `1 USD = ${fmtNum(r.rates.CNY, 4, 4)} CNY`)),
        row('BTC/USDT', Api.cryptoPriceUSD('BTC', S().cryptoSrc).then(v => '$' + fmtNum(v, 2, 2))),
        row(t('goldSrc') + ' (CNY)', Api.goldQuote('CNY', S()).then(q => `${q.ccy === 'CNY' ? '¥' : q.ccy + ' '}${fmtNum(q.price / Api.OZ_G, 2, 2)} / g · ${fmtNum(q.price, 2, 2)} / oz`)),
        row('AAPL', Api.stockQuote('AAPL', S()).then(v => '$' + fmtNum(v.price, 2, 2)))
      ]);
      out.innerHTML = rows.join('');
      el.disabled = false; el.classList.remove('spin');
    },
    history(el) { openHistory(el.dataset.kind, el.dataset.id); },
    'log-filter'(el) { UI.logKind = el.dataset.v; UI.logN = 50; renderPage(); },
    'log-more'() { UI.logN = (UI.logN || 50) + 100; renderPage(); },
    async 'update-val'(el) {
      const a = findAsset(el.dataset.id); if (!a) return;
      if (!(await requireUnlock(a.locked ? t('verifyLockedMsg') : t('verifyAssetMsg'), a.locked))) return;
      const bal = isBalance(a), ccy = aCcy(a), cur = aVal(a);
      const raw = await promptDialog({
        icon: 'refresh', title: `${bal ? t('updBal') : t('updVal')} · ${esc(a.name)}`,
        msg: t(bal ? 'updBalMsg' : 'updValMsg', { c: ccy }),
        value: trim8(cur), placeholder: '0.00',
        hint: bal ? '' : t('updValHint', { cost: money(aCost(a), { ccy, raw: true }) }),
        date: todayKey(), dateMin: [addDate(todayKey(), -59, 'day'), ymd(new Date(a.createdAt || 0))].sort().pop()
      });
      if (raw == null) return;
      const at = raw.d && raw.d < todayKey() ? raw.d : '';
      let v = parseNum(raw.v);
      if (isNaN(v) || (!bal && v < 0)) { toast(t('errAmount'), 'err'); return; }
      const before = { qty: a.qty, price: a.price, cost: a.cost };
      if (bal) { if (hasTag(a, 'liability') && v > 0) v = -v; a.qty = v; }
      else {
        const q = +a.qty || 0;
        if (!q) { a.qty = 1; a.cost = a.cost || v; }
        a.price = round8(v / (+a.qty || 1));
        a.updatedAt = Date.now();
      }
      const d = diffOf(before, a, ['qty', 'price', 'cost']);
      if (at) backdateVal(a, before, at);
      if (d.length) logOp('asset', a, bal ? 'updBal' : 'updVal', d, Object.assign({ from: cur, to: aVal(a), ccy }, at ? { at } : {}));
      commit(); renderAll();
      const diff = aVal(a) - cur;
      toast(`${t('saved')} · ${money(aVal(a), { ccy, raw: true })} (${money(diff, { ccy, sign: true, raw: true })})`, 'ok');
    },
    'sync-now'() { clearTimeout(SYNC.timer); syncNow(); },
    async 'gist-push'(el) {
      if (!S().gistToken) { toast(t('gistNeedToken'), 'err'); return; }
      el.disabled = true; el.classList.add('spin');
      try {
        if (DB.meta.demo && !(await confirmDialog({ title: t('demoPushT'), msg: t('demoPushM'), ok: t('gistPush') }))) { el.disabled = false; el.classList.remove('spin'); return; }
        if (!DB.meta.updatedAt) markDirty();
        await pushCloud(true); save(); renderPage(); renderSyncBtn(); toast(t('gistPushed'), 'ok');
      } catch (e) { if (e.message !== 'CANCEL') toast(t('syncFail') + ' · ' + syncErrText(e), 'err'); }
      el.disabled = false; el.classList.remove('spin');
    },
    /** 云端 Gist 出问题（持续 5xx 等）时：新建一个 Gist 重新上传本机数据 */
    async 'gist-new'(el) {
      if (!S().gistToken) { toast(t('gistNeedToken'), 'err'); return; }
      const demo = !!DB.meta.demo;
      if (!(await confirmDialog({ title: t('gistNewT'), msg: demo ? t('gistNewDemoM') : t('gistNewM'), ok: t('gistNew'), danger: false }))) return;
      if (demo) blankBook();   // 演示数据不上传：新 Gist 从空白账本开始
      el.disabled = true; el.classList.add('spin');
      const oldId = S().gistId;
      try {
        S().gistId = ''; if (!DB.meta.updatedAt) markDirty();
        await pushCloud(true); SYNC.state = 'ok'; SYNC.lastErr = ''; save(); renderAll();
        toast(t('gistNewDone', { id: S().gistId }), 'ok');
      } catch (e) { S().gistId = oldId; toast(t('syncFail') + ' · ' + syncErrText(e), 'err'); el.disabled = false; el.classList.remove('spin'); }
    },
    async 'gist-pull'(el) {
      if (!S().gistId) { toast(t('gistNeedId'), 'err'); return; }
      if (!(await confirmDialog({ title: t('gistPullT'), msg: t('gistPullM'), ok: t('gistPull'), danger: false }))) return;
      el.disabled = true; el.classList.add('spin');
      try {
        const obj = await decodeCloud(await Api.gistPull(S().gistToken, S().gistId), { interactive: true });
        if (!validData(obj)) throw new Error('BAD_DATA');
        applyCloud(obj); S().gistLast = Date.now(); save(); renderAll(); toast(t('gistPulled'), 'ok');
      } catch (e) { toast(t('syncFail') + ' · ' + syncErrText(e), 'err'); el.disabled = false; el.classList.remove('spin'); }
    }
  };

  function bindEvents() {
    document.addEventListener('pointerdown', e => { const h = e.target.closest('.col-rs'); if (h) startColResize(e, h); }, true);
    document.addEventListener('click', e => {
      if (e.target.closest('.col-rs') || Date.now() - (UI.colDragAt || 0) < 250) { if (e.target.closest('thead')) { e.preventDefault(); return; } }   // 拖动列宽时不触发表头排序
      if (e.target.closest('[data-modal-close]')) { closeModal(); return; }
      const el = e.target.closest('[data-action]');
      if (!el || el.disabled) return;
      const fn = actions[el.dataset.action];
      if (fn) { e.preventDefault(); fn(el, e); }
    });
    document.addEventListener('change', e => {
      const el = e.target, c = el.dataset.change;
      // 勾选框（批量）
      if (el.dataset.sel) {
        const st = selState(el.dataset.sel);
        el.checked ? st.sel.add(el.value) : st.sel.delete(el.value);
        selRender(el.dataset.sel);
        return;
      }
      if (el.dataset.selAll) {
        const kind = el.dataset.selAll, st = selState(kind);
        selIds(kind).forEach(id => (el.checked ? st.sel.add(id) : st.sel.delete(id)));
        selRender(kind);
        return;
      }
      if (c === 'subSort') { UI.sub.sort = el.value; renderSubBody(); return; }
      if (c === 'subStep') { S().subStep = el.value; save(); drawSubCharts(allSubPays()); return; }
      if (c === 'ccy') { S().ccy = el.value; save(); renderAll(); return; }
      if (c === 'yStep') { S().yStep = el.value; save(); drawTrend(); return; }
      if (c === 'rankCls') { S().rankCls = el.value; save(); renderRank(); return; }
      if (c === 'holdSort') { UI.hold.sort = el.value; renderHoldBody(); return; }
      if (c === 'pnlUp' || c === 'pnlDown') { S()[c] = el.value; S().pnlStyle = 'custom'; save(); applyTheme(); renderAll(); return; }
      if (c === 'holdWh') { UI.hold.wh = el.value; renderHoldBody(); $$('[data-change="holdWh"]').forEach(x => { x.value = el.value; }); return; }
      if (c === 'holdSrc') { UI.hold.src = el.value; renderHoldBody(); $$('[data-change="holdSrc"]').forEach(x => { x.value = el.value; }); return; }
      if (c === 'ledCat') { UI.led.cat = el.value; renderLedBody(); return; }
      if (c === 'ledAcct') { UI.led.acct = el.value; renderLedBody(); return; }
      if (c === 'ledSort') { UI.led.sort = el.value; renderLedBody(); return; }
      if (el.dataset.set) {
        const k = el.dataset.set;
        const old = S()[k];
        S()[k] = el.type === 'checkbox' ? el.checked : (k === 'autoRefresh' || k === 'lockMinutes') ? +el.value : k === 'gistId' ? Api.gistIdOf(el.value) : k === 'gistToken' ? Api.cleanToken(el.value) : /Key$/.test(k) ? cleanKey(el.value) : el.value.trim();
        if (k === 'gistId' || k === 'gistToken' || /Key$/.test(k)) el.value = S()[k];
        if (old === S()[k]) return;                                // 值没变（例如失焦时重复触发）就什么都不做
        if (k === 'gistId') {                                    // 换了 Gist 视为全新同步
          // 本机数据已全部同步到旧 Gist（没有未上传的改动）或只是演示数据：直接改用新 Gist 的数据，不弹“两边都有修改”
          S().switchPull = (DB.meta.updatedAt || 0) <= (S().syncedStamp || 0) || !!DB.meta.demo;
          S().syncedStamp = 0;
        }
        if (API_KEYS.includes(k)) { S().keysAt = Date.now(); markDirty(); scheduleSync(); }   // 行情 Key 改动同步到其他设备                 // 换了 Gist 视为全新同步
        save();
        if (k === 'gistToken' || k === 'gistId' || k === 'autoSync') { renderSyncBtn(); if (S().autoSync && syncReady()) syncNow({ silent: true, interactive: true }); }
        if (k === 'autoRefresh') setupAutoRefresh();
        if (k === 'stockSrc' || k === 'fxSrc') renderPage();
        toast(t('saved'), 'ok');
      }
    });
    let metaTimer, qTimer;
    document.addEventListener('input', e => {
      const el = e.target;
      if (el.dataset.input === 'holdQ') { UI.hold.q = el.value; clearTimeout(qTimer); qTimer = setTimeout(renderHoldBody, 120); return; }
      if (el.dataset.input === 'subQ') { UI.sub.q = el.value; clearTimeout(qTimer); qTimer = setTimeout(renderSubBody, 120); return; }
      if (el.dataset.input === 'ledQ') { UI.led.q = el.value; clearTimeout(qTimer); qTimer = setTimeout(renderLedBody, 120); return; }
      if (el.dataset.meta) {
        DB.meta[el.dataset.meta] = el.value;
        clearTimeout(metaTimer);
        metaTimer = setTimeout(() => {
          commit();
          $('#brand-sub').textContent = DB.meta.subtitle;
          renderFoot();
          document.title = DB.meta.name ? `${DB.meta.name} · AssetHub` : 'AssetHub';
        }, 250);
      }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closePopover(); if (!$('#dialog-root').classList.contains('open')) closeModal(); }
    });
    $('#file-import').addEventListener('change', e => { const f = e.target.files[0]; if (f) doImport(f); e.target.value = ''; });
    $('#file-icon').addEventListener('change', e => { const f = e.target.files[0]; if (f) pickIcon(f); e.target.value = ''; });
    let rz;
    window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { closePopover(); if (UI.page === 'overview') drawTrend(); }, 150); });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && S().autoSync && syncReady() && Date.now() - SYNC.lastCheck > 30000) syncNow({ silent: true });
      if (!document.hidden && Date.now() - DB.lastQuote > 10 * 60000 && DB.assets.some(a => a.source === 'online')) refreshQuotes({ silent: true });
    });
  }

  /* ============ 启动 ============ */
  const demoNow = autoDemo();
  pruneSnaps();
  if (!S().dfix) { const n = fixDayRecords(true); S().dfix = n ? 'v73' : 'none'; save(); if (n) setTimeout(() => toast(t('dfixDone', { n })), 1500); }

  renderAll();
  if (demoNow) setTimeout(() => toast(t('demoAuto')), 600);
  // 升级前就填过行情 Key 的设备：标记一次，让 Key 同步到其他设备
  if (!S().keysAt && API_KEYS.some(k => S()[k])) { S().keysAt = 1; save(); }   // 很小的时间戳：只补给没有 Key 的设备，不覆盖别处的新 Key
  if (S().autoSync && syncReady()) setTimeout(() => syncNow({ silent: true }), 400);   // 打开页面先拉取云端最新数据
  // 新版本检查：GitHub Pages 会让浏览器缓存页面约 10 分钟，这里绕过缓存读取 version.json，有新版就提示一键更新
  async function checkUpdate() {
    if (!/^https?:/.test(location.protocol)) return;
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      const v = String((await r.json()).v || '');
      if (v && v !== APP_VER && !document.getElementById('upd-bar')) {
        const bar = document.createElement('div');
        bar.id = 'upd-bar'; bar.className = 'upd-bar';
        bar.innerHTML = `<span>${t('newVer', { v: esc(v) })}</span><button class="btn btn-accent sm">${ic('refresh')}${t('newVerBtn')}</button>`;
        bar.querySelector('button').addEventListener('click', async () => { try { const rg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (rg) await rg.update(); } catch (e) {} location.replace(location.pathname + '?v=' + encodeURIComponent(v) + location.hash); });
        document.body.appendChild(bar);
      }
    } catch (e) { /* 离线或本地文件打开时忽略 */ }
  }
  // PWA：注册 Service Worker（仅 https / localhost），并接住浏览器的安装提示
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); PWA.prompt = e; if (UI.page === 'settings') renderPage(); });
  window.addEventListener('appinstalled', () => { PWA.prompt = null; toast(t('pwaDone')); if (UI.page === 'settings') renderPage(); });
  setTimeout(checkSubReminders, 1200);   // 订阅快到期提醒（右下角）
  setTimeout(checkUpdate, 1500);
  setInterval(checkUpdate, 10 * 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkUpdate(); checkSubReminders(); } });
  bindEvents();
  setupAutoRefresh();
  (async () => {
    if (Date.now() - DB.rates.ts > 3600e3) { if (await refreshRates(true)) renderAll(); }
    if (DB.assets.some(a => a.source === 'online') && Date.now() - DB.lastQuote > 5 * 60000) refreshQuotes({ silent: true });
  })();

  window.AssetHub = { get db() { return DB; }, refresh: refreshQuotes, render: renderAll };
})();
