// ==UserScript==
// @name         GDS 账户信息增强版 (v3.1.8.2 - 列排序/显隐 + 固定表头 + 主题 + 刷新状态明示 + 0值修正)
// @namespace    http://tampermonkey.net/
// @version      3.1.8.2
// @description  增加列排序、列显示/隐藏切换功能。固定表头。深色/浅色主题切换。余额按5万分档显示不同颜色, 增加来款速度估算显示, 自动划转UI优化(选择框居中,增加划转比例,触发金额与模式默认值), 划转设置变动日志, 精确API对接,详细Fetch参数,金额/100,增强日志,精确“金额最后变动”时间,消失账户仍可操作状态,排序与更新,UI优化,手动状态按钮POST操作,冻结金额增加单独日志区。明确刷新成功/失败状态。修正因API瞬时返回0值导致错误记录金额变动的问题。
// @match        https://admin.gdspay.xyz/cc*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
  'use strict';

  // ---- 样式注入 ----
  const style = document.createElement('style');
  style.innerHTML = `
    :root {
      --body-bg: #fff; --text-color: #212529; --text-muted-color: #6c757d; --link-color: #007bff;
      --border-color: #ccc; --border-color-light: #ddd; --border-color-lighter: #eee; --hover-bg-light: #e6f7ff;
      --panel-bg: #f0f0f0; --panel-border: #ccc; --panel-shadow: rgba(0,0,0,0.1);
      --input-bg: #fff; --input-border: #bbb; --input-text: #495057;
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
      --bal-high-color: red; --bal-negative-color: #28a745; --frozen-positive-color: #dc3545;
      --hourly-rate-positive-color: #28a745; --hourly-rate-monday-color: purple; --hourly-rate-stagnant-color: #6c757d;
      --hourly-rate-bg: #fff; --hourly-rate-border: #ddd;
      --toast-bg: rgba(0,0,0,0.75); --toast-text: white;
      --fetch-status-bg: #e0e0e0; --fetch-status-text: #333;
      --fetch-status-success-bg: #d4edda; --fetch-status-success-text: #155724; --fetch-status-success-border: #c3e6cb;
      --fetch-status-error-bg: #f8d7da; --fetch-status-error-text: #721c24; --fetch-status-error-border: #f5c6cb;
      --fetch-status-info-bg: #e0e0e0; --fetch-status-info-text: #333; --fetch-status-shadow: rgba(0,0,0,0.2);
      --column-toggle-panel-bg: #f7f7f7; --column-toggle-panel-border: #ddd; --column-toggle-panel-shadow: rgba(0,0,0,0.05);
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
      --column-toggle-panel-bg: #2a2f36; --column-toggle-panel-border: #373e47; --column-toggle-panel-shadow: rgba(0,0,0,0.15);
    }
    body { background-color: var(--body-bg); color: var(--text-color); transition: background-color 0.3s, color 0.3s; }
    input, select, button { color: var(--input-text); background-color: var(--input-bg); border: 1px solid var(--input-border); }
    select option { background-color: var(--input-bg); color: var(--input-text); }
    body.dark-theme select option { background-color: var(--input-bg) !important; color: var(--input-text) !important; }

    #gds-control-panel {
      position: fixed; top: 10px; left:50%; transform:translateX(-50%); background: var(--panel-bg);
      padding: 6px 10px; border:1px solid var(--panel-border); display: flex; flex-wrap: wrap;
      gap: 8px; align-items: center; z-index:10001; font-family: monospace; font-size: 12px;
      box-shadow: 0 2px 5px var(--panel-shadow);
    }
    #gds-control-panel input, #gds-control-panel button { padding: 2px 4px; font-size:12px; border-radius: 3px; color: var(--text-color); }
    #gds-control-panel button:hover { background-color: var(--button-hover-bg); }
    #gds-last-refresh-time { color: var(--text-muted-color); margin-left:10px; font-style:italic; }
    #gds-last-refresh-time.error { color: var(--bal-high-color); font-weight: bold; }


    #gds-main {
      position: fixed; top: 55px; /* Kontrol paneli yüksekliği + boşluk */
      left: 50%; transform: translateX(-50%); z-index: 9999;
      font-family: monospace; font-size: 12px; width: calc(100% - 20px); max-width: 1600px;
    }

    #gds-column-toggle-panel {
      background: var(--column-toggle-panel-bg); border: 1px solid var(--column-toggle-panel-border);
      border-bottom: none; padding: 6px 10px; margin-bottom: 0;
      display: flex; flex-wrap: wrap; gap: 10px; font-size: 11px;
      box-shadow: 0 1px 3px var(--column-toggle-panel-shadow);
    }
    #gds-column-toggle-panel label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
    #gds-column-toggle-panel input[type="checkbox"] { margin:0; vertical-align: middle; }

    #gds-account-info {
      background: var(--table-bg); border:1px solid var(--table-border); padding:0; /* padding is on table cells now */
      max-height: calc(100vh - 120px - 240px - 30px); /* main top - logs - col toggle */
      min-height: 200px; overflow-y: auto; overflow-x: auto;
      min-width: 800px; /* Allow table to shrink more if columns are hidden */
      box-sizing: border-box; box-shadow: 0 2px 8px var(--panel-shadow);
    }
    #gds-account-info table { border-collapse: collapse; width:100%; table-layout: auto; }
    #gds-account-info th, #gds-account-info td {
      border: 1px solid var(--table-border); padding: 5px 7px;
      text-align: left; vertical-align: middle; white-space: nowrap;
    }
    #gds-account-info th {
      position: sticky; top: 0; background: var(--table-header-bg); font-weight: bold; z-index: 10;
      color: var(--text-color); cursor: pointer; user-select: none;
    }
    #gds-account-info th.sortable:hover { background-color: var(--button-hover-bg); }
    body.dark-theme #gds-account-info th { background: var(--table-sticky-header-bg); }
    #gds-account-info tr:nth-child(even) td { background: var(--table-row-even-bg); }
    #gds-account-info tr:hover td { background: var(--table-row-hover-bg); }
    .gds-col-hidden { display: none !important; }

    .col-id { text-align: right; min-width: 50px; } .col-platform { min-width: 100px; }
    .col-accountName { min-width: 120px; } .col-phone { min-width: 100px; }
    .col-balance, .col-frozenBalance { text-align: right; min-width: 100px; }
    .col-apiStatus { text-align: center; min-width: 70px; } .col-lastChangeTime { min-width: 160px; }
    .col-statusOp { text-align: center; min-width: 170px; white-space: normal;}
    .col-autoTransferEnabled, .col-autoTransferRoundToInteger { text-align: center; min-width: 70px;}
    .col-autoTransferTriggerAmount { text-align: right; min-width: 80px;}
    .col-autoTransferPayeeId { min-width: 130px;} .col-autoTransferMode { min-width: 90px;}
    .col-autoTransferPercentage { text-align: center; min-width: 90px;}
    #gds-account-info input[type="number"].autotransfer-setting { width: 70px; text-align: right; padding: 2px 4px; box-sizing: border-box;}
    #gds-account-info select.autotransfer-setting { width: 100%; max-width: 120px; padding: 2px; box-sizing: border-box;}
    #gds-account-info input[type="checkbox"].autotransfer-setting { vertical-align: middle; margin: 0; }

    .status-enabled { color: var(--status-enabled-color); } .status-api-stopped { color: var(--status-api-stopped-color); font-weight: bold; }
    .status-api-custom-stop { color: var(--status-api-custom-stop-color); font-weight: bold; }
    .status-unknown { color: var(--status-unknown-color); } .status-disappeared { color: var(--status-disappeared-color); font-style: italic; }
    .status-op-btn {
        padding: 3px 6px; font-size: 10px; margin: 1px; border: 1px solid var(--button-border);
        border-radius: 3px; cursor: pointer; background-color: var(--button-bg); color: var(--text-color); min-width: 45px;
    }
    .status-op-btn:hover { background-color: var(--button-hover-bg); border-color: var(--button-border); }
    .status-op-btn.active { background-color: var(--button-active-bg); border-color: var(--button-active-border); color: var(--button-active-text); font-weight: bold; }
    .status-op-btn[disabled] { cursor: not-allowed; opacity: var(--button-disabled-opacity); background-color: var(--button-disabled-bg); }

    .balance-tier-0 {} .balance-tier-1 { color: var(--balance-tier-1-color); }
    .balance-tier-2 { color: var(--balance-tier-2-color); } .balance-tier-3 { color: var(--balance-tier-3-color); }
    .balance-tier-4 { color: var(--balance-tier-4-color); }
    .bal-high { color: var(--bal-high-color) !important; font-weight: bold; }
    .bal-negative{ color: var(--bal-negative-color) !important; font-weight: bold;}
    .frozen-positive { color: var(--frozen-positive-color); font-weight: bold; }

    .gds-log-base {
      position: fixed; left:50%; transform:translateX(-50%); background: var(--log-bg);
      border:1px solid var(--log-border); padding:10px; overflow: auto; z-index:10000;
      font-size:12px; font-family:monospace; width: calc(100% - 20px); max-width: 1600px;
      box-sizing: border-box; box-shadow: 0 2px 8px var(--log-shadow); color: var(--text-color);
    }
    #gds-account-log-container { bottom: 230px; max-height: 220px; }
    #gds-frozen-log-container { bottom: 100px; max-height: 100px; }
    .gds-log-base .log-title { font-weight: bold; margin-bottom: 5px; display: block; }
    .gds-log-base .log-entry { margin-bottom:5px; padding-bottom: 3px; border-bottom: 1px dotted var(--log-entry-border); line-height: 1.4; }
    .gds-log-base .log-entry:last-child { border-bottom: none; }
    .log-time { color: var(--log-time-color); margin-right: 5px;}
    .log-account-id { font-weight: bold; color: var(--log-account-id-color); }
    .log-account-name { color: var(--log-account-name-color); }
    .log-amount-increase { color: red; } .log-amount-decrease { color: green; }
    .log-interval { font-style: italic; color: var(--text-muted-color); margin-left: 5px; }
    .log-status-change { color: blue; font-weight: bold; } .log-api-op-success { color: green; }
    .log-api-op-fail { color: red; } .log-transfer-attempt { color: #DAA520; }
    .log-transfer-success { color: #008000; font-weight: bold; } .log-transfer-fail { color: #B22222; font-weight: bold; }
    .log-transfer-throttled { color: #708090; } .log-setting-change { color: #4682B4; }

    #gds-hourly-rate-display {
        margin-left: 15px; padding: 2px 6px; background-color: var(--hourly-rate-bg);
        border: 1px solid var(--hourly-rate-border); border-radius: 3px; font-weight: normal; color: var(--text-color);
    }
    #gds-hourly-rate-display .rate-value { font-weight: bold; }
    #gds-hourly-rate-display .rate-positive { color: var(--hourly-rate-positive-color); }
    #gds-hourly-rate-display .rate-monday { color: var(--hourly-rate-monday-color); }
    #gds-hourly-rate-display .rate-stagnant { color: var(--hourly-rate-stagnant-color); }

    #copy-toast { position: fixed; background: var(--toast-bg); color: var(--toast-text); padding: 8px 12px; border-radius: 4px; z-index: 10005; opacity: 0; transition: opacity 0.3s; pointer-events: none; font-size: 13px; box-shadow: 0 1px 3px var(--panel-shadow); }
    #gds-fetch-status { position: fixed; top: 15px; right: 20px; padding: 8px 12px; border-radius: 4px; font-size: 13px; z-index: 10003; display: none; box-shadow: 0 2px 5px var(--fetch-status-shadow); }
    #gds-fetch-status.info { background-color: var(--fetch-status-info-bg); color: var(--fetch-status-info-text); }
    #gds-fetch-status.success { background-color: var(--fetch-status-success-bg); color: var(--fetch-status-success-text); border: 1px solid var(--fetch-status-success-border);}
    #gds-fetch-status.error   { background-color: var(--fetch-status-error-bg); color: var(--fetch-status-error-text); border: 1px solid var(--fetch-status-error-border);}
  `;
  document.head.appendChild(style);

  // ---- 控制面板 HTML ----
  const panel = document.createElement('div');
  panel.id = 'gds-control-panel';
  panel.innerHTML = `
    搜索: <input id="gds-search" placeholder="ID/平台/账号/手机" title="可搜索多个关键词，用空格隔开"/>
    <button id="gds-refresh" title="手动刷新数据">刷新</button>
    <button id="gds-toggle-theme" title="切换主题">切换主题</button>
    <button id="gds-clear-log" title="清空操作、变动及冻结增加日志">清空日志</button>
    <button id="gds-clear-prev-data" title="清空所有本地缓存数据和脚本设置">重置脚本</button>
    <span id="gds-last-refresh-time"></span> <span id="gds-hourly-rate-display">速度: N/A</span>
  `;
  document.body.appendChild(panel);

  // ---- 主布局容器, 列控制面板, 表格容器, 日志容器, Toast, FetchStatus ----
  const mainElement = document.createElement('div'); mainElement.id = 'gds-main';
  const columnTogglePanel = document.createElement('div'); columnTogglePanel.id = 'gds-column-toggle-panel';
  const tableContainer = document.createElement('div'); tableContainer.id = 'gds-account-info'; tableContainer.innerHTML = '正在加载数据...';
  mainElement.appendChild(columnTogglePanel); mainElement.appendChild(tableContainer); document.body.appendChild(mainElement);
  const logDisplayContainer = document.createElement('div'); logDisplayContainer.id = 'gds-account-log-container'; logDisplayContainer.className = 'gds-log-base'; logDisplayContainer.innerHTML = '<span class="log-title">操作与变动日志</span>'; document.body.appendChild(logDisplayContainer);
  const frozenLogDisplayContainer = document.createElement('div'); frozenLogDisplayContainer.id = 'gds-frozen-log-container'; frozenLogDisplayContainer.className = 'gds-log-base'; frozenLogDisplayContainer.innerHTML = '<span class="log-title">冻结金额增加日志</span>'; document.body.appendChild(frozenLogDisplayContainer);
  const toast = document.createElement('div'); toast.id = 'copy-toast'; document.body.appendChild(toast);
  const fetchStatusDiv = document.createElement('div'); fetchStatusDiv.id = 'gds-fetch-status'; document.body.appendChild(fetchStatusDiv);

  // ---- 常量定义 ----
  const KEY_ACCOUNT_DATA_CACHE = 'gds_account_data_cache_v3.1.0'; const KEY_ACCOUNT_ORDER = 'gds_account_order_v3.1.0';
  const KEY_LOGS = 'gds_account_logs_v3.1.0'; const KEY_FROZEN_LOGS = 'gds_frozen_logs_v3.1.5';
  const KEY_THEME_PREFERENCE = 'gds_theme_preference_v3.1.7';
  const KEY_COLUMN_VISIBILITY = 'gds_column_visibility_v3.1.8';
  const KEY_SORT_CONFIG = 'gds_sort_config_v3.1.8';
  const KEY_LAST_SUCCESSFUL_REFRESH = 'gds_last_successful_refresh_v3.1.8.1';

  const MAX_LOG_ENTRIES = 250; const MAX_FROZEN_LOG_ENTRIES = 100; const MAX_ACCOUNT_BALANCE_HISTORY = 100;
  const API_STATUS_ENABLED = 1; const API_STATUS_CUSTOM_STOP = 2; const API_STATUS_STOP_RECEIPT = 3; const SCRIPT_INTERNAL_STATUS_DISAPPEARED = -1;
  const PAYEE_OPTIONS = [ { name: '承兑KVB', payeeId: 110 }, { name: '募捐', payeeId: 565 }, { name: '测试', payeeId: 1450}, { name: 'KOTAK中转', payeeId: 798} ];
  const TRANSFER_MODE_OPTIONS = [ { name: 'IMPS', transferMode: 1 }, { name: 'NEFT', transferMode: 2 }, { name: 'RTGS', transferMode: 3 }, ];
  const TRANSFER_PERCENTAGE_OPTIONS = [ { name: '80%', value: 0.80 }, { name: '90%', value: 0.90 }, { name: '95%', value: 0.95 }, { name: '98%', value: 0.98 }, { name: '100%', value: 1.00 } ];
  const DEFAULT_TRIGGER_AMOUNT = 500000; const DEFAULT_TRANSFER_MODE = 3; /*RTGS*/ const DEFAULT_TRANSFER_PERCENTAGE = 0.98;
  const AUTO_TRANSFER_THROTTLE_MS = 60 * 1000;

  // ---- 全局变量 ----
  let accountDataCache = {}; let accountOrder = []; let operationLogs = []; let frozenBalanceIncreaseLogs = [];
  let refreshIntervalId = null; const REFRESH_INTERVAL_MS = 7000;
  let currentTheme = 'light';
  let columnVisibility = {};
  let sortConfig = { key: 'id', direction: 'asc' };
  let lastSuccessfulDataTimestamp = null;

  // ---- 列配置 ----
  const columnConfig = [
    { id: 'id', label: 'ID', sortable: true, hideable: false, defaultVisible: true, dataKey: 'id', cssClass: 'col-id' },
    { id: 'platform', label: '平台', sortable: true, hideable: true, defaultVisible: true, dataKey: 'platform', cssClass: 'col-platform' },
    { id: 'accountName', label: '账号', sortable: true, hideable: true, defaultVisible: true, dataKey: 'accountName', cssClass: 'col-accountName' },
    { id: 'phone', label: '手机', sortable: true, hideable: true, defaultVisible: true, dataKey: 'phone', cssClass: 'col-phone' },
    { id: 'balance', label: '余额', sortable: true, hideable: false, defaultVisible: true, dataKey: 'balance', cssClass: 'col-balance' },
    { id: 'frozenBalance', label: '冻结', sortable: true, hideable: true, defaultVisible: true, dataKey: 'frozenBalance', cssClass: 'col-frozenBalance' },
    { id: 'apiStatus', label: '在线状态', sortable: false, hideable: true, defaultVisible: true, dataKey: 'apiStatus', cssClass: 'col-apiStatus' },
    { id: 'lastChangeTime', label: '金额变动时间', sortable: true, hideable: true, defaultVisible: true, dataKey: 'lastChangeTime', cssClass: 'col-lastChangeTime' },
    { id: 'statusOp', label: '状态操作', sortable: false, hideable: true, defaultVisible: true, cssClass: 'col-statusOp' },
    { id: 'autoTransferEnabled', label: '自动划转', sortable: false, hideable: true, defaultVisible: true, cssClass: 'col-autoTransferEnabled' },
    { id: 'autoTransferTriggerAmount', label: '触发金额', sortable: false, hideable: true, defaultVisible: true, cssClass: 'col-autoTransferTriggerAmount' },
    { id: 'autoTransferPayeeId', label: '收款账户', sortable: false, hideable: true, defaultVisible: true, cssClass: 'col-autoTransferPayeeId' },
    { id: 'autoTransferMode', label: '划转模式', sortable: false, hideable: true, defaultVisible: true, cssClass: 'col-autoTransferMode' },
    { id: 'autoTransferPercentage', label: '划转比例', sortable: false, hideable: true, defaultVisible: true, cssClass: 'col-autoTransferPercentage' },
    { id: 'autoTransferRoundToInteger', label: '金额取整(千)', sortable: false, hideable: true, defaultVisible: true, cssClass: 'col-autoTransferRoundToInteger' },
  ];


  // ---- 辅助函数 ----
  function escapeHtml(str, forAttribute = false) { if (typeof str !== 'string') return str === null || str === undefined ? '' : String(str); let result = str.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>'); if (forAttribute) result = result.replace(/"/g, '"'); return result; }
  function showToast(text, x, y, duration = 1200) { toast.innerText = text; toast.style.top = y + 'px'; toast.style.left = x + 'px'; toast.style.opacity = '1'; if (toast.timeoutId) clearTimeout(toast.timeoutId); toast.timeoutId = setTimeout(() => toast.style.opacity = '0', duration); }
  function showFetchStatus(message, type = 'info', duration = 3000) { fetchStatusDiv.textContent = message; fetchStatusDiv.className = ''; fetchStatusDiv.classList.add(type); fetchStatusDiv.style.display = 'block'; if (fetchStatusDiv.timer) clearTimeout(fetchStatusDiv.timer); if (duration > 0) { fetchStatusDiv.timer = setTimeout(() => { fetchStatusDiv.style.display = 'none'; }, duration); } }
  function copyToClipboard(text, event) { const displayTxt = text.length > 30 ? text.substring(0,27)+'...' : text; navigator.clipboard.writeText(text).then(() => showToast(`已复制: ${displayTxt}`, event.clientX + 10, event.clientY + 10)).catch(() => { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'absolute'; ta.style.left = '-9999px'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); showToast(`已复制: ${displayTxt}`, event.clientX + 10, event.clientY + 10); } catch (err) { showToast('复制失败', event.clientX + 10, event.clientY + 10); } document.body.removeChild(ta); }); }
  function formatAmount(amount) { const num = parseFloat(amount); if (isNaN(num)) return String(amount); return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function formatApiStatus(statusVal) { switch (parseInt(statusVal)) { case API_STATUS_ENABLED: return { text: '启用', class: 'status-enabled' }; case API_STATUS_STOP_RECEIPT: return { text: '止收', class: 'status-api-stopped' }; case API_STATUS_CUSTOM_STOP: return { text: '停止', class: 'status-api-custom-stop' }; case SCRIPT_INTERNAL_STATUS_DISAPPEARED: return { text: '已消失', class: 'status-disappeared' }; default: return { text: `未知-${statusVal}`, class: 'status-unknown' }; } }
  function formatDateTime(dateInput = new Date()) { const date = (dateInput instanceof Date) ? dateInput : new Date(dateInput); const YYYY = date.getFullYear(); const MM = String(date.getMonth() + 1).padStart(2, '0'); const DD = String(date.getDate()).padStart(2, '0'); const HH = String(date.getHours()).padStart(2, '0'); const MIN = String(date.getMinutes()).padStart(2, '0'); const SS = String(date.getSeconds()).padStart(2, '0'); return `${YYYY}-${MM}-${DD} ${HH}:${MIN}:${SS}`; }
  function formatInterval(totalSeconds) { if (isNaN(totalSeconds) || totalSeconds < 0) return 'N/A'; if (totalSeconds === 0) return '0s'; const minutes = Math.floor(totalSeconds / 60); const seconds = totalSeconds % 60; let result = ''; if (minutes > 0) { result += `${minutes}m `; } if (seconds > 0 || minutes === 0) { result += `${seconds}s`; } return result.trim(); }

  function addLogEntry(logEntry) { logEntry.time = formatDateTime(new Date()); operationLogs.unshift(logEntry); if (operationLogs.length > MAX_LOG_ENTRIES) operationLogs.pop(); localStorage.setItem(KEY_LOGS, JSON.stringify(operationLogs)); renderLogs(); }
  function renderLogs() { logDisplayContainer.innerHTML = '<span class="log-title">操作与变动日志</span>'; operationLogs.forEach(log => { const entryDiv = document.createElement('div'); entryDiv.className = 'log-entry'; let html = `<span class="log-time">[${escapeHtml(log.time)}]</span> `; if (log.accountId) { html += `<span class="log-account-id">ID:${escapeHtml(log.accountId)}</span> `; html += `<span class="log-account-name">(${escapeHtml(log.accountName || 'N/A')})</span>: `; } html += log.message; if (log.interval && log.interval !== 'N/A') { html += ` <span class="log-interval">(间隔 ${escapeHtml(log.interval)})</span>`; } entryDiv.innerHTML = html; logDisplayContainer.appendChild(entryDiv); }); }
  function addFrozenLogEntry(logEntry) { logEntry.time = formatDateTime(new Date()); frozenBalanceIncreaseLogs.unshift(logEntry); if (frozenBalanceIncreaseLogs.length > MAX_FROZEN_LOG_ENTRIES) { frozenBalanceIncreaseLogs.pop(); } localStorage.setItem(KEY_FROZEN_LOGS, JSON.stringify(frozenBalanceIncreaseLogs)); renderFrozenLogs(); }
  function renderFrozenLogs() { frozenLogDisplayContainer.innerHTML = '<span class="log-title">冻结金额增加日志</span>'; frozenBalanceIncreaseLogs.forEach(log => { const entryDiv = document.createElement('div'); entryDiv.className = 'log-entry'; let html = `<span class="log-time">[${escapeHtml(log.time)}]</span> `; if (log.accountId) { html += `<span class="log-account-id">ID:${escapeHtml(log.accountId)}</span> `; html += `<span class="log-account-name">(${escapeHtml(log.accountName || 'N/A')})</span>: `; } html += log.message; entryDiv.innerHTML = html; frozenLogDisplayContainer.appendChild(entryDiv); }); }

  function initializeAutoTransferSettings(settings) { const s = settings || {}; return { enabled: typeof s.enabled === 'boolean' ? s.enabled : false, triggerAmount: s.triggerAmount !== undefined ? s.triggerAmount : DEFAULT_TRIGGER_AMOUNT, payeeId: s.payeeId !== undefined ? s.payeeId : '', transferMode: s.transferMode !== undefined ? s.transferMode : DEFAULT_TRANSFER_MODE, roundToInteger: typeof s.roundToInteger === 'boolean' ? s.roundToInteger : false, transferPercentage: s.transferPercentage !== undefined ? s.transferPercentage : DEFAULT_TRANSFER_PERCENTAGE }; }

  function applyTheme(theme) { document.body.classList.remove('light-theme', 'dark-theme'); document.body.classList.add(theme + '-theme'); currentTheme = theme; localStorage.setItem(KEY_THEME_PREFERENCE, theme); const themeButton = document.getElementById('gds-toggle-theme'); if (themeButton) { themeButton.textContent = theme === 'dark' ? '浅色主题' : '深色主题'; } }
  function toggleTheme() { const newTheme = currentTheme === 'light' ? 'dark' : 'light'; applyTheme(newTheme); }
  function loadThemePreference() { const preferredTheme = localStorage.getItem(KEY_THEME_PREFERENCE) || 'light'; applyTheme(preferredTheme); }

  // ---- Column Visibility & Sort Persistence ----
  function loadColumnVisibility() {
    const storedVisibility = JSON.parse(localStorage.getItem(KEY_COLUMN_VISIBILITY) || '{}');
    columnConfig.forEach(col => {
        columnVisibility[col.id] = storedVisibility[col.id] !== undefined ? storedVisibility[col.id] : col.defaultVisible;
    });
  }
  function saveColumnVisibility() { localStorage.setItem(KEY_COLUMN_VISIBILITY, JSON.stringify(columnVisibility)); }
  function loadSortConfig() {
    const storedSortConfig = JSON.parse(localStorage.getItem(KEY_SORT_CONFIG) || '{}');
    if (storedSortConfig.key && storedSortConfig.direction) {
        sortConfig = storedSortConfig;
    }
  }
  function saveSortConfig() { localStorage.setItem(KEY_SORT_CONFIG, JSON.stringify(sortConfig)); }


  function loadPersistedData() {
    const storedCache = JSON.parse(localStorage.getItem(KEY_ACCOUNT_DATA_CACHE) || '{}');
    for (const accId in storedCache) { storedCache[accId].autoTransferSettings = initializeAutoTransferSettings(storedCache[accId].autoTransferSettings); if (storedCache[accId].lastSuccessfulTransferTime === undefined) { storedCache[accId].lastSuccessfulTransferTime = 0; } if(!storedCache[accId].current) storedCache[accId].current = {}; if(!storedCache[accId].current.balanceHistory) { storedCache[accId].current.balanceHistory = []; } }
    accountDataCache = storedCache;
    accountOrder = JSON.parse(localStorage.getItem(KEY_ACCOUNT_ORDER) || '[]');
    operationLogs = JSON.parse(localStorage.getItem(KEY_LOGS) || '[]');
    frozenBalanceIncreaseLogs = JSON.parse(localStorage.getItem(KEY_FROZEN_LOGS) || '[]');
    const storedTimestamp = localStorage.getItem(KEY_LAST_SUCCESSFUL_REFRESH);
    if (storedTimestamp) {
        lastSuccessfulDataTimestamp = new Date(storedTimestamp);
        const lastRefreshTimeEl = document.getElementById('gds-last-refresh-time');
        if(lastRefreshTimeEl) lastRefreshTimeEl.innerText = `上次成功更新: ${formatDateTime(lastSuccessfulDataTimestamp)}`;
    }
    loadColumnVisibility(); loadSortConfig();
    renderLogs(); renderFrozenLogs(); renderColumnTogglePanel();
  }

  function calculateEstimatedHourlyRate(accountCache) { const nowTs = Date.now(); let totalIncreaseInLast10Min = 0; let contributingAccountsCount = 0; const tenMinutesAgoTs = nowTs - (10 * 60 * 1000); for (const accountId in accountCache) { const cacheEntry = accountCache[accountId]; if (!cacheEntry || !cacheEntry.current || cacheEntry.current.isDisappeared) continue; const accData = cacheEntry.current; const currentBalance = accData.balance; if (typeof currentBalance !== 'number' || !accData.balanceHistory || accData.balanceHistory.length === 0) continue; let balanceAtApprox10MinAgo = null; for (let i = accData.balanceHistory.length - 1; i >= 0; i--) { const historyEntry = accData.balanceHistory[i]; if (historyEntry.timestamp <= tenMinutesAgoTs) { balanceAtApprox10MinAgo = historyEntry.balance; break; } } if (balanceAtApprox10MinAgo === null && accData.balanceHistory.length > 0) { const oldestEntryInHistory = accData.balanceHistory[0]; if (oldestEntryInHistory.timestamp > tenMinutesAgoTs) balanceAtApprox10MinAgo = oldestEntryInHistory.balance; } if (balanceAtApprox10MinAgo !== null && typeof balanceAtApprox10MinAgo === 'number' && currentBalance > balanceAtApprox10MinAgo) { totalIncreaseInLast10Min += (currentBalance - balanceAtApprox10MinAgo); contributingAccountsCount++; } } if (contributingAccountsCount === 0) return `速度: <span class="rate-stagnant">N/A (近10分钟无增)</span>`; const estimatedHourly = totalIncreaseInLast10Min * 6; const today = new Date(nowTs); const isMonday = today.getDay() === 1; let rateClass = "rate-positive"; let prefix = "速度"; if (isMonday) { rateClass = "rate-monday"; prefix = "预计速度"; } return `${prefix}: <span class="${rateClass}"><span class="rate-value">+${formatAmount(estimatedHourly)}</span>/小时</span> <small>(${contributingAccountsCount}个账户)</small>`; }

  async function fetchAccountData(isInitialLoad = false) {
    const token = localStorage.getItem('token');
    const lastRefreshTimeEl = document.getElementById('gds-last-refresh-time');
    const fetchAttemptTime = new Date();

    if (!token) {
      showFetchStatus('未找到Token。请登录。脚本暂停。', 'error', 0);
      if (refreshIntervalId) clearInterval(refreshIntervalId);
      tableContainer.innerHTML = '错误：未找到登录 Token。请登录后刷新页面。';
      if (lastRefreshTimeEl) {
          lastRefreshTimeEl.innerText = `获取Token失败于: ${formatDateTime(fetchAttemptTime)}`;
          lastRefreshTimeEl.classList.add('error');
      }
      return;
    }

    if (lastRefreshTimeEl && !isInitialLoad) {
        lastRefreshTimeEl.innerText = `正在刷新... (${formatDateTime(fetchAttemptTime)})`;
        lastRefreshTimeEl.classList.remove('error');
    }

    try {
      const response = await fetch("https://admin.gdspay.xyz/api/tripartite/v1/account/view", { "headers": { "accept": "application/json, text/plain, */*", "accept-language": "zh-CN,zh;q=0.9,en;q=0.8", "authorization": token, "cache-control": "no-cache", "pragma": "no-cache", "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-origin" }, "referrer": "https://admin.gdspay.xyz/tripartite", "referrerPolicy": "strict-origin-when-cross-origin", "body": null, "method": "GET", "mode": "cors", "credentials": "include" });

      if (response.status === 401) {
        console.warn('GDS Script: 收到 401 未授权错误，立即刷新页面。');
        if (refreshIntervalId) clearInterval(refreshIntervalId);
        showFetchStatus('登录已过期或Token无效，正在刷新...', 'error', 0);
        if (lastRefreshTimeEl) {
            lastRefreshTimeEl.innerText = `授权失败于: ${formatDateTime(fetchAttemptTime)}. ${lastSuccessfulDataTimestamp ? '旧数据截至: ' + formatDateTime(lastSuccessfulDataTimestamp) : ''}`;
            lastRefreshTimeEl.classList.add('error');
        }
        location.reload(); return;
      }
      if (!response.ok) {
        const errorText = await response.text(); console.error('API 获取失败:', response.status, errorText);
        let statusMsg = `API错误 ${response.status}`;
        if (lastSuccessfulDataTimestamp) statusMsg += `. 数据可能陈旧 (截至 ${formatDateTime(lastSuccessfulDataTimestamp)})`;
        showFetchStatus(statusMsg, 'error', 7000);
        if (lastRefreshTimeEl) {
            lastRefreshTimeEl.innerText = `API错误于: ${formatDateTime(fetchAttemptTime)}. ${lastSuccessfulDataTimestamp ? '旧数据截至: ' + formatDateTime(lastSuccessfulDataTimestamp) : ''}`;
            lastRefreshTimeEl.classList.add('error');
        }
        if (isInitialLoad && Object.keys(accountDataCache).length > 0) renderTable(); return;
      }
      const jsonData = await response.json();
      if (jsonData.code !== 1 || !jsonData.data || !Array.isArray(jsonData.data.list)) {
        console.error('API 数据格式错误:', jsonData);
        let statusMsg = `API数据格式错误: ${jsonData.msg || '未知'}`;
        if (lastSuccessfulDataTimestamp) statusMsg += `. 数据可能陈旧 (截至 ${formatDateTime(lastSuccessfulDataTimestamp)})`;
        showFetchStatus(statusMsg, 'error', 7000);
        if (lastRefreshTimeEl) {
            lastRefreshTimeEl.innerText = `API数据错误于: ${formatDateTime(fetchAttemptTime)}. ${lastSuccessfulDataTimestamp ? '旧数据截至: ' + formatDateTime(lastSuccessfulDataTimestamp) : ''}`;
            lastRefreshTimeEl.classList.add('error');
        }
        if (isInitialLoad && Object.keys(accountDataCache).length > 0) renderTable(); return;
      }

      if (lastRefreshTimeEl) {
          lastRefreshTimeEl.innerText = `数据更新于: ${formatDateTime(fetchAttemptTime)}`;
          lastRefreshTimeEl.classList.remove('error');
      }
      lastSuccessfulDataTimestamp = fetchAttemptTime;
      localStorage.setItem(KEY_LAST_SUCCESSFUL_REFRESH, lastSuccessfulDataTimestamp.toISOString());

      const apiList = jsonData.data.list; const nowFormattedStr = formatDateTime(new Date()); const currentApiAccountIds = new Set();
      if (accountOrder.length === 0 && apiList.length > 0 && isInitialLoad) { accountOrder = apiList.map(item => String(item.accountId)); }

      apiList.forEach(apiItem => {
          const accountIdStr = String(apiItem.accountId); currentApiAccountIds.add(accountIdStr);
          let cacheEntry = accountDataCache[accountIdStr]; if (!cacheEntry) { cacheEntry = { current: {}, autoTransferSettings: initializeAutoTransferSettings(null), lastSuccessfulTransferTime: 0 }; accountDataCache[accountIdStr] = cacheEntry; } else { cacheEntry.autoTransferSettings = initializeAutoTransferSettings(cacheEntry.autoTransferSettings); }
          if (!cacheEntry.current) cacheEntry.current = {}; if (cacheEntry.lastSuccessfulTransferTime === undefined) cacheEntry.lastSuccessfulTransferTime = 0; if (!cacheEntry.current.balanceHistory) cacheEntry.current.balanceHistory = [];

          const prevData = { ...cacheEntry.current }; // prevData is critical for change detection

          // Initialize currentData with values from API
          const currentData = {
              id: accountIdStr,
              platform: apiItem.tripartiteId,
              accountName: apiItem.accountName,
              phone: apiItem.otpReceiver,
              balance: parseFloat(apiItem.balance) / 100,
              frozenBalance: parseFloat(apiItem.frozenBalance) / 100,
              apiStatus: parseInt(apiItem.accountStatus),
              description: apiItem.description,
              lastHeartbeatTime: apiItem.lastHeartbeatTime ? formatDateTime(new Date(apiItem.lastHeartbeatTime)) : null,
              lastChangeTime: prevData.lastChangeTime || nowFormattedStr, // Default to prev or now
              isDisappeared: false,
              balanceHistory: prevData.balanceHistory ? [...prevData.balanceHistory] : []
          };
          if(!prevData.lastChangeTime){ currentData.lastChangeTime = nowFormattedStr; } // Ensure lastChangeTime is set

          // ---- START: Correction for API returning 0 when previous value was non-zero ----
          if (!isInitialLoad) { // Only apply this correction after initial data load
              if (prevData.balance !== undefined && prevData.balance > 0 && currentData.balance === 0) {
                  console.warn(`GDS Script (ID: ${accountIdStr}): API returned balance 0, previous was ${formatAmount(prevData.balance)}. Using previous value.`);
                  currentData.balance = prevData.balance; // Revert to previous balance
              }
              if (prevData.frozenBalance !== undefined && prevData.frozenBalance > 0 && currentData.frozenBalance === 0) {
                  console.warn(`GDS Script (ID: ${accountIdStr}): API returned frozenBalance 0, previous was ${formatAmount(prevData.frozenBalance)}. Using previous value.`);
                  currentData.frozenBalance = prevData.frozenBalance; // Revert to previous frozen balance
              }
          }
          // ---- END: Correction ----

          let significantAmountChangeMade = false; let logMessageParts = [];

          // Now, compare potentially corrected currentData with prevData
          if (prevData.balance !== undefined && currentData.balance !== prevData.balance) {
              const diff = currentData.balance - prevData.balance;
              const diffStr = `(${diff > 0 ? '+' : ''}${formatAmount(diff)})`;
              const diffClass = diff > 0 ? 'log-amount-increase' : 'log-amount-decrease';
              logMessageParts.push(`余额: ${formatAmount(prevData.balance)} → ${formatAmount(currentData.balance)} <span class="${diffClass}">${diffStr}</span>`);
              significantAmountChangeMade = true;
          }
          if (prevData.frozenBalance !== undefined && currentData.frozenBalance !== prevData.frozenBalance) {
              const diff = currentData.frozenBalance - prevData.frozenBalance;
              const diffStr = `(${diff > 0 ? '+' : ''}${formatAmount(diff)})`;
              const diffClass = diff > 0 ? 'log-amount-increase' : (diff < 0 ? 'log-amount-decrease' : '');
              const fontWeight = diff > 0 ? 'font-weight:bold;' : '';
              logMessageParts.push(`冻结: ${formatAmount(prevData.frozenBalance)} → ${formatAmount(currentData.frozenBalance)} <span class="${diffClass}" style="${fontWeight}">${diffStr}</span>`);
              significantAmountChangeMade = true;
              if (diff > 0 && prevData.frozenBalance >= 0 && !isInitialLoad) { // Log only actual increases
                  const frozenLogMsg = `冻结金额增加: ${formatAmount(prevData.frozenBalance)} → ${formatAmount(currentData.frozenBalance)} <span class="log-amount-increase" style="font-weight:bold;">${diffStr}</span>`;
                  addFrozenLogEntry({ accountId: accountIdStr, accountName: currentData.accountName, message: frozenLogMsg });
              }
          }

          if (significantAmountChangeMade) {
              currentData.lastChangeTime = nowFormattedStr;
          }

          if (prevData.apiStatus !== undefined && currentData.apiStatus !== prevData.apiStatus) {
              const statusChangeMsg = `在线状态: ${formatApiStatus(prevData.apiStatus).text} → <span class="log-status-change">${formatApiStatus(currentData.apiStatus).text}</span>`;
              if (!significantAmountChangeMade && !isInitialLoad) {
                  addLogEntry({ accountId: accountIdStr, accountName: currentData.accountName, message: statusChangeMsg });
              } else if (significantAmountChangeMade) {
                  logMessageParts.push(statusChangeMsg);
              }
          }

          if (significantAmountChangeMade && !isInitialLoad && logMessageParts.length > 0) {
              let intervalStr = 'N/A';
              if (prevData.lastChangeTime) {
                  const prevDate = new Date(prevData.lastChangeTime.replace(/-/g, '/'));
                  const currChangeDate = new Date(currentData.lastChangeTime.replace(/-/g, '/'));
                  if (!isNaN(prevDate) && !isNaN(currChangeDate)) {
                      const diffMs = currChangeDate.getTime() - prevDate.getTime();
                      if (diffMs >= 0) {
                          intervalStr = formatInterval(Math.round(diffMs / 1000));
                      }
                  }
              }
              addLogEntry({ accountId: accountIdStr, accountName: currentData.accountName, message: logMessageParts.join('， '), interval: intervalStr });
          }

          currentData.balanceHistory.push({ timestamp: Date.now(), balance: currentData.balance });
          if (currentData.balanceHistory.length > MAX_ACCOUNT_BALANCE_HISTORY) {
              currentData.balanceHistory.shift();
          }

          cacheEntry.current = currentData;
          if (accountOrder.indexOf(accountIdStr) === -1) accountOrder.push(accountIdStr);
      });
      accountOrder.forEach(accountIdStr => { if (!currentApiAccountIds.has(accountIdStr)) { const cacheEntry = accountDataCache[accountIdStr]; if (cacheEntry && cacheEntry.current && !cacheEntry.current.isDisappeared) { cacheEntry.current.isDisappeared = true; cacheEntry.current.apiStatus = SCRIPT_INTERNAL_STATUS_DISAPPEARED; addLogEntry({ accountId: accountIdStr, accountName: cacheEntry.current.accountName, message: '<span class="status-disappeared">账号在API响应中消失</span>' }); } } });
      localStorage.setItem(KEY_ACCOUNT_DATA_CACHE, JSON.stringify(accountDataCache)); localStorage.setItem(KEY_ACCOUNT_ORDER, JSON.stringify(accountOrder));
      renderTable();
      const hourlyRateHtml = calculateEstimatedHourlyRate(accountDataCache); document.getElementById('gds-hourly-rate-display').innerHTML = hourlyRateHtml;
      checkAndPerformAutoTransfers();
    } catch (error) {
        console.error('FetchAccountData 异常:', error);
        let statusMsg = `脚本错误: ${error.message}`;
        if (lastSuccessfulDataTimestamp) statusMsg += `. 数据可能陈旧 (截至 ${formatDateTime(lastSuccessfulDataTimestamp)})`;
        showFetchStatus(statusMsg, 'error', 7000);
        if (lastRefreshTimeEl) {
            lastRefreshTimeEl.innerText = `脚本错误于: ${formatDateTime(fetchAttemptTime)}. ${lastSuccessfulDataTimestamp ? '旧数据截至: ' + formatDateTime(lastSuccessfulDataTimestamp) : ''}`;
            lastRefreshTimeEl.classList.add('error');
        }
        tableContainer.innerHTML = `获取数据时发生脚本错误: ${error.message}。请检查控制台。`;
        if (isInitialLoad && Object.keys(accountDataCache).length > 0) renderTable();
    }
  }

  function renderColumnTogglePanel() {
    let html = '列显示控制: ';
    columnConfig.forEach(col => {
        if (col.hideable) {
            html += `<label title="${escapeHtml(col.label, true)}">
                       <input type="checkbox" data-col-id="${escapeHtml(col.id)}" ${columnVisibility[col.id] ? 'checked' : ''}>
                       ${escapeHtml(col.label)}
                     </label>`;
        }
    });
    columnTogglePanel.innerHTML = html;
  }

  function handleColumnToggle(event) {
    const checkbox = event.target;
    if (checkbox.type === 'checkbox' && checkbox.dataset.colId) {
        const colId = checkbox.dataset.colId;
        columnVisibility[colId] = checkbox.checked;
        saveColumnVisibility();
        renderTable();
    }
  }

  function handleHeaderClick(event) {
    const th = event.target.closest('th');
    if (!th || !th.dataset.colId) return;

    const colId = th.dataset.colId;
    const col = columnConfig.find(c => c.id === colId);
    if (!col || !col.sortable) return;

    if (sortConfig.key === colId) {
        sortConfig.direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
    } else {
        sortConfig.key = colId;
        sortConfig.direction = 'asc';
    }
    saveSortConfig();
    renderTable();
  }

  function renderTable() {
    let headerHtml = '<thead><tr>';
    columnConfig.forEach(col => {
        let thClass = col.cssClass || '';
        if (!columnVisibility[col.id]) thClass += ' gds-col-hidden';
        if (col.sortable) thClass += ' sortable';

        let sortIndicator = '';
        if (col.sortable && sortConfig.key === col.id) {
            sortIndicator = sortConfig.direction === 'asc' ? ' ▲' : ' ▼';
        }
        headerHtml += `<th class="${thClass}" data-col-id="${col.id}" title="${escapeHtml(col.label, true)} ${col.sortable ? '(可排序)' : ''}">${escapeHtml(col.label)}${sortIndicator}</th>`;
    });
    headerHtml += '</tr></thead>';

    const searchTerm = document.getElementById('gds-search').value.toLowerCase().trim();
    const searchKeywords = searchTerm ? searchTerm.split(/\s+/).filter(k => k) : [];

    let sortedAccountData = accountOrder.map(id => accountDataCache[id]).filter(Boolean);

    if (sortConfig.key) {
        const sortCol = columnConfig.find(c => c.id === sortConfig.key);
        if (sortCol && sortCol.dataKey) {
            sortedAccountData.sort((a, b) => {
                let valA = a.current?.[sortCol.dataKey];
                let valB = b.current?.[sortCol.dataKey];

                if (typeof valA === 'string' && typeof valB === 'string') {
                    valA = valA.toLowerCase();
                    valB = valB.toLowerCase();
                } else if (typeof valA === 'number' && typeof valB === 'number') {
                    // Native number sort is fine
                } else if (sortCol.dataKey === 'lastChangeTime') {
                    valA = valA ? new Date(String(valA).replace(/-/g, '/')).getTime() : 0;
                    valB = valB ? new Date(String(valB).replace(/-/g, '/')).getTime() : 0;
                } else {
                    valA = String(valA).toLowerCase();
                    valB = String(valB).toLowerCase();
                }


                if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
                if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
    }


    let bodyHtml = '<tbody>';
    sortedAccountData.forEach(cacheEntry => {
        if (!cacheEntry || !cacheEntry.current) return;
        const acc = cacheEntry.current;
        const settings = cacheEntry.autoTransferSettings;

        if (searchKeywords.length > 0) { const searchableText = `${acc.id} ${acc.platform} ${acc.accountName} ${acc.phone}`.toLowerCase(); if (!searchKeywords.every(keyword => searchableText.includes(keyword))) return; }

        let rowHtml = `<tr data-account-id="${escapeHtml(acc.id)}">`;

        columnConfig.forEach(col => {
            let cellClass = col.cssClass || '';
            if (!columnVisibility[col.id]) cellClass += ' gds-col-hidden';
            let cellContent = '';

            switch (col.id) {
                case 'id': cellContent = escapeHtml(acc.id); break;
                case 'platform': cellContent = escapeHtml(acc.platform); break;
                case 'accountName': cellContent = `<td class="${cellClass}" title="${escapeHtml(acc.description, true)}">${escapeHtml(acc.accountName)}</td>`; rowHtml += cellContent; return;
                case 'phone': cellContent = escapeHtml(acc.phone); break;
                case 'balance':
                    let balanceCellClasses = cellClass;
                    if (acc.balance >= 0 && acc.balance < 200000) { let tierSuffix = '0'; if (acc.balance >= 150000) tierSuffix = '4'; else if (acc.balance >= 100000) tierSuffix = '3'; else if (acc.balance >= 50000) tierSuffix = '2'; else if (acc.balance >= 10000) tierSuffix = '1'; balanceCellClasses += ` balance-tier-${tierSuffix}`; }
                    if (acc.balance >= 200000) balanceCellClasses += ' bal-high'; else if (acc.balance < 0) balanceCellClasses += ' bal-negative';
                    cellContent = `<td class="${balanceCellClasses}">${formatAmount(acc.balance)}</td>`; rowHtml += cellContent; return;
                case 'frozenBalance': const frozenCls = acc.frozenBalance > 0 ? 'frozen-positive' : ''; cellContent = `<td class="${cellClass} ${frozenCls}">${formatAmount(acc.frozenBalance)}</td>`; rowHtml += cellContent; return;
                case 'apiStatus': const statusInfo = formatApiStatus(acc.apiStatus); cellContent = `<td class="${cellClass} ${escapeHtml(statusInfo.class, true)}">${escapeHtml(statusInfo.text)}</td>`; rowHtml += cellContent; return;
                case 'lastChangeTime': cellContent = acc.lastChangeTime ? escapeHtml(acc.lastChangeTime) : 'N/A'; break;
                case 'statusOp': cellContent = `<button class="status-op-btn ${acc.apiStatus === API_STATUS_ENABLED && !acc.isDisappeared ? 'active' : ''}" data-op="set-status" data-status="${API_STATUS_ENABLED}">启用</button> <button class="status-op-btn ${acc.apiStatus === API_STATUS_STOP_RECEIPT && !acc.isDisappeared ? 'active' : ''}" data-op="set-status" data-status="${API_STATUS_STOP_RECEIPT}">止收</button> <button class="status-op-btn ${acc.apiStatus === API_STATUS_CUSTOM_STOP && !acc.isDisappeared ? 'active' : ''}" data-op="set-status" data-status="${API_STATUS_CUSTOM_STOP}">停止</button>`; break;
                case 'autoTransferEnabled': cellContent = `<input type="checkbox" class="autotransfer-setting" data-setting="enabled" ${settings.enabled ? 'checked' : ''}/>`; break;
                case 'autoTransferTriggerAmount': cellContent = `<input type="number" class="autotransfer-setting" data-setting="triggerAmount" value="${escapeHtml(String(settings.triggerAmount), true)}" placeholder="金额"/>`; break;
                case 'autoTransferPayeeId': let payeeOptionsHtml = PAYEE_OPTIONS.map(opt => `<option value="${opt.payeeId}" ${String(settings.payeeId) === String(opt.payeeId) ? 'selected' : ''}>${escapeHtml(opt.name)}</option>`).join(''); cellContent = `<select class="autotransfer-setting" data-setting="payeeId"><option value="">--选择--</option>${payeeOptionsHtml}</select>`; break;
                case 'autoTransferMode': let modeOptionsHtml = TRANSFER_MODE_OPTIONS.map(opt => `<option value="${opt.transferMode}" ${String(settings.transferMode) === String(opt.transferMode) ? 'selected' : ''}>${escapeHtml(opt.name)}</option>`).join(''); cellContent = `<select class="autotransfer-setting" data-setting="transferMode"><option value="">--选择--</option>${modeOptionsHtml}</select>`; break;
                case 'autoTransferPercentage': let percentageOptionsHtml = TRANSFER_PERCENTAGE_OPTIONS.map(opt => `<option value="${opt.value}" ${parseFloat(settings.transferPercentage) === opt.value ? 'selected' : ''}>${escapeHtml(opt.name)}</option>`).join(''); cellContent = `<select class="autotransfer-setting" data-setting="transferPercentage">${percentageOptionsHtml}</select>`; break;
                case 'autoTransferRoundToInteger': cellContent = `<input type="checkbox" class="autotransfer-setting" data-setting="roundToInteger" ${settings.roundToInteger ? 'checked' : ''}/>`; break;
                default: cellContent = `N/A_col:${escapeHtml(col.id)}`;
            }
            if (!['accountName', 'balance', 'frozenBalance', 'apiStatus'].includes(col.id)) {
                rowHtml += `<td class="${cellClass}">${cellContent}</td>`;
            }
        });
        rowHtml += `</tr>`;
        bodyHtml += rowHtml;
    });
    bodyHtml += `</tbody>`;
    tableContainer.innerHTML = `<table>${headerHtml}${bodyHtml}</table>`;

    const table = tableContainer.querySelector('table');
    if (table) {
        const thead = table.querySelector('thead');
        if (thead) {
            thead.removeEventListener('click', handleHeaderClick);
            thead.addEventListener('click', handleHeaderClick);
        }
    }
  }


  function handleAutoTransferSettingChange(event) {
      const target = event.target; if (!target.classList.contains('autotransfer-setting')) return;
      const accountId = target.closest('tr').dataset.accountId; if (!accountId || !accountDataCache[accountId]) return;
      const oldSettings = { ...accountDataCache[accountId].autoTransferSettings }; const settingName = target.dataset.setting;
      let newValue = (target.type === 'checkbox') ? target.checked : target.value; let displayValue = newValue;
      if (settingName === 'triggerAmount') { const numValue = parseFloat(newValue); if (newValue !== '' && (isNaN(numValue) || numValue < 0)) { showToast('触发金额必须是有效的非负数字或为空', event.clientX, event.clientY, 1500); target.value = oldSettings[settingName] || ''; return; } newValue = newValue === '' ? '' : numValue; displayValue = newValue === '' ? '(空)' : formatAmount(newValue); }
      else if (settingName === 'payeeId' || settingName === 'transferMode') { newValue = newValue === '' ? '' : parseInt(newValue, 10); if (settingName === 'payeeId') { const selectedOption = PAYEE_OPTIONS.find(opt => opt.payeeId === newValue); displayValue = selectedOption ? selectedOption.name : (newValue === '' ? '(空)' : `PayeeID ${newValue}`); } else { const selectedOption = TRANSFER_MODE_OPTIONS.find(opt => opt.transferMode === newValue); displayValue = selectedOption ? selectedOption.name : (newValue === '' ? '(空)' : `Mode ${newValue}`); } }
      else if (settingName === 'transferPercentage') { newValue = parseFloat(newValue); const selectedOption = TRANSFER_PERCENTAGE_OPTIONS.find(opt => opt.value === newValue); displayValue = selectedOption ? selectedOption.name : `${(newValue * 100).toFixed(0)}%`; }
      else if (settingName === 'enabled' || settingName === 'roundToInteger') { displayValue = newValue ? '是' : '否'; }
      if (settingName === 'transferPercentage') { if (oldSettings.transferPercentage === newValue) return; } else if (settingName === 'triggerAmount') { if (oldSettings.triggerAmount === newValue) return; } else { if (oldSettings[settingName] === newValue) return; }
      accountDataCache[accountId].autoTransferSettings[settingName] = newValue; localStorage.setItem(KEY_ACCOUNT_DATA_CACHE, JSON.stringify(accountDataCache));
      let settingDisplayName = settingName; let oldDisplayValue = oldSettings[settingName];
      switch(settingName) { case 'enabled': settingDisplayName = '开启自动划转'; oldDisplayValue = oldSettings.enabled ? '是' : '否'; break; case 'triggerAmount': settingDisplayName = '触发金额'; oldDisplayValue = oldSettings.triggerAmount === '' || oldSettings.triggerAmount === undefined ? '(空)' : formatAmount(oldSettings.triggerAmount); break; case 'payeeId': settingDisplayName = '收款账户'; const oldPayeeOpt = PAYEE_OPTIONS.find(opt => opt.payeeId === oldSettings.payeeId); oldDisplayValue = oldPayeeOpt ? oldPayeeOpt.name : (oldSettings.payeeId === '' || oldSettings.payeeId === undefined ? '(空)' : `PayeeID ${oldSettings.payeeId}`); break; case 'transferMode': settingDisplayName = '划转模式'; const oldModeOpt = TRANSFER_MODE_OPTIONS.find(opt => opt.transferMode === oldSettings.transferMode); oldDisplayValue = oldModeOpt ? oldModeOpt.name : (oldSettings.transferMode === '' || oldSettings.transferMode === undefined ? '(空)' : `Mode ${oldSettings.transferMode}`); break; case 'transferPercentage': settingDisplayName = '划转比例'; const oldPercOpt = TRANSFER_PERCENTAGE_OPTIONS.find(opt => opt.value === oldSettings.transferPercentage); oldDisplayValue = oldPercOpt ? oldPercOpt.name : (oldSettings.transferPercentage !== undefined ? `${(oldSettings.transferPercentage * 100).toFixed(0)}%` : '(空)'); break; case 'roundToInteger': settingDisplayName = '金额取整(千)'; oldDisplayValue = oldSettings.roundToInteger ? '是' : '否'; break; }
      addLogEntry({ accountId, accountName: accountDataCache[accountId].current?.accountName || 'N/A', message: `<span class="log-setting-change">自动划转设置: ${escapeHtml(settingDisplayName)} 从 "${escapeHtml(String(oldDisplayValue))}" 改为 "${escapeHtml(String(displayValue))}"</span>` });
      showToast(`ID ${accountId}: "${escapeHtml(settingDisplayName)}" 已更新`, event.clientX, event.clientY, 1000);
      if (settingName === 'enabled' && newValue === true) { checkAndPerformAutoTransfers(accountId); }
  }

  async function checkAndPerformAutoTransfers(specificAccountId = null) {
      const accountsToCheck = specificAccountId ? [specificAccountId] : Object.keys(accountDataCache);
      for (const accountId of accountsToCheck) {
          const cacheEntry = accountDataCache[accountId]; if (!cacheEntry || !cacheEntry.current || !cacheEntry.autoTransferSettings || !cacheEntry.autoTransferSettings.enabled) { continue; }
          const acc = cacheEntry.current; const settings = cacheEntry.autoTransferSettings; if (acc.isDisappeared || (acc.apiStatus !== API_STATUS_ENABLED && acc.apiStatus !== API_STATUS_STOP_RECEIPT)) { continue; }
          const triggerAmount = parseFloat(settings.triggerAmount); if (isNaN(triggerAmount) || triggerAmount <= 0) continue;
          if (acc.balance > triggerAmount) {
              const now = Date.now(); if (cacheEntry.lastSuccessfulTransferTime && (now - cacheEntry.lastSuccessfulTransferTime < AUTO_TRANSFER_THROTTLE_MS)) { addLogEntry({ accountId, accountName: acc.accountName, message: `<span class="log-transfer-throttled">自动划转节流 (1分钟内已成功划转)</span>` }); continue; }
              if (!settings.payeeId || !settings.transferMode) { addLogEntry({ accountId, accountName: acc.accountName, message: `<span class="log-transfer-fail">自动划转配置不完整 (收款账户或模式未选)</span>` }); continue; }
              const transferPercentage = parseFloat(settings.transferPercentage); if (isNaN(transferPercentage) || transferPercentage <= 0 || transferPercentage > 1) { addLogEntry({ accountId, accountName: acc.accountName, message: `<span class="log-transfer-fail">自动划转失败: 无效的划转比例 (${escapeHtml(String(settings.transferPercentage))})</span>` }); continue; }
              let transferAmountBase = acc.balance * transferPercentage; let amountInCents;
              if (settings.roundToInteger) { let truncatedAmount = Math.floor(transferAmountBase / 1000) * 1000; amountInCents = Math.floor(truncatedAmount * 100); } else { amountInCents = Math.floor(Math.floor(transferAmountBase) * 100); }
              if (amountInCents <= 0) { addLogEntry({ accountId, accountName: acc.accountName, message: `<span class="log-transfer-fail">计算后划转金额为0或负数 (${formatAmount(amountInCents/100)})，不执行</span>` }); continue; }
              const token = localStorage.getItem('token'); if (!token) { console.warn("Token缺失，无法执行自动划转"); continue; }
              const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`; const version = Date.now();
              const payload = { tripartiteId: acc.platform, accountName: acc.accountName, payeeId: parseInt(settings.payeeId), amount: amountInCents, transferMode: parseInt(settings.transferMode), isBulk: false, version: version };
              const payeeName = PAYEE_OPTIONS.find(p => p.payeeId === payload.payeeId)?.name || `PayeeID ${payload.payeeId}`; const modeName = TRANSFER_MODE_OPTIONS.find(m => m.transferMode === payload.transferMode)?.name || `Mode ${payload.transferMode}`;
              addLogEntry({ accountId, accountName: acc.accountName, message: `<span class="log-transfer-attempt">尝试自动划转 ${formatAmount(amountInCents / 100)} 到 ${escapeHtml(payeeName)} (模式: ${escapeHtml(modeName)})</span>` });
              showFetchStatus(`ID ${accountId}: 尝试自动划转 ${formatAmount(amountInCents / 100)}...`, 'info', 5000);
              try {
                  const response = await fetch("https://admin.gdspay.xyz/api/tripartite/v1/transfer/manual", { method: "POST", headers: { "accept": "application/json, text/plain, */*", "authorization": token, "content-type": "application/json", "X-Request-ID": requestId, "accept-language": "zh-CN,zh;q=0.9,en;q=0.8", "cache-control": "no-cache", "pragma": "no-cache", "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-origin" }, referrer: "https://admin.gdspay.xyz/transfer", referrerPolicy: "strict-origin-when-cross-origin", body: JSON.stringify(payload), credentials: "include" });
                  const result = await response.json();
                  if (result?.code === 1) { cacheEntry.lastSuccessfulTransferTime = Date.now(); localStorage.setItem(KEY_ACCOUNT_DATA_CACHE, JSON.stringify(accountDataCache)); addLogEntry({ accountId, accountName: acc.accountName, message: `<span class="log-transfer-success">自动划转 ${formatAmount(amountInCents / 100)} 到 ${escapeHtml(payeeName)} 成功!</span> (Version: ${version})` }); showFetchStatus(`ID ${accountId}: 自动划转成功!`, 'success', 3000); }
                  else { addLogEntry({ accountId, accountName: acc.accountName, message: `<span class="log-transfer-fail">自动划转 ${formatAmount(amountInCents / 100)} 失败: ${escapeHtml(result?.msg || '未知错误')}</span>` }); showFetchStatus(`ID ${accountId}: 自动划转失败 - ${result?.msg}`, 'error', 5000); }
              } catch (err) { console.error(`ID ${accountId}: 自动划转 API 请求错误:`, err); addLogEntry({ accountId, accountName: acc.accountName, message: `<span class="log-transfer-fail">自动划转 ${formatAmount(amountInCents / 100)} 请求异常: ${escapeHtml(err.message)}</span>` }); showFetchStatus(`ID ${accountId}: 自动划转请求异常`, 'error', 5000); }
          }
      }
  }

  async function handleTableClick(event) {
    const target = event.target;
    if (event.button === 2 && target.tagName === 'TD') { event.preventDefault(); const text = target.innerText.trim(); if (text) copyToClipboard(text, event); return; }
    if (target.classList.contains('status-op-btn') && target.dataset.op === 'set-status') {
        const accountId = target.closest('tr').dataset.accountId; const newApiStatus = parseInt(target.dataset.status); if (!accountId || isNaN(newApiStatus)) return;
        const accCache = accountDataCache[accountId]; if (!accCache || !accCache.current) { showToast('账户数据异常', event.clientX, event.clientY); return; }
        const { accountName, platform: tripartiteId } = accCache.current; const token = localStorage.getItem('token'); if (!token) { showToast('Token缺失', event.clientX, event.clientY); return; }
        const oldApiStatus = accCache.current.apiStatus; if (oldApiStatus === newApiStatus && !accCache.current.isDisappeared) { showToast('状态未改变', event.clientX, event.clientY, 800); return; }
        target.closest('td').querySelectorAll('.status-op-btn').forEach(btn => btn.disabled = true); showFetchStatus(`ID ${accountId}: 设置状态为 "${formatApiStatus(newApiStatus).text}"...`, 'info', 0);
        try {
            const payload = { accountId: parseInt(accountId), accountName, tripartiteId, accountStatus: newApiStatus };
            const response = await fetch("https://admin.gdspay.xyz/api/tripartite/v1/account/status/modify", { "headers": { "accept": "application/json, text/plain, */*", "accept-language": "zh-CN,zh;q=0.9,en;q=0.8", "authorization": token, "cache-control": "no-cache", "content-type": "application/json", "pragma": "no-cache", "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-origin" }, "referrer": "https://admin.gdspay.xyz/tripartite", "referrerPolicy": "strict-origin-when-cross-origin", "body": JSON.stringify(payload), "method": "POST", "mode": "cors", "credentials": "include" });
            const result = await response.json();
            if (result.code === 1) { showFetchStatus(`ID ${accountId}: 状态设置成功!`, 'success', 2500); accCache.current.apiStatus = newApiStatus; target.closest('td').querySelectorAll('.status-op-btn').forEach(btn => { btn.classList.toggle('active', parseInt(btn.dataset.status) === newApiStatus && !accCache.current.isDisappeared); }); const statusCell = target.closest('tr').querySelector('.col-apiStatus'); if (statusCell) { const newStatusInfo = formatApiStatus(newApiStatus); statusCell.className = `col-apiStatus ${escapeHtml(newStatusInfo.class, true)} ${columnVisibility['apiStatus'] ? '' : 'gds-col-hidden'}`; statusCell.innerText = escapeHtml(newStatusInfo.text); } addLogEntry({ accountId, accountName, message: `手动操作: 在线状态从 ${formatApiStatus(oldApiStatus).text} → <span class="log-status-change">${formatApiStatus(newApiStatus).text}</span> <span class="log-api-op-success">(成功)</span>` });
            } else { showFetchStatus(`ID ${accountId}: 状态设置失败 - ${result.msg || '未知错误'}`, 'error', 4000); addLogEntry({ accountId, accountName, message: `手动操作: 在线状态从 ${formatApiStatus(oldApiStatus).text} → ${formatApiStatus(newApiStatus).text} <span class="log-api-op-fail">(失败: ${escapeHtml(result.msg)})</span>` }); }
        } catch (err) { console.error('设置状态API请求错误:', err); showFetchStatus(`ID ${accountId}: 状态设置请求异常 - ${err.message}`, 'error', 4000); addLogEntry({ accountId, accountName: accCache.current.accountName, message: `手动操作: 在线状态从 ${formatApiStatus(oldApiStatus).text} → ${formatApiStatus(newApiStatus).text} <span class="log-api-op-fail">(请求异常)</span>` });
        } finally { target.closest('td').querySelectorAll('.status-op-btn').forEach(btn => btn.disabled = false); }
    }
  }

  // Event Listeners
  tableContainer.addEventListener('click', handleTableClick);
  tableContainer.addEventListener('contextmenu', handleTableClick);
  tableContainer.addEventListener('change', handleAutoTransferSettingChange);
  columnTogglePanel.addEventListener('change', handleColumnToggle);
  document.getElementById('gds-search').addEventListener('input', renderTable);
  document.getElementById('gds-refresh').addEventListener('click', () => { fetchAccountData(); });
  document.getElementById('gds-toggle-theme').addEventListener('click', toggleTheme);
  document.getElementById('gds-clear-log').addEventListener('click', (event) => { if (confirm('确定要清空所有操作、变动及冻结增加日志吗？')) { operationLogs = []; localStorage.removeItem(KEY_LOGS); renderLogs(); frozenBalanceIncreaseLogs = []; localStorage.removeItem(KEY_FROZEN_LOGS); renderFrozenLogs(); showToast('所有日志已清空', event.clientX, event.clientY); } });
  document.getElementById('gds-clear-prev-data').addEventListener('click', (event) => {
      if (confirm('警告：这将清空所有本地缓存的账户数据、排序、主题、列显示和日志！\n确定要重置脚本吗？')) {
          localStorage.removeItem(KEY_ACCOUNT_DATA_CACHE); localStorage.removeItem(KEY_ACCOUNT_ORDER);
          localStorage.removeItem(KEY_LOGS); localStorage.removeItem(KEY_FROZEN_LOGS);
          localStorage.removeItem(KEY_THEME_PREFERENCE); localStorage.removeItem(KEY_COLUMN_VISIBILITY);
          localStorage.removeItem(KEY_SORT_CONFIG); localStorage.removeItem(KEY_LAST_SUCCESSFUL_REFRESH);
          accountDataCache = {}; accountOrder = []; operationLogs = []; frozenBalanceIncreaseLogs = [];
          sortConfig = { key: 'id', direction: 'asc' };
          lastSuccessfulDataTimestamp = null;
          const lastRefreshTimeEl = document.getElementById('gds-last-refresh-time');
          if(lastRefreshTimeEl) {
              lastRefreshTimeEl.innerText = '数据未加载';
              lastRefreshTimeEl.classList.remove('error');
          }
          loadColumnVisibility();
          renderTable(); renderLogs(); renderFrozenLogs(); renderColumnTogglePanel();
          applyTheme('light'); showToast('脚本数据已重置!', event.clientX, event.clientY);
          fetchAccountData(true);
      }
  });

  // Initialization
  console.log('GDS 账户信息增强版 (v3.1.8.2) 启动...');
  loadThemePreference();
  loadPersistedData();
  fetchAccountData(true); // Initial fetch
  if (localStorage.getItem('token')) { if (refreshIntervalId) clearInterval(refreshIntervalId); refreshIntervalId = setInterval(() => { fetchAccountData(false); }, REFRESH_INTERVAL_MS); // Subsequent fetches are not initial
  } else { console.warn("未找到 Token，自动刷新已禁用。"); }
  window.addEventListener('beforeunload', () => { if (refreshIntervalId) clearInterval(refreshIntervalId); });

})();