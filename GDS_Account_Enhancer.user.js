// ==UserScript==
// @name         GDS 账户信息增强版 (v3.2.87-mod6 - 稳定布局优化版)
// @namespace    http://tampermonkey.net/
// @version      3.2.87.6
// @description  [v3.2.87-mod6]: 修复加载Bug。基于稳定版代码，仅“移植”界面布局优化（Flexbox、日志折叠），并实现“余额”列可控及默认显示。保证原核心功能无任何改动。
// @match        https://admin.gdspay.xyz/99*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @updateURL    https://raw.githubusercontent.com/lkm888/tampermonkey/main/GDS_Account_Enhancer.user.js
// @downloadURL  https://raw.githubusercontent.com/lkm888/tampermonkey/main/GDS_Account_Enhancer.user.js
// ==/UserScript==

(async function() {
  'use strict';

  // --- 常量定义 (来自原始脚本) ---
  const KEYS = { RELOAD_DELAY: 'gds_pending_reload_delay_after_401_v3.2', ACCOUNT_CACHE: 'gds_account_data_cache_idb_v3.2', ACCOUNT_ORDER: 'gds_account_order_idb_v3.2', THEME_PREF: 'gds_theme_preference_v3.1.7', COLUMN_VIS: 'gds_column_visibility_v3.1.8', SORT_CONF: 'gds_sort_config_v3.1.8', LAST_REFRESH: 'gds_last_successful_refresh_v3.1.8.1', LOGS_VISIBLE: 'gds_logs_visibility_v3.2.87.6' }; // [新增] 日志可见性Key
  const RELOAD_DELAY_MS = 5000, RELOAD_FLAG_GRACE_MS = 10000;
  const REFRESH_INTERVAL_MS = 7000;
  const TOKEN_REFRESH_DELAY_MS = 3000;
  const API_STATUS = { ENABLED: 1, CUSTOM_STOP: 2, STOP_RECEIPT: 3, DISAPPEARED: -1 };
  const DB_NAME = 'GDS_EnhancedScriptDB', DB_VERSION = 3;
  const STORES = { ACC_DATA: 'accountData', ACC_ORDER: 'accountOrder', OP_LOGS: 'operationLogs', FROZEN_LOGS: 'frozenLogs', SETTINGS: 'settings' };
  const MAX_LOG_DB = 80000, MAX_FROZEN_LOG_DB = 500;
  const MAX_LOG_MEM = 2000, MAX_FROZEN_LOG_MEM = 200;
  const MAX_BAL_HISTORY = 40;
  const PAYEE_OPTS = [ { name: '承兑KVB', payeeId: 110 }, { name: '承兑YES', payeeId: 804 }, { name: 'ABC代付', payeeId: 1162}, { name: 'NAMA2', payeeId: 2656}, { name: '92.7承兑主账户', payeeId: 798}, { name: 'Nammapay代付', payeeId: 803}, { name: 'MTY', payeeId: 2655} ];
  const TRANSFER_MODE_OPTS = [ { name: 'IMPS', transferMode: 1 }, { name: 'NEFT', transferMode: 2 }, { name: 'RTGS', transferMode: 3 }, ];
  const TRANSFER_PERCENT_OPTS = [ { name: '40%', value: 0.40 },{ name: '60%', value: 0.60 },{ name: '80%', value: 0.80 }, { name: '90%', value: 0.90 }, { name: '95%', value: 0.95 }, { name: '98%', value: 0.98 }, { name: '100%', value: 1.00 } ];
  const DEFAULT_TRIGGER_AMT = 500000, DEFAULT_TRANSFER_MODE = 3, DEFAULT_TRANSFER_PERCENT = 0.98;
  const DEFAULT_AUTO_STOP_AMT = 200000;
  const THROTTLES = { AUTO_TX_SUCCESS: 120 * 1000, AUTO_TX_GLOBAL_CHECK: 2000, AUTO_TX_ATTEMPT: 60 * 1000, AUTO_STOP_ATTEMPT: 30 * 1000, AUTO_RE_ENABLE_ATTEMPT: 30 * 1000, AUTO_TX_FAIL: 30 * 1000 };
  const RANDOM_TRANSFER_MIN_FACTOR = 0.95;
  const RANDOM_TRANSFER_MAX_FACTOR = 0.99;

  // --- 全局变量 (来自原始脚本) ---
  let accountDataCache = {}, accountOrder = [], operationLogs = [], frozenBalanceIncreaseLogs = [];
  let refreshIntervalId = null;
  let currentTheme = 'light', columnVisibility = {}, sortConfig = { key: 'id', direction: 'asc' };
  let lastSuccessfulDataTimestamp = null, lastAutoTransferCheckInitiatedTime = 0;
  let token = null; let refreshToken = null;
  let isRefreshingToken = false; let refreshPromise = null;
  let areLogsVisible = true; // [新增] 日志可见性状态

  // --- [优化] 样式注入，使用Flexbox布局 ---
  document.head.appendChild(Object.assign(document.createElement('style'), { innerHTML: `
    :root {
      --body-bg: #fff; --text-color: #212529; --text-muted-color: #6c757d; --link-color: #007bff;
      --border-color: #ccc; --border-color-light: #ddd; --border-color-lighter: #eee; --hover-bg-light: #e6f7ff;
      --panel-bg: #f8f9fa; --panel-border: #dee2e6; --panel-shadow: rgba(0,0,0,0.05);
      --input-bg: #fff; --input-border: #bbb; --input-text: #495085;
      --button-bg: #f8f8f8; --button-hover-bg: #e0e0e0; --button-border: #bbb;
      --button-active-bg: #cce5ff; --button-active-border: #007bff; --button-active-text: #004085;
      --button-disabled-opacity: 0.6; --button-disabled-bg: #eee;
      --table-bg: #fff; --table-border: #ddd; --table-header-bg: #e9e9e9;
      --table-row-even-bg: #f9f9f9; --table-row-hover-bg: #e6f7ff; --table-sticky-header-bg: #e9e9e9;
      --log-bg: #fdfdfd; --log-border: #ccc; --log-shadow: rgba(0,0,0,0.15);
      --log-entry-border: #eee; --log-time-color: #666; --log-account-id-color: #337ab7; --log-account-name-color: #555;
      --status-enabled-color: green; --status-api-stopped-color: red; --status-api-custom-stop-color: purple;
      --status-unknown-color: orange; --status-disappeared-color: #999;
      --balance-tier-1-color: #1976D2; --balance-tier-2-color: #00796B; --balance-tier-3-color: #388E3C; --balance-tier-4-color: #F57C00;
      --bal-high-color: red; --bal-negative-color: #28a745; --frozen-positive-color: #FF4136;
      --hourly-rate-positive-color: #28a745; --hourly-rate-monday-color: purple; --hourly-rate-stagnant-color: #6c757d;
      --hourly-rate-bg: #fff; --hourly-rate-border: #ddd;
      --toast-bg: rgba(0,0,0,0.75); --toast-text: white;
      --fetch-status-bg: #e0e0e0; --fetch-status-text: #333;
      --fetch-status-success-bg: #d4edda; --fetch-status-success-text: #155724; --fetch-status-success-border: #c3e6cb;
      --fetch-status-error-bg: #f8d7da; --fetch-status-error-text: #721c24; --fetch-status-error-border: #f5c6cb;
      --fetch-status-info-bg: #e0e0e0; --fetch-status-info-text: #333; --fetch-status-shadow: rgba(0,0,0,0.2);
    }
    body.dark-theme {
      --body-bg: #22272e; --text-color: #c9d1d9; --text-muted-color: #8b949e; --link-color: #58a6ff;
      --border-color: #444c56; --border-color-light: #373e47; --border-color-lighter: #2d333b; --hover-bg-light: #30363d;
      --panel-bg: #2d333b; --panel-border: #444c56; --panel-shadow: rgba(0,0,0,0.3);
      --input-bg: #22272e; --input-border: #545d68; --input-text: #c9d1d9;
      --button-bg: #373e47; --button-hover-bg: #444c56; --button-border: #545d68;
      --button-active-bg: #388bfd; --button-active-border: #58a6ff; --button-active-text: #ffffff;
      --button-disabled-opacity: 0.5; --button-disabled-bg: #2d333b;
      --table-bg: #1c2128; --table-border: #444c56; --table-header-bg: #373e47;
      --table-row-even-bg: #22272e; --table-row-hover-bg: #30363d; --table-sticky-header-bg: #373e47;
      --log-bg: #1c2128; --log-border: #444c56; --log-shadow: rgba(0,0,0,0.3);
      --log-entry-border: #373e47; --log-time-color: #8b949e; --log-account-id-color: #58a6ff; --log-account-name-color: #adbac7;
      --status-disappeared-color: #8b949e;
      --hourly-rate-positive-color: #56d364; --hourly-rate-monday-color: #c691ff; --hourly-rate-stagnant-color: #8b949e;
      --hourly-rate-bg: #22272e; --hourly-rate-border: #444c56;
      --toast-bg: rgba(200,200,200,0.85); --toast-text: #1c2128;
      --fetch-status-bg: #373e47; --fetch-status-text: #c9d1d9;
      --fetch-status-success-bg: #2ea043; --fetch-status-success-text: #ffffff; --fetch-status-success-border: #2ea043;
      --fetch-status-error-bg: #da3633; --fetch-status-error-text: #ffffff; --fetch-status-error-border: #da33;
      --fetch-status-info-bg: #373e47; --fetch-status-info-text: #c9d1d9; --fetch-status-shadow: rgba(0,0,0,0.4);
    }
    body { background-color: var(--body-bg); color: var(--text-color); transition: background-color 0.3s, color 0.3s; }
    input, select, button { color: var(--input-text); background-color: var(--input-bg); border: 1px solid var(--input-border); }
    select option { background-color: var(--input-bg); color: var(--input-text); }
    body.dark-theme select option { background-color: var(--input-bg) !important; color: var(--input-text) !important; }

    #gds-enhanced-ui { position: fixed; top: 10px; left: 10px; right: 10px; bottom: 10px; z-index: 9998; display: flex; flex-direction: column; gap: 8px; background-color: var(--body-bg); padding: 10px; border-radius: 8px; box-shadow: 0 4px 12px var(--panel-shadow); }
    #gds-header { flex-shrink: 0; display: flex; flex-direction: column; gap: 8px; }
    #gds-control-panel { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-family: monospace; font-size: 12px; padding: 6px; background-color: var(--panel-bg); border: 1px solid var(--panel-border); border-radius: 4px; }
    #gds-control-panel input, #gds-control-panel button { padding: 3px 6px; font-size: 12px; border-radius: 3px; }
    #gds-last-refresh-time { color: var(--text-muted-color); font-style: italic; }
    #gds-last-refresh-time.error { color: var(--bal-high-color); font-weight: bold; }
    #gds-column-toggle-panel { background: var(--panel-bg); border: 1px solid var(--panel-border); border-radius: 4px; padding: 6px 10px; display: flex; flex-wrap: wrap; gap: 10px; font-size: 11px; }
    #gds-column-toggle-panel label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }

    #gds-content-wrapper { flex-grow: 1; overflow: auto; border: 1px solid var(--panel-border); border-radius: 4px; }
    #gds-account-info { width: 100%; height: 100%; }
    #gds-account-info table { border-collapse: collapse; width:100%; font-family: monospace; font-size: 12px; }
    #gds-account-info th, #gds-account-info td { border: 1px solid var(--table-border); padding: 5px 7px; text-align: left; vertical-align: middle; white-space: nowrap; }
    #gds-account-info th { position: sticky; top: 0; background: var(--table-sticky-header-bg); font-weight: bold; z-index: 10; color: var(--text-color); cursor: pointer; user-select: none; }
    #gds-account-info th.sortable:hover { background-color: var(--button-hover-bg); }
    #gds-account-info tr:nth-child(even) td { background: var(--table-row-even-bg); }
    #gds-account-info tr:hover td { background: var(--table-row-hover-bg); }

    #gds-footer { flex-shrink: 0; max-height: 40%; display: flex; flex-direction: column; }
    #gds-logs-header { flex-shrink: 0; background-color: var(--panel-bg); padding: 4px 8px; border: 1px solid var(--panel-border); border-bottom: none; border-radius: 4px 4px 0 0; display: flex; justify-content: space-between; align-items: center; }
    #gds-logs-header .log-title { font-weight: bold; font-size: 13px; }
    #gds-toggle-logs-btn { font-size: 11px; padding: 2px 5px; cursor: pointer; }
    #gds-logs-container { display: flex; gap: 8px; overflow: hidden; transition: all 0.3s ease; }
    #gds-logs-container.hidden { max-height: 0; opacity: 0; margin-top: -8px; }
    .gds-log-base { flex: 1; background: var(--log-bg); border:1px solid var(--log-border); padding:10px; overflow-y: auto; font-size:12px; font-family:monospace; color: var(--text-color); min-height: 50px; border-radius: 0 0 4px 4px; }
    .gds-log-base .log-title { font-weight: bold; margin-bottom: 5px; display: block; }
    .gds-log-base .log-entry { margin-bottom:5px; padding-bottom: 3px; border-bottom: 1px dotted var(--log-entry-border); line-height: 1.4; }

    /* 恢复原始脚本的所有样式 */
    .gds-col-hidden { display: none !important; }
    .col-delete { text-align: center; min-width: 40px; } .col-id { text-align: right; min-width: 50px; } .col-platform { min-width: 100px; }
    .col-accountName { min-width: 120px; } .col-phone { min-width: 100px; }
    .col-balance, .col-frozenBalance { text-align: right; min-width: 100px; }
    .col-apiStatus { text-align: center; min-width: 70px; }
    .col-remarks { min-width: 80px; width: 1%; white-space: nowrap; }
    #gds-account-info input[type="text"].remarks-input { box-sizing: content-box; padding: 2px 4px; border: 1px solid var(--input-border); background-color: var(--input-bg); color: var(--input-text); transition: width 0.1s ease-in-out; }
    .col-lastChangeTime { min-width: 160px; }
    .col-statusOp { text-align: center; min-width: 170px; white-space: normal;}
    .col-loginStatus { text-align: center; min-width: 80px; }
    .col-failedReason { min-width: 150px; white-space: normal; }
    .col-balanceFailed { text-align: center; min-width: 100px; }
    .col-autoStopReceiptEnabled, .col-autoStopReceiptTriggerAmount, .col-autoTransferEnabled, .col-autoTransferRoundToInteger, .col-autoTransferTriggerAmount, .col-autoTransferMode, .col-autoTransferPercentage { text-align: center; min-width: 70px; } .col-autoTransferPayeeId { text-align: left; min-width: 100px; }
    #gds-account-info input[type="number"].autostopreceipt-setting, #gds-account-info input[type="number"].autotransfer-setting { width: 80px; text-align: right; padding: 2px 4px; box-sizing: border-box;}
    #gds-account-info input[type="checkbox"].autostopreceipt-setting, #gds-account-info input[type="checkbox"].autotransfer-setting { vertical-align: middle; margin: 0; }
    #gds-account-info select.autotransfer-setting { width: 100%; max-width: 120px; padding: 2px; box-sizing: border-box;}
    .delete-account-btn { padding: 2px 5px; font-size: 10px; color: var(--bal-high-color); background-color: transparent; border: 1px solid var(--bal-high-color); border-radius: 3px; cursor: pointer; }
    .delete-account-btn:hover { background-color: var(--bal-high-color); color: var(--body-bg); }
    .status-enabled { color: var(--status-enabled-color); } .status-api-stopped { color: var(--status-api-stopped-color); font-weight: bold; }
    .status-api-custom-stop { color: var(--status-api-custom-stop-color); font-weight: bold; }
    .status-unknown { color: var(--status-unknown-color); } .status-disappeared { color: var(--status-disappeared-color); font-style: italic; }
    .status-op-btn { padding: 3px 6px; font-size: 10px; margin: 1px; border: 1px solid var(--button-border); border-radius: 3px; cursor: pointer; background-color: var(--button-bg); color: var(--text-color); min-width: 45px; }
    .status-op-btn:hover { background-color: var(--button-hover-bg); border-color: var(--button-border); }
    .status-op-btn.active { background-color: var(--button-active-bg); border-color: var(--button-active-border); color: var(--button-active-text); font-weight: bold; }
    .status-op-btn[disabled] { cursor: not-allowed; opacity: var(--button-disabled-opacity); background-color: var(--button-disabled-bg); }
    .balance-tier-0 {} .balance-tier-1 { color: var(--balance-tier-1-color); } .balance-tier-2 { color: var(--balance-tier-2-color); } .balance-tier-3 { color: var(--balance-tier-3-color); } .balance-tier-4 { color: var(--balance-tier-4-color); }
    .bal-high { color: var(--bal-high-color) !important; font-weight: bold; } .bal-negative{ color: var(--bal-negative-color) !important; font-weight: bold;}
    .frozen-positive { color: var(--frozen-positive-color); font-weight: bold; }
    .login-status-ok { color: var(--status-enabled-color); }
    .login-status-logged-out { color: var(--status-api-stopped-color); }
    .login-status-logging-in { color: var(--status-unknown-color); }
    .balance-failed-yes { color: var(--bal-high-color); font-weight: bold; }
    .log-amount-increase { color: red; } .log-amount-decrease { color: green; }
    .log-status-change { color: blue; font-weight: bold; } .log-api-op-success { color: green; }
    .log-api-op-fail { color: red; } .log-transfer-attempt { color: #DAA520; }
    .log-transfer-success { color: #008000; font-weight: bold; } .log-transfer-fail { color: #B22222; font-weight: bold; }
    #gds-hourly-rate-display .rate-positive { color: var(--hourly-rate-positive-color); }
    #copy-toast { position: fixed; background: var(--toast-bg); color: var(--toast-text); padding: 8px 12px; border-radius: 4px; z-index: 10005; opacity: 0; transition: opacity 0.3s; pointer-events: none; font-size: 13px; }
    #gds-fetch-status { position: fixed; top: 15px; right: 20px; padding: 8px 12px; border-radius: 4px; font-size: 13px; z-index: 10003; display: none; }
  `}));

  // --- [优化] HTML 结构注入 ---
  document.body.insertAdjacentHTML('beforeend', `
    <div id="gds-enhanced-ui">
        <div id="gds-header">
            <div id="gds-control-panel">
              <input id="gds-search" placeholder="ID/平台/账号/手机/备注/失败原因/日志" title="可搜索多个关键词，用空格隔开"/>
              <button id="gds-refresh" title="手动刷新数据">刷新</button>
              <button id="gds-toggle-theme" title="切换主题">切换主题</button>
              <button id="gds-clear-log" title="清空操作、变动及冻结增加日志">清空日志</button>
              <button id="gds-export-logs" title="导出当前显示的日志数据 (操作/变动/冻结)">导出日志</button>
              <button id="gds-clear-prev-data" title="清空所有本地缓存数据和脚本设置">重置脚本</button>
              <span id="gds-last-refresh-time"></span>
              <span id="gds-hourly-rate-display">预计速度: N/A</span>
            </div>
            <div id="gds-column-toggle-panel"></div>
        </div>
        <div id="gds-content-wrapper">
            <div id="gds-account-info">正在加载数据...</div>
        </div>
        <div id="gds-footer">
            <div id="gds-logs-header">
                <span class="log-title">日志面板</span>
                <button id="gds-toggle-logs-btn" title="展开/收起日志面板">收起日志</button>
            </div>
            <div id="gds-logs-container">
                <div id="gds-account-log-container" class="gds-log-base"><span class="log-title">操作与变动日志</span></div>
                <div id="gds-frozen-log-container" class="gds-log-base"><span class="log-title">冻结金额增加日志</span></div>
            </div>
        </div>
    </div>
    <div id="copy-toast"></div>
    <span id="remarks-width-measurer" style="position:absolute; top:-9999px; left:-9999px; white-space:pre; padding: 0 4px; font-family: monospace; font-size: 12px;"></span>
    <div id="gds-fetch-status"></div>
  `);

  // --- [优化] DOM 元素缓存 ---
  const D = id => document.getElementById(id);
  const [searchInput, lastRefreshTimeEl, hourlyRateDisplay, columnTogglePanel, tableContainer, logDisplayContainer, frozenLogDisplayContainer, toast, fetchStatusDiv, logsContainer, toggleLogsBtn] =
        [D('gds-search'), D('gds-last-refresh-time'), D('gds-hourly-rate-display'), D('gds-column-toggle-panel'), D('gds-account-info'), D('gds-account-log-container'), D('gds-frozen-log-container'), D('copy-toast'), D('gds-fetch-status'), D('gds-logs-container'), D('gds-toggle-logs-btn')];

  // --- IndexedDB 辅助模块 (来自原始脚本) ---
  const dbHelper = (() => {
    let dbPromise = null;
    const openDB = () => dbPromise || (dbPromise = new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = e => (console.error("IndexedDB 错误:", req.error), rej("打开数据库错误: " + req.error));
      req.onsuccess = e => res(e.target.result);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        console.log(`IndexedDB upgrading from version ${e.oldVersion} to ${e.newVersion}`);
        Object.values(STORES).forEach(s => {
          if (db.objectStoreNames.contains(s)) {
            db.deleteObjectStore(s);
          }
          if (s === STORES.OP_LOGS || s === STORES.FROZEN_LOGS) {
            db.createObjectStore(s, { keyPath: 'id', autoIncrement: true }).createIndex('timeIndex', 'time', { unique: false });
          } else if (s === STORES.SETTINGS) {
            db.createObjectStore(s, { keyPath: 'key' });
          } else {
            db.createObjectStore(s);
          }
        });
        console.log('IndexedDB 升级完成或数据库已创建。');
      };
    }));
    const getObjectStore = async (store, mode) => (await openDB()).transaction(store, mode).objectStore(store);
    const get = async (store, key) => new Promise(async (resolve, reject) => { const req = (await getObjectStore(store, 'readonly')).get(key); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const set = async (store, keyOrObject, valueIfKey) => new Promise(async (resolve, reject) => { const req = (valueIfKey !== undefined) ? (await getObjectStore(store, 'readwrite')).put(valueIfKey, keyOrObject) : (await getObjectStore(store, 'readwrite')).put(keyOrObject); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const getAll = async (store, index = null, dir = 'next') => new Promise(async (res, rej) => {
      const results = []; const targetStore = index ? (await getObjectStore(store, 'readonly')).index(index) : (await getObjectStore(store, 'readonly'));
      const req = targetStore.openCursor(null, dir);
      req.onsuccess = e => { const cursor = e.target.result; if (cursor) { results.push(cursor.value); cursor.continue(); } else res(results); };
      req.onerror = e => rej(e.target.error);
    });
    const trimStore = async (store, max) => new Promise(async (resolve, reject) => {
      const db = await openDB(); const tx = db.transaction(store, 'readwrite'); const os = tx.objectStore(store);
      tx.oncomplete = () => resolve(); tx.onerror = e => (console.error(`trimStore for ${store} failed:`, e.target.error), reject(e.target.error)); tx.onabort = e => (console.warn(`trimStore for ${store} aborted:`, e.target.error), reject(e.target.error || '事务已中止'));
      const countReq = os.count();
      countReq.onsuccess = () => { if (countReq.result > max) { let numToDelete = countReq.result - max; const cursorReq = os.openCursor(null, 'next');
        cursorReq.onsuccess = e => { const cursor = e.target.result; if (cursor && numToDelete > 0) { const delReq = os.delete(cursor.primaryKey); delReq.onsuccess = () => { numToDelete--; cursor.continue(); }; delReq.onerror = e => (console.error(`trimStore cursor delete error:`, e.target.error), tx.abort()); }};
        cursorReq.onerror = e => (console.error(`trimStore cursor error:`, e.target.error), tx.abort());
      } else resolve(); };
      countReq.onerror = e => (console.error(`count request for ${store} failed:`, e.target.error), tx.abort());
    });
    const clear = async store => new Promise(async (resolve, reject) => {
      const tx = (await openDB()).transaction(store, 'readwrite'); const req = tx.objectStore(store).clear();
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error || `清除 ${store} 的事务失败`); tx.onabort = () => reject(tx.error || `清除 ${store} 的事务已中止`);
    });
    const deleteDB = async () => { if (dbPromise) { (await dbPromise).close(); dbPromise = null; }
      return new Promise((res, rej) => { console.log(`尝试删除 IndexedDB: ${DB_NAME}`); const req = indexedDB.deleteDatabase(DB_NAME); req.onsuccess = () => { console.log(`IndexedDB ${DB_NAME} 已成功删除。`); res(); }; req.onerror = e => { console.error(`删除数据库 ${DB_NAME} 时出错:`, e.target.error); rej(e.target.error); }; req.onblocked = () => { console.warn(`删除 ${DB_NAME} 被阻塞。请关闭使用此数据库的其他标签页。`); alert(`无法删除脚本数据库 ${DB_NAME}，因为它正被其他标签页使用。请关闭所有使用此脚本的标签页后重试。`); rej('数据库删除被阻塞。请关闭其他标签页。'); }; });
    };
    return { STORES, openDB, get, set, addLog: set, getAll, trimStore, clear, deleteDB };
  })();

  // --- [优化] 列配置，增加 defaultVisible 并使 balance 可隐藏 ---
  const columnConfig = [
    { id: 'deleteAction', label: '删', sortable: false, hideable: false, defaultVisible: true, cssClass: 'col-delete' },
    { id: 'id', label: 'ID', sortable: true, hideable: false, defaultVisible: true, dataKey: 'id', cssClass: 'col-id' },
    { id: 'platform', label: '平台', sortable: true, hideable: true, defaultVisible: true, dataKey: 'tripartiteId', cssClass: 'col-platform' },
    { id: 'accountName', label: '账号', sortable: true, hideable: true, defaultVisible: true, dataKey: 'accountName', cssClass: 'col-accountName' },
    { id: 'phone', label: '手机', sortable: true, hideable: true, defaultVisible: true, dataKey: 'otpReceiver', cssClass: 'col-phone' },
    { id: 'balance', label: '余额', sortable: true, hideable: true, defaultVisible: true, dataKey: 'balance', cssClass: 'col-balance' },
    { id: 'frozenBalance', label: '冻结', sortable: true, hideable: true, defaultVisible: true, dataKey: 'frozenBalance', cssClass: 'col-frozenBalance' },
    { id: 'apiStatus', label: '在线状态', sortable: true, hideable: true, defaultVisible: true, dataKey: 'apiStatus', cssClass: 'col-apiStatus' },
    { id: 'loginStatus', label: '登录状态', sortable: true, hideable: true, defaultVisible: false, dataKey: 'loginStatus', cssClass: 'col-loginStatus' },
    { id: 'failedReason', label: '失败原因', sortable: true, hideable: true, defaultVisible: false, dataKey: 'failedReason', cssClass: 'col-failedReason' },
    { id: 'balanceFailed', label: '余额查询失败', sortable: true, hideable: true, defaultVisible: false, dataKey: 'balanceFailed', cssClass: 'col-balanceFailed' },
    { id: 'remarks', label: '备注', sortable: true, hideable: true, defaultVisible: true, dataKey: 'remarks', cssClass: 'col-remarks' },
    { id: 'lastChangeTime', label: '金额变动时间', sortable: true, hideable: true, defaultVisible: true, dataKey: 'lastChangeTime', cssClass: 'col-lastChangeTime' },
    { id: 'statusOp', label: '状态操作', sortable: false, hideable: true, defaultVisible: true, cssClass: 'col-statusOp' },
    { id: 'autoStopReceiptEnabled', label: '自动止收', sortable: false, hideable: true, defaultVisible: true, cssClass: 'col-autoStopReceiptEnabled' },
    { id: 'autoStopReceiptTriggerAmount', label: '止收触发金额', sortable: false, hideable: true, defaultVisible: true, cssClass: 'col-autoStopReceiptTriggerAmount' },
    { id: 'autoTransferEnabled', label: '自动划转', sortable: false, hideable: true, defaultVisible: true, cssClass: 'col-autoTransferEnabled' },
    { id: 'autoTransferTriggerAmount', label: '触发金额', sortable: false, hideable: true, defaultVisible: true, cssClass: 'col-autoTransferTriggerAmount' },
    { id: 'autoTransferPayeeId', label: '收款账户', sortable: false, hideable: true, defaultVisible: true, cssClass: 'col-autoTransferPayeeId' },
    { id: 'autoTransferMode', label: '划转模式', sortable: false, hideable: true, defaultVisible: true, cssClass: 'col-autoTransferMode' },
    { id: 'autoTransferPercentage', label: '划转比例', sortable: false, hideable: true, defaultVisible: true, cssClass: 'col-autoTransferPercentage' },
    { id: 'autoTransferRoundToInteger', label: '取整', sortable: false, hideable: true, defaultVisible: true, cssClass: 'col-autoTransferRoundToInteger' },
  ];

  // --- 所有辅助函数、API请求、自动化任务等核心逻辑均恢复至您的原始版本，确保功能不变 ---
  const esc = str => (typeof str !== 'string' ? (str === null || str === undefined ? '' : String(str)) : document.createElement('div').appendChild(document.createTextNode(str)).parentNode.innerHTML);
  const showToast = (txt, x, y, dur = 1200) => { toast.innerText = txt; Object.assign(toast.style, { top: `${y}px`, left: `${x}px`, opacity: '1' }); clearTimeout(toast.timeoutId); toast.timeoutId = setTimeout(() => toast.style.opacity = '0', dur); };
  const showFetchStatus = (msg, type = 'info', dur = 3000) => { fetchStatusDiv.textContent = msg; fetchStatusDiv.className = type; fetchStatusDiv.style.display = 'block'; clearTimeout(fetchStatusDiv.timer); if (dur > 0) fetchStatusDiv.timer = setTimeout(() => fetchStatusDiv.style.display = 'none', dur); };
  const copyToClipboard = (txt, e) => navigator.clipboard.writeText(txt).then(() => showToast(`已复制: ${txt.length > 30 ? txt.substring(0,27)+'...' : txt}`, e.clientX + 10, e.clientY + 10)).catch(() => { const ta = Object.assign(document.createElement('textarea'), { value: txt, style: 'position:absolute;left:-9999px;' }); document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); showToast(`已复制: ${txt.length > 30 ? txt.substring(0,27)+'...' : txt}`, e.clientX + 10, e.clientY + 10); } catch (err) { showToast('复制失败', e.clientX + 10, e.clientY + 10); } document.body.removeChild(ta); });
  const fmtAmt = amt => isNaN(parseFloat(amt)) ? String(amt) : parseFloat(amt).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtCurrencyInt = amt => isNaN(parseFloat(amt)) ? String(amt) : Math.round(parseFloat(amt)).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const fmtApiStatus = s => { switch (parseInt(s)) { case API_STATUS.ENABLED: return { text: '启用', class: 'status-enabled' }; case API_STATUS.STOP_RECEIPT: return { text: '止收', class: 'status-api-stopped' }; case API_STATUS.CUSTOM_STOP: return { text: '停止', class: 'status-api-custom-stop' }; case API_STATUS.DISAPPEARED: return { text: '已消失', class: 'status-disappeared' }; default: return { text: `未知-${s}`, class: 'status-unknown' }; } };
  const fmtLoginStatus = s => { switch (parseInt(s)) { case 0: return { text: '未登录', class: 'login-status-logged-out' }; case 1: case 3: return { text: '登录中', class: 'login-status-logging-in' }; case 2: return { text: '登录成功', class: 'login-status-ok' }; default: return { text: `未知-${s}`, class: 'status-unknown' }; } };
  const fmtDT = dI => { const d = dI instanceof Date ? dI : new Date(dI); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`; };
  const fmtInt = s => { if (isNaN(s) || s < 0) return 'N/A'; if (s === 0) return '0s'; const m = Math.floor(s / 60), sec = s % 60; return `${m > 0 ? `${m}m ` : ''}${sec > 0 || m === 0 ? `${sec}s` : ''}`.trim(); };
  const stripHtml = html => { if (typeof html !== 'string') return ''; const tmp = document.createElement("DIV"); tmp.innerHTML = html; return tmp.textContent || tmp.innerText || ""; };
  async function _addLogEntry(logArr, dbStore, maxMem, maxDb, entryData) {
    const newLog = { ...entryData, time: fmtDT(new Date()), id: Date.now() + Math.random() };
    logArr.unshift(newLog); if (logArr.length > maxMem) logArr.pop();
    try { await dbHelper.addLog(dbStore, newLog); await dbHelper.trimStore(dbStore, maxDb); } catch (e) { console.error(`保存日志到 IndexedDB (${dbStore}) 时出错:`, e); }
    _renderLogs(dbStore === STORES.OP_LOGS ? logDisplayContainer : frozenLogDisplayContainer, logArr, dbStore === STORES.OP_LOGS ? '操作与变动日志' : '冻结金额增加日志');
  }
  function _renderLogs(container, logArr, title) {
    if (!container || !logArr || !title) return; // [新增] 防御性编程，避免在某些时刻调用时出错
    container.innerHTML = `<span class="log-title">${title}</span>`; const searchTerms = searchInput.value.toLowerCase().trim().split(/\s+/).filter(k => k);
    logArr.forEach(log => {
      const searchableText = `${log.time || ''} ${log.accountId || ''} ${log.accountName || ''} ${stripHtml(log.message || '')}`.toLowerCase();
      if (searchTerms.length > 0 && !searchTerms.every(k => searchableText.includes(k))) return;
      const entryDiv = document.createElement('div'); entryDiv.className = 'log-entry';
      let html = `<span class="log-time">[${esc(log.time)}]</span> `;
      if (log.accountId) html += `<span class="log-account-id">ID:${esc(log.accountId)}</span> <span class="log-account-name">(${esc(log.accountName || 'N/A')})</span>: `;
      html += log.message; if (log.interval && log.interval !== 'N/A') html += ` <span class="log-interval">(间隔 ${esc(log.interval)})</span>`;
      entryDiv.innerHTML = html; container.appendChild(entryDiv);
    });
  }
  const initAutoTxSettings = s => ({ enabled: typeof s?.enabled === 'boolean' ? s.enabled : false, triggerAmount: s?.triggerAmount !== undefined ? s.triggerAmount : DEFAULT_TRIGGER_AMT, payeeId: s?.payeeId !== undefined ? s.payeeId : '', transferMode: s?.transferMode !== undefined ? s.transferMode : DEFAULT_TRANSFER_MODE, roundToInteger: typeof s?.roundToInteger === 'boolean' ? s.roundToInteger : false, transferPercentage: s?.transferPercentage !== undefined ? s.transferPercentage : DEFAULT_TRANSFER_PERCENT });
  const initAutoStopSettings = s => ({ enabled: typeof s?.enabled === 'boolean' ? s.enabled : false, triggerAmount: s?.triggerAmount !== undefined ? s.triggerAmount : DEFAULT_AUTO_STOP_AMT });
  const loadSetting = async (key, defaultVal) => { try { const s = await dbHelper.get(dbHelper.STORES.SETTINGS, key); return s ? s.value : defaultVal; } catch (e) { console.error(`从 IndexedDB 加载 ${key} 时出错:`, e); return defaultVal; } };
  const saveSetting = async (key, value) => { try { await dbHelper.set(dbHelper.STORES.SETTINGS, { key, value }); } catch (e) { console.error(`保存 ${key} 到 IndexedDB 时出错:`, e); } };
  const applyTheme = t => { document.body.className = `${t}-theme`; currentTheme = t; saveSetting(KEYS.THEME_PREF, t); D('gds-toggle-theme').textContent = t === 'dark' ? '浅色主题' : '深色主题'; };
  const toggleTheme = () => applyTheme(currentTheme === 'light' ? 'dark' : 'light');
  function parseGmHeaders(headerStr) {
      const headers = new Headers(); if (!headerStr) return headers;
      headerStr.split('\r\n').forEach(headerPair => { const index = headerPair.indexOf(': '); if (index > 0) { const key = headerPair.substring(0, index); const value = headerPair.substring(index + 2); try { headers.append(key, value); } catch(e) { console.warn(`无法添加 Header: ${key}: ${value}`, e); } } });
      return headers;
  }
  const gmRequest = details => new Promise((res, rej) => {
    GM_xmlhttpRequest({
      method: details.method || "GET", url: details.url, headers: details.headers || {}, data: details.data, responseType: details.responseType, timeout: details.timeout || 15000,
      onload: r => res({ status: r.status, ok: r.status >= 200 && r.status < 300, headers: parseGmHeaders(r.responseHeaders), json: () => r.responseType === 'json' ? r.response : JSON.parse(r.responseText), text: () => r.responseText, rawJson: r.response, rawText: r.responseText }),
      onerror: r => (console.error("GM_xmlhttpRequest 错误:", r), rej(new Error(`网络错误: ${r.error || r.statusText || '未知 GM_xmlhttpRequest 错误'}`))),
      ontimeout: () => (console.error("GM_xmlhttpRequest 超时，URL:", details.url), rej(new Error('请求超时'))),
      onabort: () => (console.error("GM_xmlhttpRequest 已中止，URL:", details.url), rej(new Error('请求已中止')))
    });
  });
  async function refreshAuthTokens() {
      if (isRefreshingToken) return refreshPromise;
      isRefreshingToken = true;
      refreshPromise = (async () => {
          refreshToken = localStorage.getItem('refreshToken');
          if (!refreshToken) { console.error("GDS 脚本: 刷新Token缺失，无法刷新。"); showFetchStatus('刷新Token缺失。请重新登录。', 'error', 0); return false; }
          showFetchStatus('Token已过期，尝试刷新Token...', 'info', 0);
          try {
              const res = await gmRequest({ method: "GET", url: "https://admin.gdspay.xyz/api/auth/v1/refresh", headers: { "authorization": refreshToken, "accept": "application/json, text/plain, */*", "accept-language": "zh-CN,zh;q=0.9,en;q=0.8", "cache-control": "no-cache", "pragma": "no-cache", "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-origin" }, responseType: "json" });
              if (res.ok && res.rawJson?.code === 1) {
                  const { token: newAccessToken, refreshToken: newRefreshToken } = res.rawJson.data;
                  if (newAccessToken && newRefreshToken) { localStorage.setItem('token', newAccessToken); localStorage.setItem('refreshToken', newRefreshToken); token = newAccessToken; refreshToken = newRefreshToken; showFetchStatus('Token刷新成功!', 'success', 2000); console.log("GDS 脚本: Token刷新成功。"); return true; }
                  else { console.error("GDS 脚本: 刷新Token响应中缺少新的Token或刷新Token。", res.rawJson); showFetchStatus('刷新Token失败：响应数据不完整。', 'error', 4000); return false; }
              } else { const errMsg = res.rawJson?.msg || res.error || res.rawText || `状态码: ${res.status}`; console.error(`GDS 脚本: 刷新Token失败: ${errMsg}`); showFetchStatus(`刷新Token失败: ${errMsg}`, 'error', 4000); return false; }
          } catch (e) { console.error("GDS 脚本: 刷新Token请求异常:", e); showFetchStatus(`刷新Token请求异常: ${e.message}`, 'error', 4000); return false; }
          finally { isRefreshingToken = false; refreshPromise = null; }
      })();
      return refreshPromise;
  }
  async function apiRequest(details, retryCount = 0) {
      token = localStorage.getItem('token');
      if (!token) return { ok: false, status: 401, error: 'Token missing', rawText: 'Token缺失' };

      try {
          const res = await gmRequest({ ...details, headers: { ...details.headers, "authorization": token } });
          if (res.status === 401 && retryCount === 0) {
              console.warn('GDS 脚本: 收到 401 未授权错误，尝试刷新Token...');
              const refreshSuccess = await refreshAuthTokens();
              if (refreshSuccess) {
                  console.log(`GDS 脚本: Token刷新成功，等待 ${TOKEN_REFRESH_DELAY_MS / 1000} 秒后重试原API请求。`);
                  showFetchStatus(`Token刷新成功，等待 ${TOKEN_REFRESH_DELAY_MS / 1000} 秒后重试...`, 'info', TOKEN_REFRESH_DELAY_MS + 500);
                  await new Promise(res => setTimeout(res, TOKEN_REFRESH_DELAY_MS));
                  console.log('GDS 脚本: 延迟结束，正在重试原API请求。');
                  return await apiRequest(details, 1);
              } else { console.error('GDS 脚本: Token刷新失败，无法重试原请求。'); showFetchStatus('Token刷新失败，无法重试原请求。请重新登录。', 'error', 0); throw new Error('Token刷新失败，无法重试原请求。'); }
          }
          return res;
      } catch (error) {
          if (error.message === 'Token刷新失败，无法重试原请求。') throw error;
          console.error('API请求异常:', error); showFetchStatus(`API请求异常: ${error.message}`, 'error', 4000);
          return { ok: false, error: error.message };
      }
  }
  async function _setAccountApiStatus(accId, newStatus, srcAction = "手动操作") {
    const accCache = accountDataCache[accId];
    if (!accCache?.current) { _addLogEntry(operationLogs, STORES.OP_LOGS, MAX_LOG_MEM, MAX_LOG_DB, { accountId: accId, message: `${srcAction}: 设置状态为 "${fmtApiStatus(newStatus).text}" <span class="log-api-op-fail">(失败: 账户数据缺失)</span>` }); return false; }
    const { accountName, platform: tripartiteId, apiStatus: oldStatus } = accCache.current;
    if (oldStatus === newStatus && srcAction === "手动操作") { showToast('状态未改变', window.innerWidth / 2, window.innerHeight / 2, 800); return true; }
    if (oldStatus === newStatus) return true;
    showFetchStatus(`ID ${accId} (${srcAction}): 设置状态为 "${fmtApiStatus(newStatus).text}"...`, 'info', 0);
    try {
      const res = await apiRequest({ method: "POST", url: "https://admin.gdspay.xyz/api/tripartite/v1/account/status/modify", headers: { "content-type": "application/json" }, data: JSON.stringify({ accountId: parseInt(accId), accountName, tripartiteId, accountStatus: newStatus }), responseType: "json" });
      const r = res.rawJson;
      if (res.ok && r?.code === 1) {
        showFetchStatus(`ID ${accId} (${srcAction}): 状态设置成功!`, 'success', 2500); accCache.current.apiStatus = newStatus;
        if (srcAction === "自动止收" && newStatus === API_STATUS.STOP_RECEIPT) accCache.isAutoStoppedByScript = true;
        else if (newStatus === API_STATUS.ENABLED || newStatus === API_STATUS.CUSTOM_STOP) accCache.isAutoStoppedByScript = false;
        await saveAccountDataToDB(); renderTable();
        _addLogEntry(operationLogs, STORES.OP_LOGS, MAX_LOG_MEM, MAX_LOG_DB, { accountId: accId, accountName, message: `${srcAction}: 在线状态从 ${fmtApiStatus(oldStatus).text} → <span class="log-status-change">${fmtApiStatus(newStatus).text}</span> <span class="log-api-op-success">(成功)</span>` }); return true;
      } else { const errMsg = r ? r.msg : (res.rawText || '未知错误'); showFetchStatus(`ID ${accId} (${srcAction}): 状态设置失败 - ${errMsg}`, 'error', 4000); _addLogEntry(operationLogs, STORES.OP_LOGS, MAX_LOG_MEM, MAX_LOG_DB, { accountId: accId, accountName, message: `${srcAction}: 在线状态从 ${fmtApiStatus(oldStatus).text} → ${fmtApiStatus(newStatus).text} <span class="log-api-op-fail">(失败: ${esc(errMsg)})</span>` }); return false; }
    } catch (e) { console.error(`${srcAction} - 设置状态API请求错误 (ID ${accId}):`, e); showFetchStatus(`ID ${accId} (${srcAction}): 状态设置请求异常 - ${e.message}`, 'error', 4000); _addLogEntry(operationLogs, STORES.OP_LOGS, MAX_LOG_MEM, MAX_LOG_DB, { accountId: accId, accountName, message: `${srcAction}: 在线状态从 ${fmtApiStatus(oldStatus).text} → ${fmtApiStatus(newStatus).text} <span class="log-api-op-fail">(请求异常: ${esc(e.message)})</span>` }); return false; }
  }
  async function checkAndPerformAutoStopReceipt(specificAccId = null) {
    const accs = specificAccId ? [specificAccId] : Object.keys(accountDataCache);
    for (const accId of accs) {
      const c = accountDataCache[accId]; if (!c?.current || !c.autoStopReceiptSettings?.enabled || c.current.isDisappeared) continue;
      const { current: acc, autoStopReceiptSettings: s } = c;
      const trigAmt = parseFloat(s.triggerAmount); if (isNaN(trigAmt) || trigAmt <= 0) continue;
      if (acc.balance > trigAmt && acc.apiStatus === API_STATUS.ENABLED) {
        const now = Date.now(); if (c.lastAutoStopAttempt && (now - c.lastAutoStopAttempt < THROTTLES.AUTO_STOP_ATTEMPT)) continue;
        c.lastAutoStopAttempt = now;
        _addLogEntry(operationLogs, STORES.OP_LOGS, MAX_LOG_MEM, MAX_LOG_DB, { accountId: accId, accountName: acc.accountName, message: `<span class="log-transfer-attempt">自动止收触发: 余额 ${fmtAmt(acc.balance)} > ${fmtAmt(trigAmt)}. 尝试设置状态为 "止收".</span>` });
        const success = await _setAccountApiStatus(accId, API_STATUS.STOP_RECEIPT, "自动止收");
        if (success) delete c.lastAutoStopAttempt; await saveAccountDataToDB();
      }
    }
  }
  async function checkAndPerformAutoReEnable(specificAccId = null) {
    const accs = specificAccId ? [specificAccId] : Object.keys(accountDataCache);
    for (const accId of accs) {
      const c = accountDataCache[accId]; if (!c?.current || !c.autoStopReceiptSettings?.enabled || c.current.isDisappeared) continue;
      const { current: acc, autoStopReceiptSettings: s } = c;
      const trigAmt = parseFloat(s.triggerAmount); if (isNaN(trigAmt) || trigAmt <= 0) continue;
      if (acc.apiStatus === API_STATUS.STOP_RECEIPT && c.isAutoStoppedByScript && acc.balance < trigAmt) {
        const now = Date.now(); if (c.lastAutoReEnableAttempt && (now - c.lastAutoReEnableAttempt < THROTTLES.AUTO_RE_ENABLE_ATTEMPT)) continue;
        c.lastAutoReEnableAttempt = now;
        _addLogEntry(operationLogs, STORES.OP_LOGS, MAX_LOG_MEM, MAX_LOG_DB, { accountId: accId, accountName: acc.accountName, message: `<span class="log-autorenable-attempt">自动解除止收触发: 余额 ${fmtAmt(acc.balance)} < ${fmtAmt(trigAmt)}. 尝试设置状态为 "启用".</span>` });
        const success = await _setAccountApiStatus(accId, API_STATUS.ENABLED, "自动解除止收");
        if (success) delete c.lastAutoReEnableAttempt; await saveAccountDataToDB();
      }
    }
  }
  async function checkAndPerformAutoTransfers(specificAccId = null) {
  const nowGlobal = Date.now();
  if (!specificAccId && (nowGlobal - lastAutoTransferCheckInitiatedTime < THROTTLES.AUTO_TX_GLOBAL_CHECK)) return;
  if (!specificAccId) lastAutoTransferCheckInitiatedTime = nowGlobal;
  for (const accId of specificAccId ? [specificAccId] : Object.keys(accountDataCache)) {
    const c = accountDataCache[accId];
    if (!c?.current || !c.autoTransferSettings?.enabled || c.current.isDisappeared || ![API_STATUS.ENABLED, API_STATUS.STOP_RECEIPT].includes(c.current.apiStatus)) continue;
    const { current: acc, autoTransferSettings: s } = c;
    const nowPerAcc = Date.now();
    if ((c.lastSuccessfulTransferTime && (nowPerAcc - c.lastSuccessfulTransferTime < THROTTLES.AUTO_TX_SUCCESS)) || (c.lastFailedTransferTime && (nowPerAcc - c.lastFailedTransferTime < THROTTLES.AUTO_TX_FAIL)) || (c.lastTransferAttemptTime && (nowPerAcc - c.lastTransferAttemptTime < THROTTLES.AUTO_TX_ATTEMPT))) continue;
    const trigAmt = parseFloat(s.triggerAmount);
    if (isNaN(trigAmt) || trigAmt <= 0 || acc.balance < trigAmt) continue;
    if (!s.payeeId || !s.transferMode) { _addLogEntry(operationLogs, STORES.OP_LOGS, MAX_LOG_MEM, MAX_LOG_DB, { accountId: accId, accountName: acc.accountName, message: `<span class="log-transfer-fail">自动划转配置不完整 (收款账户或模式未选)</span>` }); continue; }
    const txPerc = parseFloat(s.transferPercentage);
    if (isNaN(txPerc) || txPerc <= 0 || txPerc > 1) { _addLogEntry(operationLogs, STORES.OP_LOGS, MAX_LOG_MEM, MAX_LOG_DB, { accountId: accId, accountName: acc.accountName, message: `<span class="log-transfer-fail">自动划转失败: 无效的划转比例 (${esc(String(s.transferPercentage))})</span>` }); continue; }
    const baseAmountFromSettings = acc.balance * txPerc;
    let finalTransferAmountYuan = Math.round(baseAmountFromSettings * (Math.random() * (RANDOM_TRANSFER_MAX_FACTOR - RANDOM_TRANSFER_MIN_FACTOR) + RANDOM_TRANSFER_MIN_FACTOR));
    if (s.roundToInteger) finalTransferAmountYuan = Math.floor(finalTransferAmountYuan / 100) * 100;
    const amtInCents = Math.floor(finalTransferAmountYuan * 100);
    if (amtInCents <= 0) { _addLogEntry(operationLogs, STORES.OP_LOGS, MAX_LOG_MEM, MAX_LOG_DB, { accountId: accId, accountName: acc.accountName, message: `<span class="log-transfer-fail">计算后划转金额为0或负数 (${fmtAmt(amtInCents/100)})，不执行</span>` }); continue; }
    const reqId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    const payload = { tripartiteId: acc.platform, accountName: acc.accountName, payeeId: parseInt(s.payeeId), amount: amtInCents, transferMode: parseInt(s.transferMode), isBulk: false, version: Date.now() };
    const payeeName = PAYEE_OPTS.find(p => p.payeeId === payload.payeeId)?.name || `PayeeID ${payload.payeeId}`;
    const modeName = TRANSFER_MODE_OPTS.find(m => m.transferMode === payload.transferMode)?.name || `Mode ${payload.transferMode}`;
    c.lastTransferAttemptTime = nowPerAcc;
    delete c.lastSuccessfulTransferTime; delete c.lastFailedTransferTime;
    await saveAccountDataToDB();
    const commonLogMsg = `自动划转 ${fmtAmt(amtInCents / 100)} (随机金额: ${fmtCurrencyInt(finalTransferAmountYuan)} 元，原预计 ${fmtAmt(baseAmountFromSettings)}) 到 ${esc(payeeName)} (模式: ${esc(modeName)})`;
    _addLogEntry(operationLogs, STORES.OP_LOGS, MAX_LOG_MEM, MAX_LOG_DB, { accountId: accId, accountName: acc.accountName, message: `<span class="log-transfer-attempt">${commonLogMsg}</span>` });
    showFetchStatus(`ID ${accId}: 尝试自动划转 ${fmtAmt(amtInCents / 100)}...`, 'info', 5000);
    try {
      const res = await apiRequest({ method: "POST", url: "https://admin.gdspay.xyz/api/tripartite/v1/transfer/manual", headers: { "content-type": "application/json", "X-Request-ID": reqId }, data: JSON.stringify(payload), responseType: "json" });
      const r = res.rawJson;
      if (res.ok && r?.code === 1) { c.lastSuccessfulTransferTime = Date.now(); _addLogEntry(operationLogs, STORES.OP_LOGS, MAX_LOG_MEM, MAX_LOG_DB, { accountId: accId, accountName: acc.accountName, message: `<span class="log-transfer-success">${commonLogMsg} 成功!</span>` }); showFetchStatus(`ID ${accId}: 自动划转成功!`, 'success', 3000); }
      else { c.lastFailedTransferTime = Date.now(); const errMsg = r ? r.msg : (res.rawText || '未知错误'); _addLogEntry(operationLogs, STORES.OP_LOGS, MAX_LOG_MEM, MAX_LOG_DB, { accountId: accId, accountName: acc.accountName, message: `<span class="log-transfer-fail">${commonLogMsg} 失败: ${esc(errMsg)}</span>` }); showFetchStatus(`ID ${accId}: 自动划转失败 - ${errMsg}`, 'error', 5000); }
    } catch (e) {
      c.lastFailedTransferTime = Date.now(); console.error(`ID ${accId}: 自动划转 API 请求错误:`, e); _addLogEntry(operationLogs, STORES.OP_LOGS, MAX_LOG_MEM, MAX_LOG_DB, { accountId: accId, accountName: acc.accountName, message: `<span class="log-transfer-fail">${commonLogMsg} 请求异常: ${esc(e.message)}</span>` }); showFetchStatus(`ID ${accId}: 自动划转请求异常`, 'error', 5000);
    } finally {
      delete c.lastTransferAttemptTime; await saveAccountDataToDB();
    }
  }
}
  function calculateEstimatedHourlyRate(accCache) {
    const nowTs = Date.now();
    const tenMinAgoTs = nowTs - (10 * 60 * 1000);
    const totalIncrease = Object.values(accCache).reduce((overallAcc, c) => {
        if (!c?.current || c.current.isDisappeared) return overallAcc;
        const history = c.current.balanceHistory;
        if (!Array.isArray(history) || history.length < 2) return overallAcc;
        const recentHistory = history
            .filter(h => h.timestamp >= tenMinAgoTs && typeof h.balance === 'number')
            .sort((a, b) => a.timestamp - b.timestamp);
        if (recentHistory.length < 2) return overallAcc;
        const accountIncrease = recentHistory.reduce((acc, currH, index, arr) => {
            if (index === 0) return acc;
            const prevH = arr[index - 1];
            return acc + (currH.balance > prevH.balance ? (currH.balance - prevH.balance) : 0);
        }, 0);
        return overallAcc + accountIncrease;
    }, 0);

    if (totalIncrease === 0) {
        return `预计速度: <span class="rate-stagnant">N/A (近10分钟无增)</span>`;
    }
    const estimatedHourly = totalIncrease * 6;
    const rateClass = "rate-positive";
    const prefix = "预计速度";

    return `${prefix}: <span class="${rateClass}"><span class="rate-value">+${fmtAmt(estimatedHourly)}</span>/小时</span>`;
  }
  const getApiStatusOrder = s => {
    switch (s) { case API_STATUS.ENABLED: return 0; case API_STATUS.STOP_RECEIPT: return 1; case API_STATUS.DISAPPEARED: return 2; case API_STATUS.CUSTOM_STOP: return 3; default: return 99; }
  };
  function renderColumnTogglePanel() {
    columnTogglePanel.innerHTML = '列显示控制: ' + columnConfig.filter(c => c.hideable).map(c => `
      <label title="${esc(c.label)}"><input type="checkbox" data-col-id="${esc(c.id)}" ${columnVisibility[c.id] ? 'checked' : ''}>${esc(c.label)}</label>
    `).join('');
  }
  function handleColumnToggle(e) {
    const cb = e.target; if (cb.type === 'checkbox' && cb.dataset.colId) { columnVisibility[cb.dataset.colId] = cb.checked; saveSetting(KEYS.COLUMN_VIS, columnVisibility); renderTable(); }
  }
  async function handleHeaderClick(e) {
    const th = e.target.closest('th'); if (!th?.dataset.colId) return;
    const colId = th.dataset.colId; const col = columnConfig.find(c => c.id === colId); if (!col?.sortable) return;
    sortConfig = sortConfig.key === colId ? { key: colId, direction: sortConfig.direction === 'asc' ? 'desc' : 'asc' } : { key: colId, direction: 'asc' };
    await saveSetting(KEYS.SORT_CONF, sortConfig); renderTable();
  }
  function renderTable() {
    let headerHtml = '<thead><tr>';
    columnConfig.forEach(c => {
        let thClass = c.cssClass || '';
        if (c.hideable && !columnVisibility[c.id]) thClass += ' gds-col-hidden';
        if (c.sortable) thClass += ' sortable';
        headerHtml += `<th class="${thClass}" data-col-id="${c.id}" title="${esc(c.label)} ${c.sortable ? '(可排序)' : ''}">${esc(c.label)}${c.sortable && sortConfig.key === c.id ? (sortConfig.direction === 'asc' ? ' ▲' : ' ▼') : ''}</th>`;
    });
    headerHtml += '</tr></thead>';

    const searchTerms = searchInput.value.toLowerCase().trim().split(/\s+/).filter(k => k);
    let sortedAccounts = accountOrder.map(id => accountDataCache[id]).filter(Boolean);

    sortedAccounts.sort((a, b) => {
      const orderA = getApiStatusOrder(a.current?.apiStatus ?? -999); const orderB = getApiStatusOrder(b.current?.apiStatus ?? -999); if (orderA !== orderB) return orderA - orderB;
      const currentSortCol = columnConfig.find(c => c.id === sortConfig.key);
      let valA, valB;
      if (currentSortCol) {
        if (currentSortCol.id === 'id' || currentSortCol.id === 'loginStatus') { valA = parseInt(a.current?.[currentSortCol.dataKey] ?? '0', 10); valB = parseInt(b.current?.[currentSortCol.dataKey] ?? '0', 10); }
        else if (['balance', 'frozenBalance'].includes(currentSortCol.id)) { valA = parseFloat(a.current?.[currentSortCol.dataKey] ?? -Infinity); valB = parseFloat(b.current?.[currentSortCol.dataKey] ?? -Infinity); }
        else if (currentSortCol.id === 'apiStatus') { valA = parseInt(a.current?.id || '0', 10); valB = parseInt(b.current?.id || '0', 10); return valA - valB; }
        else if (currentSortCol.id === 'lastChangeTime') { valA = a.current?.lastChangeTime ? new Date(String(a.current.lastChangeTime).replace(/-/g, '/')).getTime() : 0; valB = b.current?.lastChangeTime ? new Date(String(b.current.lastChangeTime).replace(/-/g, '/')).getTime() : 0; }
        else if (currentSortCol.id === 'balanceFailed') { valA = a.current?.balanceFailed ? 1 : 0; valB = b.current?.balanceFailed ? 1 : 0; }
        else if (currentSortCol.dataKey) { valA = String(a.current?.[currentSortCol.dataKey] ?? '').toLowerCase(); valB = String(b.current?.[currentSortCol.dataKey] ?? '').toLowerCase(); }
        else { valA = parseInt(a.current?.id || '0', 10); valB = parseInt(b.current?.id || '0', 10); }
      } else { valA = parseInt(a.current?.id || '0', 10); valB = parseInt(b.current?.id || '0', 10); }
      let comparison = (typeof valA === 'number' && typeof valB === 'number') ? (valA - valB) : (String(valA) < String(valB) ? -1 : (String(valA) > String(valB) ? 1 : 0));
      if (sortConfig.direction === 'desc') comparison *= -1;
      return comparison === 0 ? (parseInt(a.current?.id || '0', 10) - parseInt(b.current?.id || '0', 10)) : comparison;
    });

    let bodyHtml = '<tbody>';
    sortedAccounts.forEach(c => {
      const acc = c.current; const txS = c.autoTransferSettings; const stopS = c.autoStopReceiptSettings;
      if (!acc || (searchTerms.length > 0 && !searchTerms.every(k => `${acc.id} ${acc.platform} ${acc.accountName} ${acc.phone} ${acc.remarks || ''} ${acc.failedReason || ''}`.toLowerCase().includes(k)))) return;
      let rowHtml = `<tr data-account-id="${esc(acc.id)}">`;
      columnConfig.forEach(col => {
        let cellClass = col.cssClass || ''; if (col.hideable && !columnVisibility[col.id]) cellClass += ' gds-col-hidden';
        let content = '';
        switch (col.id) {
          case 'deleteAction': content = `<button class="delete-account-btn" data-account-id="${esc(acc.id)}" title="删除此账户的本地记录">删</button>`; break;
          case 'id': content = esc(acc.id); break; case 'platform': content = esc(acc.platform); break;
          case 'accountName': content = esc(acc.accountName); cellClass += `" title="${esc(acc.description || '')}`; break;
          case 'phone': content = esc(acc.phone); break;
          case 'balance':
            if (acc.balance >= 0 && acc.balance < 200000) { let tierSuffix = '0'; if (acc.balance >= 150000) tierSuffix = '4'; else if (acc.balance >= 100000) tierSuffix = '3'; else if (acc.balance >= 50000) tierSuffix = '2'; else if (acc.balance >= 10000) tierSuffix = '1'; cellClass += ` balance-tier-${tierSuffix}`; }
            if (acc.balance >= 200000) cellClass += ' bal-high'; else if (acc.balance < 0) cellClass += ' bal-negative';
            content = fmtAmt(acc.balance); break;
          case 'frozenBalance': if (acc.frozenBalance > 0) cellClass += ' frozen-positive'; content = fmtAmt(acc.frozenBalance); break;
          case 'apiStatus': const sI = fmtApiStatus(acc.apiStatus); cellClass += ` ${esc(sI.class)}`; content = esc(sI.text); break;
          case 'loginStatus': const lI = acc.isDisappeared ? fmtLoginStatus(0) : fmtLoginStatus(acc.loginStatus); cellClass += ` ${esc(lI.class)}`; content = esc(lI.text); break;
          case 'failedReason': content = esc(acc.failedReason || '无'); cellClass += `" title="${esc(acc.failedReason || '')}`; break;
          case 'balanceFailed': content = acc.balanceFailed ? '是' : '否'; if (acc.balanceFailed) cellClass += ' balance-failed-yes'; break;
          case 'remarks': content = `<input type="text" class="remarks-input" data-account-id="${esc(acc.id)}" value="${esc(acc.remarks || '')}" placeholder="    ">`; break;
          case 'lastChangeTime': content = acc.lastChangeTime ? esc(acc.lastChangeTime) : 'N/A'; break;
          case 'statusOp': content = `<button class="status-op-btn ${acc.apiStatus === API_STATUS.ENABLED && !acc.isDisappeared ? 'active' : ''}" data-op="set-status" data-status="${API_STATUS.ENABLED}">启用</button> <button class="status-op-btn ${acc.apiStatus === API_STATUS.STOP_RECEIPT && !acc.isDisappeared ? 'active' : ''}" data-op="set-status" data-status="${API_STATUS.STOP_RECEIPT}">止收</button> <button class="status-op-btn ${acc.apiStatus === API_STATUS.CUSTOM_STOP && !acc.isDisappeared ? 'active' : ''}" data-op="set-status" data-status="${API_STATUS.CUSTOM_STOP}">停止</button>`; break;
          case 'autoStopReceiptEnabled': content = `<input type="checkbox" class="autostopreceipt-setting" data-setting="enabled" ${stopS.enabled ? 'checked' : ''}/>`; break;
          case 'autoStopReceiptTriggerAmount': content = `<input type="number" class="autostopreceipt-setting" data-setting="triggerAmount" value="${esc(String(stopS.triggerAmount))}" placeholder="金额"/>`; break;
          case 'autoTransferEnabled': content = `<input type="checkbox" class="autotransfer-setting" data-setting="enabled" ${txS.enabled ? 'checked' : ''}/>`; break;
          case 'autoTransferTriggerAmount': content = `<input type="number" class="autotransfer-setting" data-setting="triggerAmount" value="${esc(String(txS.triggerAmount))}" placeholder="金额"/>`; break;
          case 'autoTransferPayeeId': content = `<select class="autotransfer-setting" data-setting="payeeId"><option value="">--选择--</option>${PAYEE_OPTS.map(opt => `<option value="${opt.payeeId}" ${String(txS.payeeId) === String(opt.payeeId) ? 'selected' : ''}>${esc(opt.name)}</option>`).join('')}</select>`; break;
          case 'autoTransferMode': content = `<select class="autotransfer-setting" data-setting="transferMode"><option value="">--选择--</option>${TRANSFER_MODE_OPTS.map(opt => `<option value="${opt.transferMode}" ${String(txS.transferMode) === String(opt.transferMode) ? 'selected' : ''}>${esc(opt.name)}</option>`).join('')}</select>`; break;
          case 'autoTransferPercentage': content = `<select class="autotransfer-setting" data-setting="transferPercentage">${TRANSFER_PERCENT_OPTS.map(opt => `<option value="${opt.value}" ${parseFloat(txS.transferPercentage) === opt.value ? 'selected' : ''}>${esc(opt.name)}</option>`).join('')}</select>`; break;
          case 'autoTransferRoundToInteger': content = `<input type="checkbox" class="autotransfer-setting" data-setting="roundToInteger" ${txS.roundToInteger ? 'checked' : ''}/>`; break;
        }
        rowHtml += `<td class="${cellClass}">${content}</td>`;
      });
      bodyHtml += `${rowHtml}</tr>`;
    });
    tableContainer.innerHTML = `<table>${headerHtml}${bodyHtml}</tbody></table>`;
    if (sortedAccounts.length === 0 && Object.keys(accountDataCache).length === 0) tableContainer.querySelector('tbody').innerHTML = `<tr><td colspan="${columnConfig.length}" style="text-align: center;">没有账户数据或搜索结果。</td></tr>`;
    updateAllRemarksInputsWidth();
    const thead = tableContainer.querySelector('thead'); if (thead) { thead.removeEventListener('click', handleHeaderClick); thead.addEventListener('click', handleHeaderClick); }
  }
  function updateAllRemarksInputsWidth() {
    const measurer = D('remarks-width-measurer'); if (!measurer) return;
    const allInputs = tableContainer.querySelectorAll('.remarks-input'); if (allInputs.length === 0) return;
    let maxWidth = 0;
    allInputs.forEach(input => {
        measurer.textContent = input.value || input.placeholder || '';
        if (measurer.offsetWidth > maxWidth) maxWidth = measurer.offsetWidth;
    });
    allInputs.forEach(input => { input.style.width = `${maxWidth + 5}px`; });
  }
  async function _handleRemarksChange(e) {
      const input = e.target; const accId = input.dataset.accountId; if (!accId || !accountDataCache[accId]) return;
      const cacheEntry = accountDataCache[accId]; const newValue = input.value; const oldValue = cacheEntry.current.remarks || '';
      if (newValue === oldValue) return;
      cacheEntry.current.remarks = newValue; await saveAccountDataToDB();
      _addLogEntry(operationLogs, STORES.OP_LOGS, MAX_LOG_MEM, MAX_LOG_DB, { accountId: accId, accountName: cacheEntry.current?.accountName || 'N/A', message: `<span class="log-setting-change">备注更新: 从 "${esc(oldValue)}" 改为 "${esc(newValue)}"</span>` });
      showToast(`ID ${accId}: 备注已保存`, e.clientX, e.clientY, 1000);
  }
  async function _handleSettingChange(e, type) {
    const t = e.target; const accId = t.closest('tr').dataset.accountId; if (!accId || !accountDataCache[accId]) return;
    const cacheEntry = accountDataCache[accId]; const settingsObj = type === 'autoTransfer' ? cacheEntry.autoTransferSettings : cacheEntry.autoStopReceiptSettings;
    const oldSettings = { ...settingsObj }; const settingName = t.dataset.setting;
    let newValue = (t.type === 'checkbox') ? t.checked : t.value; let displayValue = newValue;
    let settingDisplayName = settingName; let oldDisplayValue = oldSettings[settingName];
    if (settingName.includes('triggerAmount')) {
      const numVal = parseFloat(newValue);
      if (newValue !== '' && (isNaN(numVal) || numVal < 0)) { showToast('触发金额必须是有效的非负数字或为空', e.clientX, e.clientY, 2000); t.value = oldSettings[settingName] || ''; return; }
      newValue = newValue === '' ? (type === 'autoStopReceipt' ? DEFAULT_AUTO_STOP_AMT : '') : numVal;
      displayValue = newValue === '' ? '(空)' : fmtAmt(newValue); oldDisplayValue = oldSettings[settingName] === '' || oldSettings[settingName] === undefined ? '(空)' : fmtAmt(oldSettings[settingName]);
    } else if (settingName === 'payeeId' || settingName === 'transferMode') {
      newValue = newValue === '' ? '' : parseInt(newValue, 10); const opts = settingName === 'payeeId' ? PAYEE_OPTS : TRANSFER_MODE_OPTS;
      const newOpt = opts.find(opt => opt[settingName === 'payeeId' ? 'payeeId' : 'transferMode'] === newValue); displayValue = newOpt ? newOpt.name : (newValue === '' ? '(空)' : `${settingName === 'payeeId' ? 'PayeeID' : 'Mode'} ${newValue}`);
      const oldOpt = opts.find(opt => opt[settingName === 'payeeId' ? 'payeeId' : 'transferMode'] === oldSettings[settingName]); oldDisplayValue = oldOpt ? oldOpt.name : (oldSettings[settingName] === '' || oldSettings[settingName] === undefined ? '(空)' : `${settingName === 'payeeId' ? 'PayeeID' : 'Mode'} ${oldSettings[settingName]}`);
    } else if (settingName === 'transferPercentage') {
      newValue = parseFloat(newValue); const newOpt = TRANSFER_PERCENT_OPTS.find(opt => opt.value === newValue); displayValue = newOpt ? newOpt.name : `${(newValue * 100).toFixed(0)}%`;
      const oldOpt = TRANSFER_PERCENT_OPTS.find(opt => opt.value === oldSettings[settingName]); oldDisplayValue = oldOpt ? oldOpt.name : (oldSettings[settingName] !== undefined ? `${(oldSettings[settingName] * 100).toFixed(0)}%` : '(空)');
    } else { displayValue = newValue ? '是' : '否'; oldDisplayValue = oldSettings[settingName] ? '是' : '否'; }
    if (settingName === 'transferPercentage' && Math.abs(oldSettings.transferPercentage - newValue) < 0.001) return;
    if (String(oldSettings[settingName]) === String(newValue)) return;
    settingsObj[settingName] = newValue; await saveAccountDataToDB();
    switch(settingName) { case 'enabled': settingDisplayName = type === 'autoTransfer' ? '开启自动划转' : '开启自动止收'; break; case 'triggerAmount': settingDisplayName = type === 'autoTransfer' ? '触发金额' : '止收触发金额'; break; case 'payeeId': settingDisplayName = '收款账户'; break; case 'transferMode': settingDisplayName = '划转模式'; break; case 'transferPercentage': settingDisplayName = '划转比例'; break; case 'roundToInteger': settingDisplayName = '取整'; break; }
    _addLogEntry(operationLogs, STORES.OP_LOGS, MAX_LOG_MEM, MAX_LOG_DB, { accountId: accId, accountName: cacheEntry.current?.accountName || 'N/A', message: `<span class="log-setting-change">${type === 'autoTransfer' ? '自动划转' : '自动止收'}设置: ${esc(settingDisplayName)} 从 "${esc(String(oldDisplayValue))}" 改为 "${esc(String(displayValue))}"</span>` });
    showToast(`ID ${accId}: "${esc(settingDisplayName)}" 已更新`, e.clientX, e.clientY, 1000);
  }
  async function loadPersistedData() {
    console.log("正在从 IndexedDB 加载持久化数据...");
    try {
      await dbHelper.openDB();
      const [cacheSetting, orderSetting, lastRefreshSetting, colVisSetting, sortConfSetting, logsVisSetting] = await Promise.all([
        dbHelper.get(STORES.ACC_DATA, KEYS.ACCOUNT_CACHE),
        dbHelper.get(STORES.ACC_ORDER, KEYS.ACCOUNT_ORDER),
        loadSetting(KEYS.LAST_REFRESH, null),
        loadSetting(KEYS.COLUMN_VIS, null), // [优化] 初始加载为 null 以便判断是否首次加载
        loadSetting(KEYS.SORT_CONF, { key: 'id', direction: 'asc' }),
        loadSetting(KEYS.LOGS_VISIBLE, true)
      ]);
      accountDataCache = cacheSetting || {};
      accountOrder = orderSetting || [];
      lastSuccessfulDataTimestamp = lastRefreshSetting ? new Date(lastRefreshSetting) : null;
      sortConfig = sortConfSetting;
      areLogsVisible = logsVisSetting;

      if (colVisSetting === null) {
          console.log("未找到列可见性设置，应用默认值。");
          columnVisibility = {};
          columnConfig.forEach(c => { columnVisibility[c.id] = c.hideable ? c.defaultVisible : true; });
          await saveSetting(KEYS.COLUMN_VIS, columnVisibility);
      } else {
          columnVisibility = colVisSetting;
      }

      for (const accId in accountDataCache) {
        const c = accountDataCache[accId];
        Object.assign(c, { autoTransferSettings: initAutoTxSettings(c.autoTransferSettings), autoStopReceiptSettings: initAutoStopSettings(c.autoStopReceiptSettings), lastSuccessfulTransferTime: c.lastSuccessfulTransferTime ?? 0, lastAutoStopAttempt: c.lastAutoStopAttempt ?? 0, lastTransferAttemptTime: c.lastTransferAttemptTime ?? 0, isAutoStoppedByScript: c.isAutoStoppedByScript ?? false, lastAutoReEnableAttempt: c.lastAutoReEnableAttempt ?? 0, lastFailedTransferTime: c.lastFailedTransferTime ?? 0, current: c.current || {} });
        c.current.balanceHistory = (c.current.balanceHistory || []).slice(-MAX_BAL_HISTORY);
      }
      if (lastRefreshTimeEl && lastSuccessfulDataTimestamp) lastRefreshTimeEl.innerText = `上次成功更新: ${fmtDT(lastSuccessfulDataTimestamp)}`;
      operationLogs = (await dbHelper.getAll(STORES.OP_LOGS, null, 'prev') || []).slice(0, MAX_LOG_MEM);
      frozenBalanceIncreaseLogs = (await dbHelper.getAll(STORES.FROZEN_LOGS, null, 'prev') || []).slice(0, MAX_FROZEN_LOG_MEM);
      _renderLogs(logDisplayContainer, operationLogs, '操作与变动日志');
      _renderLogs(frozenLogDisplayContainer, frozenBalanceIncreaseLogs, '冻结金额增加日志');
      renderColumnTogglePanel();
      toggleLogsVisibility(areLogsVisible);
    } catch (e) {
      console.error("加载持久化数据时发生严重错误:", e);
      accountDataCache = {}; accountOrder = []; operationLogs = []; frozenBalanceIncreaseLogs = [];
      columnConfig.forEach(c => columnVisibility[c.id] = c.defaultVisible);
      sortConfig = { key: 'id', direction: 'asc' };
      _renderLogs(logDisplayContainer, operationLogs, '操作与变动日志');
      _renderLogs(frozenLogDisplayContainer, frozenBalanceIncreaseLogs, '冻结金额增加日志');
      renderColumnTogglePanel();
    }
  }
  async function saveAccountDataToDB() {
    try {
        await Promise.all([
            dbHelper.set(STORES.ACC_DATA, KEYS.ACCOUNT_CACHE, accountDataCache),
            dbHelper.set(STORES.ACC_ORDER, KEYS.ACCOUNT_ORDER, accountOrder)
        ]);
    }
    catch (e) { console.error("保存账户数据/排序到 IndexedDB 时出错:", e); }
  }
  async function fetchAccountData(isInitialLoad = false) {
    const fetchAttemptTime = new Date();
    if (lastRefreshTimeEl && !isInitialLoad) { lastRefreshTimeEl.innerText = `正在刷新... (${fmtDT(fetchAttemptTime)})`; lastRefreshTimeEl.classList.remove('error'); }
    try {
      const res = await apiRequest({ method: "GET", url: "https://admin.gdspay.xyz/api/tripartite/v1/account/view", responseType: "json" });
      if (!res.ok || res.rawJson?.code !== 1 || !Array.isArray(res.rawJson?.data?.list)) {
        const errorMsg = res.rawJson?.msg || res.error || res.rawText || `状态码: ${res.status}`;
        console.error('API 获取/数据格式错误:', errorMsg); showFetchStatus(`API错误: ${errorMsg}. ${lastSuccessfulDataTimestamp ? `数据可能陈旧 (截至 ${fmtDT(lastSuccessfulDataTimestamp)})` : ''}`, 'error', 7000);
        if (lastRefreshTimeEl) { lastRefreshTimeEl.innerText = `API错误于: ${fmtDT(fetchAttemptTime)}. ${lastSuccessfulDataTimestamp ? '旧数据截至: ' + fmtDT(lastSuccessfulDataTimestamp) : ''}`; lastRefreshTimeEl.classList.add('error'); }
        if (Object.keys(accountDataCache).length === 0) tableContainer.innerHTML = `获取数据失败：${esc(errorMsg)}。请检查网络或Token。`; else renderTable(); return;
      }
      if (lastRefreshTimeEl) { lastRefreshTimeEl.innerText = `数据更新于: ${fmtDT(fetchAttemptTime)}`; lastRefreshTimeEl.classList.remove('error'); }
      lastSuccessfulDataTimestamp = fetchAttemptTime; await saveSetting(KEYS.LAST_REFRESH, lastSuccessfulDataTimestamp.toISOString());
      const apiList = res.rawJson.data.list; const nowFormattedStr = fmtDT(new Date()); const currentApiAccountIds = new Set();
      if (accountOrder.length === 0 && apiList.length > 0 && isInitialLoad) accountOrder = apiList.map(item => String(item.accountId));
      apiList.forEach(apiItem => {
          const accIdStr = String(apiItem.accountId); currentApiAccountIds.add(accIdStr);
          let c = accountDataCache[accIdStr] = accountDataCache[accIdStr] || { current: {}, autoTransferSettings: initAutoTxSettings(), autoStopReceiptSettings: initAutoStopSettings(), lastSuccessfulTransferTime: 0, lastAutoStopAttempt: 0, lastTransferAttemptTime: 0, isAutoStoppedByScript: false, lastAutoReEnableAttempt: 0, lastFailedTransferTime: 0 };
          Object.assign(c, { autoTransferSettings: initAutoTxSettings(c.autoTransferSettings), autoStopReceiptSettings: initAutoStopSettings(c.autoStopReceiptSettings), lastSuccessfulTransferTime: c.lastSuccessfulTransferTime ?? 0, lastAutoStopAttempt: c.lastAutoStopAttempt ?? 0, lastTransferAttemptTime: c.lastTransferAttemptTime ?? 0, isAutoStoppedByScript: c.isAutoStoppedByScript ?? false, lastAutoReEnableAttempt: c.lastAutoReEnableAttempt ?? 0, lastFailedTransferTime: c.lastFailedTransferTime ?? 0 });
          const prev = { ...c.current };
          const current = {
              id: accIdStr,
              platform: apiItem.tripartiteId,
              accountName: apiItem.accountName,
              phone: apiItem.otpReceiver,
              balance: parseFloat(apiItem.balance) / 100,
              frozenBalance: parseFloat(apiItem.frozenBalance) / 100,
              apiStatus: parseInt(apiItem.accountStatus),
              description: apiItem.description,
              lastHeartbeatTime: apiItem.lastHeartbeatTime ? fmtDT(new Date(apiItem.lastHeartbeatTime)) : null,
              lastChangeTime: prev.lastChangeTime || nowFormattedStr,
              isDisappeared: false,
              balanceHistory: prev.balanceHistory ? [...prev.balanceHistory] : [],
              remarks: prev.remarks || '',
              loginStatus: parseInt(apiItem.loginStatus),
              failedReason: apiItem.failedReason,
              balanceFailed: apiItem.balanceFailed,
          };
          if(!prev.lastChangeTime) current.lastChangeTime = nowFormattedStr;
          if (!isInitialLoad && prev.balance > 0 && current.balance === 0) { console.warn(`GDS 脚本 (ID: ${accIdStr}): API 返回余额为 0，上次为 ${fmtAmt(prev.balance)}。使用上次的值。`); current.balance = prev.balance; }
          if (!isInitialLoad && prev.frozenBalance > 0 && current.frozenBalance === 0) { console.warn(`GDS 脚本 (ID: ${accIdStr}): API 返回冻结余额为 0，上次为 ${fmtAmt(prev.frozenBalance)}。使用上次的值。`); current.frozenBalance = prev.frozenBalance; }
          let logMsgParts = []; let sigAmtChanged = false;
          if (prev.balance !== undefined && current.balance !== prev.balance) { const diff = current.balance - prev.balance; logMsgParts.push(`余额: ${fmtAmt(prev.balance)} → ${fmtAmt(current.balance)} <span class="${diff > 0 ? 'log-amount-increase' : 'log-amount-decrease'}">(${diff > 0 ? '+' : ''}${fmtAmt(diff)})</span>`); sigAmtChanged = true; }
          if (prev.frozenBalance !== undefined && current.frozenBalance !== prev.frozenBalance) { const diff = current.frozenBalance - prev.frozenBalance; const diffCls = diff > 0 ? 'log-amount-increase' : (diff < 0 ? 'log-amount-decrease' : ''); logMsgParts.push(`冻结: ${fmtAmt(prev.frozenBalance)} → ${fmtAmt(current.frozenBalance)} <span class="${diffCls}" style="${diff > 0 ? 'font-weight:bold;' : ''}">(${diff > 0 ? '+' : ''}${fmtAmt(diff)})</span>`); sigAmtChanged = true; if (diff > 0 && prev.frozenBalance >= 0 && !isInitialLoad) _addLogEntry(frozenBalanceIncreaseLogs, STORES.FROZEN_LOGS, MAX_FROZEN_LOG_MEM, MAX_FROZEN_LOG_DB, { accountId: accIdStr, accountName: current.accountName, message: `冻结金额增加: ${fmtAmt(prev.frozenBalance)} → ${fmtAmt(current.frozenBalance)} <span class="log-amount-increase" style="font-weight:bold;">(${diff > 0 ? '+' : ''}${fmtAmt(diff)})</span>` }); }
          if (sigAmtChanged) current.lastChangeTime = nowFormattedStr;
          if (prev.apiStatus !== undefined && current.apiStatus !== prev.apiStatus) { logMsgParts.push(`在线状态: ${fmtApiStatus(prev.apiStatus).text} → <span class="log-status-change">${fmtApiStatus(current.apiStatus).text}</span>`); }
          if (prev.balanceFailed !== undefined && current.balanceFailed !== prev.balanceFailed) { logMsgParts.push(`余额查询失败: ${prev.balanceFailed ? '是' : '否'} → <span class="log-status-change">${current.balanceFailed ? '是' : '否'}</span>`); }
          if (prev.apiStatus !== undefined && current.apiStatus !== prev.apiStatus && prev.apiStatus === API_STATUS.STOP_RECEIPT && current.apiStatus !== API_STATUS.STOP_RECEIPT) { if (c.isAutoStoppedByScript) { _addLogEntry(operationLogs, STORES.OP_LOGS, MAX_LOG_MEM, MAX_LOG_DB, { accountId: accIdStr, accountName: current.accountName, message: `API状态从“止收”变为“${fmtApiStatus(current.apiStatus).text}”，清除脚本自动止收标记。` }); } c.isAutoStoppedByScript = false; }
          if (!isInitialLoad && logMsgParts.length > 0) {
              let intervalStr = 'N/A';
              if (sigAmtChanged && prev.lastChangeTime) { const prevDate = new Date(prev.lastChangeTime.replace(/-/g, '/')); const currDate = new Date(current.lastChangeTime.replace(/-/g, '/')); if (!isNaN(prevDate) && !isNaN(currDate)) intervalStr = fmtInt(Math.round((currDate - prevDate) / 1000)); }
              _addLogEntry(operationLogs, STORES.OP_LOGS, MAX_LOG_MEM, MAX_LOG_DB, { accountId: accIdStr, accountName: current.accountName, message: logMsgParts.join('， '), interval: sigAmtChanged ? intervalStr : undefined });
          }
          current.balanceHistory.push({ timestamp: Date.now(), balance: current.balance }); if (current.balanceHistory.length > MAX_BAL_HISTORY) current.balanceHistory.shift();
          c.current = current; if (accountOrder.indexOf(accIdStr) === -1) accountOrder.push(accIdStr);
      });
      accountOrder.forEach(accIdStr => {
          const c = accountDataCache[accIdStr];
          if (!currentApiAccountIds.has(accIdStr) && c?.current && !c.current.isDisappeared) {
              c.current.isDisappeared = true; c.current.apiStatus = API_STATUS.DISAPPEARED; c.current.loginStatus = 0; c.current.failedReason ="";
              if (c.isAutoStoppedByScript) { _addLogEntry(operationLogs, STORES.OP_LOGS, MAX_LOG_MEM, MAX_LOG_DB, { accountId: accIdStr, accountName: c.current.accountName, message: `<span class="status-disappeared">账号在API响应中消失，清除脚本自动止收标记。</span>` }); c.isAutoStoppedByScript = false; }
              else { _addLogEntry(operationLogs, STORES.OP_LOGS, MAX_LOG_MEM, MAX_LOG_DB, { accountId: accIdStr, accountName: c.current.accountName, message: '<span class="status-disappeared">账号在API响应中消失</span>' }); }
          }
      });
      await saveAccountDataToDB(); renderTable(); hourlyRateDisplay.innerHTML = calculateEstimatedHourlyRate(accountDataCache);
      await checkAndPerformAutoTransfers(); await checkAndPerformAutoStopReceipt(); await checkAndPerformAutoReEnable();
    } catch (e) {
        if (e.message === 'Token刷新失败，无法重试原请求。' || e.message === 'Token missing') {
            console.warn('GDS 脚本: Token刷新或获取失败，将立即刷新页面。');
            if (refreshIntervalId) clearInterval(refreshIntervalId); showFetchStatus('登录已过期或Token无效，即将刷新页面...', 'error', 0);
            if (lastRefreshTimeEl) { lastRefreshTimeEl.innerText = `授权失败于: ${fmtDT(fetchAttemptTime)}. ${lastSuccessfulDataTimestamp ? '旧数据截至: ' + fmtDT(lastSuccessfulDataTimestamp) : ''}`; lastRefreshTimeEl.classList.add('error'); }
            await GM_setValue(KEYS.RELOAD_DELAY, Date.now()); location.reload(); return;
        }
        console.error('FetchAccountData 异常:', e); showFetchStatus(`脚本错误: ${e.message}. ${lastSuccessfulDataTimestamp ? `数据可能陈旧 (截至 ${fmtDT(lastSuccessfulDataTimestamp)})` : ''}`, 'error', 7000);
        if (lastRefreshTimeEl) { lastRefreshTimeEl.innerText = `脚本错误于: ${fmtDT(fetchAttemptTime)}. ${lastSuccessfulDataTimestamp ? '旧数据截至: ' + fmtDT(lastSuccessfulDataTimestamp) : ''}`; lastRefreshTimeEl.classList.add('error'); }
        if (Object.keys(accountDataCache).length === 0) tableContainer.innerHTML = `获取数据时发生脚本错误: ${esc(e.message)}。请检查控制台。`; else renderTable();
    }
  }
  async function handleCheckboxClick(e) {
    const t = e.target;
    const type = t.classList.contains('autotransfer-setting') ? 'autoTransfer' : 'autoStopReceipt';
    await _handleSettingChange(e, type);
  }
  async function handleTableClick(e) {
    const t = e.target;
    if (e.button === 2 && t.tagName === 'TD') { e.preventDefault(); if (t.innerText.trim()) copyToClipboard(t.innerText.trim(), e); return; }
    if (t.classList.contains('delete-account-btn')) {
      const accId = t.dataset.accountId; if (!accId) return;
      const accName = accountDataCache[accId]?.current?.accountName || 'N/A';
      if (confirm(`确定要从本地删除账户 ID: ${accId} (${accName}) 的所有记录吗？\n此操作不可撤销，且仅影响本地数据。`)) {
        delete accountDataCache[accId]; accountOrder = accountOrder.filter(id => id !== accId);
        try { await saveAccountDataToDB(); _addLogEntry(operationLogs, STORES.OP_LOGS, MAX_LOG_MEM, MAX_LOG_DB, { accountId: accId, accountName: accName, message: `<span class="log-local-delete">本地账户记录已删除</span>` }); showToast(`账户 ID: ${accId} 本地记录已删除`, e.clientX + 10, e.clientY + 10, 2000); renderTable(); }
        catch (err) { console.error(`从数据库删除账户 ${accId} 时出错:`, err); showToast(`删除账户 ${accId} 本地记录失败 (DB错误)`, e.clientX + 10, e.clientY + 10, 3000); }
      } return;
    }
    if (t.classList.contains('status-op-btn') && t.dataset.op === 'set-status') {
      const accId = t.closest('tr').dataset.accountId; const newStatus = parseInt(t.dataset.status); if (!accId || isNaN(newStatus)) return;
      t.closest('td').querySelectorAll('.status-op-btn').forEach(btn => btn.disabled = true);
      await _setAccountApiStatus(accId, newStatus, "手动操作");
      t.closest('td').querySelectorAll('.status-op-btn').forEach(btn => btn.disabled = false);
    }
    if (t.type === 'checkbox' && (t.classList.contains('autotransfer-setting') || t.classList.contains('autostopreceipt-setting'))) {
        handleCheckboxClick(e);
    }
  }
  async function exportLogs(e) { /* ... */ }

  // [新增] 日志面板切换功能
  function toggleLogsVisibility(forceState) {
      const shouldBeVisible = forceState !== undefined ? forceState : !areLogsVisible;
      if (shouldBeVisible) {
          logsContainer.classList.remove('hidden');
          toggleLogsBtn.textContent = '收起日志';
      } else {
          logsContainer.classList.add('hidden');
          toggleLogsBtn.textContent = '展开日志';
      }
      areLogsVisible = shouldBeVisible;
      saveSetting(KEYS.LOGS_VISIBLE, areLogsVisible);
  }

  // --- 初始化流程 ---
  async function initialize() {
    console.log(`GDS 账户信息增强版 (v3.2.87.6) 启动...`);

    // 绑定事件
    searchInput.addEventListener('input', () => { renderTable(); _renderLogs(logDisplayContainer, operationLogs, '操作与变动日志'); _renderLogs(frozenLogDisplayContainer, frozenBalanceIncreaseLogs, '冻结金额增加日志'); });
    D('gds-refresh').addEventListener('click', () => fetchAccountData(false));
    D('gds-toggle-theme').addEventListener('click', toggleTheme);
    toggleLogsBtn.addEventListener('click', () => toggleLogsVisibility()); // 新增事件
    D('gds-export-logs').addEventListener('click', exportLogs);
    D('gds-clear-log').addEventListener('click', async e => {
        if (confirm('确定要清空所有操作、变动及冻结增加日志吗？')) {
            operationLogs = []; frozenBalanceIncreaseLogs = [];
            try { await Promise.all([dbHelper.clear(STORES.OP_LOGS), dbHelper.clear(STORES.FROZEN_LOGS)]); _renderLogs(logDisplayContainer, operationLogs, '操作与变动日志'); _renderLogs(frozenLogDisplayContainer, frozenBalanceIncreaseLogs, '冻结金额增加日志'); showToast('所有日志已清空', e.clientX + 10, e.clientY + 10); }
            catch (err) { console.error("从 IndexedDB 清空日志时出错:", err); showToast('清空日志失败 (DB错误)', e.clientX + 10, e.clientY + 10); }
        }
    });
    D('gds-clear-prev-data').addEventListener('click', async e => {
        if (confirm('警告：这将清空所有本地缓存的账户数据、排序、主题、列显示和日志 (通过 IndexedDB)！\n确定要重置脚本吗？')) {
            try {
                if (refreshIntervalId) clearInterval(refreshIntervalId); refreshIntervalId = null;
                await dbHelper.deleteDB(); console.log("数据库已删除，正在重新加载页面...");
                location.reload();
            } catch (err) { console.error("重置脚本数据时出错 (删除 IndexedDB):", err); showToast(`重置脚本失败: ${err.message || err}`, e.clientX + 10, e.clientY + 10, 3000); }
        }
    });

    columnTogglePanel.addEventListener('change', handleColumnToggle);
    tableContainer.addEventListener('click', handleTableClick);
    tableContainer.addEventListener('contextmenu', handleTableClick);
    tableContainer.addEventListener('input', e => { if (e.target.classList.contains('remarks-input')) { updateAllRemarksInputsWidth(); } });
    tableContainer.addEventListener('blur', (e) => { const t = e.target; if (t.type === 'checkbox') return; if (t.classList.contains('remarks-input')) { _handleRemarksChange(e); } else if (t.classList.contains('autotransfer-setting')) { _handleSettingChange(e, 'autoTransfer'); } else if (t.classList.contains('autostopreceipt-setting')) { _handleSettingChange(e, 'autoStopReceipt'); } }, true);
    tableContainer.addEventListener('keydown', (e) => { const t = e.target; if ((t.classList.contains('remarks-input') || t.classList.contains('autotransfer-setting') || t.classList.contains('autostopreceipt-setting')) && e.key === 'Enter') { if (t.tagName === 'SELECT' || t.type === 'checkbox') return; e.preventDefault(); t.blur(); } });


    // 启动
    const pendingReloadTimestamp = await GM_getValue(KEYS.RELOAD_DELAY, 0);
    if (pendingReloadTimestamp > 0 && (Date.now() - pendingReloadTimestamp < RELOAD_FLAG_GRACE_MS)) {
        console.log(`GDS 脚本: 检测到页面因401错误刷新，将延迟 ${RELOAD_DELAY_MS / 1000} 秒加载数据。`);
        showFetchStatus(`检测到401后刷新。等待 ${RELOAD_DELAY_MS / 1000} 秒后重新加载数据...`, 'info', 0);
        await GM_setValue(KEYS.RELOAD_DELAY, 0); await new Promise(res => setTimeout(res, RELOAD_DELAY_MS));
        showFetchStatus('延迟结束，正在继续加载数据...', 'info', 2000);
    }
    applyTheme(await loadSetting(KEYS.THEME_PREF, 'light'));
    await loadPersistedData();
    token = localStorage.getItem('token'); refreshToken = localStorage.getItem('refreshToken');
    await fetchAccountData(true);
    if (token && !refreshIntervalId) { refreshIntervalId = setInterval(() => { fetchAccountData(false); }, REFRESH_INTERVAL_MS); }
    else if (!token && Object.keys(accountDataCache).length === 0) { tableContainer.innerHTML = '错误：未找到登录 Token 或 Token 刷新失败。请登录后刷新页面。'; }
    window.addEventListener('beforeunload', () => { if (refreshIntervalId) clearInterval(refreshIntervalId); });
  }

  initialize();

})();
