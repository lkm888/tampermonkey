// ==UserScript==
// @name         GDS 交易列表集成版 (v1.3.0 - 受益人选择, 打款节流, 格式优化)
// @namespace    http://tampermonkey.net/
// @version      1.3.0
// @description  在GDS页面内嵌交易列表。Bank列匹配GDS账户。新增受益人选择，打款后按钮1分钟节流。金额无逗号。
// @match        https://admin.gdspay.xyz/dd*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
  'use strict';

  // ---- API URLs and Keys ----
  const TRANSACTION_DATA_URL = 'http://127.0.0.1:5000/transactions';
  const GDS_PAYEE_LIST_API_URL_TEMPLATE = 'https://admin.gdspay.xyz/api/tripartite/v1/payee/list?search={ACCOUNT_NO}&page=1&pageSize=50'; // Increased pageSize
  const GDS_TRANSFER_API_URL = 'https://admin.gdspay.xyz/api/tripartite/v1/transfer/manual';
  const KEY_GDS_ACCOUNT_CACHE = 'gds_account_data_cache_v3.1.0';
  const KEY_TRANSACTION_LOGS = 'gds_embedded_tx_logs_v1.3.0';
  const KEY_THEME_PREFERENCE = 'gds_theme_preference_v3.1.7';
  const KEY_COLUMN_VISIBILITY_EMBED_TX = 'gds_embed_tx_column_visibility_v1.3.0';
  const KEY_SORT_CONFIG_EMBED_TX = 'gds_embed_tx_sort_config_v1.3.0';
  const KEY_LAST_SUCCESSFUL_REFRESH_EMBED_TX = 'gds_embed_tx_last_successful_refresh_v1.3.0';
  const KEY_PAYOUT_THROTTLE_TIMESTAMPS = 'gds_embed_tx_payout_throttle_v1.3.0';


  // ---- Constants ----
  const MAX_LOG_ENTRIES = 100;
  const REFRESH_INTERVAL_MS = 10000;
  const GDS_TRANSFER_MODES = [
    { name: 'IMPS', value: 1 },
    { name: 'NEFT', value: 2 },
    { name: 'RTGS', value: 3 },
  ];
  const DEFAULT_GDS_TRANSFER_MODE = 2;
  const PAYOUT_THROTTLE_DURATION_MS = 60 * 1000; // 1分钟

  // ---- Global Variables ----
  let transactionDataCache = [];
  let gdsAccountDataCache = {};
  let operationLogs = [];
  let refreshIntervalId = null;
  let currentTheme = 'light';
  let columnVisibility = {};
  let sortConfig = { key: null, direction: 'asc' };
  let lastSuccessfulDataTimestamp = null;
  let isInitialLoad = true;
  let payoutThrottleTimestamps = {}; // { entryId: timestamp_of_last_payout_attempt }


  // ---- Styles ----
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
      --toast-bg: rgba(0,0,0,0.75); --toast-text: white;
      --fetch-status-bg: #e0e0e0; --fetch-status-text: #333;
      --fetch-status-success-bg: #d4edda; --fetch-status-success-text: #155724; --fetch-status-success-border: #c3e6cb;
      --fetch-status-error-bg: #f8d7da; --fetch-status-error-text: #721c24; --fetch-status-error-border: #f5c6cb;
      --fetch-status-info-bg: #e0e0e0; --fetch-status-info-text: #333; --fetch-status-shadow: rgba(0,0,0,0.2);
      --column-toggle-panel-bg: #f7f7f7; --column-toggle-panel-border: #ddd; --column-toggle-panel-shadow: rgba(0,0,0,0.05);
      --action-button-color: #007bff; --action-button-hover-color: #0056b3;
      --log-attempt-color: #007bff; --log-success-color: green; --log-fail-color: red;
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
      --toast-bg: rgba(200,200,200,0.85); --toast-text: #1c2128;
      --fetch-status-bg: #373e47; --fetch-status-text: #c9d1d9;
      --fetch-status-success-bg: #2ea043; --fetch-status-success-text: #ffffff; --fetch-status-success-border: #2ea043;
      --fetch-status-error-bg: #da3633; --fetch-status-error-text: #ffffff; --fetch-status-error-border: #da33;
      --fetch-status-info-bg: #373e47; --fetch-status-info-text: #c9d1d9; --fetch-status-shadow: rgba(0,0,0,0.4);
      --column-toggle-panel-bg: #2a2f36; --column-toggle-panel-border: #373e47; --column-toggle-panel-shadow: rgba(0,0,0,0.15);
      --action-button-color: #58a6ff; --action-button-hover-color: #79c0ff;
      --log-attempt-color: #58a6ff; --log-success-color: #3fb950; --log-fail-color: #f85149;
    }
    body { background-color: var(--body-bg); color: var(--text-color); transition: background-color 0.3s, color 0.3s; }
    input, select, button { color: var(--input-text); background-color: var(--input-bg); border: 1px solid var(--input-border); padding: 4px 6px; border-radius: 3px; }
    select option { background-color: var(--input-bg); color: var(--input-text); }
    body.dark-theme select option { background-color: var(--input-bg) !important; color: var(--input-text) !important; }

    #embed-tx-control-panel {
      background: var(--panel-bg);
      padding: 6px 10px; border:1px solid var(--panel-border); display: flex; flex-wrap: wrap;
      gap: 8px; align-items: center;
      font-family: monospace; font-size: 12px;
      box-shadow: 0 2px 5px var(--panel-shadow); margin-bottom: 5px;
    }
    #embed-tx-control-panel input, #embed-tx-control-panel button { padding: 2px 4px; font-size:12px; }
    #embed-tx-control-panel button:hover { background-color: var(--button-hover-bg); }
    #embed-tx-last-refresh-time { color: var(--text-muted-color); margin-left:10px; font-style:italic; }
    #embed-tx-last-refresh-time.error { color: red; font-weight: bold; }

    #embed-tx-main {
      position: fixed; top: 10px;
      left: 50%; transform: translateX(-50%); z-index: 9999;
      font-family: monospace; font-size: 12px; width: calc(100% - 40px); max-width: 1800px;
      background-color: var(--body-bg);
      padding: 10px;
      border: 1px solid var(--border-color);
      box-shadow: 0 3px 10px var(--panel-shadow);
      display: flex; flex-direction: column;
    }

    #embed-tx-column-toggle-panel {
      background: var(--column-toggle-panel-bg); border: 1px solid var(--column-toggle-panel-border);
      border-bottom: none; padding: 6px 10px; margin-bottom: 0;
      display: flex; flex-wrap: wrap; gap: 10px; font-size: 11px;
      box-shadow: 0 1px 3px var(--column-toggle-panel-shadow);
    }

    #embed-tx-table-container {
      background: var(--table-bg); border:1px solid var(--table-border); padding:0;
      max-height: calc(100vh - (10px + 20px) - 40px - 30px - 120px - 20px);
      min-height: 200px; overflow-y: auto; overflow-x: auto;
      box-sizing: border-box; box-shadow: 0 2px 8px var(--panel-shadow);
      flex-grow: 1;
    }
    #embed-tx-table-container table { border-collapse: collapse; width:100%; table-layout: auto; }
    #embed-tx-table-container th, #embed-tx-table-container td {
      border: 1px solid var(--table-border); padding: 5px 7px;
      text-align: left; vertical-align: middle; white-space: nowrap;
    }
    #embed-tx-table-container th {
      position: sticky; top: 0; background: var(--table-header-bg); font-weight: bold; z-index: 10;
      color: var(--text-color); cursor: default; user-select: none;
    }
    #embed-tx-table-container th.sortable { cursor: pointer; }
    #embed-tx-table-container th.sortable:hover { background-color: var(--button-hover-bg); }
    body.dark-theme #embed-tx-table-container th { background: var(--table-sticky-header-bg); }
    #embed-tx-table-container tr:nth-child(even) td { background: var(--table-row-even-bg); }
    #embed-tx-table-container tr:hover td { background: var(--table-row-hover-bg); }
    .embed-tx-col-hidden { display: none !important; }

    .col-tx-amount, .col-payout-account-balance, .col-transfer-amount-input input { text-align: right !important; }
    .col-payout-account-selector select, .col-transfer-mode-selector select, .col-payee-selector select { min-width: 100px; }
    .col-transfer-amount-input input { width: 80px; }
    .action-button {
        padding: 4px 8px; font-size: 11px; margin: 2px; border: 1px solid var(--button-border);
        border-radius: 3px; cursor: pointer; background-color: var(--button-bg); color: var(--text-color);
    }
    .action-button:hover { background-color: var(--button-hover-bg); }
    .action-button:disabled { cursor: not-allowed; opacity: var(--button-disabled-opacity); background-color: var(--button-disabled-bg); }
    .payout-action-button { background-color: var(--action-button-color); color: white; }
    .payout-action-button:hover { background-color: var(--action-button-hover-color); }
    body.dark-theme .payout-action-button { color: var(--body-bg); }

    #embed-tx-log-container {
      margin-top: 10px;
      background: var(--log-bg);
      border:1px solid var(--log-border); padding:10px; overflow: auto;
      font-size:12px; font-family:monospace; width: 100%;
      box-sizing: border-box; box-shadow: 0 2px 8px var(--log-shadow); color: var(--text-color);
      max-height: 100px;
      flex-shrink: 0;
    }
    #embed-tx-log-container .log-title { font-weight: bold; margin-bottom: 5px; display: block; }
    #embed-tx-log-container .log-entry { margin-bottom:5px; padding-bottom: 3px; border-bottom: 1px dotted var(--log-entry-border); line-height: 1.4; }
    #embed-tx-log-container .log-entry:last-child { border-bottom: none; }
    .log-transfer-attempt { color: var(--log-attempt-color); }
    .log-transfer-success { color: var(--log-success-color); }
    .log-transfer-fail { color: var(--log-fail-color); }


    #copy-toast { position: fixed; background: var(--toast-bg); color: var(--toast-text); padding: 8px 12px; border-radius: 4px; z-index: 10005; opacity: 0; transition: opacity 0.3s; pointer-events: none; font-size: 13px; box-shadow: 0 1px 3px var(--panel-shadow); }
    #gds-fetch-status {
        position: fixed; top: 15px; right: 20px; padding: 8px 12px; border-radius: 4px;
        font-size: 13px; z-index: 10003; display: none; box-shadow: 0 2px 5px var(--fetch-status-shadow);
        background-color: var(--fetch-status-info-bg); color: var(--fetch-status-info-text);
    }
    #gds-fetch-status.success { background-color: var(--fetch-status-success-bg); color: var(--fetch-status-success-text); border: 1px solid var(--fetch-status-success-border);}
    #gds-fetch-status.error   { background-color: var(--fetch-status-error-bg); color: var(--fetch-status-error-text); border: 1px solid var(--fetch-status-error-border);}

    #toggle-embed-tx-panel-btn {
        position: fixed; bottom: 10px; right: 10px; z-index: 10002;
        padding: 8px 12px; font-size: 14px;
        background-color: var(--link-color); color: white;
        border: none; border-radius: 5px; cursor: pointer;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
    }
    body.dark-theme #toggle-embed-tx-panel-btn { color: var(--input-text); }
  `;
  document.head.appendChild(style);

  // ---- UI Elements ----
  const embedTxPanel = document.createElement('div');
  embedTxPanel.id = 'embed-tx-main';
  embedTxPanel.style.display = 'none';

  const controlPanel = document.createElement('div');
  controlPanel.id = 'embed-tx-control-panel';
  controlPanel.innerHTML = `
    搜索: <input id="embed-tx-search" placeholder="任意内容" title="可搜索多个关键词，用空格隔开"/>
    <button id="embed-tx-refresh" title="手动刷新交易数据">刷新交易</button>
    <button id="embed-tx-toggle-theme" title="切换主题">切换主题</button>
    <button id="embed-tx-clear-log" title="清空操作日志">清空日志</button>
    <button id="embed-tx-clear-settings" title="清空此模块的本地设置">重置设置</button>
    <span id="embed-tx-last-refresh-time"></span>
  `;
  embedTxPanel.appendChild(controlPanel);

  const columnTogglePanel = document.createElement('div'); columnTogglePanel.id = 'embed-tx-column-toggle-panel';
  embedTxPanel.appendChild(columnTogglePanel);

  const tableContainer = document.createElement('div'); tableContainer.id = 'embed-tx-table-container'; tableContainer.innerHTML = '正在加载交易数据...';
  embedTxPanel.appendChild(tableContainer);

  const logDisplayContainer = document.createElement('div'); logDisplayContainer.id = 'embed-tx-log-container'; logDisplayContainer.innerHTML = '<span class="log-title">操作日志</span>';
  embedTxPanel.appendChild(logDisplayContainer);

  document.body.appendChild(embedTxPanel);

  let toast = document.getElementById('copy-toast');
  if (!toast) { toast = document.createElement('div'); toast.id = 'copy-toast'; document.body.appendChild(toast); }
  let fetchStatusDiv = document.getElementById('gds-fetch-status');
  if (!fetchStatusDiv) { fetchStatusDiv = document.createElement('div'); fetchStatusDiv.id = 'gds-fetch-status'; document.body.appendChild(fetchStatusDiv); }

  const togglePanelBtn = document.createElement('button');
  togglePanelBtn.id = 'toggle-embed-tx-panel-btn';
  togglePanelBtn.textContent = '显示交易面板';
  togglePanelBtn.addEventListener('click', () => {
    const isHidden = embedTxPanel.style.display === 'none';
    embedTxPanel.style.display = isHidden ? 'flex' : 'none';
    togglePanelBtn.textContent = isHidden ? '隐藏交易面板' : '显示交易面板';
    if (isHidden && isInitialLoad) { fetchTransactionData(true); isInitialLoad = false; }
  });
  document.body.appendChild(togglePanelBtn);


  // ---- Column Configuration ----
  const columnConfig = [
    { id: 'merchant', label: '商户', sortable: true, hideable: true, defaultVisible: true, dataKey: 'merchant', cssClass: 'col-merchant' },
    { id: 'recipientName', label: 'Name', sortable: true, hideable: true, defaultVisible: true, dataKey: 'recipientName', cssClass: 'col-recipient-name' },
    { id: 'recipientBank', label: 'Bank', sortable: true, hideable: true, defaultVisible: true, dataKey: 'recipientBank', cssClass: 'col-recipient-bank' },
    { id: 'recipientAccNo', label: 'Acc No', sortable: true, hideable: false, defaultVisible: true, dataKey: 'recipientAccNo', cssClass: 'col-recipient-acc-no' },
    { id: 'recipientIFSC', label: 'IFSC', sortable: true, hideable: true, defaultVisible: true, dataKey: 'recipientIFSC', cssClass: 'col-recipient-ifsc' },
    { id: 'txAmount', label: '金额', sortable: true, hideable: false, defaultVisible: true, dataKey: 'txAmount', cssClass: 'col-tx-amount' },
    { id: 'payoutAccountSelector', label: '可选打款账户', sortable: false, hideable: false, defaultVisible: true, cssClass: 'col-payout-account-selector' },
    { id: 'payoutAccountBalance', label: '当前账户金额', sortable: false, hideable: false, defaultVisible: true, cssClass: 'col-payout-account-balance' },
    { id: 'payeeSelector', label: '受益人', sortable: false, hideable: false, defaultVisible: true, cssClass: 'col-payee-selector' },
    { id: 'payoutAccountLastUpdate', label: '更新时间', sortable: false, hideable: true, defaultVisible: true, cssClass: 'col-payout-account-last-update' },
    { id: 'transferAmountInput', label: '打款金额', sortable: false, hideable: false, defaultVisible: true, cssClass: 'col-transfer-amount-input' },
    { id: 'transferModeSelector', label: '转账模式', sortable: false, hideable: false, defaultVisible: true, cssClass: 'col-transfer-mode-selector' },
    { id: 'actions', label: '操作', sortable: false, hideable: false, defaultVisible: true, cssClass: 'col-actions' },
  ];

  // ---- Helper Functions ----
  function escapeHtml(str, forAttribute = false) { if (typeof str !== 'string') return str === null || str === undefined ? '' : String(str); let result = str.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>'); if (forAttribute) result = result.replace(/"/g, '"'); return result; }
  function showToast(text, event, duration = 1200) {
    const x = event ? event.clientX + 10 : window.innerWidth / 2;
    const y = event ? event.clientY + 10 : window.innerHeight / 2;
    toast.innerText = text;
    toast.style.left = `${x}px`;
    toast.style.top = `${y}px`;
    toast.style.transform = 'translate(-50%, -50%)';
    if (!event) toast.style.transform = 'translate(-50%, -50%)'; else toast.style.transform = '';

    toast.style.opacity = '1';
    if (toast.timeoutId) clearTimeout(toast.timeoutId);
    toast.timeoutId = setTimeout(() => toast.style.opacity = '0', duration);
  }
  function copyToClipboard(text, event) {
      const displayTxt = text.length > 30 ? text.substring(0,27)+'...' : text;
      navigator.clipboard.writeText(text).then(() => {
          showToast(`已复制: ${displayTxt}`, event);
      }).catch(() => {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'absolute'; ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          try {
              document.execCommand('copy');
              showToast(`已复制: ${displayTxt}`, event);
          } catch (err) {
              showToast('复制失败', event);
          }
          document.body.removeChild(ta);
      });
  }
  function showFetchStatus(message, type = 'info', duration = 3000) { fetchStatusDiv.textContent = message; fetchStatusDiv.className = ''; fetchStatusDiv.classList.add(type); fetchStatusDiv.style.display = 'block'; if (fetchStatusDiv.timer) clearTimeout(fetchStatusDiv.timer); if (duration > 0) { fetchStatusDiv.timer = setTimeout(() => { fetchStatusDiv.style.display = 'none'; }, duration); } }
  function formatAmount(amount) { const num = parseFloat(amount); if (isNaN(num)) return String(amount); return num.toFixed(2).replace(/\.00$/, ''); }
  function formatDateTime(dateInput = new Date()) { const date = (dateInput instanceof Date) ? dateInput : new Date(dateInput); if (isNaN(date.getTime())) return 'Invalid Date'; const YYYY = date.getFullYear(); const MM = String(date.getMonth() + 1).padStart(2, '0'); const DD = String(date.getDate()).padStart(2, '0'); const HH = String(date.getHours()).padStart(2, '0'); const MIN = String(date.getMinutes()).padStart(2, '0'); const SS = String(date.getSeconds()).padStart(2, '0'); return `${YYYY}-${MM}-${DD} ${HH}:${MIN}:${SS}`; }
  function addLogEntry(logEntry) { logEntry.time = formatDateTime(new Date()); operationLogs.unshift(logEntry); if (operationLogs.length > MAX_LOG_ENTRIES) operationLogs.pop(); localStorage.setItem(KEY_TRANSACTION_LOGS, JSON.stringify(operationLogs)); renderLogs(); }
  function renderLogs() { logDisplayContainer.innerHTML = '<span class="log-title">操作日志</span>'; operationLogs.forEach(log => { const entryDiv = document.createElement('div'); entryDiv.className = 'log-entry'; let html = `<span class="log-time">[${escapeHtml(log.time)}]</span> `; html += log.message; entryDiv.innerHTML = html; logDisplayContainer.appendChild(entryDiv); }); }
  function applyTheme(theme) { document.body.classList.remove('light-theme', 'dark-theme'); document.body.classList.add(theme + '-theme'); currentTheme = theme; localStorage.setItem(KEY_THEME_PREFERENCE, theme); const themeButton = document.getElementById('embed-tx-toggle-theme'); if (themeButton) { themeButton.textContent = theme === 'dark' ? '浅色主题' : '深色主题'; } }
  function toggleTheme() { const newTheme = currentTheme === 'light' ? 'dark' : 'light'; applyTheme(newTheme); }
  function loadThemePreference() { const preferredTheme = localStorage.getItem(KEY_THEME_PREFERENCE) || 'light'; applyTheme(preferredTheme); }
  function loadColumnVisibility() { const storedVisibility = JSON.parse(localStorage.getItem(KEY_COLUMN_VISIBILITY_EMBED_TX) || '{}'); columnConfig.forEach(col => { columnVisibility[col.id] = storedVisibility[col.id] !== undefined ? storedVisibility[col.id] : col.defaultVisible; }); }
  function saveColumnVisibility() { localStorage.setItem(KEY_COLUMN_VISIBILITY_EMBED_TX, JSON.stringify(columnVisibility)); }
  function loadSortConfig() { const storedSortConfig = JSON.parse(localStorage.getItem(KEY_SORT_CONFIG_EMBED_TX) || '{}'); if (storedSortConfig.key && storedSortConfig.direction) { sortConfig = storedSortConfig; } else { sortConfig = { key: null, direction: 'asc' }; } }
  function saveSortConfig() { localStorage.setItem(KEY_SORT_CONFIG_EMBED_TX, JSON.stringify(sortConfig)); }
  function loadGdsAccountCache() {
    const rawCache = localStorage.getItem(KEY_GDS_ACCOUNT_CACHE);
    if (rawCache) {
        try {
            const parsedCache = JSON.parse(rawCache);
            Object.keys(parsedCache).forEach(key => {
                if (parsedCache[key] && !parsedCache[key].current) { parsedCache[key] = { current: parsedCache[key] }; }
                if (parsedCache[key] && parsedCache[key].current && parsedCache[key].current.id === undefined) { parsedCache[key].current.id = key; }
            });
            gdsAccountDataCache = parsedCache;
        } catch (e) { console.error('Error parsing GDS Account Cache:', e); gdsAccountDataCache = {}; }
    } else { gdsAccountDataCache = {}; console.warn('GDS Account Cache not found in localStorage.'); }
  }
  function loadPayoutThrottleTimestamps() {
    payoutThrottleTimestamps = JSON.parse(localStorage.getItem(KEY_PAYOUT_THROTTLE_TIMESTAMPS) || '{}');
    const now = Date.now();
    Object.keys(payoutThrottleTimestamps).forEach(entryId => {
        if (now - payoutThrottleTimestamps[entryId] > PAYOUT_THROTTLE_DURATION_MS + 5000) {
            delete payoutThrottleTimestamps[entryId];
        }
    });
    localStorage.setItem(KEY_PAYOUT_THROTTLE_TIMESTAMPS, JSON.stringify(payoutThrottleTimestamps));
  }
  function setPayoutThrottle(entryId) {
    payoutThrottleTimestamps[entryId] = Date.now();
    localStorage.setItem(KEY_PAYOUT_THROTTLE_TIMESTAMPS, JSON.stringify(payoutThrottleTimestamps));
  }
  function isPayoutThrottled(entryId) {
    const lastPayoutTime = payoutThrottleTimestamps[entryId];
    if (!lastPayoutTime) return false;
    return (Date.now() - lastPayoutTime) < PAYOUT_THROTTLE_DURATION_MS;
  }

  function parseBankColumnForAccountNames(bankString) {
    if (!bankString || typeof bankString !== 'string') return [];
    let cleanedString = bankString.replace(/\ball\b/gi, '').trim();
    if (!cleanedString) return [];
    const potentialNames = cleanedString.split(/[\s,\/]+/).filter(Boolean);
    return potentialNames.map(name => name.trim().toUpperCase()).filter(Boolean);
  }


  async function fetchTransactionData(isInitialFetch = false) {
    const lastRefreshTimeEl = document.getElementById('embed-tx-last-refresh-time');
    const fetchAttemptTime = new Date();

    if (lastRefreshTimeEl && !isInitialFetch) {
        lastRefreshTimeEl.innerText = `正在刷新... (${formatDateTime(fetchAttemptTime)})`;
        lastRefreshTimeEl.classList.remove('error');
    }
    showFetchStatus('正在从本地服务器获取交易数据...', 'info', 0);

    GM_xmlhttpRequest({
        method: 'GET',
        url: TRANSACTION_DATA_URL,
        headers: { "Accept": "text/html", "Cache-Control": "no-cache", "Pragma": "no-cache" },
        onload: function(response) {
            if (response.status >= 200 && response.status < 300) {
                const htmlText = response.responseText;
                const parser = new DOMParser();
                const doc = parser.parseFromString(htmlText, 'text/html');
                const rows = doc.querySelectorAll('table tbody tr');
                const newTransactionData = [];
                let hasChanged = false;

                rows.forEach(row => {
                    const cells = row.querySelectorAll('td');
                    if (cells.length >= 7) {
                        const entryId = row.dataset.entryId || `gen_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                        const transaction = {
                            entryId: entryId,
                            merchant: cells[0].textContent.trim(),
                            recipientName: cells[1].textContent.trim(),
                            recipientBank: cells[2].textContent.trim(),
                            recipientAccNo: cells[3].textContent.trim(),
                            recipientIFSC: cells[4].textContent.trim(),
                            txAmount: parseFloat(cells[6].textContent.trim().replace(/,/g, '')) || 0,
                            selectedPayoutAccountId: null, payoutAccountBalance: null, payoutAccountLastUpdate: null,
                            availablePayees: [], selectedPayeeId: null,
                            transferAmount: null, selectedTransferMode: DEFAULT_GDS_TRANSFER_MODE
                        };
                        const existingTx = transactionDataCache.find(t => t.entryId === transaction.entryId);
                        if (existingTx) {
                            transaction.selectedPayoutAccountId = existingTx.selectedPayoutAccountId;
                            transaction.payoutAccountBalance = existingTx.payoutAccountBalance;
                            transaction.payoutAccountLastUpdate = existingTx.payoutAccountLastUpdate;
                            transaction.availablePayees = existingTx.availablePayees || [];
                            transaction.selectedPayeeId = existingTx.selectedPayeeId;
                            transaction.transferAmount = existingTx.transferAmount;
                            transaction.selectedTransferMode = existingTx.selectedTransferMode;
                            if (transaction.selectedPayoutAccountId && gdsAccountDataCache[transaction.selectedPayoutAccountId]?.current) {
                                const gdsAcc = gdsAccountDataCache[transaction.selectedPayoutAccountId].current;
                                transaction.payoutAccountBalance = parseFloat(gdsAcc.balance);
                                transaction.payoutAccountLastUpdate = gdsAcc.lastChangeTime ? new Date(gdsAcc.lastChangeTime.replace(/-/g, '/')).getTime() : Date.now();
                            }
                        }
                        newTransactionData.push(transaction);
                    }
                });

                if (JSON.stringify(newTransactionData.map(tx => ({...tx, availablePayees: []}))) !== JSON.stringify(transactionDataCache.map(tx => ({...tx, availablePayees: []})))) {
                    hasChanged = true;
                }
                transactionDataCache = newTransactionData;

                if (lastRefreshTimeEl) {
                    lastRefreshTimeEl.innerText = `数据更新于: ${formatDateTime(fetchAttemptTime)}`;
                    lastRefreshTimeEl.classList.remove('error');
                }
                lastSuccessfulDataTimestamp = fetchAttemptTime;
                localStorage.setItem(KEY_LAST_SUCCESSFUL_REFRESH_EMBED_TX, lastSuccessfulDataTimestamp.toISOString());
                showFetchStatus(`成功获取 ${transactionDataCache.length} 条交易数据` + (hasChanged ? " (内容有变)" : ""), 'success', 2000);

                if (hasChanged || isInitialFetch) {
                    renderTable();
                    if (isInitialFetch) {
                        transactionDataCache.forEach(tx => {
                            if (tx.selectedPayoutAccountId && tx.recipientAccNo) {
                                fetchPayeesForRow(tx.entryId, tx.recipientAccNo);
                            }
                        });
                    }
                } else {
                    const tableRows = tableContainer.querySelectorAll('tbody tr');
                    tableRows.forEach(tableRow => {
                        const entryId = tableRow.dataset.entryId;
                        const txEntry = transactionDataCache.find(tx => tx.entryId === entryId);
                        if (txEntry && txEntry.selectedPayoutAccountId) {
                            updateRowState(tableRow, txEntry);
                        }
                    });
                }
            } else {
                 if (lastRefreshTimeEl) {
                    lastRefreshTimeEl.innerText = `数据刷新失败 (${formatDateTime(fetchAttemptTime)}) - ${response.status}`;
                    lastRefreshTimeEl.classList.add('error');
                }
                showFetchStatus(`获取交易数据失败: ${response.status}`, 'error', 5000);
            }
        },
        onerror: function(response) {
            if (lastRefreshTimeEl) {
                lastRefreshTimeEl.innerText = `数据刷新失败 (${formatDateTime(fetchAttemptTime)}) - 网络错误`;
                lastRefreshTimeEl.classList.add('error');
            }
            showFetchStatus('获取交易数据网络错误', 'error', 5000);
        }
    });
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
        if (!columnVisibility[col.id] && col.hideable) thClass += ' embed-tx-col-hidden';
        if (col.sortable) thClass += ' sortable';

        let sortIndicator = '';
        if (col.sortable && sortConfig.key === col.id) {
            sortIndicator = sortConfig.direction === 'asc' ? ' ▲' : ' ▼';
        }
        headerHtml += `<th class="${thClass}" data-col-id="${col.id}" title="${escapeHtml(col.label, true)} ${col.sortable ? '(可排序)' : ''}">${escapeHtml(col.label)}${sortIndicator}</th>`;
    });
    headerHtml += '</tr></thead>';

    const searchTerm = document.getElementById('embed-tx-search').value.toLowerCase().trim();
    const searchKeywords = searchTerm ? searchTerm.split(/\s+/).filter(k => k) : [];

    let displayData = [...transactionDataCache];

    if (searchKeywords.length > 0) {
        displayData = displayData.filter(tx => {
            const searchableText = `${tx.merchant} ${tx.recipientName} ${tx.recipientBank} ${tx.recipientAccNo} ${tx.recipientIFSC} ${tx.txAmount}`.toLowerCase();
            return searchKeywords.every(keyword => searchableText.includes(keyword));
        });
    }

    if (sortConfig.key) {
        const sortCol = columnConfig.find(c => c.id === sortConfig.key);
        if (sortCol && sortCol.dataKey && sortCol.sortable) {
            displayData.sort((a, b) => {
                let valA = a[sortCol.dataKey];
                let valB = b[sortCol.dataKey];
                if (typeof valA === 'string' && typeof valB === 'string') {
                     valA = valA.toLowerCase(); valB = valB.toLowerCase();
                } else if (typeof valA === 'number' && typeof valB === 'number') {}
                else { valA = String(valA).toLowerCase(); valB = String(valB).toLowerCase(); }
                if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
                if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
                if (a.entryId < b.entryId) return -1;
                if (a.entryId > b.entryId) return 1;
                return 0;
            });
        }
    }

    let bodyHtml = '<tbody>';
    displayData.forEach(tx => {
        let rowHtml = `<tr data-entry-id="${escapeHtml(tx.entryId)}">`;
        const potentialBankAccountNames = parseBankColumnForAccountNames(tx.recipientBank);
        const matchingGdsAccounts = Object.values(gdsAccountDataCache)
            .filter(gdsAcc => gdsAcc && gdsAcc.current && gdsAcc.current.accountName &&
                            potentialBankAccountNames.includes(gdsAcc.current.accountName.toUpperCase()))
            .map(gdsAcc => gdsAcc.current);

        columnConfig.forEach(col => {
            let cellClass = col.cssClass || '';
            if (!columnVisibility[col.id] && col.hideable) cellClass += ' embed-tx-col-hidden';
            let cellContent = '';
            switch (col.id) {
                case 'merchant': cellContent = escapeHtml(tx.merchant); break;
                case 'recipientName': cellContent = escapeHtml(tx.recipientName); break;
                case 'recipientBank': cellContent = escapeHtml(tx.recipientBank); break;
                case 'recipientAccNo': cellContent = escapeHtml(tx.recipientAccNo); break;
                case 'recipientIFSC': cellContent = escapeHtml(tx.recipientIFSC); break;
                case 'txAmount': cellContent = formatAmount(tx.txAmount); break;
                case 'payoutAccountSelector':
                    let payoutAccOptionsHtml = '<option value="">--选择账户--</option>';
                    if (matchingGdsAccounts.length > 0) {
                        matchingGdsAccounts.sort((a,b) => a.accountName.localeCompare(b.accountName));
                        matchingGdsAccounts.forEach(gdsAcc => {
                            const accountId = gdsAcc.id || Object.keys(gdsAccountDataCache).find(key => gdsAccountDataCache[key].current === gdsAcc);
                            payoutAccOptionsHtml += `<option value="${escapeHtml(accountId)}" ${tx.selectedPayoutAccountId === accountId ? 'selected' : ''}>${escapeHtml(gdsAcc.accountName)}</option>`;
                        });
                    } else { payoutAccOptionsHtml += '<option value="" disabled>无匹配账户</option>'; }
                    cellContent = `<select data-type="payout-account-selector">${payoutAccOptionsHtml}</select>`;
                    break;
                case 'payoutAccountBalance': cellContent = tx.payoutAccountBalance !== null ? formatAmount(tx.payoutAccountBalance) : 'N/A'; break;
                case 'payeeSelector':
                    let payeeOptionsHtml = '<option value="">--选择受益人--</option>';
                    if (tx.availablePayees && tx.availablePayees.length > 0) {
                         tx.availablePayees.forEach(payee => {
                            payeeOptionsHtml += `<option value="${escapeHtml(payee.payeeId)}" ${tx.selectedPayeeId == payee.payeeId ? 'selected' : ''}>${escapeHtml(payee.name)}</option>`;
                        });
                    } else if (tx.selectedPayoutAccountId) {
                        payeeOptionsHtml += '<option value="" disabled>正在加载或无受益人...</option>';
                    } else {
                        payeeOptionsHtml += '<option value="" disabled>先选打款账户</option>';
                    }
                    cellContent = `<select data-type="payee-selector">${payeeOptionsHtml}</select>`;
                    break;
                case 'payoutAccountLastUpdate': cellContent = tx.payoutAccountLastUpdate ? formatDateTime(new Date(tx.payoutAccountLastUpdate)) : 'N/A'; break;
                case 'transferAmountInput': cellContent = `<input type="number" placeholder="金额" value="${tx.transferAmount !== null ? tx.transferAmount : ''}" data-type="transfer-amount-input" min="0">`; break;
                case 'transferModeSelector':
                    let modeOptionsHtml = GDS_TRANSFER_MODES.map(mode => `<option value="${mode.value}" ${tx.selectedTransferMode == mode.value ? 'selected' : ''}>${escapeHtml(mode.name)}</option>`).join('');
                    cellContent = `<select data-type="transfer-mode-selector">${modeOptionsHtml}</select>`;
                    break;
                case 'actions':
                    const payoutAccountSelected = tx.selectedPayoutAccountId && gdsAccountDataCache[tx.selectedPayoutAccountId];
                    const payeeSelected = tx.selectedPayeeId !== null;
                    const transferAmountValid = tx.transferAmount !== null && tx.transferAmount > 0 && payoutAccountSelected && tx.transferAmount <= tx.payoutAccountBalance;
                    const throttled = isPayoutThrottled(tx.entryId);
                    cellContent = `<button class="action-button payout-action-button" data-type="payout-button" ${!(payoutAccountSelected && payeeSelected && transferAmountValid && !throttled) ? 'disabled' : ''}>${throttled ? '冷却中' : '打款'}</button>`;
                    break;
                default: cellContent = `N/A (${col.id})`;
            }
            rowHtml += `<td class="${cellClass}">${cellContent}</td>`;
        });
        rowHtml += `</tr>`;
        bodyHtml += rowHtml;
    });
    bodyHtml += `</tbody>`;
    tableContainer.innerHTML = `<table>${headerHtml}${bodyHtml}</table>`;

    const table = tableContainer.querySelector('table');
    if (table) {
        const thead = table.querySelector('thead');
        if (thead) { thead.removeEventListener('click', handleHeaderClick); thead.addEventListener('click', handleHeaderClick); }
        table.removeEventListener('contextmenu', handleTableRightClick);
        table.addEventListener('contextmenu', handleTableRightClick);

        table.querySelectorAll('[data-type="payout-account-selector"]').forEach(sel => sel.addEventListener('change', handlePayoutAccountChange));
        table.querySelectorAll('[data-type="payee-selector"]').forEach(sel => sel.addEventListener('change', handlePayeeChange));
        table.querySelectorAll('[data-type="transfer-amount-input"]').forEach(inp => inp.addEventListener('input', handleTransferAmountChange));
        table.querySelectorAll('[data-type="transfer-mode-selector"]').forEach(sel => sel.addEventListener('change', handleTransferModeChange));
        table.querySelectorAll('[data-type="payout-button"]').forEach(btn => btn.addEventListener('click', handlePayoutButtonClick));
    }
  }

  function handleTableRightClick(event) {
    const td = event.target.closest('td');
    if (td) {
        event.preventDefault();
        const text = td.innerText.trim();
        if (text) {
            copyToClipboard(text, event);
        }
    }
  }


  function updateRowState(rowElement, txEntry) {
    if (!rowElement || !txEntry) return;
    const balanceCell = rowElement.querySelector('.col-payout-account-balance');
    const lastUpdateCell = rowElement.querySelector('.col-payout-account-last-update');
    const payoutButton = rowElement.querySelector('[data-type="payout-button"]');
    const payoutAccountSelectorEl = rowElement.querySelector('[data-type="payout-account-selector"]');
    const payeeSelectorEl = rowElement.querySelector('[data-type="payee-selector"]');


    if (balanceCell) balanceCell.textContent = txEntry.payoutAccountBalance !== null ? formatAmount(txEntry.payoutAccountBalance) : 'N/A';
    if (lastUpdateCell) lastUpdateCell.textContent = txEntry.payoutAccountLastUpdate ? formatDateTime(new Date(txEntry.payoutAccountLastUpdate)) : 'N/A';

    if(payoutAccountSelectorEl && txEntry.selectedPayoutAccountId) {
        const selectedOption = payoutAccountSelectorEl.querySelector(`option[value="${txEntry.selectedPayoutAccountId}"]`);
        if(selectedOption && gdsAccountDataCache[txEntry.selectedPayoutAccountId]?.current) {
             const gdsAccCurrent = gdsAccountDataCache[txEntry.selectedPayoutAccountId].current;
             selectedOption.textContent = `${escapeHtml(gdsAccCurrent.accountName)}`;
        }
    }
    if (payeeSelectorEl) {
        let payeeOptionsHtml = '<option value="">--选择受益人--</option>';
        if (txEntry.availablePayees && txEntry.availablePayees.length > 0) {
            txEntry.availablePayees.forEach(payee => {
                payeeOptionsHtml += `<option value="${escapeHtml(payee.payeeId)}" ${txEntry.selectedPayeeId == payee.payeeId ? 'selected' : ''}>${escapeHtml(payee.name)}</option>`;
            });
        } else if (txEntry.selectedPayoutAccountId && txEntry.recipientAccNo) {
             payeeOptionsHtml += '<option value="" disabled>正在加载或无受益人...</option>';
        } else {
             payeeOptionsHtml += '<option value="" disabled>先选打款账户</option>';
        }
        payeeSelectorEl.innerHTML = payeeOptionsHtml;
        if (txEntry.selectedPayeeId !== null) {
            payeeSelectorEl.value = txEntry.selectedPayeeId;
        } else {
            payeeSelectorEl.value = "";
        }
    }


    if (payoutButton) {
        const payoutAccountSelected = txEntry.selectedPayoutAccountId && gdsAccountDataCache[txEntry.selectedPayoutAccountId];
        const payeeSelected = txEntry.selectedPayeeId !== null;
        const transferAmountEntered = txEntry.transferAmount !== null && parseFloat(txEntry.transferAmount) > 0;
        const balanceSufficient = payoutAccountSelected && transferAmountEntered && parseFloat(txEntry.transferAmount) <= txEntry.payoutAccountBalance;
        const throttled = isPayoutThrottled(txEntry.entryId);
        payoutButton.disabled = !(payoutAccountSelected && payeeSelected && transferAmountEntered && balanceSufficient && !throttled);
        payoutButton.textContent = throttled ? '冷却中' : '打款';
    }
  }

  async function fetchPayeesForRow(entryId, recipientAccNo) {
    const txEntry = transactionDataCache.find(tx => tx.entryId === entryId);
    if (!txEntry || !recipientAccNo) return;

    const token = localStorage.getItem('token');
    if (!token) {
        txEntry.availablePayees = [];
        txEntry.selectedPayeeId = null;
        updateRowState(document.querySelector(`tr[data-entry-id="${entryId}"]`), txEntry);
        return;
    }

    const apiUrl = GDS_PAYEE_LIST_API_URL_TEMPLATE.replace('{ACCOUNT_NO}', encodeURIComponent(recipientAccNo));

    GM_xmlhttpRequest({
        method: "GET",
        url: apiUrl,
        headers: {
            "Accept": "application/json, text/plain, */*",
            "Authorization": token,
            "Cache-Control": "no-cache", "Pragma": "no-cache"
        },
        onload: function(response) {
            try {
                const result = JSON.parse(response.responseText);
                if (result.code === 1 && result.data && Array.isArray(result.data.list)) {
                    txEntry.availablePayees = result.data.list.map(p => ({ payeeId: p.payeeId, name: p.name }));
                    if (txEntry.availablePayees.length === 1) {
                        txEntry.selectedPayeeId = txEntry.availablePayees[0].payeeId;
                    } else {
                        if (txEntry.selectedPayeeId && !txEntry.availablePayees.find(p => p.payeeId == txEntry.selectedPayeeId)) {
                            txEntry.selectedPayeeId = null;
                        }
                    }
                } else {
                    txEntry.availablePayees = [];
                    txEntry.selectedPayeeId = null;
                    addLogEntry({message: `<span class="log-transfer-fail">Entry ${escapeHtml(entryId)}: 获取受益人列表为空或API错误 for Acc ${escapeHtml(recipientAccNo)} - ${escapeHtml(result.msg || 'No list')}</span>`});
                }
            } catch (e) {
                txEntry.availablePayees = [];
                txEntry.selectedPayeeId = null;
                addLogEntry({message: `<span class="log-transfer-fail">Entry ${escapeHtml(entryId)}: 解析受益人响应错误 for Acc ${escapeHtml(recipientAccNo)}</span>`});
            }
            updateRowState(document.querySelector(`tr[data-entry-id="${entryId}"]`), txEntry);
        },
        onerror: function(response) {
            txEntry.availablePayees = [];
            txEntry.selectedPayeeId = null;
            addLogEntry({message: `<span class="log-transfer-fail">Entry ${escapeHtml(entryId)}: 获取受益人网络错误 for Acc ${escapeHtml(recipientAccNo)}</span>`});
            updateRowState(document.querySelector(`tr[data-entry-id="${entryId}"]`), txEntry);
        }
    });
  }

  function handlePayoutAccountChange(event) {
    loadGdsAccountCache();

    const selector = event.target;
    const entryId = selector.closest('tr').dataset.entryId;
    const selectedGdsAccountId = selector.value;
    const txEntry = transactionDataCache.find(tx => tx.entryId === entryId);

    if (txEntry) {
        txEntry.selectedPayoutAccountId = selectedGdsAccountId;
        txEntry.availablePayees = [];
        txEntry.selectedPayeeId = null;

        if (selectedGdsAccountId && gdsAccountDataCache[selectedGdsAccountId]?.current) {
            const gdsAcc = gdsAccountDataCache[selectedGdsAccountId].current;
            txEntry.payoutAccountBalance = parseFloat(gdsAcc.balance);
            txEntry.payoutAccountLastUpdate = gdsAcc.lastChangeTime ? new Date(gdsAcc.lastChangeTime.replace(/-/g, '/')).getTime() : Date.now();
            if (txEntry.recipientAccNo) {
                fetchPayeesForRow(entryId, txEntry.recipientAccNo);
            }
        } else {
            txEntry.payoutAccountBalance = null;
            txEntry.payoutAccountLastUpdate = null;
        }
        updateRowState(selector.closest('tr'), txEntry);
    }
  }

  function handlePayeeChange(event) {
    const selector = event.target;
    const entryId = selector.closest('tr').dataset.entryId;
    const selectedPayeeId = selector.value ? parseInt(selector.value) : null;
    const txEntry = transactionDataCache.find(tx => tx.entryId === entryId);
    if (txEntry) {
        txEntry.selectedPayeeId = selectedPayeeId;
        updateRowState(selector.closest('tr'), txEntry);
    }
  }

  function handleTransferAmountChange(event) {
    const input = event.target;
    const entryId = input.closest('tr').dataset.entryId;
    const txEntry = transactionDataCache.find(tx => tx.entryId === entryId);
    if (txEntry) {
        const amount = parseFloat(input.value);
        txEntry.transferAmount = isNaN(amount) || amount < 0 ? null : parseFloat(amount.toFixed(2));
        updateRowState(input.closest('tr'), txEntry);
    }
  }
  function handleTransferModeChange(event) {
    const selector = event.target;
    const entryId = selector.closest('tr').dataset.entryId;
    const txEntry = transactionDataCache.find(tx => tx.entryId === entryId);
    if (txEntry) txEntry.selectedTransferMode = parseInt(selector.value);
  }
  async function handlePayoutButtonClick(event) {
    const button = event.target;
    const entryId = button.closest('tr').dataset.entryId;
    const txEntry = transactionDataCache.find(tx => tx.entryId === entryId);

    if (!txEntry || !txEntry.selectedPayoutAccountId || txEntry.selectedPayeeId === null || txEntry.transferAmount === null || txEntry.transferAmount <= 0) {
        showToast('请选择打款账户、受益人并输入有效的打款金额', event); return;
    }
    const gdsAccount = gdsAccountDataCache[txEntry.selectedPayoutAccountId]?.current;
    if (!gdsAccount) { showToast('选择的打款账户信息无效', event); return; }
    if (txEntry.transferAmount > txEntry.payoutAccountBalance) {
        showToast('打款金额不能超过当前账户余额', event); return;
    }
    if (isPayoutThrottled(entryId)) { showToast('操作过于频繁，请稍后再试', event); return; }

    const token = localStorage.getItem('token');
    if (!token) { showToast('GDS Token 未找到，无法打款', event); addLogEntry({ message: `<span class="log-transfer-fail">打款失败 (Entry ${escapeHtml(entryId)}): 未找到GDS Token</span>` }); return; }

    button.disabled = true;
    button.textContent = '处理中...';
    showFetchStatus(`正在为 Entry ${entryId} 打款...`, 'info', 0);
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    const payload = {
        tripartiteId: gdsAccount.platform,
        accountName: gdsAccount.accountName,
        payeeId: txEntry.selectedPayeeId,
        amount: Math.floor(txEntry.transferAmount * 100),
        transferMode: txEntry.selectedTransferMode,
        isBulk: false,
        version: Date.now()
    };

    const selectedPayee = txEntry.availablePayees.find(p => p.payeeId == txEntry.selectedPayeeId);
    const selectedPayeeName = selectedPayee ? selectedPayee.name : `PayeeID ${txEntry.selectedPayeeId}`;
    const transferModeName = GDS_TRANSFER_MODES.find(m=>m.value == payload.transferMode)?.name || `Mode ${payload.transferMode}`;

    let logMessageHtml = `<span class="log-transfer-attempt">尝试打款 (Entry ${escapeHtml(entryId)}):<br>`;
    logMessageHtml += `    From Account: ${escapeHtml(gdsAccount.accountName)} (GDS ID: ${escapeHtml(gdsAccount.id)}, Platform ID: ${escapeHtml(payload.tripartiteId)})<br>`;
    logMessageHtml += `    To Payee: ${escapeHtml(selectedPayeeName)} (GDS PayeeID: ${escapeHtml(String(payload.payeeId))})<br>`;
    logMessageHtml += `    Amount: ${formatAmount(txEntry.transferAmount)} (Payload value: ${payload.amount})<br>`;
    logMessageHtml += `    Transfer Mode: ${escapeHtml(transferModeName)} (Payload value: ${payload.transferMode})<br>`;
    logMessageHtml += `    Request ID: ${escapeHtml(requestId)}</span>`;
    addLogEntry({ message: logMessageHtml });

    GM_xmlhttpRequest({
        method: "POST",
        url: GDS_TRANSFER_API_URL,
        headers: { "Accept": "application/json, text/plain, */*", "Authorization": token, "Content-Type": "application/json", "X-Request-ID": requestId },
        data: JSON.stringify(payload),
        onload: function(response) {
            try {
                const result = JSON.parse(response.responseText);
                if (result.code === 1) {
                    showFetchStatus(`Entry ${entryId}: 打款成功!`, 'success', 3000);
                    addLogEntry({ message: `<span class="log-transfer-success">打款成功 (Entry ${escapeHtml(entryId)}): ${escapeHtml(result.msg || '')} (Req ID: ${escapeHtml(requestId)})</span>` });
                    setPayoutThrottle(entryId);
                    loadGdsAccountCache();
                    const updatedGdsAccData = gdsAccountDataCache[gdsAccount.id]?.current;
                    if (updatedGdsAccData) {
                        txEntry.payoutAccountBalance = parseFloat(updatedGdsAccData.balance);
                        txEntry.payoutAccountLastUpdate = updatedGdsAccData.lastChangeTime ? new Date(updatedGdsAccData.lastChangeTime.replace(/-/g, '/')).getTime() : Date.now();
                    }
                    transactionDataCache.forEach(tx => {
                        if (tx.selectedPayoutAccountId === gdsAccount.id && tx.entryId !== entryId) {
                            if (updatedGdsAccData) {
                                tx.payoutAccountBalance = parseFloat(updatedGdsAccData.balance);
                                tx.payoutAccountLastUpdate = updatedGdsAccData.lastChangeTime ? new Date(updatedGdsAccData.lastChangeTime.replace(/-/g, '/')).getTime() : Date.now();
                                const otherRowEl = document.querySelector(`tr[data-entry-id="${tx.entryId}"]`);
                                if (otherRowEl) updateRowState(otherRowEl, tx);
                            }
                        }
                    });
                    updateRowState(button.closest('tr'), txEntry);
                } else {
                    showFetchStatus(`Entry ${entryId}: 打款失败 - ${result.msg || '未知错误'}`, 'error', 5000);
                    addLogEntry({ message: `<span class="log-transfer-fail">打款失败 (Entry ${escapeHtml(entryId)}): ${escapeHtml(result.msg || '未知错误')} (Req ID: ${escapeHtml(requestId)})</span>` });
                    button.disabled = false;
                    button.textContent = '打款';
                }
            } catch (e) {
                showFetchStatus(`Entry ${entryId}: 打款响应解析错误`, 'error', 5000);
                addLogEntry({ message: `<span class="log-transfer-fail">打款响应解析错误 (Entry ${escapeHtml(entryId)}): ${escapeHtml(e.message)} (Req ID: ${escapeHtml(requestId)})</span>` });
                button.disabled = false;
                button.textContent = '打款';
            }
        },
        onerror: function(response) {
            button.disabled = false;
            button.textContent = '打款';
            addLogEntry({ message: `<span class="log-transfer-fail">打款请求网络错误 (Entry ${escapeHtml(entryId)}). Req ID: ${escapeHtml(requestId)}</span>` });
            showFetchStatus(`Entry ${entryId}: 打款请求网络错误`, 'error', 5000);
        }
    });
  }

  function init() {
    console.log('GDS 交易列表集成版 (v1.3.0) 启动...');
    loadThemePreference();
    loadGdsAccountCache();
    loadPayoutThrottleTimestamps();
    operationLogs = JSON.parse(localStorage.getItem(KEY_TRANSACTION_LOGS) || '[]');
    renderLogs();

    const storedTimestamp = localStorage.getItem(KEY_LAST_SUCCESSFUL_REFRESH_EMBED_TX);
    if (storedTimestamp) {
        lastSuccessfulDataTimestamp = new Date(storedTimestamp);
        const lastRefreshTimeEl = document.getElementById('embed-tx-last-refresh-time');
        if(lastRefreshTimeEl) lastRefreshTimeEl.innerText = `上次成功更新: ${formatDateTime(lastSuccessfulDataTimestamp)}`;
    }

    loadColumnVisibility();
    loadSortConfig();
    renderColumnTogglePanel();

    if (refreshIntervalId) clearInterval(refreshIntervalId);
    refreshIntervalId = setInterval(() => {
        if (embedTxPanel.style.display !== 'none') {
            fetchTransactionData();
            const tableRows = tableContainer.querySelectorAll('tbody tr');
            tableRows.forEach(tableRow => {
                const entryId = tableRow.dataset.entryId;
                const txEntry = transactionDataCache.find(tx => tx.entryId === entryId);
                if (txEntry) updateRowState(tableRow, txEntry);
            });
        }
    }, REFRESH_INTERVAL_MS);

    document.getElementById('embed-tx-search').addEventListener('input', renderTable);
    document.getElementById('embed-tx-refresh').addEventListener('click', () => { loadGdsAccountCache(); fetchTransactionData(true); });
    document.getElementById('embed-tx-toggle-theme').addEventListener('click', toggleTheme);
    document.getElementById('embed-tx-clear-log').addEventListener('click', (event) => { if (confirm('确定要清空操作日志吗？')) { operationLogs = []; localStorage.removeItem(KEY_TRANSACTION_LOGS); renderLogs(); showToast('操作日志已清空', event); } });
    document.getElementById('embed-tx-clear-settings').addEventListener('click', (event) => {
        if (confirm('警告：这将清空此内嵌模块的本地设置（列、排序、日志、打款节流状态）！\nGDS账户缓存和全局主题不会被清除。\n确定要重置吗？')) {
            localStorage.removeItem(KEY_TRANSACTION_LOGS); localStorage.removeItem(KEY_COLUMN_VISIBILITY_EMBED_TX); localStorage.removeItem(KEY_SORT_CONFIG_EMBED_TX); localStorage.removeItem(KEY_LAST_SUCCESSFUL_REFRESH_EMBED_TX); localStorage.removeItem(KEY_PAYOUT_THROTTLE_TIMESTAMPS);
            operationLogs = []; sortConfig = { key: null, direction: 'asc' }; lastSuccessfulDataTimestamp = null; payoutThrottleTimestamps = {};
            const lastRefreshTimeEl = document.getElementById('embed-tx-last-refresh-time');
            if(lastRefreshTimeEl) { lastRefreshTimeEl.innerText = '数据未加载'; lastRefreshTimeEl.classList.remove('error'); }
            loadColumnVisibility(); renderColumnTogglePanel(); renderLogs();
            if (embedTxPanel.style.display !== 'none') { transactionDataCache=[]; renderTable(); fetchTransactionData(true); } else { transactionDataCache=[]; renderTable(); }
            showToast('内嵌模块设置已重置!', event);
        }
    });
    columnTogglePanel.addEventListener('change', handleColumnToggle);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    window.addEventListener('DOMContentLoaded', init);
  }
  window.addEventListener('beforeunload', () => { if (refreshIntervalId) clearInterval(refreshIntervalId); });

})();