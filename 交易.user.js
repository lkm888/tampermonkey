// ==UserScript==
// @name         GDS 交易列表集成版 (v1.5.1 - 补单优化)
// @namespace    http://tampermonkey.net/
// @version      1.5.1
// @description  在GDS页面内嵌交易列表。打款金额不能超过订单金额。Bank列匹配GDS账户。新增受益人选择，打款后按钮1分钟节流。金额无逗号。增加删除交易记录功能。使用IndexedDB存储数据，从GDS_EnhancedScriptDB/accountData按指定键读取账户缓存。操作日志现分面板显示、可搜索、清除和导出。新增“扣钱”按钮，将打款金额从订单金额中扣除并更新到本地。(v1.5.1: 优化补单面板，保持选择并移除补录确认框).
// @match        https://admin.gdspay.xyz/2*
// @grant        GM_xmlhttpRequest
// @updateURL    https://raw.githubusercontent.com/lkm888/tampermonkey/main/交易.user.js
// @downloadURL  https://raw.githubusercontent.com/lkm888/tampermonkey/main/交易.user.js
// ==/UserScript==

(function() {
  'use strict';

  // ---- API URLs 和 键值 ----
  const TRANSACTION_DATA_URL = 'http://127.0.0.1:5000/transactions';
  const DELETE_TRANSACTION_URL_TEMPLATE = 'http://127.0.0.1:5000/transactions/delete/{ENTRY_ID}';
  const EDIT_TRANSACTION_URL_TEMPLATE = 'http://127.0.0.1:5000/transactions/edit/{ENTRY_ID}'; // 用于本地编辑
  const GDS_PAYEE_LIST_API_URL_TEMPLATE = 'https://admin.gdspay.xyz/api/tripartite/v1/payee/list?search={ACCOUNT_NO}&page=1&pageSize=50';
  const GDS_TRANSFER_API_URL = 'https://admin.gdspay.xyz/api/tripartite/v1/transfer/manual';
  const GDS_BENEFICIARY_ADD_API_URL = 'https://admin.gdspay.xyz/api/tripartite/v1/beneficiary/add';
  const BANK_BENEFICIARIES_URL = 'http://127.0.0.1:5000/bank_beneficiaries';
  const GDS_BENEFICIARY_LIST_API_URL = 'https://admin.gdspay.xyz/api/tripartite/v1/beneficiary/list';
  const BANK_BENEFICIARIES_BULK_ADD_URL = 'http://127.0.0.1:5000/bank_beneficiaries/bulk_add';
  // 新增补单API
  const GDS_PAYEE_MODIFY_API_URL = 'https://admin.gdspay.xyz/api/tripartite/v1/payee/modify';
  const GDS_MAKEUP_TRANSFER_API_URL = 'https://admin.gdspay.xyz/api/tripartite/v1/transfer/makeup';


  // ---- IndexedDB 配置 (此脚本数据) ----
  const EMBED_TX_DB_NAME = 'GDSEmbeddedTxDB';
  const EMBED_TX_STORE_NAME = 'scriptDataStore';
  const EMBED_TX_DB_VERSION = 1;

  // ---- IndexedDB 配置 (共享GDS账户缓存，来自GDS_EnhancedScriptDB) ----
  const SHARED_GDS_DB_NAME = 'GDS_EnhancedScriptDB';
  const SHARED_GDS_STORE_NAME = 'accountData';
  const SHARED_GDS_DB_VERSION = 3;
  const KEY_FOR_SHARED_ACCOUNTS_OBJECT = 'gds_account_data_cache_idb_v3.2';

  // ---- 用于此脚本 IndexedDB 存储的键 ----
  const KEY_PERSISTENT_OPERATION_LOGS_TX = 'gds_persistent_operation_logs_tx'; // 交易面板日志
  const KEY_PERSISTENT_OPERATION_LOGS_BB = 'gds_persistent_operation_logs_bb'; // 银行受益人面板日志
  const KEY_PERSISTENT_OPERATION_LOGS_MU = 'gds_persistent_operation_logs_mu'; // 补单面板日志
  const KEY_THEME_PREFERENCE = 'gds_theme_preference';
  const KEY_COLUMN_VISIBILITY_TX = 'gds_column_visibility_tx';
  const KEY_SORT_CONFIG_TX = 'gds_sort_config_tx';
  const KEY_LAST_REFRESH_TX = 'gds_last_refresh_tx';
  const KEY_PAYOUT_THROTTLE_TIMESTAMPS = 'gds_payout_throttle_timestamps';
  const KEY_COLUMN_VISIBILITY_BB = 'gds_column_visibility_bb';
  const KEY_SORT_CONFIG_BB = 'gds_sort_config_bb';
  const KEY_LAST_REFRESH_BB = 'gds_last_refresh_bb';
  const KEY_ACTIVE_SUBPANEL_PREFERENCE = 'gds_active_subpanel';
  const KEY_BANK_BENE_SELECTED_ACCOUNT = 'gds_bank_bene_selected_account';

  // ---- 常量 ----
  const MAX_LOG_ENTRIES = 10000;
  const REFRESH_INTERVAL_MS = 10000;
  const GDS_TRANSFER_MODES = [
    { name: 'IMPS', value: 1 },
    { name: 'NEFT', value: 2 },
    { name: 'RTGS', value: 3 },
  ];
  const GDS_PAYOUT_TYPES = [
    { name: '承兑', value: 5 },
    { name: '四方内充', value: 4 },
    { name: '佣金打款', value: 6 },
    { name: '中转', value: 3 },
  ];
  const DEFAULT_GDS_TRANSFER_MODE = 2;
  const PAYOUT_THROTTLE_DURATION_MS = 60 * 1000; // 1分钟
  const ADMIN_PASSWORD_FOR_BULK_ADD = '1'; // 本地Flask API 的固定管理密码
  const DEBOUNCE_DELAY_MS = 300; // 金额输入防抖延迟 (毫秒)

  // ---- 全局变量 ----
  let transactionDataCache = [];
  let bankBeneficiaryDataCache = [];
  let gdsAccountDataCache = {};
  let makeupAnalysisResult = null; // 存储补单分析结果

  let transactionPanelLogs = [];
  let bankBeneficiaryPanelLogs = [];
  let makeupPanelLogs = []; // 补单面板日志
  let currentLogDisplayType = 'transaction'; // 'transaction', 'bankBeneficiary', 'makeup'

  let refreshIntervalId = null;
  let currentTheme = 'light';
  let columnVisibilityTx = {};
  let bankBeneficiaryColumnVisibility = {};
  let sortConfigTx = { key: null, direction: 'asc' };
  let bankBeneficiarySortConfig = { key: null, direction: 'asc' };
  let lastSuccessfulDataTimestamp = null;
  let lastSuccessfulBankBeneTimestamp = null;
  let currentActiveSubPanel = 'transaction';
  let hasFetchedInitialData = false;

  let payoutThrottleTimestamps = {};
  let bankBeneSelectedAccountId = null;
  const transferAmountDebounceTimers = {};

  // ---- IndexedDB 辅助函数 ----
  const idbHelper = (dbName, version, storeConfigs) => {
    let dbPromise = null;
    const getDb = () => {
      if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
          const request = indexedDB.open(dbName, version);
          request.onerror = (event) => { console.error(`IDB错误 ${dbName} v${version}:`, event.target.error); reject(event.target.error); };
          request.onsuccess = (event) => resolve(event.target.result);
          request.onupgradeneeded = (event) => { const db = event.target.result; storeConfigs.forEach(c => { if (!db.objectStoreNames.contains(c.name)) db.createObjectStore(c.name, c.options || {}); }); };
        });
      }
      return dbPromise;
    };
    return {
      get: async (storeName, key) => { const db = await getDb(); return new Promise((resolve, reject) => { if (!db.objectStoreNames.contains(storeName)) return reject(new Error(`存储 "${storeName}" 不存在.`)); const t = db.transaction(storeName, 'readonly').objectStore(storeName).get(key); t.onerror = e => reject(e.target.error); t.onsuccess = e => resolve(e.target.result); }); },
      set: async (storeName, key, value) => { const db = await getDb(); return new Promise((resolve, reject) => { if (!db.objectStoreNames.contains(storeName)) return reject(new Error(`存储 "${storeName}" 不存在.`)); const t = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value, key); t.onerror = e => reject(e.target.error); t.onsuccess = e => resolve(e.target.result); }); },
      remove: async (storeName, key) => { const db = await getDb(); return new Promise((resolve, reject) => { if (!db.objectStoreNames.contains(storeName)) return reject(new Error(`存储 "${storeName}" 不存在.`)); const t = db.transaction(storeName, 'readwrite').objectStore(storeName).delete(key); t.onerror = e => reject(e.target.error); t.onsuccess = e => resolve(e.target.result); }); },
    };
  };

  const embedTxDb = idbHelper(EMBED_TX_DB_NAME, EMBED_TX_DB_VERSION, [{ name: EMBED_TX_STORE_NAME }]);
  const sharedGdsDb = idbHelper(SHARED_GDS_DB_NAME, SHARED_GDS_DB_VERSION, [{ name: SHARED_GDS_STORE_NAME }]);

  // 通用 IndexedDB 偏好设置加载/保存函数
  async function loadPreference(key, defaultValue) {
    try { return (await embedTxDb.get(EMBED_TX_STORE_NAME, key)) || defaultValue; }
    catch (e) { console.warn(`从IDB加载偏好设置失败 (${key}):`, e.message); return defaultValue; }
  }
  async function savePreference(key, value) {
    try { await embedTxDb.set(EMBED_TX_STORE_NAME, key, value); }
    catch (e) { console.error(`保存偏好设置到IDB失败 (${key}):`, e); }
  }

  // ---- 样式 ----
  const style = document.createElement('style');
  style.innerHTML = `
    :root {
      --body-bg: #fff; --text-color: #212529; --text-muted-color: #6c757d; --link-color: #007bff;
      --border-color: #ccc; --input-border: #bbb; --input-text: #495057; --input-bg: #fff;
      --panel-bg: #f0f0f0; --panel-border: #ccc; --panel-shadow: rgba(0,0,0,0.1);
      --button-bg: #f8f8f8; --button-hover-bg: #e0e0e0; --button-border: #bbb;
      --button-disabled-opacity: 0.6; --button-disabled-bg: #eee;
      --table-bg: #fff; --table-border: #ddd; --table-header-bg: #e9e9e9;
      --table-row-even-bg: #f9f9f9; --table-row-hover-bg: #e6f7ff; --table-sticky-header-bg: #e9e9e9;
      --log-bg: #fdfdfd; --log-border: #ccc; --log-time-color: #666; --log-entry-border: #eee;
      --toast-bg: rgba(0,0,0,0.75); --toast-text: white;
      --fetch-status-info-bg: #e0e0e0; --fetch-status-info-text: #333;
      --fetch-status-success-bg: #d4edda; --fetch-status-success-text: #155724;
      --fetch-status-error-bg: #f8d7da; --fetch-status-error-text: #721c24;
      --column-toggle-panel-bg: #f7f7f7; --column-toggle-panel-border: #ddd;
      --action-button-color: #007bff; --action-button-hover-color: #0056b3;
      --delete-button-color: #dc3545; --delete-button-hover-color: #c82333;
      --deduct-button-color: #ffc107; --deduct-button-hover-color: #e0a800; /* 扣钱按钮样式 */
      --log-attempt-color: #007bff; --log-success-color: green; --log-fail-color: red;
      --log-info-color: var(--text-color); --log-warn-color: orange; --log-error-color: var(--log-fail-color);
      --input-invalid-border-color: red;
      --panel-switcher-bg: #e9e9e9;
      --panel-switcher-btn-bg: #f0f0f0;
      --panel-switcher-btn-active-bg: #d0d0d0;
      --panel-switcher-btn-active-border: #a0a0a0;
      --sync-button-bg: #6c757d; --sync-button-hover-bg: #5a6268;
      --export-button-bg: #17a2b8; --export-button-hover-bg: #138496;
      --makeup-record-button-bg: #28a745; --makeup-record-button-hover-bg: #218838;
      --analysis-result-bg: #f8f9fa; --analysis-result-border: #dee2e6;
    }
    body.dark-theme {
      --body-bg: #22272e; --text-color: #c9d1d9; --text-muted-color: #8b949e; --link-color: #58a6ff;
      --border-color: #444c56; --input-border: #545d68; --input-text: #c9d1d9; --input-bg: #22272e;
      --panel-bg: #2d333b; --panel-border: #444c56;
      --button-bg: #373e47; --button-hover-bg: #444c56; --button-border: #545d68;
      --button-disabled-bg: #2d333b;
      --table-bg: #1c2128; --table-border: #444c56; --table-header-bg: #373e47;
      --table-row-even-bg: #22272e; --table-row-hover-bg: #30363d; --table-sticky-header-bg: #373e47;
      --log-bg: #1c2128; --log-border: #444c56; --log-time-color: #8b949e; --log-entry-border: #2d333b;
      --toast-bg: rgba(200,200,200,0.85); --toast-text: #1c2128;
      --fetch-status-info-bg: #373e47; --fetch-status-info-text: #c9d1d9;
      --fetch-status-success-bg: #2ea043; --fetch-status-success-text: #ffffff;
      --fetch-status-error-bg: #da3633; --fetch-status-error-text: #ffffff;
      --column-toggle-panel-bg: #2a2f36; --column-toggle-panel-border: #373e47;
      --action-button-color: #58a6ff; --action-button-hover-color: #79c0ff;
      --delete-button-color: #f85149; --delete-button-hover-color: #da3633;
      --deduct-button-color: #fdab3d; --deduct-button-hover-color: #ffc107; /* 扣钱按钮样式 (深色主题) */
      --log-attempt-color: #58a6ff; --log-success-color: #3fb950; --log-fail-color: #f85149;
      --log-info-color: var(--text-color); --log-warn-color: #fdab3d; --log-error-color: var(--log-fail-color);
      --input-invalid-border-color: #f85149;
      --panel-switcher-bg: #22272e;
      --panel-switcher-btn-bg: #373e47;
      --panel-switcher-btn-active-bg: #444c56;
      --panel-switcher-btn-active-border: #545d68;
      --sync-button-bg: #8b949e; --sync-button-hover-bg: #6c757d;
      --export-button-bg: #007bff; --export-button-hover-bg: #0056b3;
      --makeup-record-button-bg: #3fb950; --makeup-record-button-hover-bg: #2ea043;
      --analysis-result-bg: #2d333b; --analysis-result-border: #444c56;
    }
    body { background-color: var(--body-bg); color: var(--text-color); transition: background-color 0.3s, color 0.3s; }
    input, select, button, textarea { color: var(--input-text); background-color: var(--input-bg); border: 1px solid var(--input-border); padding: 4px 6px; border-radius: 3px; }
    select option { background-color: var(--input-bg); color: var(--input-text); }
    body.dark-theme select option { background-color: var(--input-bg) !important; color: var(--input-text) !important; }
    .input-invalid { border-color: var(--input-invalid-border-color) !important; box-shadow: 0 0 0 0.2rem color-mix(in srgb, var(--input-invalid-border-color) 40%, transparent); }

    /* 主面板容器 */
    #embed-tx-main {
        position: fixed; top: 10px; left: 50%; transform: translateX(-50%); z-index: 9999;
        font-size: 12px; width: calc(100% - 40px); max-width: 1800px;
        background-color: var(--body-bg); padding: 10px; border: 1px solid var(--border-color);
        box-shadow: 0 3px 10px var(--panel-shadow);
        display: flex;
        flex-direction: column;
        max-height: calc(100vh - 20px);
        overflow: hidden;
    }

    /* 面板切换器 */
    #panel-switcher {
        display: flex; gap: 5px; margin-bottom: 10px;
        background-color: var(--panel-switcher-bg);
        padding: 5px; border-radius: 3px; justify-content: flex-start; flex-shrink: 0;
    }
    #panel-switcher button {
        padding: 5px 10px; font-size: 13px; cursor: pointer; border: 1px solid var(--button-border);
        background-color: var(--panel-switcher-btn-bg); color: var(--text-color); border-radius: 4px;
        transition: background-color 0.2s, border-color 0.2s;
    }
    #panel-switcher button:hover { background-color: var(--button-hover-bg); }
    #panel-switcher button.active {
        background-color: var(--panel-switcher-btn-active-bg); border-color: var(--panel-switcher-btn-active-border);
        font-weight: bold;
    }

    /* 包含三个主面板的内容区域 */
    #panel-content-area {
        display: flex; flex-direction: row; gap: 10px; flex-grow: 1; overflow: hidden; min-height: 200px;
    }

    /* 各个子面板样式 */
    #transaction-panel-content, #bank-beneficiary-panel, #makeup-panel {
        display: none; /* 默认隐藏，JS控制显示 */
        flex-direction: column; flex-grow: 1; flex-shrink: 1; border: 1px solid var(--panel-border);
        box-shadow: 0 2px 5px var(--panel-shadow); background-color: var(--body-bg); padding: 8px;
        max-height: 100%; overflow: hidden; min-width: 400px;
    }
    #transaction-panel-content.active-panel, #bank-beneficiary-panel.active-panel, #makeup-panel.active-panel { display: flex; }

    /* 子面板内控制区和列切换区公共样式 */
    .panel-control-area, .column-toggle-panel {
        display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 11px;
        background: var(--panel-bg); padding: 6px 10px; border: 1px solid var(--panel-border);
        box-shadow: 0 1px 3px rgba(0,0,0,0.08); margin-bottom: 5px; flex-shrink: 0;
    }
    .panel-control-area input, .panel-control-area button, .panel-control-area select, .panel-control-area textarea { padding: 2px 4px; font-size:12px; }

    /* 补单面板特定样式 */
    #makeup-panel-content { display: flex; flex-direction: row; gap: 10px; flex-grow: 1; overflow: auto; }
    #makeup-input-area { flex: 1; display: flex; flex-direction: column; gap: 8px; min-width: 300px; }
    #makeup-recipient-info { width: 100%; height: 120px; resize: vertical; font-family: monospace; }
    #makeup-analysis-result { flex: 1; background-color: var(--analysis-result-bg); border: 1px solid var(--analysis-result-border); padding: 10px; white-space: pre-wrap; font-family: monospace; overflow-y: auto; min-width: 300px; }
    #makeup-record-btn { background-color: var(--makeup-record-button-bg); color: white; }
    #makeup-record-btn:hover { background-color: var(--makeup-record-button-hover-bg); }
    body.dark-theme #makeup-record-btn { color: var(--body-bg); }
    #makeup-log-controls { margin-top: auto; padding-top: 10px; flex-shrink: 0; display:flex; gap: 8px;}

    /* 表格容器样式 */
    .table-container {
        flex-grow: 1; overflow: auto; background: var(--table-bg); border:1px solid var(--table-border);
        box-shadow: 0 1px 3px rgba(0,0,0,0.08); margin-top: 5px; min-height: 100px;
    }
    .table-container table { border-collapse: collapse; width:100%; }
    .table-container th, .table-container td { border: 1px solid var(--table-border); padding: 5px 7px; text-align: left; vertical-align: middle; white-space: nowrap; }
    .table-container th { position: sticky; top: 0; background: var(--table-sticky-header-bg); font-weight: bold; z-index: 10; color: var(--text-color); user-select: none; }
    .table-container th.sortable { cursor: pointer; } .table-container th.sortable:hover { background-color: var(--button-hover-bg); }
    .table-container tr:nth-child(even) td { background: var(--table-row-even-bg); } .table-container tr:hover td { background: var(--table-row-hover-bg); }
    .col-hidden { display: none !important; }

    /* 日志容器 (现在是主面板的直接子元素) */
    #embed-tx-log-container {
        flex-shrink: 0; max-height: 150px; margin-top: 10px;
        background: var(--log-bg); border:1px solid var(--log-border); padding:10px; overflow: auto; font-size:12px;
        box-shadow: 0 2px 8px var(--panel-shadow); color: var(--text-color);
    }
    #embed-tx-log-container .log-title { font-weight: bold; margin-bottom: 5px; display: block; }
    #embed-tx-log-container .log-entry { margin-bottom:5px; padding-bottom: 3px; border-bottom: 1px dotted var(--log-entry-border); line-height: 1.4; } #embed-tx-log-container .log-entry:last-child { border-bottom: none; }

    /* 交易表格列宽度/对齐 */
    .col-tx-amount, .col-payout-account-balance, .col-transfer-amount-input input { text-align: right !important; }
    .col-payout-account-selector select, .col-transfer-mode-selector select, .col-payee-selector select { min-width: 100px; }
    .col-transfer-amount-input input { width: 80px; }
    .col-add-beneficiary select { min-width: 100px; margin-right: 5px; }

    /* 操作按钮 */
    .action-button { padding: 4px 8px; font-size: 11px; margin: 0 2px; border: 1px solid var(--button-border); border-radius: 3px; cursor: pointer; background-color: var(--button-bg); color: var(--text-color); }
    .action-button:hover { background-color: var(--button-hover-bg); } .action-button:disabled { cursor: not-allowed; opacity: var(--button-disabled-opacity); background-color: var(--button-disabled-bg); }
    .payout-action-button { background-color: var(--action-button-color); color: white; } .payout-action-button:hover { background-color: var(--action-button-hover-color); } body.dark-theme .payout-action-button { color: var(--body-bg); }
    .delete-action-button { background-color: var(--delete-button-color); color: white; } .delete-action-button:hover { background-color: var(--delete-button-hover-color); } body.dark-theme .delete-action-button { color: var(--body-bg); }
    .deduct-action-button { background-color: var(--deduct-button-color); color: black; } .deduct-action-button:hover { background-color: var(--deduct-button-hover-color); } body.dark-theme .deduct-action-button { color: var(--body-bg); }
    .add-beneficiary-button { background-color: #28a745; color: white; } .add-beneficiary-button:hover { background-color: #218838; } body.dark-theme .add-beneficiary-button { color: var(--body-bg); }
    .sync-gds-beneficiaries-button { background-color: var(--sync-button-bg); color: white; } .sync-gds-beneficiaries-button:hover { background-color: var(--sync-button-hover-bg); } body.dark-theme .sync-gds-beneficiaries-button { color: var(--body-bg); }
    .export-log-button { background-color: var(--export-button-bg); color: white; } .export-log-button:hover { background-color: var(--export-button-hover-bg); } body.dark-theme .export-log-button { color: var(--body-bg); }

    /* 日志颜色 */
    .log-transfer-attempt, .log-add-beneficiary-attempt, .log-sync-beneficiary-attempt, .log-makeup-attempt { color: var(--log-attempt-color); }
    .log-transfer-success, .log-add-beneficiary-success, .log-sync-beneficiary-success, .log-makeup-success { color: var(--log-success-color); }
    .log-transfer-fail, .log-add-beneficiary-fail, .log-sync-beneficiary-fail, .log-makeup-fail { color: var(--log-fail-color); }
    .log-info { color: var(--log-info-color); } .log-warn { color: var(--log-warn-color); } .log-error { color: var(--log-error-color); }

    /* 提示框和获取状态 */
    #copy-toast { position: fixed; background: var(--toast-bg); color: var(--toast-text); padding: 8px 12px; border-radius: 4px; z-index: 10005; opacity: 0; transition: opacity 0.3s; pointer-events: none; font-size: 13px; }
    #gds-fetch-status { position: fixed; top: 15px; right: 20px; padding: 8px 12px; border-radius: 4px; font-size: 13px; z-index: 10003; display: none; box-shadow: 0 2px 5px var(--panel-shadow); background-color: var(--fetch-status-info-bg); color: var(--fetch-status-info-text); }
    #gds-fetch-status.success { background-color: var(--fetch-status-success-bg); color: var(--fetch-status-success-text); border: 1px solid var(--fetch-status-success-border);}
    #gds-fetch-status.error   { background-color: var(--fetch-status-error-bg); color: var(--fetch-status-error-text); border: 1px solid var(--fetch-status-error-border);}

    /* 主面板切换按钮 */
    #toggle-embed-tx-panel-btn { position: fixed; bottom: 10px; right: 10px; z-index: 10002; padding: 8px 12px; font-size: 14px; background-color: var(--link-color); color: white; border: none; border-radius: 5px; cursor: pointer; box-shadow: 0 2px 5px rgba(0,0,0,0.2); }
    body.dark-theme #toggle-embed-tx-panel-btn { color: var(--input-text); }
  `;
  document.head.appendChild(style);

  // ---- UI 元素 ----
  const createEl = (tag, id, className, innerHTML = '') => {
    const el = document.createElement(tag);
    if (id) el.id = id;
    if (className) el.className = className;
    el.innerHTML = innerHTML;
    return el;
  };

  const embedTxPanel = createEl('div', 'embed-tx-main'); embedTxPanel.style.display = 'none';
  document.body.appendChild(embedTxPanel);

  const panelSwitcher = createEl('div', 'panel-switcher', null, `
    <button id="show-transaction-panel-btn" class="active">交易面板</button>
    <button id="show-bank-beneficiary-panel-btn">银行受益人</button>
    <button id="show-makeup-panel-btn">补单</button>
  `);
  embedTxPanel.appendChild(panelSwitcher);

  const panelContentArea = createEl('div', 'panel-content-area');
  embedTxPanel.appendChild(panelContentArea);

  const transactionPanelContent = createEl('div', 'transaction-panel-content', null, `
    <div id="embed-tx-control-panel" class="panel-control-area">
      交易列表 <span id="embed-tx-last-refresh-time"></span>
      搜索: <input id="embed-tx-search" placeholder="任意内容"/>
      <button id="embed-tx-refresh">刷新</button>
      <button id="embed-tx-clear-tx-log">清日志</button>
      <button id="embed-tx-export-tx-log" class="export-log-button">导出日志</button>
      <button id="embed-tx-toggle-theme">主题</button>
      <button id="embed-tx-clear-settings">重置设置</button>
    </div>
    <div id="embed-tx-column-toggle-panel" class="column-toggle-panel"></div>
    <div id="embed-tx-table-container" class="table-container">加载中...</div>
  `);
  panelContentArea.appendChild(transactionPanelContent);

  const bankBeneficiaryPanel = createEl('div', 'bank-beneficiary-panel', null, `
    <div id="bank-beneficiary-panel-control" class="panel-control-area">
      银行受益人 <span id="bank-beneficiary-last-refresh-time"></span>
      <input id="bank-beneficiary-search" placeholder="搜索"/>
      <select id="bank-beneficiary-account-selector" data-type="bank-bene-account-selector"><option value="">--选择账户--</option></select>
      <button id="bank-beneficiary-sync-gds-beneficiaries" class="sync-gds-beneficiaries-button">更新GDS受益人</button>
      <button id="bank-beneficiary-refresh">刷新</button>
      <button id="embed-tx-clear-bb-log">清日志</button>
      <button id="embed-tx-export-bb-log" class="export-log-button">导出日志</button>
    </div>
    <div id="bank-beneficiary-column-toggle-panel" class="column-toggle-panel"></div>
    <div id="bank-beneficiary-table-container" class="table-container">加载中...</div>
  `);
  panelContentArea.appendChild(bankBeneficiaryPanel);

  // 新增：补单面板
  const makeupPanel = createEl('div', 'makeup-panel', null, `
    <div id="makeup-panel-control" class="panel-control-area">
      <span>补单工具</span>
    </div>
    <div id="makeup-panel-content">
      <div id="makeup-input-area">
        <label>打款账户: <select id="makeup-account-selector" style="width:100%;"><option value="">--选择打款账户--</option></select></label>
        <label>账户类型: <select id="makeup-payout-type-selector" style="width:100%;"></select></label>
        <label>转账模式: <select id="makeup-transfer-mode-selector" style="width:100%;"></select></label>
        <label>收款信息 (Name, Acc, IFSC, 金额, UTR): <textarea id="makeup-recipient-info" placeholder="请用 Tab, | 或换行分隔"></textarea></label>
        <div style="display:flex; gap: 10px;">
           <button id="makeup-analyze-btn" class="action-button" style="flex:1;">分析</button>
           <button id="makeup-record-btn" class="action-button" style="flex:1;" disabled>补录</button>
        </div>
        <div id="makeup-log-controls">
            <button id="embed-tx-clear-mu-log">清日志</button>
            <button id="embed-tx-export-mu-log" class="export-log-button">导出日志</button>
        </div>
      </div>
      <div id="makeup-analysis-result">请先点击“分析”按钮...</div>
    </div>
  `);
  panelContentArea.appendChild(makeupPanel);

  const logDisplayContainer = createEl('div', 'embed-tx-log-container', null, '<span class="log-title">操作日志</span>');
  embedTxPanel.appendChild(logDisplayContainer);

  let toast = document.getElementById('copy-toast'); if (!toast) { toast = createEl('div', 'copy-toast'); document.body.appendChild(toast); }
  let fetchStatusDiv = document.getElementById('gds-fetch-status'); if (!fetchStatusDiv) { fetchStatusDiv = createEl('div', 'gds-fetch-status'); document.body.appendChild(fetchStatusDiv); }

  const togglePanelBtn = createEl('button', 'toggle-embed-tx-panel-btn'); togglePanelBtn.textContent = '交易面板';
  document.body.appendChild(togglePanelBtn);

  // ---- 列配置 ----
  const columnConfig = [
      { id: 'merchant', label: '商户', sortable: true, hideable: true, defaultVisible: true, dataKey: 'merchant' },
      { id: 'recipientName', label: 'Name', sortable: true, hideable: true, defaultVisible: true, dataKey: 'recipientName' },
      { id: 'recipientBank', label: 'Bank', sortable: true, hideable: true, defaultVisible: true, dataKey: 'recipientBank' },
      { id: 'recipientAccNo', label: 'Acc No', sortable: true, hideable: true, defaultVisible: true, dataKey: 'recipientAccNo' },
      { id: 'recipientIFSC', label: 'IFSC', sortable: true, hideable: true, defaultVisible: true, dataKey: 'recipientIFSC' },
      { id: 'remarks', label: '备注', sortable: true, hideable: true, defaultVisible: true, dataKey: 'remarks' },
      { id: 'txAmount', label: '订单金额', sortable: true, hideable: true, defaultVisible: true, dataKey: 'txAmount', cssClass: 'col-tx-amount' },
      { id: 'payoutAccountSelector', label: '打款账户', sortable: false, hideable: true, defaultVisible: true, cssClass: 'col-payout-account-selector' },
      { id: 'payoutAccountBalance', label: '账户余额', sortable: false, hideable: true, defaultVisible: true, cssClass: 'col-payout-account-balance' },
      { id: 'payeeSelector', label: '受益人', sortable: false, hideable: true, defaultVisible: true, cssClass: 'col-payee-selector' },
      { id: 'payoutAccountLastUpdate', label: '余额更新', sortable: false, hideable: true, defaultVisible: true },
      { id: 'transferAmountInput', label: '打款金额', sortable: false, hideable: true, defaultVisible: true, cssClass: 'col-transfer-amount-input' },
      { id: 'transferModeSelector', label: '转账模式', sortable: false, hideable: true, defaultVisible: true },
      { id: 'actions', label: '操作', sortable: false, hideable: true, defaultVisible: true },
      { id: 'addBeneficiary', label: '添加受益人', sortable: false, hideable: true, defaultVisible: true, cssClass: 'col-add-beneficiary' },
  ];

  const bankBeneficiaryColumnConfig = [
      { id: 'bank', label: '银行', sortable: true, hideable: true, defaultVisible: true, dataKey: 'bank' },
      { id: 'name', label: '姓名', sortable: true, hideable: true, defaultVisible: true, dataKey: 'name' },
      { id: 'accountNo', label: '卡号', sortable: true, hideable: true, defaultVisible: true, dataKey: 'accountNo' },
      { id: 'ifsc', label: 'IFSC', sortable: true, hideable: true, defaultVisible: true, dataKey: 'ifsc' },
      { id: 'time', label: '时间', sortable: true, hideable: true, defaultVisible: true, dataKey: 'timeRaw' },
  ];

  // ---- 辅助函数 ----
  function escapeHtml(str) { if (typeof str !== 'string') return String(str); return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function showToast(text, event, duration = 1200) { const x = event ? event.clientX + 10 : window.innerWidth / 2; const y = event ? event.clientY + 10 : window.innerHeight / 2; toast.innerText = text; toast.style.left = `${x}px`; toast.style.top = `${y}px`; toast.style.transform = event ? '' : 'translate(-50%, -50%)'; toast.style.opacity = '1'; if (toast.timeoutId) clearTimeout(toast.timeoutId); toast.timeoutId = setTimeout(() => toast.style.opacity = '0', duration); }
  function showFetchStatus(message, type = 'info', duration = 3000) { fetchStatusDiv.textContent = message; fetchStatusDiv.className = type; fetchStatusDiv.style.display = 'block'; if (fetchStatusDiv.timer) clearTimeout(fetchStatusDiv.timer); if (duration > 0) { fetchStatusDiv.timer = setTimeout(() => { fetchStatusDiv.style.display = 'none'; }, duration); } }
  function formatAmount(amount) { const num = parseFloat(amount); return isNaN(num) ? String(amount) : num.toFixed(2).replace(/\.00$/, ''); }
  function formatDateTime(dateInput = new Date()) { const d = (dateInput instanceof Date) ? dateInput : new Date(dateInput); if (isNaN(d.getTime())) return '无效日期'; return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`; }

  async function gmFetch(method, url, headers = {}, data = null) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method, url, headers, data,
        onload: (resp) => resolve(resp),
        onerror: (error) => reject(error)
      });
    });
  }

  // --- 日志管理 ---
  async function addLogEntry(logEntry, persistToDB = false, panelType = 'transaction') {
    if (!logDisplayContainer) return;
    logEntry.time = formatDateTime();

    let targetLogs;
    let dbKey;

    if (panelType === 'transaction') { targetLogs = transactionPanelLogs; dbKey = KEY_PERSISTENT_OPERATION_LOGS_TX; }
    else if (panelType === 'bankBeneficiary') { targetLogs = bankBeneficiaryPanelLogs; dbKey = KEY_PERSISTENT_OPERATION_LOGS_BB; }
    else if (panelType === 'makeup') { targetLogs = makeupPanelLogs; dbKey = KEY_PERSISTENT_OPERATION_LOGS_MU; }
    else { console.warn("addLogEntry: 无效的面板类型:", panelType); return; }

    targetLogs.unshift(logEntry);
    if (targetLogs.length > MAX_LOG_ENTRIES) targetLogs.pop();

    if (persistToDB) {
      try {
        let persistedLogs = (await embedTxDb.get(EMBED_TX_STORE_NAME, dbKey)) || [];
        persistedLogs.unshift(logEntry);
        if (persistedLogs.length > MAX_LOG_ENTRIES) persistedLogs = persistedLogs.slice(0, MAX_LOG_ENTRIES);
        await embedTxDb.set(EMBED_TX_STORE_NAME, dbKey, persistedLogs);
      } catch (e) {
        console.error('保存持久日志到IDB失败:', e);
        targetLogs.unshift({ time: formatDateTime(), message: `<span class="log-error">保存持久日志失败: ${escapeHtml(e.message)}.</span>` });
        if (targetLogs.length > MAX_LOG_ENTRIES) targetLogs.pop();
      }
    }
    if (panelType === currentLogDisplayType) renderLogs();
  }

  function renderLogs() {
    if (!logDisplayContainer) return;

    let logsToDisplay = [];
    let searchInput = null;
    let logTitle = '操作日志';

    if (currentLogDisplayType === 'transaction') { logsToDisplay = transactionPanelLogs; searchInput = document.getElementById('embed-tx-search'); logTitle = '交易面板操作日志'; }
    else if (currentLogDisplayType === 'bankBeneficiary') { logsToDisplay = bankBeneficiaryPanelLogs; searchInput = document.getElementById('bank-beneficiary-search'); logTitle = '银行受益人操作日志'; }
    else if (currentLogDisplayType === 'makeup') { logsToDisplay = makeupPanelLogs; searchInput = null; logTitle = '补单面板操作日志'; } // 补单面板无搜索框

    const searchFilter = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const keywords = searchFilter ? searchFilter.split(/\s+/).filter(Boolean) : [];

    logDisplayContainer.innerHTML = `<span class="log-title">${logTitle}</span>`;

    logsToDisplay.forEach(log => {
      const logText = `${log.time} ${log.message}`.toLowerCase();
      const shouldDisplay = keywords.length === 0 || keywords.every(k => logText.includes(k));
      if (shouldDisplay) {
        const el = createEl('div', null, 'log-entry');
        el.innerHTML = `<span class="log-time">[${escapeHtml(log.time)}]</span> ${log.message}`;
        logDisplayContainer.appendChild(el);
      }
    });
  }

  async function clearLogs(panelType) {
    let panelName = '';
    if (panelType === 'transaction') panelName = '交易面板';
    else if (panelType === 'bankBeneficiary') panelName = '银行受益人面板';
    else if (panelType === 'makeup') panelName = '补单面板';
    else return;

    if (!confirm(`确定清空 ${panelName} 的操作日志?`)) {
      await addLogEntry({ message: `<span class="log-info">取消清空日志 (${panelType}).</span>` }, false, panelType);
      return;
    }

    let targetLogs, dbKey;
    if (panelType === 'transaction') { targetLogs = transactionPanelLogs; dbKey = KEY_PERSISTENT_OPERATION_LOGS_TX; }
    else if (panelType === 'bankBeneficiary') { targetLogs = bankBeneficiaryPanelLogs; dbKey = KEY_PERSISTENT_OPERATION_LOGS_BB; }
    else if (panelType === 'makeup') { targetLogs = makeupPanelLogs; dbKey = KEY_PERSISTENT_OPERATION_LOGS_MU; }

    targetLogs.length = 0;
    try {
      await embedTxDb.remove(EMBED_TX_STORE_NAME, dbKey);
      await addLogEntry({ message: `<span class="log-warn">日志已清空 (${panelType}).</span>` }, false, panelType);
    } catch (err) {
      await addLogEntry({ message: `<span class="log-error">清日志(DB)失败 (${panelType}):${escapeHtml(err.message)}.</span>` }, false, panelType);
    }
    renderLogs();
    showToast('日志已清空');
  }

  function exportLogs(panelType) {
    let logsToExport, filenamePrefix, searchInput;

    if (panelType === 'transaction') { logsToExport = transactionPanelLogs; filenamePrefix = 'transaction_logs'; searchInput = document.getElementById('embed-tx-search'); }
    else if (panelType === 'bankBeneficiary') { logsToExport = bankBeneficiaryPanelLogs; filenamePrefix = 'bank_beneficiary_logs'; searchInput = document.getElementById('bank-beneficiary-search'); }
    else if (panelType === 'makeup') { logsToExport = makeupPanelLogs; filenamePrefix = 'makeup_logs'; searchInput = null; }
    else return;

    const searchFilter = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const keywords = searchFilter ? searchFilter.split(/\s+/).filter(Boolean) : [];
    const filteredLogs = keywords.length > 0
        ? logsToExport.filter(log => {
            const logText = `${log.time} ${log.message}`.toLowerCase();
            return keywords.every(k => logText.includes(k));
          })
        : logsToExport;

    const logContent = filteredLogs.map(log => `[${log.time}] ${log.message.replace(/<[^>]*>?/gm, '')}`).join('\n');
    const blob = new Blob([logContent], { type: 'text/plain;charset=utf-8' });
    const filename = `${filenamePrefix}_${formatDateTime(new Date()).replace(/[:\s]/g, '-')}.txt`;

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);

    addLogEntry({ message: `<span class="log-info">日志已导出 (${panelType}).</span>` }, false, panelType);
    showToast('日志已导出');
  }

  // --- 主题和设置管理 ---
  async function applyTheme(theme) { document.body.classList.toggle('dark-theme', theme === 'dark'); currentTheme = theme; await savePreference(KEY_THEME_PREFERENCE, theme); document.getElementById('embed-tx-toggle-theme').textContent = theme === 'dark' ? '浅色' : '深色'; }
  async function toggleTheme() { const newTheme = currentTheme === 'light' ? 'dark' : 'light'; await applyTheme(newTheme); await addLogEntry({ message: `<span class="log-info">主题: ${newTheme}.</span>` }, false, currentLogDisplayType);}

  // --- 列可见性管理 ---
  function renderColumnTogglePanel(config, visibilityMap, panelElementId, handler) {
    const panel = document.getElementById(panelElementId);
    if (!panel) return;
    panel.innerHTML = '列: ' + config.map(col =>
      `<label><input type="checkbox" data-col-id="${escapeHtml(col.id)}" ${visibilityMap[col.id] ? 'checked' : ''}> ${escapeHtml(col.label)}</label>`
    ).join('');
    panel.removeEventListener('change', handler);
    panel.addEventListener('change', handler);
  }

  async function handleColumnToggle(event) {
    const cb = event.target;
    if (cb.type === 'checkbox' && cb.dataset.colId) {
        const isBankBeneficiaryPanel = cb.closest('#bank-beneficiary-column-toggle-panel');
        const visibilityMap = isBankBeneficiaryPanel ? bankBeneficiaryColumnVisibility : columnVisibilityTx;
        const saveKey = isBankBeneficiaryPanel ? KEY_COLUMN_VISIBILITY_BB : KEY_COLUMN_VISIBILITY_TX;
        const renderFunc = isBankBeneficiaryPanel ? renderBankBeneficiaryTable : renderTable;

        visibilityMap[cb.dataset.colId] = cb.checked;
        await savePreference(saveKey, visibilityMap);
        renderFunc();
    }
  }

  // --- 表格排序管理 ---
  async function handleHeaderClick(event) {
    const th = event.target.closest('th');
    if (!th || !th.dataset.colId) return;

    const isBankBeneficiaryTable = th.closest('#bank-beneficiary-table-container');
    let currentSortConfig = isBankBeneficiaryTable ? bankBeneficiarySortConfig : sortConfigTx;
    let currentColumnConfig = isBankBeneficiaryTable ? bankBeneficiaryColumnConfig : columnConfig;
    let saveKey = isBankBeneficiaryTable ? KEY_SORT_CONFIG_BB : KEY_SORT_CONFIG_TX;
    let renderFunc = isBankBeneficiaryTable ? renderBankBeneficiaryTable : renderTable;

    const col = currentColumnConfig.find(c => c.id === th.dataset.colId);
    if (!col?.sortable) return;

    if (currentSortConfig.key === col.id) {
        currentSortConfig.direction = currentSortConfig.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentSortConfig.key = col.id;
        currentSortConfig.direction = 'asc';
    }

    await savePreference(saveKey, currentSortConfig);
    renderFunc();
  }

  // --- 面板切换逻辑 ---
  async function showSubPanel(panelType) {
    const transactionPanel = document.getElementById('transaction-panel-content');
    const bankBeneficiaryPanel = document.getElementById('bank-beneficiary-panel');
    const makeupPanel = document.getElementById('makeup-panel');
    const txBtn = document.getElementById('show-transaction-panel-btn');
    const bbBtn = document.getElementById('show-bank-beneficiary-panel-btn');
    const muBtn = document.getElementById('show-makeup-panel-btn');

    transactionPanel.classList.remove('active-panel');
    bankBeneficiaryPanel.classList.remove('active-panel');
    makeupPanel.classList.remove('active-panel');
    txBtn.classList.remove('active');
    bbBtn.classList.remove('active');
    muBtn.classList.remove('active');

    if (panelType === 'transaction') {
        transactionPanel.classList.add('active-panel');
        txBtn.classList.add('active');
    } else if (panelType === 'bankBeneficiary') {
        bankBeneficiaryPanel.classList.add('active-panel');
        bbBtn.classList.add('active');
        populateBankBeneAccountSelector();
    } else if (panelType === 'makeup') {
        makeupPanel.classList.add('active-panel');
        muBtn.classList.add('active');
        populateMakeupPanelSelectors();
    }

    currentActiveSubPanel = panelType;
    await savePreference(KEY_ACTIVE_SUBPANEL_PREFERENCE, currentActiveSubPanel);

    currentLogDisplayType = panelType;
    renderLogs();
    renderTable(); // 确保可见性
    renderBankBeneficiaryTable(); // 确保可见性
  }

  // --- 打款节流逻辑 ---
  async function loadPayoutThrottleTimestamps() {
    payoutThrottleTimestamps = (await loadPreference(KEY_PAYOUT_THROTTLE_TIMESTAMPS, {})) || {};
    const now = Date.now();
    let changed = false;
    // 清理过期时间戳
    Object.keys(payoutThrottleTimestamps).forEach(id => {
      if (now - payoutThrottleTimestamps[id] > PAYOUT_THROTTLE_DURATION_MS + 5000) { // 额外宽限5秒
        delete payoutThrottleTimestamps[id];
        changed = true;
      }
    });
    if (changed) await savePreference(KEY_PAYOUT_THROTTLE_TIMESTAMPS, payoutThrottleTimestamps); // 如果有清理，则保存
  }

  async function setPayoutThrottle(id) {
    payoutThrottleTimestamps[id] = Date.now();
    await savePreference(KEY_PAYOUT_THROTTLE_TIMESTAMPS, payoutThrottleTimestamps);
    await addLogEntry({ message: `<span class="log-info">节流时间戳已存.</span>`}, false, 'transaction');
  }

  function isPayoutThrottled(id) {
    const ts = payoutThrottleTimestamps[id];
    return ts && (Date.now() - ts) < PAYOUT_THROTTLE_DURATION_MS;
  }

  // --- GDS账户数据缓存 ---
  function parseBankColumnForAccountNames(bankStr) {
      if (!bankStr || typeof bankStr !== 'string') return [];
      let clean = bankStr.replace(/\balll\b/gi, '').trim();
      if (!clean) return [];
      return clean.split(/[\s,\/]+/).filter(Boolean).map(n => n.trim().toUpperCase()).filter(Boolean);
  }

  async function loadGdsAccountCache() {
      try {
          const raw = await sharedGdsDb.get(SHARED_GDS_STORE_NAME, KEY_FOR_SHARED_ACCOUNTS_OBJECT);
          gdsAccountDataCache = {}; // 每次加载前清空，确保最新
          if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
              for (const k in raw) {
                  if (raw.hasOwnProperty(k)) {
                      const entry = raw[k];
                      if (entry?.current?.accountName && entry.current.platform) {
                          // 确保账户ID正确设置
                          if (!entry.current.id || String(entry.current.id) !== String(k)) {
                              entry.current.id = String(k);
                          }
                          const accountData = { ...entry.current };
                          // 如果apiStatus是-1，显式将状态标记为“已消失”
                          if (accountData.apiStatus === -1) {
                              accountData.status = '已消失';
                          }
                          gdsAccountDataCache[String(k)] = { current: accountData };
                      }
                  }
              }
          } else {
              await addLogEntry({ message: `<span class="log-warn">GDS缓存未找到/无效.</span>` }, false, currentLogDisplayType);
          }
      } catch (e) {
          gdsAccountDataCache = {};
          await addLogEntry({ message: `<span class="log-error">加载GDS缓存错误: ${escapeHtml(e.message)}.</span>` }, false, currentLogDisplayType);
      }
  }

  // --- 交易表格函数 ---
  async function fetchTransactionData(isInitial = false) {
    const timeEl = document.getElementById('embed-tx-last-refresh-time');
    const attemptTime = new Date();
    if (timeEl && !isInitial) { timeEl.innerText = `刷新中... (${formatDateTime(attemptTime)})`; timeEl.classList.remove('error'); }

    try {
      const resp = await gmFetch('GET', TRANSACTION_DATA_URL, { "Accept": "text/html", "Cache-Control": "no-cache" });
      if (resp.status >= 200 && resp.status < 300) {
        const doc = new DOMParser().parseFromString(resp.responseText, 'text/html');
        const rows = doc.querySelectorAll('table tbody tr');
        const newData = [];
        let changed = false;

        rows.forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 7) {
            const id = row.dataset.entryId || `gen_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
            const tx = {
              id, entryId: id, merchant: cells[0].textContent.trim(), recipientName: cells[1].textContent.trim(), recipientBank: cells[2].textContent.trim(), recipientAccNo: cells[3].textContent.trim(), recipientIFSC: cells[4].textContent.trim(), remarks: cells[5].textContent.trim(), txAmount: parseFloat(cells[6].textContent.trim().replace(/,/g, '')) || 0,
              selectedPayoutAccountId: null, payoutAccountBalance: null, payoutAccountLastUpdate: null, availablePayees: [], selectedPayeeId: null, transferAmount: null, selectedTransferMode: DEFAULT_GDS_TRANSFER_MODE,
              selectedAddBeneficiaryAccountId: null
            };
            const oldTx = transactionDataCache.find(t => t.entryId === tx.entryId);
            if (oldTx) {
              Object.assign(tx, {
                selectedPayoutAccountId: oldTx.selectedPayoutAccountId, payoutAccountBalance: oldTx.payoutAccountBalance, payoutAccountLastUpdate: oldTx.payoutAccountLastUpdate,
                availablePayees: oldTx.availablePayees || [], selectedPayeeId: oldTx.selectedPayeeId, transferAmount: oldTx.transferAmount, selectedTransferMode: oldTx.selectedTransferMode,
                selectedAddBeneficiaryAccountId: oldTx.selectedAddBeneficiaryAccountId
              });
              if (tx.selectedPayoutAccountId && gdsAccountDataCache[String(tx.selectedPayoutAccountId)]?.current) {
                const acc = gdsAccountDataCache[String(tx.selectedPayoutAccountId)].current;
                tx.payoutAccountBalance = parseFloat(acc.balance);
                tx.payoutAccountLastUpdate = acc.lastChangeTime ? new Date(String(acc.lastChangeTime).replace(/-/g,'/')).getTime() : Date.now();
              }
            }
            newData.push(tx);
          }
        });

        const essentialData = (dataArray) => dataArray.map(t => ({
          entryId: t.entryId, merchant: t.merchant, recipientName: t.recipientName, recipientBank: t.recipientBank,
          recipientAccNo: t.recipientAccNo, recipientIFSC: t.recipientIFSC, remarks: t.remarks, txAmount: t.txAmount
        }));
        if (JSON.stringify(essentialData(newData)) !== JSON.stringify(essentialData(transactionDataCache))) changed = true;

        transactionDataCache = newData;
        if (timeEl) { timeEl.innerText = `更新于: ${formatDateTime(attemptTime)}`; timeEl.classList.remove('error'); }
        lastSuccessfulDataTimestamp = attemptTime;
        await savePreference(KEY_LAST_REFRESH_TX, lastSuccessfulDataTimestamp.toISOString());

        if (changed || isInitial) {
          renderTable();
          if (isInitial) {
            for (const tx of newData) {
              if (tx.selectedPayoutAccountId && tx.recipientAccNo) {
                await fetchPayeesForRow(tx.entryId, tx.recipientAccNo);
              }
            }
          }
        } else {
          document.getElementById('embed-tx-table-container').querySelectorAll('tbody tr').forEach(r => {
            const id = r.dataset.entryId;
            const tx = transactionDataCache.find(t => t.entryId === id);
            if (tx) updateRowState(r, tx);
          });
        }
      } else {
        if (timeEl) { timeEl.innerText = `刷新失败 (${formatDateTime(attemptTime)}) - ${resp.status}`; timeEl.classList.add('error'); }
        showFetchStatus(`获取交易失败: ${resp.status}`, 'error');
        await addLogEntry({ message: `<span class="log-error">获取交易失败. Status: ${resp.status}.</span>` }, false, 'transaction');
      }
    } catch (error) {
      if (timeEl) { timeEl.innerText = `刷新失败 (${formatDateTime(attemptTime)}) - 网络错误`; timeEl.classList.add('error'); }
      showFetchStatus('获取交易网络错误', 'error');
      await addLogEntry({ message: `<span class="log-error">获取交易网络错误.</span>` }, false, 'transaction');
    }
  }

  const commonTableHeaders = (config, visibilityMap, sortConfig) => {
    return '<thead><tr>' + config.map(col => {
      let cls = col.cssClass || '';
      if (!visibilityMap[col.id]) cls += ' col-hidden';
      if (col.sortable) cls += ' sortable';
      let indicator = (col.sortable && sortConfig.key === col.id) ? (sortConfig.direction === 'asc' ? ' ▲' : ' ▼') : '';
      return `<th class="${cls}" data-col-id="${col.id}" title="${escapeHtml(col.label)}">${escapeHtml(col.label)}${indicator}</th>`;
    }).join('') + '</tr></thead>';
  };

  const transactionCellRenderer = (tx, col, columnVisibilityTx) => {
    let cls = col.cssClass || '';
    if (!columnVisibilityTx[col.id]) cls += ' col-hidden';
    let content = '';

    switch (col.id) {
        case 'merchant': content = escapeHtml(tx.merchant); break;
        case 'recipientName': content = escapeHtml(tx.recipientName); break;
        case 'recipientBank': content = escapeHtml(tx.recipientBank); break;
        case 'recipientAccNo': content = escapeHtml(tx.recipientAccNo); break;
        case 'recipientIFSC': content = escapeHtml(tx.recipientIFSC); break;
        case 'remarks': content = escapeHtml(tx.remarks); break;
        case 'txAmount': content = formatAmount(tx.txAmount); break;
        case 'payoutAccountSelector':
            let pOpts='<option value="">--打款账户--</option>';
            const bankNames = parseBankColumnForAccountNames(tx.recipientBank);
            const filteredPayoutAccounts = Object.values(gdsAccountDataCache).filter(c => c?.current?.accountName && c.current.platform && c.current.status !== '已消失' && bankNames.some(bankName => String(c.current.accountName).toUpperCase().includes(bankName))).map(c => c.current);
            if(filteredPayoutAccounts.length > 0){
                filteredPayoutAccounts.sort((a,b)=>String(a.accountName).localeCompare(String(b.accountName)))
                                 .forEach(a=>{pOpts+=`<option value="${escapeHtml(String(a.id))}" ${String(tx.selectedPayoutAccountId)===String(a.id)?'selected':''}>${escapeHtml(a.accountName)}</option>`;});
            }else{
                pOpts+='<option value="" disabled>无匹配</option>';
            }
            content=`<select data-type="payout-account-selector">${pOpts}</select>`;
            break;
        case 'payoutAccountBalance': content = tx.payoutAccountBalance !== null ? formatAmount(tx.payoutAccountBalance) : 'N/A'; break;
        case 'payeeSelector':
            let yOpts='<option value="">--受益人--</option>';
            if(tx.availablePayees?.length>0){
                tx.availablePayees.forEach(p=>{yOpts+=`<option value="${escapeHtml(String(p.payeeId))}" ${String(p.payeeId)==String(tx.selectedPayeeId)?'selected':''}>${escapeHtml(p.name)}</option>`;});
            }else if(tx.selectedPayoutAccountId){
                yOpts+='<option value="" disabled>加载/无</option>';
            }else{
                yOpts+='<option value="" disabled>选账户</option>';
            }
            content=`<select data-type="payee-selector">${yOpts}</select>`;
            break;
        case 'payoutAccountLastUpdate': content = tx.payoutAccountLastUpdate ? formatDateTime(new Date(tx.payoutAccountLastUpdate)) : 'N/A'; break;
        case 'transferAmountInput': content = `<input type="number" placeholder="金额" value="${tx.transferAmount !== null ? tx.transferAmount : ''}" data-type="transfer-amount-input" min="0" class="${(tx.transferAmount !== null && tx.transferAmount > tx.txAmount) ? 'input-invalid' : ''}">`; break;
        case 'transferModeSelector': let mOpts = GDS_TRANSFER_MODES.map(m=>`<option value="${m.value}" ${tx.selectedTransferMode==m.value?'selected':''}>${escapeHtml(m.name)}</option>`).join(''); content=`<select data-type="transfer-mode-selector">${mOpts}</select>`; break;
        case 'actions':
            const pAcc = tx.selectedPayoutAccountId && gdsAccountDataCache[String(tx.selectedPayoutAccountId)];
            const payee = tx.selectedPayeeId !== null;
            const amtValid = tx.transferAmount !== null && tx.transferAmount > 0 && tx.transferAmount <= tx.txAmount && pAcc && tx.transferAmount <= tx.payoutAccountBalance;
            const thr = isPayoutThrottled(tx.entryId);
            const deductButtonDisabled = !(tx.transferAmount !== null && tx.transferAmount > 0 && tx.txAmount > 0);

            content = `
                <button class="action-button payout-action-button" data-type="payout-button" ${!(pAcc && payee && amtValid && !thr)?'disabled':''}>${thr?'冷却中':'打款'}</button>
                <button class="action-button deduct-action-button" data-type="deduct-amount-button" ${deductButtonDisabled?'disabled':''}>扣钱</button>
                <button class="action-button delete-action-button" data-type="delete-button">删除</button>
            `;
            break;
        case 'addBeneficiary':
            let addBeneOpts = '<option value="">--选择账户--</option>';
            const addBeneAccounts = Object.values(gdsAccountDataCache).filter(c => c?.current?.accountName && c.current.platform && c.current.status !== '已消失');
            if (addBeneAccounts.length > 0) {
                addBeneAccounts.sort((a, b) => String(a.current.accountName).localeCompare(String(b.current.accountName)))
                    .forEach(a => {
                        addBeneOpts += `<option value="${escapeHtml(String(a.current.id))}" ${String(tx.selectedAddBeneficiaryAccountId) === String(a.current.id) ? 'selected' : ''}>${escapeHtml(a.current.accountName)}</option>`;
                    });
            } else {
                addBeneOpts += '<option value="" disabled>无可用账户</option>';
            }
            const selectedAddBeneAccount = tx.selectedAddBeneficiaryAccountId && gdsAccountDataCache[String(tx.selectedAddBeneficiaryAccountId)]?.current;
            const addBeneBtnEnabled = !!selectedAddBeneAccount;
            content = `<select data-type="add-beneficiary-account-selector">${addBeneOpts}</select><button class="action-button add-beneficiary-button" data-type="add-beneficiary-button" ${!addBeneBtnEnabled ? 'disabled' : ''}>添加</button>`;
            break;
        default: content = `N/A`;
    }
    return `<td class="${cls}">${content}</td>`;
  };

  function renderTable() {
    const tableContainer = document.getElementById('embed-tx-table-container');
    if (!tableContainer) return;

    let data = [...transactionDataCache];
    const search = (document.getElementById('embed-tx-search')?.value || '').toLowerCase().trim();
    const keywords = search ? search.split(/\s+/).filter(Boolean) : [];
    if (keywords.length > 0) {
      data = data.filter(tx => {
        const txt = `${tx.merchant} ${tx.recipientName} ${tx.recipientBank} ${tx.recipientAccNo} ${tx.recipientIFSC} ${tx.remarks} ${tx.txAmount}`.toLowerCase();
        return keywords.every(k => txt.includes(k));
      });
    }

    if (sortConfigTx.key) {
      const scol = columnConfig.find(c => c.id === sortConfigTx.key);
      if (scol?.dataKey && scol.sortable) {
        data.sort((a,b) => {
          let vA = a[scol.dataKey], vB = b[scol.dataKey];
          if(typeof vA === 'string') {vA=vA.toLowerCase(); vB=String(vB).toLowerCase();}
          const dir = sortConfigTx.direction === 'asc' ? 1 : -1;
          if (vA < vB) return -1 * dir;
          if (vA > vB) return 1 * dir;
          return (a.entryId < b.entryId) ? -1 : 1; // 稳定排序
        });
      }
    }

    const tableHTML = `<table>${commonTableHeaders(columnConfig, columnVisibilityTx, sortConfigTx)}<tbody>` +
      data.map(tx => `<tr data-entry-id="${escapeHtml(tx.entryId)}">` +
        columnConfig.map(col => transactionCellRenderer(tx, col, columnVisibilityTx)).join('') +
      `</tr>`).join('') + `</tbody></table>`;

    tableContainer.innerHTML = tableHTML;

    const table = tableContainer.querySelector('table');
    if (table) {
      table.querySelector('thead')?.addEventListener('click', handleHeaderClick);
      table.addEventListener('contextmenu', handleTableRightClick);
      // 为动态生成的元素绑定事件
      table.querySelectorAll('[data-type="payout-account-selector"]').forEach(s=>s.addEventListener('change', handlePayoutAccountChange));
      table.querySelectorAll('[data-type="payee-selector"]').forEach(s=>s.addEventListener('change', handlePayeeChange));
      table.querySelectorAll('[data-type="transfer-amount-input"]').forEach(i=>i.addEventListener('input', handleTransferAmountChange));
      table.querySelectorAll('[data-type="transfer-mode-selector"]').forEach(s=>s.addEventListener('change', handleTransferModeChange));
      table.querySelectorAll('[data-type="payout-button"]').forEach(b=>b.addEventListener('click', handlePayoutButtonClick));
      table.querySelectorAll('[data-type="deduct-amount-button"]').forEach(b=>b.addEventListener('click', handleDeductAmountButtonClick));
      table.querySelectorAll('[data-type="delete-button"]').forEach(b=>b.addEventListener('click', handleDeleteButtonClick));
      table.querySelectorAll('[data-type="add-beneficiary-account-selector"]').forEach(s=>s.addEventListener('change', handleAddBeneficiaryAccountChange));
      table.querySelectorAll('[data-type="add-beneficiary-button"]').forEach(b=>b.addEventListener('click', handleAddBeneficiaryButtonClick));
    }
  }

  function handleTableRightClick(event) { const td = event.target.closest('td'); if (td) { event.preventDefault(); const txt = td.innerText.trim(); if (txt) navigator.clipboard.writeText(txt).then(()=>showToast(`已复制: ${txt.substring(0,20)}...`, event)).catch(()=>showToast('复制失败', event)); }}

  function updateRowState(rowEl, tx) {
    if (!rowEl || !tx) return;
    const balCell = rowEl.querySelector('.col-payout-account-balance');
    const updCell = rowEl.querySelector('.col-payout-account-last-update');
    const payBtn = rowEl.querySelector('[data-type="payout-button"]');
    const accSel = rowEl.querySelector('[data-type="payout-account-selector"]');
    const payeeSel = rowEl.querySelector('.col-payee-selector select');
    const amtInp = rowEl.querySelector('[data-type="transfer-amount-input"]');
    const deductBtn = rowEl.querySelector('[data-type="deduct-amount-button"]');
    const addBeneAccSel = rowEl.querySelector('[data-type="add-beneficiary-account-selector"]');
    const addBeneBtn = rowEl.querySelector('[data-type="add-beneficiary-button"]');

    if (balCell) balCell.textContent = tx.payoutAccountBalance !== null ? formatAmount(tx.payoutAccountBalance) : 'N/A';
    if (updCell) updCell.textContent = tx.payoutAccountLastUpdate ? formatDateTime(new Date(tx.payoutAccountLastUpdate)) : 'N/A';
    if(accSel && tx.selectedPayoutAccountId) { const opt = accSel.querySelector(`option[value="${escapeHtml(String(tx.selectedPayoutAccountId))}"]`); if(opt && gdsAccountDataCache[String(tx.selectedPayoutAccountId)]?.current) opt.textContent = escapeHtml(gdsAccountDataCache[String(tx.selectedPayoutAccountId)].current.accountName); }
    if (payeeSel) {
        let opts='<option value="">--受益人--</option>';
        if(tx.availablePayees?.length>0){ tx.availablePayees.forEach(p=>{opts+=`<option value="${escapeHtml(String(p.payeeId))}" ${String(p.payeeId)==String(tx.selectedPayeeId)?'selected':''}>${escapeHtml(p.name)}</option>`;}); }
        else if(tx.selectedPayoutAccountId){ opts+='<option value="" disabled>加载/无</option>'; }
        else{ opts+='<option value="" disabled>选账户</option>'; }
        payeeSel.innerHTML=opts;
        payeeSel.value = tx.selectedPayeeId !== null ? String(tx.selectedPayeeId) : "";
        if (tx.selectedPayeeId && !payeeSel.querySelector(`option[value="${escapeHtml(String(tx.selectedPayeeId))}"]`)) { tx.selectedPayeeId = null; payeeSel.value = ""; }
    }
    if (amtInp) amtInp.classList.toggle('input-invalid', tx.transferAmount !== null && tx.transferAmount > tx.txAmount);
    if (payBtn) { const pAcc = tx.selectedPayoutAccountId && gdsAccountDataCache[String(tx.selectedPayoutAccountId)]; const payee = tx.selectedPayeeId !== null; const amtValid = tx.transferAmount !== null && tx.transferAmount > 0 && tx.transferAmount <= tx.txAmount && pAcc && tx.transferAmount <= tx.payoutAccountBalance; const thr = isPayoutThrottled(tx.entryId); payBtn.disabled = !(pAcc && payee && amtValid && !thr); payBtn.textContent = thr?'冷却中':'打款'; }
    if (deductBtn) { deductBtn.disabled = !(tx.transferAmount !== null && tx.transferAmount > 0 && tx.txAmount > 0); }
    if (addBeneAccSel) {
        if (tx.selectedAddBeneficiaryAccountId && (!gdsAccountDataCache[String(tx.selectedAddBeneficiaryAccountId)]?.current || gdsAccountDataCache[String(tx.selectedAddBeneficiaryAccountId)].current.status === '已消失')) { tx.selectedAddBeneficiaryAccountId = null; }
        addBeneAccSel.value = tx.selectedAddBeneficiaryAccountId !== null ? String(tx.selectedAddBeneficiaryAccountId) : "";
        if (tx.selectedAddBeneficiaryAccountId) { const opt = addBeneAccSel.querySelector(`option[value="${escapeHtml(String(tx.selectedAddBeneficiaryAccountId))}"]`); if (opt && gdsAccountDataCache[String(tx.selectedAddBeneficiaryAccountId)]?.current) { opt.textContent = escapeHtml(gdsAccountDataCache[String(tx.selectedAddBeneficiaryAccountId)].current.accountName); }}
    }
    if (addBeneBtn) { const selectedAddBeneAccount = tx.selectedAddBeneficiaryAccountId && gdsAccountDataCache[String(tx.selectedAddBeneficiaryAccountId)]?.current; addBeneBtn.disabled = !selectedAddBeneAccount; }
  }

  async function fetchPayeesForRow(id, accNo) {
    const tx = transactionDataCache.find(t => t.entryId === id); if (!tx) return;
    const token = localStorage.getItem('token'); if (!token) { tx.availablePayees=[]; tx.selectedPayeeId=null; updateRowState(document.querySelector(`tr[data-entry-id="${escapeHtml(id)}"]`), tx); return; }
    const url = GDS_PAYEE_LIST_API_URL_TEMPLATE.replace('{ACCOUNT_NO}', encodeURIComponent(accNo));
    try {
      const resp = await gmFetch("GET", url, { "Accept": "application/json", "Authorization": token, "Cache-Control": "no-cache" });
      const res = JSON.parse(resp.responseText);
      if (res.code===1 && res.data?.list) { tx.availablePayees = res.data.list.map(p=>({payeeId:p.payeeId, name:p.name})); if(tx.availablePayees.length===1)tx.selectedPayeeId=tx.availablePayees[0].payeeId; else if(tx.selectedPayeeId && !tx.availablePayees.find(p=>String(p.payeeId)==String(tx.selectedPayeeId)))tx.selectedPayeeId=null;}
      else { tx.availablePayees=[]; tx.selectedPayeeId=null; if(res.code!==1) await addLogEntry({message:`<span class="log-warn">E${escapeHtml(id.substring(0,5))}:受益人API错误:${escapeHtml(res.msg||'')}</span>`}, false, 'transaction');}
    } catch(e){ tx.availablePayees=[]; tx.selectedPayeeId=null; await addLogEntry({message:`<span class="log-error">E${escapeHtml(id.substring(0,5))}:受益人解析错误或网络错误: ${escapeHtml(e.message)}</span>`}, false, 'transaction'); }
    updateRowState(document.querySelector(`tr[data-entry-id="${escapeHtml(id)}"]`), tx);
  }

  async function handlePayoutAccountChange(event) {
    await loadGdsAccountCache();
    const sel = event.target;
    const id = sel.closest('tr').dataset.entryId;
    const accId = sel.value;
    const tx = transactionDataCache.find(t => t.entryId === id);
    if (!tx) return;

    tx.selectedPayoutAccountId = accId;
    tx.availablePayees = [];
    tx.selectedPayeeId = null;
    let accName = "无";

    if (accId && gdsAccountDataCache[accId]?.current) {
      const acc = gdsAccountDataCache[accId].current;
      accName = acc.accountName;
      tx.payoutAccountBalance = parseFloat(acc.balance);
      tx.payoutAccountLastUpdate = acc.lastChangeTime ? new Date(String(acc.lastChangeTime).replace(/-/g,'/')).getTime() : Date.now();
      if (tx.recipientAccNo) await fetchPayeesForRow(id, tx.recipientAccNo);
    } else {
      tx.payoutAccountBalance = null;
      tx.payoutAccountLastUpdate = null;
    }
    await addLogEntry({message: `<span class="log-info">E${escapeHtml(id.substring(0,5))}: 打款账户->${escapeHtml(accName)}.</span>`}, false, 'transaction');
    updateRowState(sel.closest('tr'), tx);
  }

  async function handlePayeeChange(event) {
    const sel = event.target;
    const id = sel.closest('tr').dataset.entryId;
    const pId = sel.value ? parseInt(sel.value) : null;
    const tx = transactionDataCache.find(t => t.entryId === id);
    if (!tx) return;
    tx.selectedPayeeId = pId;
    const pName = pId ? (tx.availablePayees.find(p => p.payeeId === pId)?.name || `ID ${pId}`) : "无";
    await addLogEntry({message: `<span class="log-info">E${escapeHtml(id.substring(0,5))}: 受益人->${escapeHtml(pName.substring(0,10))}.</span>`}, false, 'transaction');
    updateRowState(sel.closest('tr'), tx);
  }

  async function handleTransferAmountChange(event) {
    const input = event.target;
    const id = input.closest('tr').dataset.entryId;
    const tx = transactionDataCache.find(t => t.entryId === id);
    if (!tx) return;

    let currentInputValue = parseFloat(input.value);
    input.classList.toggle('input-invalid', !isNaN(currentInputValue) && currentInputValue > tx.txAmount);

    if (transferAmountDebounceTimers[id]) {
      clearTimeout(transferAmountDebounceTimers[id]);
    }

    transferAmountDebounceTimers[id] = setTimeout(async () => {
      let amount = parseFloat(input.value);
      const oldAmount = tx.transferAmount;
      let clamped = false;

      if (isNaN(amount) || amount < 0) {
        tx.transferAmount = null;
      } else {
        if (amount > tx.txAmount) {
          amount = tx.txAmount;
          input.value = formatAmount(amount);
          clamped = true;
          showToast('打款金额已自动修正为订单金额', event, 1500);
        }
        tx.transferAmount = parseFloat(amount.toFixed(2));
      }

      input.classList.toggle('input-invalid', tx.transferAmount !== null && tx.transferAmount > tx.txAmount);

      if (oldAmount !== tx.transferAmount || clamped) {
        let logMessage = `<span class="log-info">E${escapeHtml(id.substring(0,5))}: 打款金额->${tx.transferAmount===null?'N/A':formatAmount(tx.transferAmount)}`;
        if (clamped) logMessage += ' (已修正为订单金额)';
        else if (tx.transferAmount !== null && tx.transferAmount > tx.txAmount) logMessage += ' (超订单金额!)';
        logMessage += '.</span>';
        await addLogEntry({message: logMessage}, false, 'transaction');
      }
      updateRowState(input.closest('tr'), tx);
    }, DEBOUNCE_DELAY_MS);
  }

  async function handleTransferModeChange(event) {
    const sel = event.target;
    const id = sel.closest('tr').dataset.entryId;
    const tx = transactionDataCache.find(t => t.entryId === id);
    if (!tx) return;
    tx.selectedTransferMode = parseInt(sel.value);
    const mName = GDS_TRANSFER_MODES.find(m=>m.value===tx.selectedTransferMode)?.name||'未知';
    await addLogEntry({message: `<span class="log-info">E${escapeHtml(id.substring(0,5))}: 模式->${escapeHtml(mName)}.</span>`}, false, 'transaction');
  }

  async function handlePayoutButtonClick(event) {
    const btn = event.target;
    const id = btn.closest('tr').dataset.entryId;
    const tx = transactionDataCache.find(t => t.entryId === id);
    if (!tx || !tx.selectedPayoutAccountId || tx.selectedPayeeId === null || tx.transferAmount === null || tx.transferAmount <= 0) { showToast('请选账户/受益人/有效金额', event); return; }
    const accCont = gdsAccountDataCache[String(tx.selectedPayoutAccountId)]; if (!accCont?.current) { showToast('打款账户无效', event); return; }
    const acc = accCont.current;
    if (tx.transferAmount > tx.txAmount) { showToast('打款金额不能超过订单金额!', event); await addLogEntry({ message: `<span class="log-warn">E${escapeHtml(id.substring(0,5))}: 打款失败 - 超订单金额.</span>` }, true, 'transaction'); return; }
    if (tx.transferAmount > tx.payoutAccountBalance) { showToast('金额超余额', event); await addLogEntry({ message: `<span class="log-warn">E${escapeHtml(id.substring(0,5))}: 打款失败 - 超账户余额.</span>` }, true, 'transaction'); return; }
    if (isPayoutThrottled(id)) { showToast('操作频繁', event); return; }
    const token = localStorage.getItem('token'); if (!token) { showToast('Token未找到', event); await addLogEntry({ message: `<span class="log-error">打款失败(E${escapeHtml(id.substring(0,5))}): Token未找到</span>` }, true, 'transaction'); return; }

    btn.disabled = true; btn.textContent = '处理中...'; showFetchStatus(`E${id} 打款中...`, 'info', 0);
    const reqId = `req-${Date.now()}-${Math.random().toString(36).substring(2,7)}`;
    const payload = { tripartiteId: acc.platform, accountName: acc.accountName, payeeId: tx.selectedPayeeId, amount: Math.floor(tx.transferAmount * 100), transferMode: tx.selectedTransferMode, isBulk: false, version: Date.now() };
    const pName = tx.availablePayees.find(p=>String(p.payeeId)==String(tx.selectedPayeeId))?.name || `PayeeID ${tx.selectedPayeeId}`;
    await addLogEntry({ message: `<span class="log-transfer-attempt">尝试打款 E${escapeHtml(id.substring(0,5))}: ${escapeHtml(acc.accountName)}->${escapeHtml(pName.substring(0,10))} 金额 ${formatAmount(tx.transferAmount)} (Req ${reqId})</span>`}, true, 'transaction');

    try {
      const resp = await gmFetch("POST", GDS_TRANSFER_API_URL, { "Accept": "application/json", "Authorization": token, "Content-Type": "application/json", "X-Request-ID": reqId }, JSON.stringify(payload));
      const res = JSON.parse(resp.responseText);
      if (res.code === 1) {
        showFetchStatus(`E${id}:打款成功!`, 'success', 3000);
        await addLogEntry({ message: `<span class="log-transfer-success">打款成功 E${escapeHtml(id.substring(0,5))}: ${escapeHtml(acc.accountName)} -> ${escapeHtml(pName.substring(0,10))} ${escapeHtml(res.msg||'')} (Req ${reqId})</span>` }, true, 'transaction');
        await setPayoutThrottle(id);
        await loadGdsAccountCache(); // 重新加载账户余额
        const curAccId = String(acc.id);
        const updAcc = gdsAccountDataCache[curAccId];
        if (updAcc?.current) { // 更新所有使用该账户的交易的余额显示
          const d = updAcc.current;
          tx.payoutAccountBalance = parseFloat(d.balance);
          tx.payoutAccountLastUpdate = d.lastChangeTime ? new Date(String(d.lastChangeTime).replace(/-/g,'/')).getTime() : Date.now();
          transactionDataCache.forEach(t => { if (String(t.selectedPayoutAccountId)===curAccId && t.entryId!==id) { t.payoutAccountBalance = parseFloat(d.balance); t.payoutAccountLastUpdate = d.lastChangeTime ? new Date(String(d.lastChangeTime).replace(/-/g,'/')).getTime() : Date.now(); updateRowState(document.querySelector(`tr[data-entry-id="${escapeHtml(t.entryId)}"]`), t); }});
        }
        updateRowState(btn.closest('tr'), tx);
      } else {
        showFetchStatus(`E${id}:打款失败 - ${res.msg||'未知'}`, 'error');
        await addLogEntry({ message: `<span class="log-transfer-fail">打款失败 E${escapeHtml(id.substring(0,5))}: ${escapeHtml(res.msg||'未知')} (Req ${reqId})</span>` }, true, 'transaction');
        btn.disabled = false; btn.textContent = '打款';
      }
    } catch (e) {
      showFetchStatus(`E${id}:打款网络或解析错误`, 'error');
      await addLogEntry({ message: `<span class="log-error">打款网络或解析错误 E${escapeHtml(id.substring(0,5))}: ${escapeHtml(e.message)} (Req ${reqId})</span>` }, true, 'transaction');
      btn.disabled = false; btn.textContent = '打款';
    }
  }

  async function handleDeleteButtonClick(event) {
    const btn = event.target;
    const id = btn.closest('tr').dataset.entryId;
    const tx = transactionDataCache.find(t => t.entryId === id);
    if (!tx) { showToast('记录未找到', event); return; }
    if (!confirm(`确定删除记录？\n商户: ${tx.merchant}\n收款人: ${tx.recipientName}\n备注: ${tx.remarks}\n金额: ${formatAmount(tx.txAmount)}`)) { await addLogEntry({ message: `<span class="log-info">取消删除 E${escapeHtml(id.substring(0,5))}.</span>` }, false, 'transaction'); return; }
    btn.disabled = true; btn.textContent = '删除中...';
    const url = DELETE_TRANSACTION_URL_TEMPLATE.replace('{ENTRY_ID}', encodeURIComponent(id));
    await addLogEntry({ message: `<span class="log-warn">尝试删除 E${escapeHtml(id.substring(0,5))}</span>` }, false, 'transaction');

    try {
      const resp = await gmFetch("POST", url, { "accept": "text/html,application/xhtml+xml", "content-type": "application/x-www-form-urlencoded", "cache-control": "no-cache", "pragma": "no-cache", "Referer": TRANSACTION_DATA_URL }, "");
      if (resp.status >= 200 && resp.status < 300) {
        await addLogEntry({ message: `<span class="log-success">记录 E${escapeHtml(id.substring(0,5))} 删除成功.</span>` }, false, 'transaction');
        showToast(`记录 ${id.substring(0,5)} 已删`, event);
        transactionDataCache = transactionDataCache.filter(t => t.entryId !== id);
        renderTable();
      } else {
        await addLogEntry({ message: `<span class="log-error">删除 E${escapeHtml(id.substring(0,5))} 失败. Status: ${resp.status}.</span>` }, false, 'transaction');
        showToast(`删除失败: ${resp.status}`, event);
        btn.disabled = false; btn.textContent = '删除';
      }
    } catch (e) {
      await addLogEntry({ message: `<span class="log-error">删除 E${escapeHtml(id.substring(0,5))} 网络错误.</span>` }, false, 'transaction');
      showToast('删除网络错误', event);
      btn.disabled = false; btn.textContent = '删除';
    }
  }

  async function handleDeductAmountButtonClick(event) {
    const btn = event.target;
    const id = btn.closest('tr').dataset.entryId;
    const tx = transactionDataCache.find(t => t.entryId === id);

    if (!tx) { showToast('记录未找到', event); return; }
    if (tx.transferAmount === null || tx.transferAmount <= 0) { showToast('请填写有效的打款金额 (>0)', event); return; }
    if (tx.txAmount <= 0) { showToast('订单金额已为0或更少，无法扣除', event); return; }

    const amountToDeduct = tx.transferAmount;
    let newTxAmount = Math.max(0, tx.txAmount - amountToDeduct);
    const actualDeduction = tx.txAmount - newTxAmount;

    if (!confirm(`确定从订单金额 ${formatAmount(tx.txAmount)} 中扣除 ${formatAmount(amountToDeduct)}？\n扣除后订单金额将变为 ${formatAmount(newTxAmount)}`)) {
      await addLogEntry({ message: `<span class="log-info">取消扣钱 E${escapeHtml(id.substring(0,5))}.</span>` }, false, 'transaction');
      return;
    }

    btn.disabled = true; btn.textContent = '扣钱中...'; showFetchStatus(`E${id} 扣钱中...`, 'info', 0);
    const editTxUrl = EDIT_TRANSACTION_URL_TEMPLATE.replace('{ENTRY_ID}', encodeURIComponent(tx.entryId));
    let currentLocalTxDetails = null;

    try {
      const getResp = await gmFetch("GET", editTxUrl, { "Accept": "text/html", "Cache-Control": "no-cache" });
      if (getResp.status >= 200 && getResp.status < 300) {
        const doc = new DOMParser().parseFromString(getResp.responseText, 'text/html');
        currentLocalTxDetails = {};
        ['code', 'name', 'bank', 'account_no', 'ifsc', 'amount'].forEach(f => { const el = doc.getElementById(f); if (el) currentLocalTxDetails[f] = el.value; });
        const locationEl = doc.getElementById('location'); if (locationEl) currentLocalTxDetails.location = locationEl.value;

        if (currentLocalTxDetails && tx.selectedPayoutAccountId) {
          const selectedGdsAcc = gdsAccountDataCache[String(tx.selectedPayoutAccountId)]?.current;
          if (selectedGdsAcc) {
            let currentBankValue = currentLocalTxDetails.bank || '';
            const accountNameToRemove = selectedGdsAcc.accountName;
            let bankNames = currentBankValue.split('/').map(s => s.trim().toUpperCase()).filter(Boolean);
            const targetNameUpper = accountNameToRemove.toUpperCase();
            const filteredBankNames = bankNames.filter(name => name !== targetNameUpper);
            const newBankValue = filteredBankNames.join('/');
            currentLocalTxDetails.bank = newBankValue;
            if (currentBankValue !== newBankValue) {
                await addLogEntry({ message: `<span class="log-info">E${escapeHtml(id.substring(0,5))}: Bank列更新: 从 "${escapeHtml(currentBankValue)}" 移除 "${escapeHtml(accountNameToRemove)}" -> "${escapeHtml(newBankValue)}".</span>` }, false, 'transaction');
            } else {
                await addLogEntry({ message: `<span class="log-info">E${escapeHtml(id.substring(0,5))}: Bank列未变动，"${escapeHtml(accountNameToRemove)}" 未找到或已移除.</span>` }, false, 'transaction');
            }
          }
        }
        currentLocalTxDetails.amount = newTxAmount.toFixed(2);

        const postBody = new URLSearchParams();
        for (const key in currentLocalTxDetails) { postBody.append(key, currentLocalTxDetails[key] || ''); }
        postBody.append('admin_password', ADMIN_PASSWORD_FOR_BULK_ADD);

        await addLogEntry({ message: `<span class="log-warn">E${escapeHtml(id.substring(0,5))}: 尝试更新本地订单金额为 ${formatAmount(newTxAmount)} (原:${formatAmount(tx.txAmount)}, 扣除:${formatAmount(actualDeduction)}).</span>` }, true, 'transaction');

        const postResp = await gmFetch("POST", editTxUrl, { "Content-Type": "application/x-www-form-urlencoded" }, postBody.toString());
        if (postResp.status >= 200 && postResp.status < 300) {
          showFetchStatus(`E${id}:更新成功!`, 'success', 3000);
          await addLogEntry({ message: `<span class="log-success">更新成功 E${escapeHtml(id.substring(0,5))}: 原${formatAmount(tx.txAmount)} 扣${formatAmount(actualDeduction)} -> 现${formatAmount(newTxAmount)}. Bank列已更新.</span>` }, true, 'transaction');
          await fetchTransactionData(true);
        } else {
          showFetchStatus(`E${id}:更新失败 - ${postResp.status}`, 'error');
          await addLogEntry({ message: `<span class="log-error">更新失败 E${escapeHtml(id.substring(0,5))}: ${postResp.status} - ${escapeHtml(postResp.responseText.substring(0, 100))}.</span>` }, true, 'transaction');
          btn.disabled = false; btn.textContent = '扣钱';
        }
      } else {
        showFetchStatus(`E${id}:获取交易详情失败 - ${getResp.status}`, 'error');
        await addLogEntry({ message: `<span class="log-error">获取交易详情失败 E${escapeHtml(id.substring(0,5))}: ${getResp.status}.</span>` }, true, 'transaction');
        btn.disabled = false; btn.textContent = '扣钱';
      }
    } catch (e) {
      showFetchStatus(`E${id}:操作错误 - ${e.message}`, 'error');
      await addLogEntry({ message: `<span class="log-error">操作错误 E${escapeHtml(id.substring(0,5))}: ${escapeHtml(e.message)}.</span>` }, true, 'transaction');
      btn.disabled = false; btn.textContent = '扣钱';
    }
  }

  async function handleAddBeneficiaryAccountChange(event) {
    await loadGdsAccountCache();
    const sel = event.target;
    const id = sel.closest('tr').dataset.entryId;
    const accId = sel.value;
    const tx = transactionDataCache.find(t => t.entryId === id);
    if (!tx) return;

    tx.selectedAddBeneficiaryAccountId = accId;
    const selectedAcc = accId ? gdsAccountDataCache[String(accId)]?.current : null;
    const accName = selectedAcc ? selectedAcc.accountName : "无";
    await addLogEntry({message: `<span class="log-info">E${escapeHtml(id.substring(0,5))}: 添加受益人账户->${escapeHtml(accName)}.</span>`}, false, 'transaction');
    updateRowState(sel.closest('tr'), tx);
  }

  async function handleAddBeneficiaryButtonClick(event) {
    const btn = event.target;
    const id = btn.closest('tr').dataset.entryId;
    const tx = transactionDataCache.find(t => t.entryId === id);

    if (!tx) { showToast('记录未找到', event); return; }
    if (!tx.selectedAddBeneficiaryAccountId) { showToast('请选择用于添加受益人的打款账户', event); return; }

    const selectedGdsAcc = gdsAccountDataCache[String(tx.selectedAddBeneficiaryAccountId)]?.current;
    if (!selectedGdsAcc) { showToast('所选打款账户无效', event); return; }

    const token = localStorage.getItem('token');
    if (!token) { showToast('Token未找到', event); await addLogEntry({ message: `<span class="log-error log-add-beneficiary-fail">添加受益人失败(E${escapeHtml(id.substring(0,5))}): Token未找到</span>` }, true, 'transaction'); return; }

    btn.disabled = true; btn.textContent = '添加中...'; showFetchStatus(`E${id} 添加受益人中...`, 'info', 0);
    const editTxUrl = EDIT_TRANSACTION_URL_TEMPLATE.replace('{ENTRY_ID}', encodeURIComponent(tx.entryId));
    let currentLocalTxDetails = null;

    try {
      const getResp = await gmFetch("GET", editTxUrl, { "Accept": "text/html", "Cache-Control": "no-cache" });
      if (getResp.status >= 200 && getResp.status < 300) {
        const doc = new DOMParser().parseFromString(getResp.responseText, 'text/html');
        currentLocalTxDetails = {};
        ['code', 'name', 'bank', 'account_no', 'ifsc', 'amount'].forEach(f => { const el = doc.getElementById(f); if (el) currentLocalTxDetails[f] = el.value; });
        const locationEl = doc.getElementById('location'); if (locationEl) currentLocalTxDetails.location = locationEl.value;
      } else {
        await addLogEntry({ message: `<span class="log-error log-add-beneficiary-fail">E${escapeHtml(id.substring(0,5))}: 预获取本地交易详情失败: ${getResp.status}.</span>` }, true, 'transaction');
        showFetchStatus(`E${id}:预获取交易详情失败 - ${getResp.status}`, 'error');
        btn.disabled = false; btn.textContent = '添加'; return;
      }

      const bankCode = tx.recipientIFSC;
      const bankName = bankCode ? bankCode.substring(0, 4) : '';

      const payload = { cardNo: tx.recipientAccNo, index: 0, beneficiaryName: tx.recipientName, bankCode: bankCode, bankName: bankName, tripartiteId: selectedGdsAcc.platform, accountName: selectedGdsAcc.accountName, timestamp: Date.now() };

      await addLogEntry({ message: `<span class="log-add-beneficiary-attempt">尝试添加受益人 E${escapeHtml(id.substring(0,5))}: 平台: ${escapeHtml(selectedGdsAcc.platform)}, 账户: ${escapeHtml(selectedGdsAcc.accountName)}, 受益人: ${escapeHtml(tx.recipientName.substring(0,20))}, 卡号: ${escapeHtml(tx.recipientAccNo)}, 银行代码: ${escapeHtml(bankCode)}.</span>` }, true, 'transaction');

      const gdsAddResp = await gmFetch("POST", GDS_BENEFICIARY_ADD_API_URL, { "Accept": "application/json", "Authorization": token, "Content-Type": "application/json" }, JSON.stringify(payload));
      const gdsAddRes = JSON.parse(gdsAddResp.responseText);

      if (gdsAddRes.code === 1) {
        showFetchStatus(`E${id}:受益人添加成功!`, 'success', 3000);
        await addLogEntry({ message: `<span class="log-add-beneficiary-success">受益人添加成功 E${escapeHtml(id.substring(0,5))}, 账户: ${escapeHtml(selectedGdsAcc.accountName)},受益人: ${escapeHtml(tx.recipientName.substring(0,20))}: ${escapeHtml(gdsAddRes.msg||'')}</span>` }, true, 'transaction');

        if (currentLocalTxDetails) {
          let currentBank = currentLocalTxDetails.bank || '';
          const accountNameToAdd = selectedGdsAcc.accountName;
          const existingBankEntries = currentBank.split('/').map(s => s.trim().toUpperCase()).filter(Boolean);
          if (!existingBankEntries.includes(accountNameToAdd.toUpperCase())) {
            const newBankValue = currentBank ? `${currentBank}/${accountNameToAdd}` : accountNameToAdd;
            const postBody = new URLSearchParams();
            for (const key in currentLocalTxDetails) { postBody.append(key, currentLocalTxDetails[key] || ''); }
            postBody.set('bank', newBankValue);
            postBody.append('admin_password', ADMIN_PASSWORD_FOR_BULK_ADD);

            await addLogEntry({ message: `<span class="log-info">E${escapeHtml(id.substring(0,5))}: 尝试更新本地交易 Bank 列为 "${escapeHtml(newBankValue.substring(0, Math.min(newBankValue.length, 30)))}...".</span>` }, false, 'transaction');

            const updateLocalResp = await gmFetch("POST", editTxUrl, { "Content-Type": "application/x-www-form-urlencoded" }, postBody.toString());
            if (updateLocalResp.status >= 200 && updateLocalResp.status < 300) {
              await addLogEntry({ message: `<span class="log-success">E${escapeHtml(id.substring(0,5))}: 本地Bank列更新成功.</span>` }, true, 'transaction');
            } else {
              await addLogEntry({ message: `<span class="log-error">E${escapeHtml(id.substring(0,5))}: 本地Bank列更新失败. Status: ${updateLocalResp.status}.</span>` }, true, 'transaction');
            }
          } else {
            await addLogEntry({ message: `<span class="log-info">E${escapeHtml(id.substring(0,5))}: GDS账户 '${escapeHtml(accountNameToAdd)}' 已存在于 Bank 列中，跳过更新.</span>` }, false, 'transaction');
          }
        } else {
            await addLogEntry({ message: `<span class="log-error">E${escapeHtml(id.substring(0,5))}: 无法更新本地Bank列，因为预获取本地交易详情失败.</span>` }, true, 'transaction');
        }

        const newBeneficiaryForLocalDB = { bank: selectedGdsAcc.accountName, name: tx.recipientName, accountNo: tx.recipientAccNo, ifsc: tx.recipientIFSC };
        const bulkDataArray = [`${encodeURIComponent(newBeneficiaryForLocalDB.bank)},${encodeURIComponent(newBeneficiaryForLocalDB.name)},${encodeURIComponent(newBeneficiaryForLocalDB.accountNo)},${encodeURIComponent(newBeneficiaryForLocalDB.ifsc)}`];
        const bulkAddBody = `bulk_data=${bulkDataArray.join('\n')}&admin_password=${ADMIN_PASSWORD_FOR_BULK_ADD}`;

        await addLogEntry({ message: `<span class="log-sync-beneficiary-attempt">E${escapeHtml(id.substring(0,5))}: GDS受益人添加成功，尝试直接添加至本地受益人列表...</span>` }, true, 'bankBeneficiary');

        gmFetch("POST", BANK_BENEFICIARIES_BULK_ADD_URL, { "Accept": "text/html", "Content-Type": "application/x-www-form-urlencoded" }, bulkAddBody)
          .then(async (bulkResp) => {
            if (bulkResp.status >= 200 && bulkResp.status < 300) {
              await addLogEntry({ message: `<span class="log-sync-beneficiary-success">E${escapeHtml(id.substring(0,5))}: 新受益人已成功添加至本地列表.</span>` }, true, 'bankBeneficiary');
            } else {
              await addLogEntry({ message: `<span class="log-error log-sync-beneficiary-fail">E${escapeHtml(id.substring(0,5))}: 新受益人添加至本地列表失败: ${bulkResp.status} - ${escapeHtml(bulkResp.responseText.substring(0, 100))}.</span>` }, true, 'bankBeneficiary');
            }
            await fetchBankBeneficiaryData(true);
          })
          .catch(async () => {
            await addLogEntry({ message: `<span class="log-error log-sync-beneficiary-fail">E${escapeHtml(id.substring(0,5))}: 添加新受益人至本地列表网络错误.</span>` }, true, 'bankBeneficiary');
          });

        await fetchTransactionData(true); // 刷新交易数据以反映Bank列的任何变化
      } else {
        let specificErrorMessage = '';
        if (gdsAddRes.data && typeof gdsAddRes.data === 'string') {
            const dataMatch = gdsAddRes.data.match(/desc = (.*?)(?:$|\.$)/);
            if (dataMatch && dataMatch[1]) specificErrorMessage = dataMatch[1].trim();
            else specificErrorMessage = gdsAddRes.data.trim();
        }
        const displayMessage = specificErrorMessage || gdsAddRes.msg || '未知错误';
        showFetchStatus(`E${id}:受益人添加失败 - ${displayMessage}`, 'error');
        await addLogEntry({ message: `<span class="log-add-beneficiary-fail">受益人添加失败 E${escapeHtml(id.substring(0,5))}: ${escapeHtml(displayMessage)}</span>` }, true, 'transaction');
      }
    } catch (e) {
      console.error("添加受益人过程失败:", e);
      showFetchStatus(`E${id}:操作错误 - ${e.message}`, 'error');
      await addLogEntry({ message: `<span class="log-error log-add-beneficiary-fail">操作错误 E${escapeHtml(id.substring(0,5))}: ${escapeHtml(e.message)}.</span>` }, true, 'transaction');
    } finally {
      btn.disabled = false; btn.textContent = '添加';
    }
  }

  // --- 银行受益人面板函数 ---
  async function populateBankBeneAccountSelector() {
    const selector = document.getElementById('bank-beneficiary-account-selector');
    if (!selector) return;

    let opts = '<option value="">--选择账户--</option>';
    const availableAccounts = Object.values(gdsAccountDataCache).filter(c => c?.current?.accountName && c.current.platform && c.current.status !== '已消失');
    if (availableAccounts.length > 0) {
        availableAccounts.sort((a, b) => String(a.current.accountName).localeCompare(String(b.current.accountName)))
            .forEach(a => {
                opts += `<option value="${escapeHtml(String(a.current.id))}" data-platform="${escapeHtml(a.current.platform)}" data-accountname="${escapeHtml(a.current.accountName)}" ${String(bankBeneSelectedAccountId) === String(a.current.id) ? 'selected' : ''}>${escapeHtml(a.current.accountName)}</option>`;
            });
    } else {
        opts += '<option value="" disabled>无可用账户</option>';
    }
    selector.innerHTML = opts;
    handleBankBeneAccountSelectorChange();
  }

  async function handleBankBeneAccountSelectorChange() {
    const selector = document.getElementById('bank-beneficiary-account-selector');
    const syncButton = document.getElementById('bank-beneficiary-sync-gds-beneficiaries');
    if (!selector || !syncButton) return;

    bankBeneSelectedAccountId = selector.value || null;
    await savePreference(KEY_BANK_BENE_SELECTED_ACCOUNT, bankBeneSelectedAccountId);

    const hasValidSelection = selector.options[selector.selectedIndex] && selector.options[selector.selectedIndex].value !== "";
    syncButton.disabled = !hasValidSelection;
  }

  async function handleSyncGdsBeneficiariesForSelectedAccount(accountId, platform, accountName) {
    const syncButton = document.getElementById('bank-beneficiary-sync-gds-beneficiaries');
    if (syncButton) { syncButton.disabled = true; syncButton.textContent = '同步中...'; }
    showFetchStatus(`同步GDS受益人 (${accountName})...`, 'info', 0);

    const token = localStorage.getItem('token');
    if (!token) { showToast('Token未找到'); await addLogEntry({ message: `<span class="log-error log-sync-beneficiary-fail">同步受益人失败: Token未找到</span>` }, true, 'bankBeneficiary'); if (syncButton) { syncButton.disabled = false; syncButton.textContent = '更新GDS受益人'; } return; }

    await addLogEntry({ message: `<span class="log-sync-beneficiary-attempt">开始同步 GDS 受益人: GDS账户: ${escapeHtml(accountName)} (平台: ${escapeHtml(platform)}).</span>` }, true, 'bankBeneficiary');

    try {
      const gdsListResp = await gmFetch("POST", GDS_BENEFICIARY_LIST_API_URL, { "Accept": "application/json", "Authorization": token, "Content-Type": "application/json" }, JSON.stringify({ tripartiteId: platform, accountName: accountName }));
      const gdsListRes = JSON.parse(gdsListResp.responseText);

      if (gdsListRes.code === 1 && gdsListRes.data?.list) {
        const gdsBeneficiaries = gdsListRes.data.list;
        let latestLocalBeneficiaries = [];
        try {
          const localResp = await gmFetch('GET', BANK_BENEFICIARIES_URL, { "Accept": "text/html", "Cache-Control": "no-cache" });
          if (localResp.status >= 200 && localResp.status < 300) {
            const doc = new DOMParser().parseFromString(localResp.responseText, 'text/html');
            doc.querySelectorAll('table tbody tr').forEach(row => {
              const cells = row.querySelectorAll('td');
              if (cells.length >= 6) { latestLocalBeneficiaries.push({ bank: cells[0].textContent.trim(), accountNo: cells[2].textContent.trim() }); }
            });
          } else { console.error('获取最新本地受益人失败:', localResp.status); await addLogEntry({ message: `<span class="log-error log-sync-beneficiary-fail">获取本地受益人失败: ${localResp.status}.</span>` }, true, 'bankBeneficiary'); }
        } catch (e) { console.error('获取最新本地受益人网络错误:', e); await addLogEntry({ message: `<span class="log-error log-sync-beneficiary-fail">获取本地受益人网络错误: ${escapeHtml(e.message)}.</span>` }, true, 'bankBeneficiary'); }

        const beneficiariesToBulkAdd = [];
        gdsBeneficiaries.forEach(gdsBene => {
          const existsLocally = latestLocalBeneficiaries.some(localBene =>
            localBene.bank === accountName && localBene.accountNo === gdsBene.cardNo
          );
          if (!existsLocally) {
            beneficiariesToBulkAdd.push({ bank: accountName, name: gdsBene.beneficiaryName, accountNo: gdsBene.cardNo, ifsc: gdsBene.bankCode || '' });
          }
        });

        if (beneficiariesToBulkAdd.length > 0) {
          const bulkDataArray = beneficiariesToBulkAdd.map(b => `${encodeURIComponent(b.bank)},${encodeURIComponent(b.name)},${encodeURIComponent(b.accountNo)},${encodeURIComponent(b.ifsc)}`);
          const bulkAddBody = `bulk_data=${bulkDataArray.join('\n')}&admin_password=${ADMIN_PASSWORD_FOR_BULK_ADD}`;
          await addLogEntry({ message: `<span class="log-sync-beneficiary-attempt">发现 ${beneficiariesToBulkAdd.length} 条新受益人，尝试批量添加...</span>` }, true, 'bankBeneficiary');

          const bulkAddResp = await gmFetch("POST", BANK_BENEFICIARIES_BULK_ADD_URL, { "Accept": "text/html", "Content-Type": "application/x-www-form-urlencoded" }, bulkAddBody);
          if (bulkAddResp.status >= 200 && bulkAddResp.status < 300) {
            showFetchStatus(`同步成功! 添加了 ${beneficiariesToBulkAdd.length} 条新受益人。`, 'success', 5000);
            await addLogEntry({ message: `<span class="log-sync-beneficiary-success">批量添加成功: ${beneficiariesToBulkAdd.length} 条新受益人已添加.</span>` }, true, 'bankBeneficiary');
          } else {
            showFetchStatus(`批量添加失败: ${bulkAddResp.status}`, 'error', 5000);
            await addLogEntry({ message: `<span class="log-sync-beneficiary-fail">批量添加失败: ${bulkAddResp.status} - ${escapeHtml(bulkAddResp.responseText.substring(0, 100))}.</span>` }, true, 'bankBeneficiary');
          }
          await fetchBankBeneficiaryData(true);
        } else {
          showFetchStatus('没有新的受益人需要同步', 'info', 3000);
          await addLogEntry({ message: `<span class="log-sync-beneficiary-success">没有新的受益人需要同步.</span>` }, true, 'bankBeneficiary');
        }
      } else {
        showFetchStatus(`GDS受益人列表API错误: ${gdsListRes.msg||'未知'}`, 'error');
        await addLogEntry({ message: `<span class="log-sync-beneficiary-fail">GDS受益人列表API错误: ${escapeHtml(gdsListRes.msg||'未知')}.</span>` }, true, 'bankBeneficiary');
      }
    } catch (e) {
      showFetchStatus('GDS受益人列表网络或解析错误', 'error');
      await addLogEntry({ message: `<span class="log-error log-sync-beneficiary-fail">GDS受益人列表网络或解析错误: ${escapeHtml(e.message)}.</span>` }, true, 'bankBeneficiary');
    } finally {
      if (syncButton) { syncButton.disabled = false; syncButton.textContent = '更新GDS受益人'; }
    }
  }

  async function handleSyncGdsBeneficiariesButtonClick(event) {
    const selector = document.getElementById('bank-beneficiary-account-selector');
    const selectedAccountId = selector.value;
    if (!selectedAccountId) { showToast('请选择一个GDS账户来同步受益人', event); return; }
    const selectedGdsAcc = gdsAccountDataCache[selectedAccountId]?.current;
    if (!selectedGdsAcc) { showToast('所选GDS账户无效', event); return; }
    await handleSyncGdsBeneficiariesForSelectedAccount(selectedGdsAcc.id, selectedGdsAcc.platform, selectedGdsAcc.accountName);
  }

  async function fetchBankBeneficiaryData(isInitial = false) {
    const timeEl = document.getElementById('bank-beneficiary-last-refresh-time');
    const attemptTime = new Date();
    if (timeEl && !isInitial) { timeEl.innerText = `刷新中... (${formatDateTime(attemptTime)})`; timeEl.classList.remove('error'); }

    try {
      const resp = await gmFetch('GET', BANK_BENEFICIARIES_URL, { "Accept": "text/html", "Cache-Control": "no-cache" });
      if (resp.status >= 200 && resp.status < 300) {
        const doc = new DOMParser().parseFromString(resp.responseText, 'text/html');
        const rows = doc.querySelectorAll('table tbody tr');
        bankBeneficiaryDataCache = Array.from(rows).map(row => {
          const cells = row.querySelectorAll('td');
          return (cells.length >= 6) ? {
            id: row.dataset.entryId,
            bank: cells[0].textContent.trim(),
            name: cells[1].textContent.trim(),
            accountNo: cells[2].textContent.trim(),
            ifsc: cells[3].textContent.trim(),
            time: cells[4].textContent.trim(),
            timeRaw: new Date(cells[4].textContent.trim().replace(/-/g, '/')).getTime(),
            actionsText: cells[5].textContent.trim().replace(/\s+/g, ' ')
          } : null;
        }).filter(Boolean);

        if (timeEl) { timeEl.innerText = `更新于: ${formatDateTime(attemptTime)}`; timeEl.classList.remove('error'); }
        lastSuccessfulBankBeneTimestamp = attemptTime;
        await savePreference(KEY_LAST_REFRESH_BB, lastSuccessfulBankBeneTimestamp.toISOString());
        renderBankBeneficiaryTable();
      } else {
        if (timeEl) { timeEl.innerText = `刷新失败 (${formatDateTime(attemptTime)}) - ${resp.status}`; timeEl.classList.add('error'); }
        showFetchStatus(`获取银行受益人失败: ${resp.status}`, 'error');
        await addLogEntry({ message: `<span class="log-error">获取银行受益人失败. Status: ${resp.status}.</span>` }, false, 'bankBeneficiary');
      }
    } catch (error) {
      if (timeEl) { timeEl.innerText = `刷新失败 (${formatDateTime(attemptTime)}) - 网络错误`; timeEl.classList.add('error'); }
      showFetchStatus('获取银行受益人网络错误', 'error');
      await addLogEntry({ message: `<span class="log-error">获取银行受益人网络错误.</span>` }, false, 'bankBeneficiary');
    }
  }

  const bankBeneficiaryCellRenderer = (bene, col, bankBeneficiaryColumnVisibility) => {
    let cls = '';
    if (!bankBeneficiaryColumnVisibility[col.id]) cls += ' col-hidden';
    let content = '';
    switch (col.id) {
        case 'bank': content = escapeHtml(bene.bank); break;
        case 'name': content = escapeHtml(bene.name); break;
        case 'accountNo': content = escapeHtml(bene.accountNo); break;
        case 'ifsc': content = escapeHtml(bene.ifsc); break;
        case 'time': content = escapeHtml(bene.time); break;
        default: content = 'N/A';
    }
    return `<td class="${cls}">${content}</td>`;
  };

  function renderBankBeneficiaryTable() {
    const tableContainer = document.getElementById('bank-beneficiary-table-container');
    if (!tableContainer) return;

    let data = [...bankBeneficiaryDataCache];
    const search = (document.getElementById('bank-beneficiary-search')?.value || '').toLowerCase().trim();
    const keywords = search ? search.split(/\s+/).filter(Boolean) : [];
    if (keywords.length > 0) {
        data = data.filter(bene => {
            const txt = `${bene.bank} ${bene.name} ${bene.accountNo} ${bene.ifsc} ${bene.time} ${bene.actionsText}`.toLowerCase();
            return keywords.every(k => txt.includes(k));
        });
    }

    if (bankBeneficiarySortConfig.key) {
        const scol = bankBeneficiaryColumnConfig.find(c => c.id === bankBeneficiarySortConfig.key);
        if (scol?.dataKey && scol.sortable) {
            data.sort((a, b) => {
                let vA = a[scol.dataKey], vB = b[scol.dataKey];
                if (typeof vA === 'string') { vA = vA.toLowerCase(); vB = String(vB).toLowerCase(); }
                const dir = bankBeneficiarySortConfig.direction === 'asc' ? 1 : -1;
                if (vA < vB) return -1 * dir;
                if (vA > vB) return 1 * dir;
                return 0;
            });
        }
    }

    const tableHTML = `<table>${commonTableHeaders(bankBeneficiaryColumnConfig, bankBeneficiaryColumnVisibility, bankBeneficiarySortConfig)}<tbody>` +
        data.map(bene => `<tr data-entry-id="${escapeHtml(bene.id || '')}">` +
            bankBeneficiaryColumnConfig.map(col => bankBeneficiaryCellRenderer(bene, col, bankBeneficiaryColumnVisibility)).join('') +
        `</tr>`).join('') + `</tbody></table>`;

    tableContainer.innerHTML = tableHTML;
    const table = tableContainer.querySelector('table');
    if (table) {
        table.querySelector('thead')?.addEventListener('click', handleHeaderClick);
        table.addEventListener('contextmenu', handleTableRightClick);
    }
  }

  // --- 补单面板函数 ---
  // MODIFIED: 增加了保持选择的功能
  function populateMakeupPanelSelectors() {
    const accountSelector = document.getElementById('makeup-account-selector');
    const payoutTypeSelector = document.getElementById('makeup-payout-type-selector');
    const transferModeSelector = document.getElementById('makeup-transfer-mode-selector');

    if (!accountSelector || !payoutTypeSelector || !transferModeSelector) return;

    // 保存当前选择
    const currentAccountId = accountSelector.value;
    const currentTypeId = payoutTypeSelector.value;
    const currentModeId = transferModeSelector.value;

    // 填充打款账户
    let accOpts = '<option value="">--选择打款账户--</option>';
    const allAccounts = Object.values(gdsAccountDataCache).filter(c => c?.current?.accountName && c.current.platform);
    if (allAccounts.length > 0) {
        allAccounts.sort((a, b) => String(a.current.accountName).localeCompare(String(b.current.accountName)))
            .forEach(a => {
                const acc = a.current;
                const statusText = acc.status !== '已消失' ? '' : ' (已消失)';
                accOpts += `<option value="${escapeHtml(String(acc.id))}">${escapeHtml(acc.accountName)}${statusText}</option>`;
            });
    } else {
        accOpts += '<option value="" disabled>无可用账户</option>';
    }
    accountSelector.innerHTML = accOpts;

    // 填充账户类型
    payoutTypeSelector.innerHTML = GDS_PAYOUT_TYPES.map(t => `<option value="${t.value}">${escapeHtml(t.name)}</option>`).join('');

    // 填充转账模式
    transferModeSelector.innerHTML = GDS_TRANSFER_MODES.map(m => `<option value="${m.value}">${escapeHtml(m.name)}</option>`).join('');

    // 恢复之前的选择
    accountSelector.value = currentAccountId;
    payoutTypeSelector.value = currentTypeId;
    transferModeSelector.value = currentModeId;
  }

  async function handleAnalyzeButtonClick() {
    const accountId = document.getElementById('makeup-account-selector').value;
    const payoutTypeId = document.getElementById('makeup-payout-type-selector').value;
    const transferModeId = document.getElementById('makeup-transfer-mode-selector').value;
    const recipientInfoText = document.getElementById('makeup-recipient-info').value;
    const resultDiv = document.getElementById('makeup-analysis-result');
    const recordBtn = document.getElementById('makeup-record-btn');

    recordBtn.disabled = true;
    makeupAnalysisResult = null;

    if (!accountId) {
        resultDiv.textContent = '错误：请选择一个打款账户。';
        await addLogEntry({ message: `<span class="log-warn">补单分析失败：未选择打款账户。</span>` }, false, 'makeup');
        return;
    }

    const recipientData = recipientInfoText.split(/[\t\n|]+/).map(s => s.trim()).filter(Boolean);
    if (recipientData.length !== 5) {
        resultDiv.textContent = `错误：收款信息需要包含 5 项 (Name, Acc, IFSC, 金额, UTR)，当前检测到 ${recipientData.length} 项。`;
        await addLogEntry({ message: `<span class="log-warn">补单分析失败：收款信息项数不符。</span>` }, false, 'makeup');
        return;
    }

    const [name, accNumber, ifsc, amountStr, utr] = recipientData;
    const amount = parseFloat(amountStr);

    if (isNaN(amount) || amount <= 0) {
        resultDiv.textContent = `错误：无效的金额 "${escapeHtml(amountStr)}"。`;
        await addLogEntry({ message: `<span class="log-warn">补单分析失败：无效金额。</span>` }, false, 'makeup');
        return;
    }

    const account = gdsAccountDataCache[accountId]?.current;
    if (!account) {
        resultDiv.textContent = '错误：选择的打款账户信息未找到。';
        await addLogEntry({ message: `<span class="log-warn">补单分析失败：账户信息未找到。</span>` }, false, 'makeup');
        return;
    }
    const payoutType = GDS_PAYOUT_TYPES.find(t => String(t.value) === payoutTypeId);
    const transferMode = GDS_TRANSFER_MODES.find(t => String(t.value) === transferModeId);

    makeupAnalysisResult = {
        account,
        payoutType,
        transferMode,
        recipient: { name, accNumber, ifsc, amount, utr }
    };

    const displayText = `
请核对以下补单信息：
---------------------------------
【打款账户】
  - 账户名: ${escapeHtml(account.accountName)}
  - 平台ID: ${escapeHtml(account.platform)}
  - 状态: ${escapeHtml(account.status || '正常')}

【收款信息】
  - 收款人: ${escapeHtml(name)}
  - 卡号: ${escapeHtml(accNumber)}
  - IFSC: ${escapeHtml(ifsc)}
  - 金额: ${formatAmount(amount)}
  - UTR/备注: ${escapeHtml(utr)}

【交易参数】
  - 账户类型: ${escapeHtml(payoutType.name)} (${payoutType.value})
  - 转账模式: ${escapeHtml(transferMode.name)} (${transferMode.value})
---------------------------------
确认无误后，请点击“补录”按钮。
    `;
    resultDiv.innerHTML = `<pre>${displayText}</pre>`;
    recordBtn.disabled = false;
    await addLogEntry({ message: `<span class="log-info">补单信息分析成功，待确认。</span>` }, false, 'makeup');
  }

  // MODIFIED: 移除了 confirm 对话框
  async function handleMakeupRecordButtonClick() {
    if (!makeupAnalysisResult) {
        showToast('无有效的分析结果，请先点击分析。');
        return;
    }

    await addLogEntry({ message: `<span class="log-warn"><strong>开始执行补录操作 (无确认对话框).</strong></span>` }, true, 'makeup');

    const analyzeBtn = document.getElementById('makeup-analyze-btn');
    const recordBtn = document.getElementById('makeup-record-btn');
    analyzeBtn.disabled = true;
    recordBtn.disabled = true;
    recordBtn.textContent = '补录中...';

    const token = localStorage.getItem('token');
    if (!token) {
        showToast('Token未找到，无法操作');
        await addLogEntry({ message: `<span class="log-error log-makeup-fail">补单失败: Token 未找到。</span>` }, true, 'makeup');
        analyzeBtn.disabled = false; recordBtn.disabled = false; recordBtn.textContent = '补录';
        return;
    }

    const { account, payoutType, transferMode, recipient } = makeupAnalysisResult;
    let payeeIdToDelete = null;

    try {
        // --- 步骤 1: 创建临时受益人 ---
        showFetchStatus('步骤 1/4: 创建临时受益人...', 'info', 0);
        await addLogEntry({ message: `<span class="log-makeup-attempt">1. 尝试创建受益人: ${escapeHtml(recipient.name)} / ${escapeHtml(recipient.accNumber)}</span>` }, true, 'makeup');
        const createPayeePayload = {
            payeeId: 0, status: 2, currency: "INR", wayCode: 1,
            name: recipient.name, accountNo: recipient.accNumber, bankCode: recipient.ifsc,
            bankName: recipient.ifsc.substring(0, 4), phone: "1", email: "b@a.cc",
            payoutType: payoutType.value, operate: "CREATE"
        };
        const createResp = await gmFetch("POST", GDS_PAYEE_MODIFY_API_URL, { "Authorization": token, "Content-Type": "application/json" }, JSON.stringify(createPayeePayload));
        const createRes = JSON.parse(createResp.responseText);
        if (createRes.code !== 1) throw new Error(`创建受益人失败: ${createRes.msg || '未知错误'}`);
        await addLogEntry({ message: `<span class="log-makeup-success">1. 创建受益人成功.</span>` }, true, 'makeup');

        // --- 步骤 2: 获取受益人ID ---
        showFetchStatus('步骤 2/4: 查询受益人ID...', 'info', 0);
        await addLogEntry({ message: `<span class="log-makeup-attempt">2. 尝试查询受益人ID...</span>` }, true, 'makeup');
        const listUrl = GDS_PAYEE_LIST_API_URL_TEMPLATE.replace('{ACCOUNT_NO}', encodeURIComponent(recipient.accNumber));
        const listResp = await gmFetch("GET", listUrl, { "Authorization": token, "Cache-Control": "no-cache" });
        const listRes = JSON.parse(listResp.responseText);
        if (listRes.code !== 1 || !listRes.data?.list || listRes.data.list.length === 0) throw new Error(`查询受益人ID失败: ${listRes.msg || '未找到记录'}`);
        payeeIdToDelete = listRes.data.list[0].payeeId;
        await addLogEntry({ message: `<span class="log-makeup-success">2. 获取受益人ID成功: ${payeeIdToDelete}.</span>` }, true, 'makeup');

        // --- 步骤 3: 执行补单 ---
        showFetchStatus('步骤 3/4: 执行补单交易...', 'info', 0);
        await addLogEntry({ message: `<span class="log-makeup-attempt">3. 尝试补单: ${formatAmount(recipient.amount)} -> ${escapeHtml(recipient.name)}</span>` }, true, 'makeup');
        const makeupPayload = {
            tripartiteId: account.platform,
            accountName: account.accountName,
            payeeId: payeeIdToDelete,
            amount: Math.floor(recipient.amount * 100),
            transferMode: transferMode.value,
            assignReferenceNo: recipient.utr,
            version: Date.now()
        };
        const makeupResp = await gmFetch("POST", GDS_MAKEUP_TRANSFER_API_URL, { "Authorization": token, "Content-Type": "application/json" }, JSON.stringify(makeupPayload));
        const makeupRes = JSON.parse(makeupResp.responseText);
        if (makeupRes.code !== 1) throw new Error(`补单失败: ${makeupRes.msg || '未知错误'}`);
        await addLogEntry({ message: `<span class="log-makeup-success">3. 补单交易成功.</span>` }, true, 'makeup');

        showFetchStatus('补单流程成功！', 'success', 5000);
        await addLogEntry({ message: `<span class="log-makeup-success"><strong>整个补单流程成功完成！</strong></span>` }, true, 'makeup');

    } catch (error) {
        showFetchStatus(`补单流程失败: ${error.message}`, 'error', 10000);
        await addLogEntry({ message: `<span class="log-error log-makeup-fail">补单流程失败: ${escapeHtml(error.message)}</span>` }, true, 'makeup');
    } finally {
        // --- 步骤 4: 删除临时受益人 (无论成功失败都执行) ---
        if (payeeIdToDelete) {
            showFetchStatus('步骤 4/4: 清理临时受益人...', 'info', 5000);
            await addLogEntry({ message: `<span class="log-makeup-attempt">4. 尝试删除临时受益人ID: ${payeeIdToDelete}</span>` }, true, 'makeup');
            try {
                const deletePayload = { payeeId: payeeIdToDelete, operate: "REMOVE" };
                const deleteResp = await gmFetch("POST", GDS_PAYEE_MODIFY_API_URL, { "Authorization": token, "Content-Type": "application/json" }, JSON.stringify(deletePayload));
                const deleteRes = JSON.parse(deleteResp.responseText);
                if (deleteRes.code === 1) {
                    await addLogEntry({ message: `<span class="log-makeup-success">4. 删除临时受益人成功.</span>` }, true, 'makeup');
                } else {
                    await addLogEntry({ message: `<span class="log-warn">4. 删除临时受益人失败: ${deleteRes.msg || '未知错误'}. 请手动处理。</span>` }, true, 'makeup');
                }
            } catch (e) {
                await addLogEntry({ message: `<span class="log-error">4. 删除临时受益人时发生网络错误: ${e.message}. 请手动处理。</span>` }, true, 'makeup');
            }
        }
        analyzeBtn.disabled = false;
        recordBtn.disabled = false;
        recordBtn.textContent = '补录';
    }
  }


  // --- 初始化函数 ---
  async function init() {
    // 加载日志
    try {
        transactionPanelLogs = (await loadPreference(KEY_PERSISTENT_OPERATION_LOGS_TX, []));
        bankBeneficiaryPanelLogs = (await loadPreference(KEY_PERSISTENT_OPERATION_LOGS_BB, []));
        makeupPanelLogs = (await loadPreference(KEY_PERSISTENT_OPERATION_LOGS_MU, []));
    } catch(e) {
        console.error("加载持久日志失败:", e);
        transactionPanelLogs = []; bankBeneficiaryPanelLogs = []; makeupPanelLogs = [];
        transactionPanelLogs.unshift({ time: formatDateTime(), message: `<span class="log-error">加载持久日志失败: ${escapeHtml(e.message)}.</span>`});
    }

    const gm = (typeof GM === 'object' && GM?.info) ? GM.info : { script: { name: 'GDS交易列表', version: 'N/A' } };
    await addLogEntry({ message: `<span class="log-info">脚本启动: ${escapeHtml(gm.script.name)} v${escapeHtml(gm.script.version)}.</span>` }, false, 'transaction');

    // 加载所有偏好设置
    [
        currentTheme,
        payoutThrottleTimestamps,
        columnVisibilityTx,
        sortConfigTx,
        bankBeneficiaryColumnVisibility,
        bankBeneficiarySortConfig,
        currentActiveSubPanel,
        bankBeneSelectedAccountId
    ] = await Promise.all([
        loadPreference(KEY_THEME_PREFERENCE, 'light'),
        loadPreference(KEY_PAYOUT_THROTTLE_TIMESTAMPS, {}),
        loadPreference(KEY_COLUMN_VISIBILITY_TX, Object.fromEntries(columnConfig.map(c => [c.id, c.defaultVisible]))),
        loadPreference(KEY_SORT_CONFIG_TX, { key: null, direction: 'asc' }),
        loadPreference(KEY_COLUMN_VISIBILITY_BB, Object.fromEntries(bankBeneficiaryColumnConfig.map(c => [c.id, c.defaultVisible]))),
        loadPreference(KEY_SORT_CONFIG_BB, { key: null, direction: 'asc' }),
        loadPreference(KEY_ACTIVE_SUBPANEL_PREFERENCE, 'transaction'),
        loadPreference(KEY_BANK_BENE_SELECTED_ACCOUNT, null)
    ]);

    // 应用主题
    await applyTheme(currentTheme);

    // 渲染列切换面板
    renderColumnTogglePanel(columnConfig, columnVisibilityTx, 'embed-tx-column-toggle-panel', handleColumnToggle);
    renderColumnTogglePanel(bankBeneficiaryColumnConfig, bankBeneficiaryColumnVisibility, 'bank-beneficiary-column-toggle-panel', handleColumnToggle);

    // 加载上次成功刷新时间戳
    try {
        const txTs = await loadPreference(KEY_LAST_REFRESH_TX, null);
        if (txTs) { lastSuccessfulDataTimestamp = new Date(txTs); const el = document.getElementById('embed-tx-last-refresh-time'); if(el) el.innerText = `上次更新: ${formatDateTime(lastSuccessfulDataTimestamp)}`; }
        const bbTs = await loadPreference(KEY_LAST_REFRESH_BB, null);
        if (bbTs) { lastSuccessfulBankBeneTimestamp = new Date(bbTs); const el = document.getElementById('bank-beneficiary-last-refresh-time'); if(el) el.innerText = `上次更新: ${formatDateTime(lastSuccessfulBankBeneTimestamp)}`; }
    } catch(e) { console.error('从IDB加载上次刷新时间戳失败:', e); }

    // 设置刷新间隔
    if (refreshIntervalId) clearInterval(refreshIntervalId);
    refreshIntervalId = setInterval(async () => {
        if (embedTxPanel.style.display !== 'none') {
            await loadGdsAccountCache();
            if (currentActiveSubPanel === 'transaction') await fetchTransactionData();
            if (currentActiveSubPanel === 'bankBeneficiary') await fetchBankBeneficiaryData();

            // 刷新选择器内容，并保持选择
            if (currentActiveSubPanel === 'bankBeneficiary') populateBankBeneAccountSelector();
            if (currentActiveSubPanel === 'makeup') populateMakeupPanelSelectors();
        }
    }, REFRESH_INTERVAL_MS);

    // 主面板切换按钮事件
    togglePanelBtn.addEventListener('click', async () => {
        const isHidden = embedTxPanel.style.display === 'none';
        if (isHidden) {
            embedTxPanel.style.display = 'flex';
            if (!hasFetchedInitialData) {
                await loadGdsAccountCache();
                await Promise.all([
                    fetchTransactionData(true),
                    fetchBankBeneficiaryData(true)
                ]);
                hasFetchedInitialData = true;
            }
            // 总是显示当前激活的面板
            showSubPanel(currentActiveSubPanel);
        } else {
            embedTxPanel.style.display = 'none';
        }
        togglePanelBtn.textContent = isHidden ? '隐藏面板' : '交易面板';
    });

    // 交易面板控制事件
    document.getElementById('embed-tx-search').addEventListener('input', () => { renderTable(); renderLogs(); });
    document.getElementById('embed-tx-refresh').addEventListener('click', async (e) => { showToast('刷新中...', e); await addLogEntry({ message: `<span class="log-info">手动刷新交易.</span>`}, false, 'transaction'); await loadGdsAccountCache(); await fetchTransactionData(true); });
    document.getElementById('embed-tx-toggle-theme').addEventListener('click', toggleTheme);
    document.getElementById('embed-tx-clear-tx-log').addEventListener('click', () => clearLogs('transaction'));
    document.getElementById('embed-tx-export-tx-log').addEventListener('click', () => exportLogs('transaction'));
    document.getElementById('embed-tx-clear-settings').addEventListener('click', async (e) => {
        if (confirm('重置所有设置？')) {
            await addLogEntry({ message: `<span class="log-warn">重置设置...</span>` }, false, currentLogDisplayType);
            const keysToClear = [
                KEY_THEME_PREFERENCE, KEY_COLUMN_VISIBILITY_TX, KEY_SORT_CONFIG_TX, KEY_LAST_REFRESH_TX,
                KEY_PAYOUT_THROTTLE_TIMESTAMPS, KEY_PERSISTENT_OPERATION_LOGS_TX, KEY_PERSISTENT_OPERATION_LOGS_BB,
                KEY_PERSISTENT_OPERATION_LOGS_MU,
                KEY_COLUMN_VISIBILITY_BB, KEY_SORT_CONFIG_BB, KEY_LAST_REFRESH_BB,
                KEY_ACTIVE_SUBPANEL_PREFERENCE, KEY_BANK_BENE_SELECTED_ACCOUNT
            ];
            await Promise.all(keysToClear.map(k => embedTxDb.remove(EMBED_TX_STORE_NAME, k)));

            // 重置内存中的状态
            transactionPanelLogs = []; bankBeneficiaryPanelLogs = []; makeupPanelLogs = [];
            currentTheme = 'light';
            sortConfigTx = { key: null, direction: 'asc' };
            bankBeneficiarySortConfig = { key: null, direction: 'asc' };
            lastSuccessfulDataTimestamp = null; lastSuccessfulBankBeneTimestamp = null;
            payoutThrottleTimestamps = {};
            currentActiveSubPanel = 'transaction'; hasFetchedInitialData = false;
            bankBeneSelectedAccountId = null;
            makeupAnalysisResult = null;

            const elTs = document.getElementById('embed-tx-last-refresh-time'); if(elTs) {elTs.innerText='未加载'; elTs.classList.remove('error');}
            const elBbTs = document.getElementById('bank-beneficiary-last-refresh-time'); if(elBbTs) {elBbTs.innerText='未加载'; elBbTs.classList.remove('error');}

            // 重新加载并渲染所有偏好和UI
            await init();
            await addLogEntry({ message: `<span class="log-warn">设置已重置.</span>` }, false, currentLogDisplayType);
            showToast('设置已重置', e);
        } else {
            await addLogEntry({ message: `<span class="log-info">取消重置设置.</span>` }, false, currentLogDisplayType);
        }
    });

    // 银行受益人面板控制事件
    document.getElementById('bank-beneficiary-search').addEventListener('input', () => { renderBankBeneficiaryTable(); renderLogs(); });
    document.getElementById('bank-beneficiary-refresh').addEventListener('click', async (e) => { showToast('刷新中...', e); await addLogEntry({ message: `<span class="log-info">手动刷新银行受益人.</span>`}, false, 'bankBeneficiary'); await fetchBankBeneficiaryData(true); });
    document.getElementById('bank-beneficiary-account-selector').addEventListener('change', handleBankBeneAccountSelectorChange);
    document.getElementById('bank-beneficiary-sync-gds-beneficiaries').addEventListener('click', handleSyncGdsBeneficiariesButtonClick);
    document.getElementById('embed-tx-clear-bb-log').addEventListener('click', () => clearLogs('bankBeneficiary'));
    document.getElementById('embed-tx-export-bb-log').addEventListener('click', () => exportLogs('bankBeneficiary'));

    // 补单面板控制事件
    document.getElementById('makeup-analyze-btn').addEventListener('click', handleAnalyzeButtonClick);
    document.getElementById('makeup-record-btn').addEventListener('click', handleMakeupRecordButtonClick);
    document.getElementById('embed-tx-clear-mu-log').addEventListener('click', () => clearLogs('makeup'));
    document.getElementById('embed-tx-export-mu-log').addEventListener('click', () => exportLogs('makeup'));

    // 面板切换器按钮事件
    document.getElementById('show-transaction-panel-btn').addEventListener('click', () => showSubPanel('transaction'));
    document.getElementById('show-bank-beneficiary-panel-btn').addEventListener('click', () => showSubPanel('bankBeneficiary'));
    document.getElementById('show-makeup-panel-btn').addEventListener('click', () => showSubPanel('makeup'));

    await addLogEntry({ message: `<span class="log-info">初始化完成.</span>` }, false, 'transaction');
  }

  // ---- 脚本入口点 ----
  if (document.readyState === 'complete' || document.readyState === 'interactive') init().catch(e => { console.error("初始化失败:", e); addLogEntry({ message: `<span class="log-error">初始化失败: ${escapeHtml(e.message)}.</span>` }); });
  else window.addEventListener('DOMContentLoaded', () => init().catch(e => { console.error("初始化(DOM)失败:", e); addLogEntry({ message: `<span class="log-error">初始化(DOM)失败: ${escapeHtml(e.message)}.</span>` }); }));
  window.addEventListener('beforeunload', () => { if (refreshIntervalId) clearInterval(refreshIntervalId); });
})();
