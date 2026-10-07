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
  const DISPLAY_CCYS = ['USD', 'CNY', 'HKD', 'TWD'];
  const CCY_SYM = { USD: '$', CNY: '¥', HKD: 'HK$', TWD: 'NT$', EUR: '€', JPY: 'JP¥', GBP: '£', KRW: '₩' };
  const CCY_SHORT = { USD: 'USD', CNY: 'CNY', HKD: 'HKD', TWD: 'NTD' };
  const FALLBACK_RATES = { USD: 1, CNY: 7.12, HKD: 7.78, TWD: 30.5, EUR: 0.86, JPY: 148, GBP: 0.75, SGD: 1.29, AUD: 1.52, CAD: 1.38, KRW: 1380 };
  // 资产类别（可多选；第一个选中的为“主类别”，用于占比图，避免重复计算）
  const CLASSES = ['stock', 'crypto', 'gold', 'fund', 'cash', 'liability', 'physical', 'other'];
  const CLASS_COLOR = { stock: '#0A84FF', crypto: '#FF9000', gold: '#FFD60A', fund: '#30B0C7', cash: '#BF5AF2', liability: '#8E8E93', physical: '#AC8E68', other: '#5E5CE6' };
  const PNL_CLASSES = ['stock', 'crypto', 'gold', 'fund'];        // 总览第二、三行指标卡
  const EXP_CATS = ['food', 'daily', 'transport', 'housing', 'leisure', 'digital', 'subscription', 'medical', 'social', 'investLoss', 'otherExp'];
  const INC_CATS = ['salary', 'bonus', 'invest', 'parttime', 'gift', 'refund', 'otherInc'];
  const CAT_ICON = {
    food: '🍜', daily: '🛒', transport: '🚇', housing: '🏠', leisure: '🎮', digital: '💻', subscription: '🔁', medical: '💊', social: '🎁', investLoss: '📉', otherExp: '📦',
    transfer: '🔄', salary: '💼', bonus: '🏆', invest: '📈', parttime: '🧑‍💻', gift: '🧧', refund: '↩️', otherInc: '💰'
  };
  const DEFAULT_LOGO = 'assets/img/logo.png';   // 默认品牌图标（木牛）
  const WAREHOUSE_PRESETS = ['Binance', 'BIT', 'OKX', 'Bitget Wallet', 'fomo', '支付宝', '微信', '招商银行卡', '建设银行卡', '中国银行卡', '农业银行卡'];
  const PNL_STYLES = {
    ios: { up: '#30D158', down: '#FF453A' },
    classic: { up: '#22C55E', down: '#EF4444' },
    soft: { up: '#63E6A4', down: '#FF8A80' },
    neon: { up: '#00F5A0', down: '#FF2E63' },
    mint: { up: '#34C3A6', down: '#F2546B' }
  };
  const PAGES = [
    { id: 'overview', icon: 'pie', k: 'navOverview' },
    { id: 'holdings', icon: 'trend', k: 'navHoldings' },
    { id: 'ledger', icon: 'receipt', k: 'navLedger' },
    { id: 'settings', icon: 'sliders', k: 'navSettings' }
  ];
  const SECRET_KEYS = ['finnhubKey', 'twelveKey', 'avKey', 'gistToken', 'passHash', 'syncedStamp', 'syncKey', 'syncSalt', 'syncIter'];
  const K_SPANS = { '1M': 31, '3M': 92, '6M': 183, '1Y': 366, ALL: 1e9 };

  const ICON = {
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
      cryptoSrc: 'binance', stockSrc: 'finnhub', finnhubKey: '', twelveKey: '', avKey: '',
      fxSrc: 'erapi', autoRefresh: 5,
      trendMode: 'asset', chartRange: 'month', yStep: 'auto',
      assetRange: 'month', kSpan: '3M', kStyle: 'candle', rankCls: 'all', moveCls: 'all', rankSort: 'desc', moveSort: 'desc', rankMode: 'day', leftMode: 'alloc',
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
      lastQuote: 0, assets: [], txs: [], snaps: {}
    };
  }
  /** 旧版单一类别 → 新版多选类别 */
  function migrateAsset(a) {
    if (!Array.isArray(a.cls)) {
      const c = a.cls;
      if (c === 'realestate') a.cls = Api.isGold(a.code) ? ['gold', 'physical'] : ['physical'];
      else a.cls = CLASSES.includes(c) ? [c] : ['other'];
    }
    a.cls = a.cls.filter(c => CLASSES.includes(c));
    if (!a.cls.length) a.cls = ['other'];
    if (a.warehouse == null) a.warehouse = '';
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
    d.snaps = d.snaps && typeof d.snaps === 'object' ? d.snaps : {};
    d.audit = Array.isArray(d.audit) ? d.audit : [];
    if (!['day', 'total'].includes(d.settings.rankMode)) d.settings.rankMode = 'day';
    if (!d.settings.v21) { d.settings.trendMode = 'asset'; d.settings.v21 = true; }   // v2.1：资产趋势改为默认
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
  const ASSET_FIELDS = ['name', 'code', 'cls', 'warehouse', 'ccy', 'qty', 'cost', 'price', 'unit', 'source', 'note', 'locked'];
  const TX_FIELDS = ['date', 'type', 'cat', 'amount', 'ccy', 'accountId', 'toId', 'toAmount', 'fee', 'note'];
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
    if (kind === 'asset') return r.name || r.code || '';
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
  /** 把云端的数据套用到本机：只替换资产、记账、账本信息，设备自己的设置（布局、配色、密码等）保持不变 */
  function applyCloud(obj) {
    backupNow('pull');
    const c = migrate(JSON.parse(JSON.stringify(obj)));
    DB.assets = c.assets; DB.txs = c.txs;
    DB.meta = Object.assign({}, DB.meta, { name: c.meta.name, subtitle: c.meta.subtitle, icon: c.meta.icon, updatedAt: c.meta.updatedAt || 0, demo: c.meta.demo });
    DB.snaps = Object.assign({}, c.snaps, DB.snaps);           // 两边的每日快照合并
    const seen = new Set(), merged = [];
    (DB.audit || []).concat(obj.audit || []).sort((x, y) => x.ts - y.ts).forEach(e => { const k = e.ts + e.kind + e.id + e.act; if (!seen.has(k)) { seen.add(k); merged.push(e); } });
    DB.audit = merged.slice(-2000);
    S().syncedStamp = c.meta.updatedAt || 0;
  }
  async function pushCloud(interactive) {
    await ensureSyncKey(interactive);
    const body = await encodeCloud(JSON.stringify(exportable()));        // 加密后再上传
    const id = await Api.gistPush(S().gistToken, S().gistId, body, `AssetHub · ${bookName()}`);
    S().gistId = id; S().syncedStamp = DB.meta.updatedAt || 0; S().gistLast = Date.now();
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
  async function encodeCloud(text) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(S().syncKey), new TextEncoder().encode(text));
    return JSON.stringify({ assethub: 'enc1', salt: S().syncSalt, iter: S().syncIter || ENC_ITER, iv: b64(iv), data: b64(ct) });
  }
  async function decryptWith(raw, env) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, await aesKey(raw), unb64(env.data));
    return new TextDecoder().decode(pt);
  }
  const isEnc = o => !!(o && o.assethub === 'enc1' && o.data);
  /** 上传前确保有加密密钥：没有密码先设密码，有密码就输入一次 */
  async function ensureSyncKey(interactive) {
    if (S().syncKey) return;
    if (!interactive) throw new Error('NEED_PASS');
    if (!S().passHash) { if (!(await setPasswordFlow(t('syncSetPassMsg')))) throw new Error('CANCEL'); if (S().syncKey) return; }
    const r = await passDialog(t('syncEncT'), t('syncEncM'), ['cur']);
    if (!r) throw new Error('CANCEL');
    if ((await hashPass(r.cur)) !== S().passHash) throw new Error(t('passWrong'));
    await setSyncKey(r.cur); save();
  }
  /** 云端文本 → 数据对象。加密数据先用本机密钥解；解不开（新设备 / 别的设备改过密码）就请你输入密码。
      opt.old = 读取历史版本：只解密，不改本机密码 */
  async function decodeCloud(text, opt) {
    opt = opt || {};
    const obj = JSON.parse(text);
    if (!isEnc(obj)) return obj;
    if (S().syncKey) { try { return JSON.parse(await decryptWith(S().syncKey, obj)); } catch (e) { /* 密钥不对 */ } }
    if (!opt.interactive) throw new Error('NEED_PASS');
    for (let i = 0; i < 3; i++) {
      const r = await passDialog(t('cloudPassT'), i ? t('passWrongRetry') : t(opt.old ? 'cloudPassOldM' : 'cloudPassM'), ['cur']);
      if (!r) throw new Error('CANCEL');
      let raw, data;
      try { raw = await deriveKeyRaw(r.cur, obj.salt, obj.iter); data = JSON.parse(await decryptWith(raw, obj)); } catch (e) { continue; }
      if (!opt.old) {
        const h = await hashPass(r.cur), changed = !!S().passHash && S().passHash !== h;
        S().syncKey = raw; S().syncSalt = obj.salt; S().syncIter = obj.iter || ENC_ITER; S().passHash = h; unlockFor(); save();
        toast(changed ? t('passSyncedChanged') : t('passSynced'), 'ok');
      }
      return data;
    }
    throw new Error(t('passWrong'));
  }

  /* ================= 本机自动备份（加载演示 / 导入 / 清空 / 云端覆盖 / 恢复 之前） ================= */
  const BACKUP_KEY = 'assethub.backups.v1';
  function readBackups() { try { const l = JSON.parse(localStorage.getItem(BACKUP_KEY) || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
  function backupNow(reason) {
    if (!DB.assets.length && !DB.txs.length) return;
    const data = JSON.stringify({ assets: DB.assets, txs: DB.txs, meta: DB.meta, snaps: DB.snaps, audit: DB.audit });
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
    UI.unlockUntil = 0; UI.hold.sel.clear(); UI.led.sel.clear();
    clearTimeout(SYNC.timer); SYNC.state = 'idle'; SYNC.lastErr = '';
  }
  /** 用某个版本替换当前数据（先自动备份当前数据），并上传到云端 */
  function restoreData(obj, label) {
    backupNow('restore');
    const cur = JSON.parse(JSON.stringify(DB));
    DB = migrate(Object.assign(cur, { assets: obj.assets, txs: obj.txs, snaps: obj.snaps || {}, audit: obj.audit || cur.audit, meta: Object.assign({}, cur.meta, obj.meta || {}) }));
    DB.meta.demo = !!(obj.meta && obj.meta.demo);
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
              if (!validData(obj)) throw new Error(t('importBad'));
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
        const cloud = await decodeCloud(await Api.gistPull(S().gistToken, S().gistId), { interactive: inter });
        if (!validData(cloud)) throw new Error(t('importBad'));
        const cStamp = (cloud.meta && cloud.meta.updatedAt) || 0;
        const cloudNew = (cStamp > (S().syncedStamp || 0) && cStamp !== DB.meta.updatedAt) || (!cStamp && !S().syncedStamp && !localDirty && (cloud.assets.length || cloud.txs.length));
        let action = 'none';
        if (cloudNew && localDirty) {
          const keepCloud = await confirmDialog({ title: t('syncConflictT'), msg: t('syncConflictM', { c: dateTimeStr(cStamp), l: dateTimeStr(DB.meta.updatedAt) }), ok: t('syncUseCloud'), cancel: t('syncUseLocal'), danger: false, noBackdrop: true });
          action = keepCloud ? 'pull' : 'push';
        } else if (cloudNew) action = 'pull';
        else if (localDirty) action = 'push';
        // 本机是演示数据、云端是真实数据：绝不自动上传覆盖，询问是否用云端替换本机
        if (action === 'push' && DB.meta.demo && !(cloud.meta && cloud.meta.demo) && (cloud.assets.length || cloud.txs.length)) {
          if (!inter) throw new Error('DEMO_BLOCK');
          action = (await confirmDialog({ title: t('demoBlockT'), msg: t('demoBlockM', { s: dataSummary(cloud) }), ok: t('syncUseCloud'), cancel: t('cancel'), danger: false })) ? 'pull' : 'none';
        }
        if (action === 'pull') { applyCloud(cloud); logOp('system', null, 'cloudPull'); S().gistLast = Date.now(); save(); renderAll(); toast(t('syncPulled'), 'ok'); }
        else if (action === 'push') { await pushCloud(inter); save(); if (!opt.silent) toast(t('syncPushed'), 'ok'); }
        else { S().gistLast = Date.now(); save(); if (!opt.silent) toast(t('syncUpToDate'), 'ok'); }
      }
      SYNC.state = 'ok'; SYNC.lastErr = '';
    } catch (e) {
      SYNC.state = 'err'; SYNC.lastErr = syncErrText(e);
      if (!opt.silent && e.message !== 'CANCEL') toast(t('syncFail') + ' · ' + SYNC.lastErr, 'err');
    }
    SYNC.busy = false; SYNC.lastCheck = Date.now(); renderSyncBtn();
    if (UI.page === 'settings') renderPage();
  }
  /** 把 GitHub 错误码翻译成看得懂的原因 */
  function syncErrText(e) {
    const m = String((e && e.message) || 'error'), code = (m.match(/HTTP (\d{3})/) || [])[1];
    if (m === 'NEED_PASS') return t('syncNeedPass');
    if (m === 'CANCEL') return t('syncCanceled');
    if (m === 'DEMO_BLOCK') return t('syncDemoBlock');
    if (code === '401') return t('syncE401');
    if (code === '404') return t('syncE404');
    if (code === '403') return t('syncE403');
    if (code === '422') return t('syncE422');
    if (code && code[0] === '5') return t('syncE5xx', { c: code });
    if (/Timeout|Failed to fetch|NetworkError|Load failed/i.test(m)) return t('syncENet');
    return m;
  }
  function syncBtnHTML() {
    let st = 'off', tip = t('syncOff');
    if (syncReady() || S().gistToken) {
      const dirty = (DB.meta.updatedAt || 0) > (S().syncedStamp || 0);
      st = SYNC.busy ? 'busy' : SYNC.state === 'err' ? 'err' : dirty ? 'dirty' : 'ok';
      tip = SYNC.busy ? t('syncing') : st === 'err' ? t('syncFail') + ' · ' + SYNC.lastErr : st === 'dirty' ? t('syncDirty') : `${t('syncOk')} · ${dateTimeStr(S().gistLast)}`;
    }
    return `<button class="icon-btn sync-btn st-${st} ${st === 'busy' ? 'spin' : ''}" data-action="sync-now" title="${esc(tip)}">${ic('cloud')}<i class="sdot"></i></button>`;
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
    hold: { q: '', cls: 'all', sort: 'valDesc', batch: false, sel: new Set() },
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
  const qtyStr = a => (hidden() ? MASK : fmtNum(+a.qty || 0, 0, 8));
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
  const isBalance = a => tagsOf(a).every(c => c === 'cash' || c === 'liability');   // 现金/负债：数量 = 余额
  const aCcy = a => (a.ccy || 'USD').toUpperCase();
  const aVal = a => (+a.qty || 0) * (isBalance(a) ? 1 : (+a.price || 0));
  const aCost = a => (isBalance(a) ? aVal(a) : (+a.qty || 0) * (+a.cost || 0));
  const aValD = a => conv(aVal(a), aCcy(a));
  const aCostD = a => conv(aCost(a), aCcy(a));
  const netD = () => DB.assets.reduce((s, a) => s + aValD(a), 0);
  const netUSD = () => DB.assets.reduce((s, a) => s + conv(aVal(a), aCcy(a), 'USD'), 0);
  const clsLabel = a => tagsOf(a).map(c => t('cls_' + c)).join(' · ');
  const tagHTML = a => tagsOf(a).map(c => `<span class="tag" style="--tc:${CLASS_COLOR[c]}">${t('cls_' + c)}</span>`).join('');

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
    // p / b：当日最新的单价 / 余额；po / bo：当日第一次看到的单价 / 余额（作为“今日变化”的起点）
    s.p = {}; s.b = {}; s.po = s.po || {}; s.bo = s.bo || {};
    DB.assets.forEach(a => {
      if (isBalance(a)) {
        s.b[a.id] = +a.qty || 0;
        if (a.addBal == null) a.addBal = +a.qty || 0;            // 录入时余额（用于总变化排行）
        if (s.bo[a.id] == null) s.bo[a.id] = +a.qty || 0;
        return;
      }
      s.p[a.id] = +a.price || 0;
      if (s.po[a.id] == null) s.po[a.id] = +a.price || 0;
      if (!a.addPrice && a.price > 0) a.addPrice = +a.price;
    });
  }
  function pruneSnaps() {
    // 只保留最近 60 天 + 每月最后一天的价格明细，控制存储体积
    const keys = Object.keys(DB.snaps).sort();
    const cut = ymd(new Date(Date.now() - 60 * 864e5));
    keys.forEach((k, i) => {
      const next = keys[i + 1];
      const monthEnd = !next || next.slice(0, 7) !== k.slice(0, 7);
      const sn = DB.snaps[k];
      if (k < cut && !monthEnd) { delete sn.p; delete sn.b; }
      if (k < todayKey()) { delete sn.po; delete sn.bo; }
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
  /** “今日变化”的起点：在线行情的昨收 / 今开 → 昨天最后一次记录 → 今天第一次记录 → 当前值 */
  function dayRef(a, keys) {
    const tk = todayKey(), bal = isBalance(a);
    if (!bal && a.prevClose > 0 && a.prevDay === tk) return a.prevClose;
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
    DB.assets.forEach(a => { if (!hasTag(a, c) || isBalance(a)) return; v += aValD(a); cost += aCostD(a); n++; });
    return { v, pnl: v - cost, pct: cost ? ((v - cost) / Math.abs(cost)) * 100 : 0, n };
  }

  /* ---- 记账 ---- */
  // 转账可在任意资产之间进行：amount / fee 是转出资产的“数量”（现金类即金额），value / feeValue 是折算成 ccy 的价值
  const txD = x => conv(x.type === 'transfer' && x.value != null ? +x.value : +x.amount || 0, x.ccy || S().ccy);
  const feeD = x => (x.type === 'transfer' && x.fee > 0 ? conv(x.feeValue != null ? +x.feeValue : +x.fee, x.ccy || S().ccy) : 0);
  /** 数量单位：现金 / 负债按金额（返回空串），其他资产按代码或单位 */
  const qtyUnit = a => (!a || isBalance(a) ? '' : (a.code || t('unit_' + (a.unit || 'pc')) || a.name));
  const unitPx = a => (!a || isBalance(a) ? 1 : +a.price || 0);
  /** 显示“数量 + 单位”或金额 */
  const qtyTxt = (n, unit, ccy) => (unit ? `${hidden() ? MASK : trim8(n)} ${esc(unit)}` : money(n, { ccy, max: 8 }));   // 转账手续费（计入支出）
  const catName = c => t('cat_' + c);
  function statsOf(pred) {
    const r = { inc: 0, exp: 0, n: 0 };
    DB.txs.forEach(x => { if (!pred(x)) return; if (x.type === 'transfer') { r.exp += feeD(x); return; } r.n++; if (x.type === 'income') r.inc += txD(x); else r.exp += txD(x); });
    return r;
  }
  const sortTxDate = list => list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
  const isMobile = () => S().layout === 'mobile';

  /* ============ 4. 渲染 ============ */
  function hexRGB(hex) { const n = parseInt(hex.slice(1), 16); return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`; }
  function applyTheme() {
    const st = PNL_STYLES[S().pnlStyle] || PNL_STYLES.ios;
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
    const st = PNL_STYLES[S().pnlStyle] || PNL_STYLES.ios;
    const up = S().pnlSwap ? st.down : st.up, dn = S().pnlSwap ? st.up : st.down;
    return `<button class="icon-btn pnl-cycle" data-action="pnl-cycle" title="${t('pnlCycle')}: ${t('pnl_' + S().pnlStyle)}"><i style="background:${up}"></i><i style="background:${dn}"></i></button>`;
  }
  function eyeBtn() {
    const h = hidden();
    return `<button class="icon-btn eye ${h ? 'on' : ''}" data-action="toggle-hide" title="${h ? t('showAmt') : t('hideAmt')}">${ic(h ? 'eyeoff' : 'eye')}</button>`;
  }
  function renderHeader() {
    const s = S(), m = isMobile();
    const icon = DB.meta.icon ? `<img src="${esc(DB.meta.icon)}" alt="">` : `<img src="${DEFAULT_LOGO}" alt="AssetHub">`;
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
    const list = DB.assets.filter(a => hasTag(a, c) && !isBalance(a));
    if (!list.length) return [];
    return snapKeys().slice(-30).filter(k => DB.snaps[k].p).map(k => {
      const p = DB.snaps[k].p;
      return list.reduce((s, a) => s + conv((+a.qty || 0) * (p[a.id] != null ? p[a.id] : +a.price || 0), aCcy(a), 'USD'), 0);
    });
  }
  function kpiCard(o) {
    return `<div class="kpi glass ${o.cls || ''}">
      <div class="lbl"><span class="ico">${ic(o.icon)}</span>${o.label}</div>
      <div class="val num">${o.val}</div>
      <div class="sub">${o.sub || ''}</div>${o.spark || ''}</div>`;
  }
  /** 第一行：所有页面固定显示 */
  function renderKPIs() {
    const net = netD(), C = colors(), accent = '#FF9000';
    const col = v => (v > 1e-9 ? C.up : v < -1e-9 ? C.down : '#8E8E93');
    const pnlCard = (label, icon, r, ref, kind) => kpiCard({
      cls: tone(r.pnl), icon, label,
      val: moneyHTML(r.pnl, { sign: true }),
      sub: `${ref} <b class="num">${pct(r.pct)}</b>`,
      spark: sparkSVG(netSeries(kind), col(r.pnl))
    });
    $('#kpis').innerHTML =
      kpiCard({ cls: 'hero', icon: 'wallet', label: t('kpiNet'), val: moneyHTML(net), sub: `${t('quoteAt')}: ${timeStr(DB.lastQuote)} · ${t('nAssets', { n: DB.assets.length })}`, spark: sparkSVG(netSeries('net'), accent) }) +
      pnlCard(t('kpiDay'), 'trend', periodPnl('day'), t('vsDay'), 'day') +
      pnlCard(t('kpiMonth'), 'cal', periodPnl('month'), t('vsMonth'), 'month') +
      pnlCard(t('kpiYear'), 'sparkle', periodPnl('year'), t('vsYear'), 'year');
  }
  /** 第二行：仅资产总览页 —— 每个类别一张卡，左“总盈亏”右“日盈亏” */
  function classKpisHTML() {
    const icon = { stock: 'trend', crypto: 'bolt', gold: 'sparkle', fund: 'pie' }, C = colors();
    const col = v => (v > 1e-9 ? C.up : v < -1e-9 ? C.down : '#8E8E93');
    return `<section class="kpis kpis-dual">${PNL_CLASSES.map(c => {
      const tot = classTotal(c), day = periodPnl('day', DB.assets.filter(a => hasTag(a, c))), name = t('cls_' + c);
      return `<div class="kpi glass dual ${tone(tot.pnl)}">
        <div class="dual-grid">
          <div><div class="lbl"><span class="ico">${ic(icon[c])}</span>${t('kpiClsTotal', { c: name })}</div>
            <div class="val num ${upDown(tot.pnl)}">${moneyHTML(tot.pnl, { sign: true })}</div>
            <div class="sub">${t('mktValue')} ${money(tot.v)} · <b class="num ${upDown(tot.pnl)}">${pct(tot.pct)}</b></div></div>
          <div class="dual-r"><div class="lbl">${t('kpiClsDay', { c: name })}</div>
            <div class="val num ${upDown(day.pnl)}">${moneyHTML(day.pnl, { sign: true })}</div>
            <div class="sub">${t('vsDay')} <b class="num ${upDown(day.pnl)}">${pct(day.pct)}</b></div></div>
        </div>${sparkSVG(classSeries(c), col(tot.pnl))}</div>`;
    }).join('')}</section>`;
  }

  function renderFoot() {
    $('#foot').innerHTML = `<b>${esc(bookName())}</b> · ${t('footLocal')} · AssetHub v3.0`;
  }
  function renderPage() {
    closePopover();
    ({ overview: renderOverview, holdings: renderHoldings, ledger: renderLedger, settings: renderSettings })[UI.page]();
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
    CLASSES.map(c => `<option value="${c}" ${sel === c ? 'selected' : ''}>${t('cls_' + c)}</option>`).join('');

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
              <button class="${S().rankMode === 'total' ? 'on' : ''}" data-action="rank-mode" data-v="total">${t('rankTotalTitle')}</button></div>${liveBadge()}</div>
            <div class="head-tools"><span id="sort-moveSort">${sortBtnHTML('moveSort')}</span><button class="pill-select" data-action="rank-menu" data-key="moveCls" id="pill-moveCls">${rankPillHTML('moveCls')}</button>
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
  function renderLeft() {
    const body = $('#left-body'); if (!body) return;
    if (S().leftMode === 'rank') {
      $('#left-tools').innerHTML = `${sortBtnHTML('rankSort')}<button class="pill-select" data-action="rank-menu" data-key="rankCls" id="pill-rankCls">${rankPillHTML('rankCls')}</button>
        <button class="link" data-action="nav" data-page="holdings">${t('viewAll')}${ic('chev-r')}</button>`;
      renderRank();
      return;
    }
    const so = S().allocSort === 'asc' ? 'asc' : 'desc';
    $('#left-tools').innerHTML = `<button class="icon-btn sm sort-btn" data-action="alloc-sort" title="${t('allocSortTip')} · ${t('allocSort_' + so)}">${ic(so === 'asc' ? 'sortasc' : 'sortdesc')}</button>`;
    // 占比按“主类别”统计；负债不进圆环，单独列出
    const by = {}; CLASSES.forEach(c => { by[c] = 0; });
    DB.assets.forEach(a => { by[primary(a)] += aValD(a); });
    // 排序：默认按类别顺序；高→低 / 低→高 按占比，负债始终放最后
    const order = CLASSES.filter(c => c !== 'liability');
    if (so === 'desc') order.sort((x, y) => by[y] - by[x]); else if (so === 'asc') order.sort((x, y) => by[x] - by[y]);
    order.push('liability');
    const segs = order.filter(c => c !== 'liability').map(c => ({ key: c, label: t('cls_' + c), value: Math.max(0, by[c]), color: CLASS_COLOR[c] }));
    const pos = segs.reduce((s, x) => s + x.value, 0);
    const legend = order.map(c => {
      const v = by[c], isL = c === 'liability', p = isL ? 0 : (pos ? (Math.max(0, v) / pos) * 100 : 0);
      return `<div class="legend-row lg-line" data-k="${c}"><i class="dot" style="background:${CLASS_COLOR[c]}"></i>
        <div class="lg-name">${t('cls_' + c)}</div>
        <div class="lg-val num ${isL && v < 0 ? 'down' : ''}">${money(v)}</div>
        <div class="lg-pct num">${isL ? '—' : p.toFixed(1) + '%'}</div>
        <div class="lg-bar"><i style="width:${isL ? 0 : p}%;background:${CLASS_COLOR[c]}"></i></div></div>`;
    }).join('');
    body.innerHTML = DB.assets.length ? `<div class="donut-wrap"><div class="donut" id="donut"></div><div class="legend">${legend}</div></div>` : emptyState('assets');
    if (DB.assets.length) {
      const net = netD();
      const d = Charts.donut($('#donut'), segs, {
        id: 'alloc',
        center: k => {
          if (!k) return `<div class="t">${t('kpiNet')}</div><div class="v num">${money(net)}</div><div class="p">${t('nAssets', { n: DB.assets.length })}</div>`;
          const s = segs.find(x => x.key === k);
          return `<div class="t">${s.label}</div><div class="v num">${money(s.value)}</div><div class="p">${pos ? ((s.value / pos) * 100).toFixed(2) : 0}%</div>`;
        },
        onHover: k => $$('.legend-row').forEach(r => r.classList.toggle('hl', r.dataset.k === k))
      });
      $$('.legend-row').forEach(r => {
        r.addEventListener('mouseenter', () => { if (r.dataset.k !== 'liability') d.hl(r.dataset.k); });
        r.addEventListener('mouseleave', () => d.hl(null));
      });
    }
  }
  /** 排序切换按钮（由高到低 ⇄ 由低到高），key 为设置项名 */
  function sortBtnHTML(key) {
    const asc = S()[key] === 'asc';
    return `<button class="icon-btn sm sort-btn" data-action="sort-toggle" data-key="${key}" title="${t('allocSortTip')} · ${t(asc ? 'allocSort_asc' : 'allocSort_desc')}">${ic(asc ? 'sortasc' : 'sortdesc')}</button>`;
  }
  function rankPillHTML(key) {
    const c = S()[key || 'rankCls'];
    return `${c === 'all' ? '<i class="cdot all"></i>' : `<i class="cdot" style="background:${CLASS_COLOR[c]}"></i>`}<span>${c === 'all' ? t('allCls') : t('cls_' + c)}</span>${ic('chev-d')}`;
  }
  /** 资产排行的类别筛选菜单 */
  function openRankMenu(anchor) {
    if (popEl) { closePopover(); return; }
    const key = anchor.dataset.key || 'rankCls', cur = S()[key];
    const cnt = c => DB.assets.filter(a => hasTag(a, c)).length;
    const pop = document.createElement('div');
    pop.className = 'popover menu';
    pop.innerHTML = ['all'].concat(CLASSES).map(c => `<button class="menu-item ${cur === c ? 'on' : ''}" data-k="${c}">
      ${c === 'all' ? '<i class="cdot all"></i>' : `<i class="cdot" style="background:${CLASS_COLOR[c]}"></i>`}
      <span>${c === 'all' ? t('allCls') : t('cls_' + c)}</span><em>${cnt(c)}</em></button>`).join('');
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
  function renderMoves() {
    if (!$('#rank')) return;
    const total = S().rankMode === 'total', c = S().moveCls, keys = snapKeys();
    const list = DB.assets.filter(a => hasTag(a, c)).map(a => Object.assign({ a }, total ? totalChange(a) : dayChange(a, keys))).sort((x, y) => (S().moveSort === 'asc' ? x.ch - y.ch : y.ch - x.ch));
    const top = Math.max(1e-9, ...list.map(x => Math.abs(x.ch)));
    const sum = list.reduce((s, x) => s + x.ch, 0);
    $('#rank').innerHTML = !DB.assets.length ? emptyState('assets') : !list.length ? `<div class="empty sm"><p>${t('noMatchCls')}</p></div>` :
      `<div class="rank-sum">${t(total ? 'rankTotalSum' : 'rankDaySum')} <b class="num ${upDown(sum)}">${money(sum, { sign: true })}</b><span class="dim">· ${t(total ? 'rankTotalHint' : 'rankDayHint')}</span></div>
      <div class="rank rank-scroll">${list.map((x, i) => {
        const a = x.a, z = Math.abs(x.ch) < 0.005;
        return `<div class="rank-row ${z ? 'zero' : ''}">
          <span class="rank-no">${i + 1}</span>
          <div style="min-width:0"><div class="rank-name"><i class="cdot" style="background:${CLASS_COLOR[primary(a)]}"></i><span class="nm">${esc(a.name)}</span>${a.code ? `<span class="code">${esc(a.code)}</span>` : ''}${a.locked ? ic('lock', 'lk') : ''}</div>
            <div class="bar"><i style="width:${z ? 0 : Math.max(2, (Math.abs(x.ch) / top) * 100)}%;background:${x.ch < 0 ? 'var(--down)' : 'var(--up)'}"></i></div></div>
          <div class="rank-val num ${z ? 'dim' : upDown(x.ch)}">${z ? '—' : money(x.ch, { sign: true })}<small class="${z ? 'dim' : upDown(x.ch)}">${z ? t('noChange') : pct(x.pct)} · ${money(aValD(a))}</small></div>
        </div>`;
      }).join('')}</div>`;
  }
  function renderRank() {
    if (!$('#left-body') || S().leftMode !== 'rank') return;
    const c = S().rankCls;
    let list = DB.assets.filter(a => hasTag(a, c)).map(a => ({ a, v: aValD(a) }));
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
          <div style="min-width:0"><div class="rank-name"><i class="cdot" style="background:${CLASS_COLOR[primary(a)]}"></i><span class="nm">${esc(a.name)}</span>${a.code ? `<span class="code">${esc(a.code)}</span>` : ''}${a.locked ? ic('lock', 'lk') : ''}</div>
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
      if (x.type === 'transfer') { map[k].exp += feeD(x); return; }
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
    if (range === 'month') {
      const m = ym(now);
      return keys.filter(k => k.startsWith(m)).map(k => mk(k, DB.snaps[k], String(+k.slice(8)), dayLabel(k)));
    }
    if (range === 'year') {
      const y = String(now.getFullYear()), out = [];
      for (let i = 1; i <= 12; i++) {
        const mkey = `${y}-${pad(i)}`, ks = keys.filter(k => k.startsWith(mkey));
        if (!ks.length) continue;
        const ss = ks.map(k => DB.snaps[k]);
        out.push({ key: mkey, label: t('mon' + (i - 1)), tip: zh() ? `${y}年${i}月` : `${t('mon' + (i - 1))} ${y}`,
          o: cv(ss[0].o), c: cv(ss[ss.length - 1].c), h: cv(Math.max(...ss.map(s => s.h))), l: cv(Math.min(...ss.map(s => s.l))) });
      }
      return out;
    }
    return keys.map(k => mk(k, DB.snaps[k], `${k.slice(5, 7)}/${k.slice(8)}`, dayLabel(k) + ' ' + k.slice(0, 4)));
  }
  function drawAssetTrend() {
    const s = S(), range = s.assetRange, C = colors();
    $('#trend-tools').innerHTML = `
      <div class="seg">${['month', 'year', 'day'].map(r => `<button class="${range === r ? 'on' : ''}" data-action="asset-range" data-v="${r}">${t('ar_' + r)}</button>`).join('')}</div>
      ${range === 'day' ? `<div class="seg">${Object.keys(K_SPANS).map(k => `<button class="${s.kSpan === k ? 'on' : ''}" data-action="k-span" data-v="${k}">${k === 'ALL' ? t('all') : k}</button>`).join('')}</div>` : ''}
      <div class="seg">
        <button class="${s.kStyle === 'candle' ? 'on' : ''}" data-action="k-style" data-v="candle" title="${t('kCandle')}">${ic('candle')}</button>
        <button class="${s.kStyle === 'line' ? 'on' : ''}" data-action="k-style" data-v="line" title="${t('kLine')}">${ic('linechart')}</button></div>`;
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
      ${range === 'day' ? `<span class="dim">${t('kDragHint')}</span>` : ''}`;
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
  const txAcct = x => (x.type === 'transfer' ? `${acctName(x.accountId)} → ${acctName(x.toId)}` : acctName(x.accountId));
  const txSign = x => (x.type === 'income' ? 1 : x.type === 'transfer' ? 0 : -1);
  /** 金额文字：转账不带正负号、不着色 */
  function txAmt(x, ccy, amt, max) {
    const s = txSign(x);
    return s ? money(s * amt, { ccy, sign: true, max }) : '⇄ ' + money(amt, { ccy, max });
  }
  const txCls = x => (x.type === 'income' ? 'up' : x.type === 'expense' ? 'down' : 'muted');
  function txRowHTML(x, withOps, batch) {
    const orig = x.ccy && x.ccy !== S().ccy;
    return `<div class="tx-row ${batch ? 'batch' : ''}">
      ${batch ? `<label class="ck"><input type="checkbox" data-sel="tx" value="${x.id}" ${UI.led.sel.has(x.id) ? 'checked' : ''}><i></i></label>` : ''}
      <div class="tx-ico ${x.type}">${CAT_ICON[x.cat] || '•'}</div>
      <div class="tx-main"><div class="tx-title">${catName(x.cat)}${x.note ? `<span class="nt">${esc(x.note)}</span>` : ''}</div>
        <div class="tx-meta">${x.date} · ${esc(txAcct(x))}</div></div>
      <div class="tx-amt num ${txCls(x)}">${txAmt(x, null, txD(x), orig ? 2 : 8)}
        ${x.fromUnit ? `<small>${qtyTxt(x.amount, x.fromUnit)}</small>` : orig ? `<small>${txAmt(x, x.ccy, x.amount, 8)}</small>` : ''}${x.fee > 0 ? `<small class="down">${t('fee')} ${qtyTxt(x.fee, x.fromUnit, x.ccy)}</small>` : ''}
        ${withOps && !batch ? `<div class="tx-ops">${histBtn('tx', x.id)}<button class="op edit" data-action="edit-tx" data-id="${x.id}">${ic('edit')}</button><button class="op del" data-action="del-tx" data-id="${x.id}">${ic('trash')}</button></div>` : ''}
      </div></div>`;
  }

  /* ================= 页面二：资产明细 ================= */
  function holdList() {
    const H = UI.hold, q = H.q.trim().toLowerCase();
    let list = DB.assets.filter(a => hasTag(a, H.cls));
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
    CLASSES.forEach(c => { counts[c] = DB.assets.filter(a => hasTag(a, c)).length; });
    const chips = ['all'].concat(CLASSES).map(c =>
      `<button class="chip ${H.cls === c ? 'on' : ''}" data-action="hold-filter" data-v="${c}">${c !== 'all' ? `<i class="cdot" style="background:${CLASS_COLOR[c]}"></i>` : ''}${c === 'all' ? t('all') : t('cls_' + c)}<em>${counts[c]}</em></button>`).join('');
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
      </div>
      <div class="chips mb">${chips}</div>
      <div id="batch-bar"></div>
      <div id="hold-body"></div>`;
    renderHoldBody();
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
            <div class="meta">${tagHTML(a)}${srcBadge(a)}</div></div>
            <div class="r"><div class="v num ${v < 0 ? 'down' : ''}">${money(v)}</div>
              <div class="p num ${upDown(day)}">${t('colDay')} ${dayCell(day, dayPct, true)}</div>
              <div class="p num ${bal ? 'dim' : upDown(pnl)}">${bal ? t('noPnl') : `${money(pnl, { sign: true })} (${pct(c ? (pnl / Math.abs(c)) * 100 : 0)})`}</div></div></div>
          <div class="hc-grid">
            <div><div class="l">${bal ? t('cashBalance') : t('colQty')}</div><div class="x num">${qtyStr(a)}${unitSuffix(a)}</div></div>
            <div><div class="l">${t('colCost')}</div><div class="x num">${bal ? '—' : money(conv(+a.cost || 0, aCcy(a)), { max: 8 })}</div></div>
            <div><div class="l">${t('colPrice')}</div><div class="x num">${bal ? '—' : money(conv(+a.price || 0, aCcy(a)), { max: 8 })}</div></div>
          </div>
          ${a.warehouse ? `<div class="hc-wh">${ic('db')}${esc(a.warehouse)}</div>` : ''}
          ${H.batch ? '' : `<div class="hc-ops">${histBtn('asset', a.id)}${quickBtn(a)}<button class="op edit" data-action="edit-asset" data-id="${a.id}">${ic('edit')}${t('edit')}</button><button class="op del" data-action="del-asset" data-id="${a.id}">${ic('trash')}${t('del')}</button></div>`}
        </div>`;
      }).join('')}</div>`;
    } else {
      let sumV = 0, sumC = 0, sumHV = 0, sumDay = 0;
      const tr = rows.map(({ a, v, pnl, day, dayPct }) => {
        const ccy = aCcy(a), bal = isBalance(a), c = aCostD(a), orig = ccy !== D;
        sumV += v; sumDay += day; if (!bal) { sumC += c; sumHV += v; }
        return `<tr class="${H.sel.has(a.id) ? 'sel' : ''}">
          ${H.batch ? `<td class="ckc"><label class="ck"><input type="checkbox" data-sel="hold" value="${a.id}" ${H.sel.has(a.id) ? 'checked' : ''}><i></i></label></td>` : ''}
          <td><div class="nmcell"><i class="cdot" style="background:${CLASS_COLOR[primary(a)]}"></i><b>${esc(a.name)}</b>${a.code ? `<span class="code">${esc(a.code)}</span>` : ''}${a.locked ? ic('lock', 'lk') : ''}</div>${a.note ? `<small>${esc(a.note)}</small>` : ''}</td>
          <td><div class="tags">${tagHTML(a)}</div></td>
          <td class="wh">${a.warehouse ? esc(a.warehouse) : '<span class="dim">—</span>'}</td>
          <td class="r num">${qtyStr(a)}${unitSuffix(a)}</td>
          <td class="r num muted">${bal ? `<span class="dim">—</span><small>${ccy}</small>` : money(conv(+a.cost || 0, ccy), { max: 8 }) + (orig ? `<small>${money(+a.cost || 0, { ccy, max: 8 })}</small>` : '')}</td>
          <td class="r num strong">${bal ? '<span class="dim">—</span>' : money(conv(+a.price || 0, ccy), { max: 8 }) + (orig ? `<small>${money(+a.price || 0, { ccy, max: 8 })}</small>` : '')}</td>
          <td class="r num strong ${v < 0 ? 'down' : ''}">${money(v, { max: 8 })}${orig ? `<small>${money(aVal(a), { ccy, max: 8 })}</small>` : ''}</td>
          <td class="r num ${upDown(day)}">${dayCell(day, dayPct)}</td>
          <td class="r num ${bal ? 'dim' : upDown(pnl)}">${bal ? t('noPnl') : `${money(pnl, { sign: true })}<small class="${upDown(pnl)}">${pct(c ? (pnl / Math.abs(c)) * 100 : 0)}</small>`}</td>
          <td>${srcBadge(a)}</td>
          <td class="c">${H.batch ? '' : `<div class="ops">${histBtn('asset', a.id)}${quickBtn(a)}<button class="op edit" data-action="edit-asset" data-id="${a.id}">${ic('edit')}${t('edit')}</button><button class="op del" data-action="del-asset" data-id="${a.id}">${ic('trash')}${t('del')}</button></div>`}</td>
        </tr>`;
      }).join('');
      const sp = sumHV - sumC;
      const allSel = rows.length && rows.every(r => H.sel.has(r.a.id));
      body = `<div class="card glass table-card"><div class="table-wrap"><table class="tbl">
        <thead><tr>
          ${H.batch ? `<th class="ckc"><label class="ck"><input type="checkbox" data-sel-all="hold" ${allSel ? 'checked' : ''}><i></i></label></th>` : ''}
          <th>${t('colName')}</th><th>${t('colClass')}</th><th>${t('colWh')}</th><th class="r">${t('colQty')}</th><th class="r">${t('colCost')}</th><th class="r">${t('colPrice')}</th>
          ${sortHead('val', t('colValue'))}${sortHead('day', t('colDay'))}${sortHead('pnl', t('colPnl'))}<th>${t('colSrc')}</th><th class="c">${t('colOps')}</th></tr></thead>
        <tbody>${tr}</tbody>
        <tfoot><tr>${H.batch ? '<td></td>' : ''}<td colspan="6">${t('total')} · ${t('nAssets', { n: rows.length })}</td><td class="r num">${money(sumV)}</td><td class="r num ${upDown(sumDay)}">${money(sumDay, { sign: true })}</td><td class="r num ${upDown(sp)}">${money(sp, { sign: true })}<small class="${upDown(sp)}">${pct(sumC ? (sp / Math.abs(sumC)) * 100 : 0)}</small></td><td colspan="2"></td></tr></tfoot>
      </table></div></div>`;
    }
    $('#hold-body').innerHTML = body;
  }
  /** 手动维护的资产显示“更新市值 / 更新余额”快捷按钮 */
  const histBtn = (kind, id) => `<button class="op hist" data-action="history" data-kind="${kind}" data-id="${id}" title="${t('history')}">${ic('clock')}</button>`;
  const canQuickUpdate = a => isBalance(a) || !(a.source === 'online' && Api.canQuote(a));
  const quickBtn = a => (canQuickUpdate(a) ? `<button class="op upd" data-action="update-val" data-id="${a.id}" title="${isBalance(a) ? t('updBal') : t('updVal')}">${ic('refresh')}${isBalance(a) ? t('updBalS') : t('updValS')}</button>` : '');
  /** 今日盈亏单元格：没有变化显示 — */
  const dayCell = (ch, p, inline) => (Math.abs(ch) < 0.005 ? '<span class="dim">—</span>'
    : inline ? `${money(ch, { sign: true })} (${pct(p)})` : `${money(ch, { sign: true })}<small class="${upDown(ch)}">${pct(p)}</small>`);
  const unitSuffix = a => (a.unit && !isBalance(a) && (hasTag(a, 'gold') || hasTag(a, 'physical')) ? ` <span class="dim">${t('unitS_' + a.unit)}</span>` : '');
  function srcBadge(a) {
    const online = a.source === 'online' && Api.canQuote(a), err = online && a.lastErr;
    const title = online ? `${t('updatedAt')}: ${dateTimeStr(a.updatedAt)}${err ? ' · ' + a.lastErr : ''}` : '';
    return `<span class="src ${online ? 'online' : ''} ${err ? 'err' : ''}" title="${esc(title)}"><i></i>${online ? t('srcOnline') : t('srcManual')}</span>`;
  }
  /** 批量操作条（资产 / 记账共用） */
  function renderBatchBar(kind, visibleIds) {
    const st = kind === 'hold' ? UI.hold : UI.led, el = $('#batch-bar');
    if (!el) return;
    if (!st.batch) { el.innerHTML = ''; return; }
    const n = st.sel.size;
    el.innerHTML = `<div class="batch-bar glass">
      <span class="bb-n">${t('selectedN', { n })}</span>
      <button class="btn btn-glass sm" data-action="sel-all" data-kind="${kind}" data-ids="${visibleIds.join(',')}">${t('selectAll')}</button>
      <button class="btn btn-glass sm" data-action="sel-none" data-kind="${kind}" ${n ? '' : 'disabled'}>${t('selectNone')}</button>
      <span class="bb-sp"></span>
      ${kind === 'hold' ? `<button class="btn btn-soft sm" data-action="batch-lock" ${n ? '' : 'disabled'}>${ic('lock')}${t('batchLock')}</button>
      <button class="btn btn-glass sm" data-action="batch-unlock" ${n ? '' : 'disabled'}>${ic('unlock')}${t('batchUnlock')}</button>` : ''}
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
      && (L.acct === 'all' || (L.acct === 'none' ? !x.accountId : x.accountId === L.acct || x.toId === L.acct)));
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
      return `<div class="stat-row-h"><span class="srh-l">${t('per_' + mode)}<small>${periodLabel(mode, L.date)}</small></span></div>
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
          const net = groups[d].reduce((s, x) => s + txSign(x) * txD(x) - feeD(x), 0);
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
            <td><span style="margin-right:6px">${CAT_ICON[x.cat] || ''}</span>${catName(x.cat)}</td>
            <td class="muted">${esc(txAcct(x))}${x.applied ? `<small>${t('synced')}</small>` : ''}</td>
            <td class="note" title="${esc(x.note)}">${esc(x.note) || '<span class="dim">—</span>'}</td>
            <td class="r num strong ${txCls(x)}">${txAmt(x, null, txD(x), orig ? 2 : 8)}${x.fromUnit ? `<small>${qtyTxt(x.amount, x.fromUnit)}</small>` : orig ? `<small>${txAmt(x, x.ccy, x.amount, 8)}</small>` : ''}${x.type === 'transfer' && (x.toUnit || x.fromUnit || (x.toCcy && x.toCcy !== x.ccy)) ? `<small>${t('received')} ${qtyTxt(x.toAmount, x.toUnit, x.toCcy)}</small>` : ''}${x.fee > 0 ? `<small class="down">${t('fee')} ${qtyTxt(x.fee, x.fromUnit, x.ccy)}</small>` : ''}</td>
            <td class="c">${L.batch ? '' : `<div class="ops">${histBtn('tx', x.id)}<button class="op edit" data-action="edit-tx" data-id="${x.id}">${ic('edit')}${t('edit')}</button><button class="op del" data-action="del-tx" data-id="${x.id}">${ic('trash')}${t('del')}</button></div>`}</td>
          </tr>`;
        }).join('')}</tbody></table></div></div>`;
    }
    $('#led-body').innerHTML = body;
  }

  /* ================= 页面四：数据设置 ================= */
  function auditCardHTML() {
    const kindF = UI.logKind || 'all', n = UI.logN || 50;
    const all = (DB.audit || []).filter(e => kindF === 'all' || e.kind === kindF).slice().reverse();
    return `<div class="card glass">
      <div class="card-head"><div class="card-title"><span class="ico">${ic('clock')}</span>${t('auditT')}</div>
        <div class="seg">${['all', 'asset', 'tx', 'system'].map(k => `<button class="${kindF === k ? 'on' : ''}" data-action="log-filter" data-v="${k}">${k === 'all' ? t('all') : t('kind_' + k)}</button>`).join('')}</div></div>
      <p class="set-desc">${t('auditSub')}</p>
      ${all.length ? `<div class="lg-list audit">${all.slice(0, n).map(e => logEntryHTML(e, null, true)).join('')}</div>
        ${all.length > n ? `<button class="btn btn-glass sm" data-action="log-more" style="margin-top:12px">${t('loadMore')} (${all.length - n})</button>` : ''}` : `<div class="empty sm"><p>${t('noLog')}</p></div>`}
    </div>`;
  }
  function renderSettings() {
    const s = S();
    const size = (new Blob([JSON.stringify(DB)]).size / 1024).toFixed(1);
    const stockSrc = Api.STOCK_SOURCES[s.stockSrc] || Api.STOCK_SOURCES.finnhub;
    const r = DB.rates.rates;
    const pnlOpts = Object.keys(PNL_STYLES).map(k => {
      const p = PNL_STYLES[k], up = s.pnlSwap ? p.down : p.up, dn = s.pnlSwap ? p.up : p.down;
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
            <button class="btn btn-glass" data-action="recover">${ic('clock')}${t('recoverT')}</button>
            <button class="btn btn-danger" data-action="clear">${ic('trash')}${t('clearAll')}</button>
          </div>
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
          <div class="field"><label>${t('gistToken')}</label><input class="input" type="password" data-set="gistToken" value="${esc(s.gistToken)}" placeholder="ghp_xxx / github_pat_xxx" autocomplete="off">
            <div class="hint">${t('gistTokenHint')} <a href="https://github.com/settings/tokens/new?scopes=gist&description=AssetHub" target="_blank" rel="noopener">${t('createToken')} ↗</a></div></div>
          <div class="field"><label>${t('gistId')}</label><input class="input" data-set="gistId" value="${esc(s.gistId)}" placeholder="${t('gistIdPh')}" autocomplete="off"></div>
          <label class="switch-row"><span>${t('autoSync')}<small>${t('autoSyncSub')}</small></span>
            <span class="switch"><input type="checkbox" data-set="autoSync" ${s.autoSync ? 'checked' : ''}><i></i></span></label>
          <div class="btn-row">
            <button class="btn btn-accent" data-action="sync-now">${ic('cloud')}${t('syncNowBtn')}</button>
            <button class="btn btn-glass" data-action="gist-push">${ic('upload')}${t('gistPush')}</button>
            <button class="btn btn-glass" data-action="gist-pull">${ic('download')}${t('gistPull')}</button>
            <button class="btn btn-glass" data-action="gist-new">${ic('plus')}${t('gistNew')}</button>
          </div>
          <div class="hint" style="margin-top:10px">${ic('lock')} ${S().syncKey ? t('encOn') : t('encOff')}</div>
          ${SYNC.state === 'err' && SYNC.lastErr ? `<div class="hint down" style="margin-top:10px">${t('syncFail')} · ${esc(SYNC.lastErr)}</div>` : ''}
          <div class="hint" style="margin-top:12px">${t('lastSync')}: ${s.gistLast ? new Date(s.gistLast).toLocaleString(locale(), { hour12: false }) : t('never')}</div>
        </div>
      </div>
      <div class="set-col">
        <div class="card glass">
          <div class="card-head"><div class="card-title"><span class="ico">${ic('bolt')}</span>${t('setQuoteT')}</div></div>
          <p class="set-desc">${t('setQuoteSub')}</p>
          <div class="field"><label>${t('cryptoSrc')}</label><select class="input" data-set="cryptoSrc">${Object.keys(Api.CRYPTO_SOURCES).map(k => `<option value="${k}" ${s.cryptoSrc === k ? 'selected' : ''}>${Api.CRYPTO_SOURCES[k].name}</option>`).join('')}</select>
            <div class="hint">${t('cryptoSrcHint')}</div></div>
          <div class="row2">
            <div class="field"><label>${t('stockSrc')}</label><select class="input" data-set="stockSrc">${Object.keys(Api.STOCK_SOURCES).map(k => `<option value="${k}" ${s.stockSrc === k ? 'selected' : ''}>${Api.STOCK_SOURCES[k].name}</option>`).join('')}</select></div>
            <div class="field"><label>${stockSrc.name} API Key</label><input class="input" type="password" data-set="${stockSrc.keyField}" value="${esc(s[stockSrc.keyField])}" placeholder="${t('apiKeyPh')}" autocomplete="off"></div>
          </div>
          <div class="hint" style="margin:-6px 0 14px">${t('stockSrcHint')} <a href="${stockSrc.signup}" target="_blank" rel="noopener">${t('getKey')} ${stockSrc.name} ↗</a></div>
          <div class="field"><label>${t('goldSrc')}</label><div class="fx-box">${t('goldSrcDesc')}</div></div>
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
          <div class="field"><label>${t('pnlStyle')}</label><div class="pnl-opts">${pnlOpts}</div></div>
          <div class="field"><label>${t('pnlDir')}</label><div class="seg seg-full">
            <button class="${!s.pnlSwap ? 'on' : ''}" data-action="pnl-swap" data-v="0">${t('dirGreenUp')}</button>
            <button class="${s.pnlSwap ? 'on' : ''}" data-action="pnl-swap" data-v="1">${t('dirRedUp')}</button></div></div>
          <div class="divider"></div>
          <div class="field"><label>${t('customIcon')}</label><div class="icon-row">
            <div class="brand-icon icon-preview ${DB.meta.icon ? 'custom' : 'bull'}"><img src="${DB.meta.icon ? esc(DB.meta.icon) : DEFAULT_LOGO}" alt=""></div>
            <button class="btn btn-glass sm" data-action="pick-icon">${ic('upload')}${t('uploadIcon')}</button>
            ${DB.meta.icon ? `<button class="btn btn-danger sm" data-action="remove-icon">${t('removeIcon')}</button>` : ''}
          </div></div>
          <div class="field" style="margin-bottom:0"><label>${t('subtitle')}</label><input class="input" data-meta="subtitle" value="${esc(DB.meta.subtitle)}" placeholder="${t('subtitlePh')}" maxlength="80"></div>
        </div>
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
        <div class="pass-fields"><input class="input num" name="v" inputmode="decimal" value="${esc(o.value || '')}" placeholder="${esc(o.placeholder || '')}">${o.hint ? `<div class="hint">${o.hint}</div>` : ''}</div>
        <div class="alert-btns"><button type="button" data-r="0">${t('cancel')}</button><button type="submit" class="ok">${t('save')}</button></div></form>`;
      root.classList.add('open');
      const form = $('form', root), inp = form.elements.v;
      setTimeout(() => { inp.focus(); inp.select(); }, 50);
      const done = v => { root.classList.remove('open'); root.innerHTML = ''; res(v); };
      form.addEventListener('submit', e => { e.preventDefault(); done(inp.value); });
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
  async function setPasswordFlow(msg) {
    const hasOld = !!S().passHash;
    const r = await passDialog(hasOld ? t('changePass') : t('setPass'), hasOld ? t('changePassMsg') : (msg || t('setPassMsg')), hasOld ? ['old', 'new', 'confirm'] : ['new', 'confirm']);
    if (!r) return false;
    if (hasOld && (await hashPass(r.old)) !== S().passHash) { toast(t('passWrong'), 'err'); return false; }
    if (!r.new || r.new.length < 4) { toast(t('passShort'), 'err'); return false; }
    if (r.new !== r.confirm) { toast(t('passMismatch'), 'err'); return false; }
    S().passHash = await hashPass(r.new);
    try { await setSyncKey(r.new); } catch (e) { /* 浏览器不支持加密时仅设置锁定密码 */ }
    unlockFor();
    save(); toast(t('passSaved'), 'ok');
    if (syncReady()) { markDirty(); save(); scheduleSync(); }   // 用新密码重新加密云端数据
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
  function accountOptions(sel) {
    let h = `<option value="">${t('noAccount')}</option>`;
    const groups = {};
    DB.assets.forEach(a => { (groups[primary(a)] = groups[primary(a)] || []).push(a); });
    CLASSES.forEach(c => {
      if (!groups[c]) return;
      h += `<optgroup label="${t('cls_' + c)}">${groups[c].map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}${a.code ? ' · ' + esc(a.code) : ''} (${aCcy(a)})</option>`).join('')}</optgroup>`;
    });
    return h;
  }
  function txCcyList(extra) {
    const set = new Set(DISPLAY_CCYS);
    DB.assets.forEach(a => set.add(aCcy(a)));
    DB.txs.forEach(x => { if (x.ccy) set.add(x.ccy); });
    if (extra) set.add(extra);
    return Array.from(set);
  }
  const validCcy = c => /^[A-Z]{3,5}$/.test(c) && !!rateOf(c);
  /** 转账账户：所有资产按类别分组；现金类显示余额，其他显示持有数量 */
  function balOptions(sel) {
    let h = `<option value="">${t('pickAcct')}</option>`;
    const groups = {};
    DB.assets.forEach(a => { (groups[primary(a)] = groups[primary(a)] || []).push(a); });
    CLASSES.forEach(c => {
      if (!groups[c]) return;
      h += `<optgroup label="${t('cls_' + c)}">${groups[c].map(a => {
        const u = qtyUnit(a), amt = hidden() ? MASK : u ? `${trim8(+a.qty || 0)} ${u}` : `${aCcy(a)} ${fmtNum(+a.qty || 0, 0, 2)}`;
        return `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)} (${esc(amt)})</option>`;
      }).join('')}</optgroup>`;
    });
    return h;
  }
  function openTxModal(ex, presetType) {
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
        <div class="field"><label>${t('transferTo')}</label><select class="input" id="tf-to">${balOptions(st.toId)}</select></div>
        <div class="field" id="tf-recv-wrap" style="visibility:hidden"><label id="tf-recv-l">${t('received')}</label><input class="input num" id="tf-recv" inputmode="decimal" autocomplete="off" value="${st.toAmount != null ? esc(trim8(st.toAmount)) : ''}"></div>
      </div>
      <div class="hint" id="tf-val-hint" style="display:none;margin:-6px 0 12px"></div>
      <div class="field" id="tf-fee-wrap" style="display:none"><label id="tf-fee-l">${t('fee')}</label>
        <input class="input num" id="tf-fee" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${st.fee > 0 ? esc(trim8(st.fee)) : ''}">
        <div class="hint" id="tf-fee-hint"></div></div>
      <div class="field" id="tf-cats-wrap"><label>${t('category')}</label><div class="cat-grid" id="tf-cats"></div></div>
      <label class="switch-row" id="tf-sync-row"><span>${t('syncBalance')}<small>${t('syncBalanceSub')}</small></span>
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
        const syncRow = () => { const a = findAsset($('#tf-acct', m).value); $('#tf-sync-row', m).style.display = !isTr() && a && isBalance(a) ? '' : 'none'; };
        let recvTouched = !!(ex && ex.type === 'transfer');
        /** 转账：可在任意资产之间互转。金额框填转出“数量”（现金类为金额）；到账数量按价值自动折算，可手动改 */
        const trSync = () => {
          if (!isTr()) return;
          const f = findAsset($('#tf-acct', m).value), to = findAsset($('#tf-to', m).value), sel = $('#tf-ccy', m);
          const fu = qtyUnit(f), tu = qtyUnit(to);
          if (f) {
            if (![...sel.options].some(o => o.value === aCcy(f))) sel.insertAdjacentHTML('afterbegin', `<option value="${aCcy(f)}">${aCcy(f)}</option>`);
            sel.value = aCcy(f); $('#tf-sym', m).textContent = fu ? '' : symOf(aCcy(f)).trim();
          }
          sel.style.display = fu ? 'none' : '';
          $('#tf-unit', m).textContent = fu; $('#tf-unit', m).style.display = fu ? '' : 'none';
          $('#tf-amount', m).placeholder = fu ? '0.00000000' : '0.00';
          $('#tf-fee-l', m).innerHTML = `${t('fee')}${f ? ` (${esc(fu || aCcy(f))})` : ''} <span class="dim">· ${t('codeOpt')}</span>`;
          const amt = parseNum($('#tf-amount', m).value) || 0, fee0 = parseNum($('#tf-fee', m).value) || 0;
          $('#tf-fee-hint', m).innerHTML = f && fee0 > 0 ? t('feeHint', { a: fu ? `${trim8(round8(amt + fee0))} ${esc(fu)}` : money(amt + fee0, { ccy: aCcy(f), max: 8, raw: true }) }) : t('feeHint0');
          const val = f ? amt * unitPx(f) : 0, vh = $('#tf-val-hint', m);
          vh.style.display = f && fu && amt > 0 ? '' : 'none';
          if (f && fu) vh.innerHTML = t('transferValue', { v: money(val, { ccy: aCcy(f), max: 2, raw: true }), q: `${trim8(+f.qty || 0)} ${esc(fu)}` });
          const diff = f && to && (fu || tu || aCcy(f) !== aCcy(to));
          $('#tf-recv-wrap', m).style.visibility = diff ? 'visible' : 'hidden';
          if (diff) {
            $('#tf-recv-l', m).textContent = `${t('received')} (${tu || aCcy(to)})`;
            const px = unitPx(to);
            if (!recvTouched && amt > 0 && px > 0) $('#tf-recv', m).value = trim8(round8(conv(val, aCcy(f), aCcy(to)) / px));
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
        drawCats(); setMode();
        $('#tf-type', m).addEventListener('click', e => {
          const b = e.target.closest('[data-v]'); if (!b) return;
          st.type = b.dataset.v; $$('#tf-type button', m).forEach(x => x.classList.toggle('on', x === b)); setMode();
        });
        $('#tf-to', m).addEventListener('change', () => { recvTouched = false; trSync(); });
        $('#tf-recv', m).addEventListener('input', () => { recvTouched = true; });
        $('#tf-fee', m).addEventListener('input', trSync);
        $('#tf-amount', m).addEventListener('input', trSync);
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
            const fromId = $('#tf-acct', m).value, toId = $('#tf-to', m).value, f = findAsset(fromId), to = findAsset(toId);
            if (!f || !to) { toast(t('errTransferAcct'), 'err'); return; }
            if (fromId === toId) { toast(t('errTransferSame'), 'err'); return; }
            const fee = parseNum($('#tf-fee', m).value || '0');
            if (isNaN(fee) || fee < 0) { toast(t('errAmount'), 'err'); return; }
            const fu = qtyUnit(f), tu = qtyUnit(to), value = round8(amount * unitPx(f));
            let toAmount = amount;
            if (fu || tu || aCcy(f) !== aCcy(to)) {
              toAmount = parseNum($('#tf-recv', m).value);
              if (!(toAmount > 0)) { const px = unitPx(to); toAmount = px > 0 ? round8(conv(value, aCcy(f), aCcy(to)) / px) : 0; }
              if (!(toAmount > 0)) { toast(t('errRecv'), 'err'); $('#tf-recv', m).focus(); return; }
            }
            const tx = ex || { id: uid(), createdAt: Date.now() };
            const old = ex ? JSON.parse(JSON.stringify(ex)) : null, bal0 = balSnapshot();
            if (ex) applyTx(ex, -1);
            // 非现金资产：转出数量（含手续费）不能超过持有数量
            if (fu && amount + fee > (+f.qty || 0) + 1e-9) {
              if (ex) applyTx(ex, 1);
              toast(t('errTransferQty', { q: `${trim8(+f.qty || 0)} ${fu}` }), 'err'); return;
            }
            // 转入非现金资产：按转出部分的成本摊入平均成本
            const inCost = tu ? round8(conv(fu ? amount * (+f.cost || 0) : amount, aCcy(f), aCcy(to))) : null;
            Object.keys(tx).forEach(k => { if (!['id', 'createdAt', 'log'].includes(k)) delete tx[k]; });
            Object.assign(tx, { date, type: 'transfer', cat: 'transfer', amount, ccy: aCcy(f), accountId: fromId, toId, toAmount, toCcy: aCcy(to), fee, value, feeValue: round8(fee * unitPx(f)), note: $('#tf-note', m).value.trim(), applied: true });
            if (fu) tx.fromUnit = fu;
            if (tu) { tx.toUnit = tu; tx.inCost = inCost; }
            applyTx(tx, 1);
            if (!ex) DB.txs.push(tx);
            if (old) { const d = diffOf(old, tx, TX_FIELDS); if (d.length) logOp('tx', tx, 'edit', d); } else logOp('tx', tx, 'create');
            logBalChanges(bal0, tx, old ? 'edit' : 'create');
            commit(); closeModal(); renderAll();
            const q = (n, u) => (u ? `${trim8(n)} ${u}` : money(n, { ccy: aCcy(f), max: 8, raw: true }));
            toast(`${t('transferDone')} · ${f.name} → ${to.name} ${q(amount, fu)}${fee > 0 ? ` · ${t('fee')} ${q(fee, fu)}` : ''}`, 'ok');
            return;
          }
          const tx = ex || { id: uid(), createdAt: Date.now() };
          const old = ex ? JSON.parse(JSON.stringify(ex)) : null, bal0 = balSnapshot();
          if (ex) applyTx(ex, -1);
          ['toId', 'toAmount', 'toCcy', 'fee', 'value', 'feeValue', 'fromUnit', 'toUnit', 'inCost'].forEach(k => delete tx[k]);
          Object.assign(tx, { date, type: st.type, cat: st.cat, amount, ccy, accountId: $('#tf-acct', m).value || '', note: $('#tf-note', m).value.trim(), applied: false, appliedDelta: 0 });
          const a = findAsset(tx.accountId);
          if (a && isBalance(a) && $('#tf-sync', m).checked) {
            tx.applied = true;
            tx.appliedDelta = round8((tx.type === 'income' ? 1 : -1) * conv(tx.amount, tx.ccy, aCcy(a)));
            applyTx(tx, 1);
          }
          if (!ex) DB.txs.push(tx);
          if (old) { const d = diffOf(old, tx, TX_FIELDS); if (d.length) logOp('tx', tx, 'edit', d); } else logOp('tx', tx, 'create');
          logBalChanges(bal0, tx, old ? 'edit' : 'create');
          commit(); closeModal(); renderAll();
          toast(ex ? t('saved') : t('txSaved', { a: money((tx.type === 'income' ? 1 : -1) * tx.amount, { ccy: tx.ccy, sign: true, max: 8 }) }), 'ok');
        });
      }
    });
  }
  function applyTx(tx, sign) {
    if (tx.type === 'transfer') {
      if (!tx.applied) return;
      const f = findAsset(tx.accountId), to = findAsset(tx.toId);
      if (f) f.qty = round8((+f.qty || 0) - ((+tx.amount || 0) + (+tx.fee || 0)) * sign);   // 手续费从转出账户扣
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
    if (!a || !isBalance(a)) return;
    a.qty = round8((+a.qty || 0) + (+tx.appliedDelta || 0) * sign);
  }

  /* ---- 添加 / 编辑资产 ---- */
  function openAssetModal(id) {
    const ex = id ? findAsset(id) : null;
    const f = ex ? Object.assign({}, ex, { cls: tagsOf(ex).slice() })
      : { cls: [UI.hold.cls !== 'all' ? UI.hold.cls : 'stock'], name: '', code: '', qty: '', cost: '', price: '', ccy: 'USD', unit: 'g', source: 'online', note: '', warehouse: '' };
    if (!ex && isBalance(f)) { f.ccy = S().ccy; f.source = 'manual'; }
    const isStd = DISPLAY_CCYS.includes(aCcy(f));
    const num = v => (v === '' || v == null ? '' : esc(trim8(v)));
    const whs = Array.from(new Set(WAREHOUSE_PRESETS.concat(DB.assets.map(a => a.warehouse).filter(Boolean))));
    const body = `
      <div class="field"><label>${t('assetClass')} <span class="dim">· ${t('multiOk')}</span></label>
        <div class="cls-grid" id="af-cls">${CLASSES.map(c => `<button type="button" data-v="${c}" class="${f.cls.includes(c) ? 'on' : ''}" style="--tc:${CLASS_COLOR[c]}"><i class="cdot"></i>${t('cls_' + c)}<em>${f.cls[0] === c && f.cls.length > 1 ? t('primary') : ''}</em></button>`).join('')}</div>
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
          <div class="wh-chips" id="af-wh-chips">${WAREHOUSE_PRESETS.map(w => `<button type="button" data-v="${esc(w)}" class="${f.warehouse === w ? 'on' : ''}">${esc(w)}</button>`).join('')}</div></div>
      <div class="row2">
        <div class="field"><label id="af-qty-l"></label><input class="input num" id="af-qty" inputmode="decimal" autocomplete="off" value="${num(f.qty)}" placeholder="0.00000000"></div>
        <div class="field" id="af-unit-wrap"><label>${t('unit')}</label><select class="input" id="af-unit">${['oz', 'g', 'kg', 'pc'].map(u => `<option value="${u}" ${f.unit === u ? 'selected' : ''}>${t('unit_' + u)}</option>`).join('')}</select></div>
        <div class="field hide-bal" id="af-cost-wrap"><label>${t('avgCost')}</label><input class="input num" id="af-cost" inputmode="decimal" autocomplete="off" value="${num(f.cost)}" placeholder="0.00"></div>
      </div>
      <div class="field hide-bal"><label>${t('curPrice')}</label><div class="input-group">
        <input class="input num" id="af-price" inputmode="decimal" autocomplete="off" value="${num(f.price)}" placeholder="0.00">
        <button type="button" class="btn btn-soft" id="af-fetch">${ic('bolt')}${t('fetchOnline')}</button></div></div>
      <div class="fetch-msg" id="af-msg"></div>
      <div class="field hide-bal" id="af-src-wrap"><label>${t('quoteSource')}</label><div class="seg seg-full" id="af-src">
        <button type="button" data-v="online" class="${f.source === 'online' ? 'on' : ''}">${t('srcOnline')}</button>
        <button type="button" data-v="manual" class="${f.source !== 'online' ? 'on' : ''}">${t('srcManual')}</button></div></div>
      <div class="field"><label>${t('noteOpt')}</label><input class="input" id="af-note" value="${esc(f.note || '')}" maxlength="80" placeholder="${t('notePh')}"></div>
      <div class="preview" id="af-preview"></div>`;
    openModal({
      title: ex ? t('editAsset') : t('addAsset'),
      body,
      footer: `${ex ? `<span class="foot-meta">${t('createdAt')} ${fullTime(ex.createdAt)}</span>` : ''}<button class="btn btn-glass" data-modal-close>${t('cancel')}</button><button class="btn btn-accent" id="af-save">${ic('check')}${t('save')}</button>`,
      onMount(m) {
        const st = { cls: f.cls.slice(), ccy: isStd ? aCcy(f) : 'OTHER', source: f.source || 'online', touched: !!ex };
        const readForm = () => {
          const ccy = st.ccy === 'OTHER' ? ($('#af-ccy-other', m).value.trim().toUpperCase() || 'USD') : st.ccy;
          return {
            cls: st.cls.slice(), name: $('#af-name', m).value.trim(), code: $('#af-code', m).value.trim().toUpperCase(),
            ccy, qty: parseNum($('#af-qty', m).value), cost: parseNum($('#af-cost', m).value), price: parseNum($('#af-price', m).value),
            unit: $('#af-unit', m).value, source: st.source, note: $('#af-note', m).value.trim(), warehouse: $('#af-wh', m).value.trim()
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
          const a = readForm(), bal = isBalance(a);
          $$('.hide-bal', m).forEach(el => { el.style.display = bal ? 'none' : ''; });
          const showUnit = !bal && (a.cls.includes('gold') || a.cls.includes('physical'));
          $('#af-unit-wrap', m).style.display = showUnit ? '' : 'none';
          $('#af-cost-wrap', m).style.gridColumn = showUnit ? '1 / -1' : '';
          $('#af-code-wrap', m).style.display = bal ? 'none' : '';
          $('#af-qty-l', m).textContent = bal ? t('cashBalance') : t('colQty');
          const p = a.cls[0];
          $('#af-name', m).placeholder = t('namePh_' + p);
          $('#af-code', m).placeholder = t('codePh_' + p);
          $('#af-cls-hint', m).textContent = a.cls.map(c => t('clsHint_' + c)).join(' ');
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
        });
        ['#af-qty', '#af-cost', '#af-price', '#af-ccy-other'].forEach(s => $(s, m).addEventListener('input', preview));
        $('#af-code', m).addEventListener('input', sync);
        $('#af-unit', m).addEventListener('change', preview);
        $('#af-fetch', m).addEventListener('click', async () => {
          const a = readForm();
          if (!a.code) { msg(t('errNeedCode'), 'err'); $('#af-code', m).focus(); return; }
          const btn = $('#af-fetch', m);
          btn.disabled = true; btn.classList.add('spin'); msg(t('fetching'));
          try {
            const q = await Api.quoteAsset(a, S());
            const p = conv(q.price, q.ccy, a.ccy);
            $('#af-price', m).value = trim8(p);
            msg(`✓ ${t('fetched')} ${a.code} = ${money(p, { ccy: a.ccy, max: 8, raw: true })} · ${timeStr(Date.now())}`, 'ok');
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
          if (isNaN(a.qty)) { toast(t('errQty'), 'err'); $('#af-qty', m).focus(); return; }
          if (!validCcy(a.ccy)) { toast(t('errRate', { c: a.ccy }), 'err'); return; }
          if (bal) {
            a.cost = 1; a.price = 1; a.source = 'manual'; a.code = '';
            if (a.cls.includes('liability') && a.qty > 0) a.qty = -a.qty;     // 负债自动记为负数
          } else {
            if (isNaN(a.cost)) a.cost = 0;
            if (isNaN(a.price)) a.price = 0;
            if (!a.price && a.cost) a.price = a.cost;
            if (!Api.canQuote(a)) a.source = 'manual';
            if (a.cls.includes('liability') && a.qty > 0) a.qty = -a.qty;
          }
          if (!(a.cls.includes('gold') || a.cls.includes('physical'))) a.unit = '';
          if (ex) {
            if (ex.price !== a.price) a.updatedAt = Date.now();
            if (ex.code !== a.code || ex.unit !== a.unit) { a.prevClose = 0; a.prevDay = ''; }
            const d = diffOf(ex, a, ASSET_FIELDS);
            Object.assign(ex, a);
            if (d.length) logOp('asset', ex, 'edit', d);
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
  function errText(e) {
    const m = (e && e.message) || '';
    if (m === 'NO_KEY') return t('errNoKey');
    if (m === 'MANUAL') return t('errManual');
    if (m === 'NEED_CODE') return t('errNeedCode');
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return t('errFetch') + ' · ' + t('errNetwork');
    return t('errFetch') + (m ? ' · ' + m : '');
  }

  /* ---- 操作记录展示 ---- */
  const fullTime = ts => (ts ? new Date(ts).toLocaleString(locale(), { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');
  function fmtField(f, v, kind) {
    if (v === '' || v == null) return '<span class="dim">∅</span>';
    if (f === 'cls') return esc((Array.isArray(v) ? v : [v]).map(c => t('cls_' + c)).join(' · '));
    if (f === 'accountId' || f === 'toId') { const a = findAsset(v); return esc(a ? a.name : t('deletedAccount')); }
    if (f === 'cat') return esc(catName(v));
    if (f === 'type') return esc(t(v));
    if (f === 'source') return esc(v === 'online' ? t('srcOnline') : t('srcManual'));
    if (f === 'locked') return v ? t('lockYes') : t('lockNo');
    if (f === 'unit') return esc(t('unit_' + v));
    if (typeof v === 'number') return hidden() && ['qty', 'cost', 'price', 'amount', 'toAmount', 'fee'].includes(f) ? MASK : fmtNum(v, 0, 8);
    return esc(String(v));
  }
  function logEntryHTML(e, kind, withName) {
    const k = kind || e.kind;
    const diffs = (e.diffs || []).map(([f, a, b]) => `<div class="lg-d"><span class="lg-f">${t('fld_' + f)}</span>${e.act === 'create' ? '' : `${fmtField(f, a, k)} <i>→</i> `}${fmtField(f, b, k)}</div>`).join('');
    let extra = '';
    if (e.extra) {
      if (e.extra.tx) extra += `<div class="lg-d dim">${t('viaTx')}: ${esc(e.extra.tx)}</div>`;
      if (e.extra.from != null) extra += `<div class="lg-d">${t('fld_value')}: ${money(e.extra.from, { ccy: e.extra.ccy, max: 8 })} <i>→</i> ${money(e.extra.to, { ccy: e.extra.ccy, max: 8 })}</div>`;
      if (e.extra.value != null && e.act === 'delete') extra += `<div class="lg-d dim">${t('fld_value')}: ${money(e.extra.value, { ccy: e.extra.ccy, max: 8 })}</div>`;
      if (e.extra.file) extra += `<div class="lg-d dim">${esc(e.extra.file)}</div>`;
    }
    return `<div class="lg-item act-${e.act}"><div class="lg-h"><span class="lg-act">${t('act_' + e.act)}</span>${withName && e.name ? `<span class="lg-name">${t('kind_' + k)} · ${esc(e.name)}</span>` : ''}<span class="lg-ts num">${fullTime(e.ts)}</span></div>${diffs}${extra}</div>`;
  }
  function openHistory(kind, id) {
    const rec = kind === 'asset' ? findAsset(id) : DB.txs.find(x => x.id === id);
    if (!rec) return;
    const log = (rec.log || []).slice().reverse();
    const lastEdit = log.find(e => e.act !== 'create');
    const head = `<div class="hist-meta"><div><span class="dim">${t('createdAt')}</span><b class="num">${fullTime(rec.createdAt)}</b></div>
      <div><span class="dim">${t('lastEdited')}</span><b class="num">${lastEdit ? fullTime(lastEdit.ts) : '—'}</b></div>
      <div><span class="dim">${t('logCount')}</span><b class="num">${log.length}</b></div></div>`;
    openModal({
      title: `${ic('clock')} ${t('history')} · ${esc(kind === 'asset' ? rec.name : recTitle('tx', rec))}`,
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
    if (q.prev > 0) { a.prevClose = round8(conv(q.prev, q.ccy, aCcy(a))); a.prevDay = todayKey(); }
  }
  async function refreshOne(a) {
    try { await quoteInto(a); save(); renderAll(); }
    catch (e) { a.lastErr = errText(e); save(); if (UI.page === 'holdings') renderHoldBody(); }
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
      else { fail++; online[i].lastErr = errText(r.reason); if (r.reason && r.reason.message === 'NO_KEY') noKey = true; }
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

  function exportable() {
    const d = JSON.parse(JSON.stringify(DB));
    SECRET_KEYS.forEach(k => { d.settings[k] = ''; });
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
    const name = (DB.meta.name || 'AssetHub').replace(/[\\/:*?"<>|]+/g, '_');
    const blob = new Blob([JSON.stringify(exportable(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name}-${todayKey()}.json`;
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
    return { assets, txs, snaps };
  }
  /** 首次打开（没有任何数据）或仍在使用旧版演示数据时，自动填充演示数据 */
  function autoDemo() {
    if (DB.meta.noDemo) return false;
    const isOldDemo = DB.meta.demo === true && /Jasper's Asset(View|Hub)/.test(DB.meta.name || '') && Object.keys(DB.snaps).length < 30;   // 只替换旧版演示数据，绝不动真实数据
    if ((DB.assets.length || DB.txs.length) && !isOldDemo) return false;
    const d = buildDemo();
    DB.assets = d.assets; DB.txs = d.txs; DB.snaps = d.snaps;
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
    DB.assets = d.assets; DB.txs = d.txs; DB.snaps = d.snaps;
    if (!DB.meta.name) DB.meta.name = t('demoBookName');
    DB.meta.demo = true;
    logOp('system', null, 'demo');
    UI.hold.sel.clear(); UI.led.sel.clear();
    commit(); renderAll(); toast(t('demoLoaded'), 'ok');
    refreshQuotes({ silent: true });
  }

  /* ---- 批量操作 ---- */
  async function batchDelete(kind) {
    const st = kind === 'hold' ? UI.hold : UI.led, ids = Array.from(st.sel);
    if (!ids.length) return;
    if (kind === 'hold') {
      const locked = ids.some(id => (findAsset(id) || {}).locked);
      if (!(await confirmDialog({ title: t('batchDelT', { n: ids.length }), msg: t('batchDelAssetM') + (locked ? ' ' + t('hasLocked') : ''), ok: t('del') }))) return;
      if (!(await requireUnlock(locked ? t('verifyLockedMsg') : t('verifyAssetMsg'), locked))) return;
      DB.assets.filter(a => st.sel.has(a.id)).forEach(a => logOp('asset', a, 'delete', null, { value: aVal(a), ccy: aCcy(a), batch: true }));
      DB.assets = DB.assets.filter(a => !st.sel.has(a.id));
    } else {
      if (!(await confirmDialog({ title: t('batchDelT', { n: ids.length }), msg: t('batchDelTxM'), ok: t('del') }))) return;
      if (!(await requireUnlock())) return;
      const bal0 = balSnapshot();
      DB.txs.filter(x => st.sel.has(x.id)).forEach(x => { applyTx(x, -1); logOp('tx', x, 'delete', null, { batch: true }); });
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
      logOp('tx', x, 'delete');
      logBalChanges(bal0, x, 'delete');
      DB.txs = DB.txs.filter(v => v !== x);
      commit(); renderAll(); toast(t('deleted'), 'ok');
    },
    'add-asset'() { openAssetModal(); },
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
      const st = el.dataset.kind === 'hold' ? UI.hold : UI.led;
      el.dataset.ids.split(',').filter(Boolean).forEach(id => st.sel.add(id));
      el.dataset.kind === 'hold' ? renderHoldBody() : renderLedBody();
    },
    'sel-none'(el) { const st = el.dataset.kind === 'hold' ? UI.hold : UI.led; st.sel.clear(); el.dataset.kind === 'hold' ? renderHoldBody() : renderLedBody(); },
    'batch-del'(el) { batchDelete(el.dataset.kind); },
    async 'batch-lock'() {
      const ids = Array.from(UI.hold.sel); if (!ids.length) return;
      if (!S().passHash && !(await setPasswordFlow())) return;
      DB.assets.forEach(a => { if (UI.hold.sel.has(a.id) && !a.locked) { a.locked = true; logOp('asset', a, 'lock'); } });
      commit(); renderHoldBody(); toast(t('lockedN', { n: ids.length }), 'ok');
    },
    async 'batch-unlock'() {
      const ids = Array.from(UI.hold.sel); if (!ids.length) return;
      if (!(await requireUnlock(t('verifyLockedMsg'), true))) return;
      DB.assets.forEach(a => { if (UI.hold.sel.has(a.id) && a.locked) { a.locked = false; logOp('asset', a, 'unlock'); } });
      commit(); renderHoldBody(); toast(t('unlockedN', { n: ids.length }), 'ok');
    },
    'led-mode'(el) { UI.led.mode = el.dataset.v; UI.led.sel.clear(); renderLedger(); },
    'tx-type'(el) { UI.led.type = el.dataset.v; renderLedger(); },
    'date-picker'(el) { openDatePicker(el); },
    'rank-menu'(el) { openRankMenu(el); },
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
        row(t('goldSrc') + ' (PAXG)', Api.cryptoPriceUSD('PAXG', S().cryptoSrc).then(v => '$' + fmtNum(v, 2, 2) + ' / oz')),
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
        hint: bal ? '' : t('updValHint', { cost: money(aCost(a), { ccy, raw: true }) })
      });
      if (raw == null) return;
      let v = parseNum(raw);
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
      if (d.length) logOp('asset', a, bal ? 'updBal' : 'updVal', d, { from: cur, to: aVal(a), ccy });
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
        if (!validData(obj)) throw new Error(t('importBad'));
        applyCloud(obj); S().gistLast = Date.now(); save(); renderAll(); toast(t('gistPulled'), 'ok');
      } catch (e) { toast(t('syncFail') + ' · ' + syncErrText(e), 'err'); el.disabled = false; el.classList.remove('spin'); }
    }
  };

  function bindEvents() {
    document.addEventListener('click', e => {
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
        const st = el.dataset.sel === 'hold' ? UI.hold : UI.led;
        el.checked ? st.sel.add(el.value) : st.sel.delete(el.value);
        el.dataset.sel === 'hold' ? renderHoldBody() : renderLedBody();
        return;
      }
      if (el.dataset.selAll) {
        const kind = el.dataset.selAll, st = kind === 'hold' ? UI.hold : UI.led;
        const ids = kind === 'hold' ? holdList().map(r => r.a.id) : ledList().map(x => x.id);
        ids.forEach(id => (el.checked ? st.sel.add(id) : st.sel.delete(id)));
        kind === 'hold' ? renderHoldBody() : renderLedBody();
        return;
      }
      if (c === 'ccy') { S().ccy = el.value; save(); renderAll(); return; }
      if (c === 'yStep') { S().yStep = el.value; save(); drawTrend(); return; }
      if (c === 'rankCls') { S().rankCls = el.value; save(); renderRank(); return; }
      if (c === 'holdSort') { UI.hold.sort = el.value; renderHoldBody(); return; }
      if (c === 'ledCat') { UI.led.cat = el.value; renderLedBody(); return; }
      if (c === 'ledAcct') { UI.led.acct = el.value; renderLedBody(); return; }
      if (c === 'ledSort') { UI.led.sort = el.value; renderLedBody(); return; }
      if (el.dataset.set) {
        const k = el.dataset.set;
        const old = S()[k];
        S()[k] = el.type === 'checkbox' ? el.checked : (k === 'autoRefresh' || k === 'lockMinutes') ? +el.value : k === 'gistId' ? Api.gistIdOf(el.value) : k === 'gistToken' ? Api.cleanToken(el.value) : el.value.trim();
        if (k === 'gistId' || k === 'gistToken') el.value = S()[k];
        if (old === S()[k]) return;                                // 值没变（例如失焦时重复触发）就什么都不做
        if (k === 'gistId') S().syncedStamp = 0;                 // 换了 Gist 视为全新同步
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
  renderAll();
  if (demoNow) setTimeout(() => toast(t('demoAuto')), 600);
  if (S().autoSync && syncReady()) setTimeout(() => syncNow({ silent: true }), 400);   // 打开页面先拉取云端最新数据
  bindEvents();
  setupAutoRefresh();
  (async () => {
    if (Date.now() - DB.rates.ts > 3600e3) { if (await refreshRates(true)) renderAll(); }
    if (DB.assets.some(a => a.source === 'online') && Date.now() - DB.lastQuote > 5 * 60000) refreshQuotes({ silent: true });
  })();

  window.AssetHub = { get db() { return DB; }, refresh: refreshQuotes, render: renderAll };
})();
