// ==UserScript==
// @name         GDS 账户信息增强版 (v3.2.88-refactored - 模块化与无感刷新)
// @namespace    http://tampermonkey.net/
// @version      3.2.88
// @description  [v3.2.88-refactored]: 基于 v3.2.87-mod10 重构。代码采用单文件模块化，提升可维护性；实现增量更新逻辑，在数据无变化时不重绘表格，实现“无感刷新”，优化性能。
// @match        https://admin.gdspay.xyz/99*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      gist.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/lkm888/tampermonkey/main/GDS_Account_Enhancer.user.js
// @downloadURL  https://raw.githubusercontent.com/lkm888/tampermonkey/main/GDS_Account_Enhancer.user.js
// ==/UserScript==

(async function() {
    'use strict';

    /**
     * =================================================================
     * 模块化结构：
     * - Config:     所有常量和配置
     * - State:      所有可变的全局状态
     * - Utils:      通用辅助函数 (格式化、复制等)
     * - DB:         IndexedDB 数据库操作模块
     * - UI:         所有DOM操作、渲染和事件绑定
     * - API:        所有API请求、Token刷新和核心数据获取逻辑
     * - Automation: 所有自动化任务 (划转、止收)
     * - App:        主应用程序，负责初始化和启动
     * =================================================================
     */

    // --- [模块] Config: 常量与配置 ---
    const Config = {
        KEYS: {
            RELOAD_DELAY: 'gds_pending_reload_delay_after_401_v3.2',
            ACCOUNT_CACHE: 'gds_account_data_cache_idb_v3.2',
            ACCOUNT_ORDER: 'gds_account_order_idb_v3.2',
            THEME_PREF: 'gds_theme_preference_v3.1.7',
            COLUMN_VIS: 'gds_column_visibility_v3.1.8',
            SORT_CONF: 'gds_sort_config_v3.1.8',
            LAST_REFRESH: 'gds_last_successful_refresh_v3.1.8.1',
            LOGS_VISIBLE: 'gds_logs_visibility_v3.2.87.6'
        },
        RELOAD_DELAY_MS: 5000,
        RELOAD_FLAG_GRACE_MS: 10000,
        REFRESH_INTERVAL_MS: 7000,
        TOKEN_REFRESH_DELAY_MS: 3000,
        API_STATUS: { ENABLED: 1, CUSTOM_STOP: 2, STOP_RECEIPT: 3, DISAPPEARED: -1 },
        DB_NAME: 'GDS_EnhancedScriptDB',
        DB_VERSION: 3,
        STORES: { ACC_DATA: 'accountData', ACC_ORDER: 'accountOrder', OP_LOGS: 'operationLogs', FROZEN_LOGS: 'frozenLogs', SETTINGS: 'settings' },
        MAX_LOG_DB: 400000, MAX_FROZEN_LOG_DB: 2500,
        MAX_LOG_MEM: 2000, MAX_FROZEN_LOG_MEM: 200,
        MAX_BAL_HISTORY: 40,
        PAYEE_OPTS: [ { name: '承兑KVB', payeeId: 110 }, { name: '承兑YES', payeeId: 804 }, { name: 'ABC代付', payeeId: 1162}, { name: 'NAMA2', payeeId: 2656}, { name: 'CRYSTAL IMPEX', payeeId: 2660}, { name: 'KortyaPay代付', payeeId: 2574}, { name: 'ISK', payeeId: 565} ],
        TRANSFER_MODE_OPTS: [ { name: 'IMPS', transferMode: 1 }, { name: 'NEFT', transferMode: 2 }, { name: 'RTGS', transferMode: 3 }, ],
        TRANSFER_PERCENT_OPTS: [ { name: '40%', value: 0.40 },{ name: '60%', value: 0.60 },{ name: '80%', value: 0.80 }, { name: '90%', value: 0.90 }, { name: '95%', value: 0.95 }, { name: '98%', value: 0.98 }, { name: '100%', value: 1.00 } ],
        DEFAULT_TRIGGER_AMT: 500000,
        DEFAULT_TRANSFER_MODE: 3,
        DEFAULT_TRANSFER_PERCENT: 0.98,
        DEFAULT_AUTO_STOP_AMT: 200000,
        THROTTLES: { AUTO_TX_SUCCESS: 120 * 1000, AUTO_TX_GLOBAL_CHECK: 2000, AUTO_TX_ATTEMPT: 60 * 1000, AUTO_STOP_ATTEMPT: 30 * 1000, AUTO_RE_ENABLE_ATTEMPT: 30 * 1000, AUTO_TX_FAIL: 30 * 1000 },
        RANDOM_TRANSFER_MIN_FACTOR: 0.95,
        RANDOM_TRANSFER_MAX_FACTOR: 0.99,
        COLUMN_CONFIG: [
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
        ]
    };

    // --- [模块] State: 全局状态 ---
    const State = {
        accountDataCache: {},
        accountOrder: [],
        operationLogs: [],
        frozenBalanceIncreaseLogs: [],
        currentTheme: 'light',
        columnVisibility: {},
        sortConfig: { key: 'id', direction: 'asc' },
        lastSuccessfulDataTimestamp: null,
        lastAutoTransferCheckInitiatedTime: 0,
        token: null,
        refreshToken: null,
        isRefreshingToken: false,
        refreshPromise: null,
        areLogsVisible: true,
        isFetchingData: false,
    };

    // --- [模块] Utils: 通用辅助函数 ---
    const Utils = {
        esc: str => (typeof str !== 'string' ? (str === null || str === undefined ? '' : String(str)) : document.createElement('div').appendChild(document.createTextNode(str)).parentNode.innerHTML),
        fmtAmt: amt => isNaN(parseFloat(amt)) ? String(amt) : parseFloat(amt).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        fmtCurrencyInt: amt => isNaN(parseFloat(amt)) ? String(amt) : Math.round(parseFloat(amt)).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
        fmtApiStatus: s => { switch (parseInt(s)) { case Config.API_STATUS.ENABLED: return { text: '启用', class: 'status-enabled' }; case Config.API_STATUS.STOP_RECEIPT: return { text: '止收', class: 'status-api-stopped' }; case Config.API_STATUS.CUSTOM_STOP: return { text: '停止', class: 'status-api-custom-stop' }; case Config.API_STATUS.DISAPPEARED: return { text: '已消失', class: 'status-disappeared' }; default: return { text: `未知-${s}`, class: 'status-unknown' }; } },
        fmtLoginStatus: s => { switch (parseInt(s)) { case 0: return { text: '未登录', class: 'login-status-logged-out' }; case 1: case 3: return { text: '登录中', class: 'login-status-logging-in' }; case 2: return { text: '登录成功', class: 'login-status-ok' }; default: return { text: `未知-${s}`, class: 'status-unknown' }; } },
        fmtDT: dI => { const d = dI instanceof Date ? dI : new Date(dI); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`; },
        fmtInt: s => { if (isNaN(s) || s < 0) return 'N/A'; if (s === 0) return '0s'; const m = Math.floor(s / 60), sec = s % 60; return `${m > 0 ? `${m}m ` : ''}${sec > 0 || m === 0 ? `${sec}s` : ''}`.trim(); },
        stripHtml: html => { if (typeof html !== 'string') return ''; const tmp = document.createElement("DIV"); tmp.innerHTML = html; return tmp.textContent || tmp.innerText || ""; },
        copyToClipboard: (txt, e) => {
            navigator.clipboard.writeText(txt)
                .then(() => UI.showToast(`已复制: ${txt.length > 30 ? txt.substring(0,27)+'...' : txt}`, e.clientX + 10, e.clientY + 10))
                .catch(() => {
                    const ta = Object.assign(document.createElement('textarea'), { value: txt, style: 'position:absolute;left:-9999px;' });
                    document.body.appendChild(ta);
                    ta.select();
                    try { document.execCommand('copy'); UI.showToast(`已复制: ${txt.length > 30 ? txt.substring(0,27)+'...' : txt}`, e.clientX + 10, e.clientY + 10); }
                    catch (err) { UI.showToast('复制失败', e.clientX + 10, e.clientY + 10); }
                    document.body.removeChild(ta);
                });
        },
        initAutoTxSettings: s => ({ enabled: typeof s?.enabled === 'boolean' ? s.enabled : false, triggerAmount: s?.triggerAmount !== undefined ? s.triggerAmount : Config.DEFAULT_TRIGGER_AMT, payeeId: s?.payeeId !== undefined ? s.payeeId : '', transferMode: s?.transferMode !== undefined ? s.transferMode : Config.DEFAULT_TRANSFER_MODE, roundToInteger: typeof s?.roundToInteger === 'boolean' ? s.roundToInteger : false, transferPercentage: s?.transferPercentage !== undefined ? s.transferPercentage : Config.DEFAULT_TRANSFER_PERCENT }),
        initAutoStopSettings: s => ({ enabled: typeof s?.enabled === 'boolean' ? s.enabled : false, triggerAmount: s?.triggerAmount !== undefined ? s.triggerAmount : Config.DEFAULT_AUTO_STOP_AMT }),
    };

    // --- [模块] DB: IndexedDB 操作 ---
    const DB = {
        dbPromise: null,
        open() {
            if (this.dbPromise) return this.dbPromise;
            this.dbPromise = new Promise((res, rej) => {
                const req = indexedDB.open(Config.DB_NAME, Config.DB_VERSION);
                req.onerror = e => (console.error("IndexedDB 错误:", req.error), rej("打开数据库错误: " + req.error));
                req.onsuccess = e => res(e.target.result);
                req.onupgradeneeded = e => {
                    const db = e.target.result;
                    console.log(`IndexedDB upgrading from version ${e.oldVersion} to ${e.newVersion}`);
                    Object.values(Config.STORES).forEach(s => {
                        if (db.objectStoreNames.contains(s)) db.deleteObjectStore(s);
                        if (s === Config.STORES.OP_LOGS || s === Config.STORES.FROZEN_LOGS) {
                            db.createObjectStore(s, { keyPath: 'id', autoIncrement: true }).createIndex('timeIndex', 'time', { unique: false });
                        } else if (s === Config.STORES.SETTINGS) {
                            db.createObjectStore(s, { keyPath: 'key' });
                        } else {
                            db.createObjectStore(s);
                        }
                    });
                    console.log('IndexedDB 升级完成或数据库已创建。');
                };
            });
            return this.dbPromise;
        },
        async getObjectStore(store, mode) { return (await this.open()).transaction(store, mode).objectStore(store); },
        async get(store, key) { return new Promise(async (res, rej) => { const r = (await this.getObjectStore(store, 'readonly')).get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
        async set(store, keyOrObject, valueIfKey) { return new Promise(async (res, rej) => { const r = (valueIfKey !== undefined) ? (await this.getObjectStore(store, 'readwrite')).put(valueIfKey, keyOrObject) : (await this.getObjectStore(store, 'readwrite')).put(keyOrObject); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
        async getAll(store, index = null, dir = 'next') {
            return new Promise(async (res, rej) => {
                const results = [];
                const targetStore = index ? (await this.getObjectStore(store, 'readonly')).index(index) : (await this.getObjectStore(store, 'readonly'));
                const req = targetStore.openCursor(null, dir);
                req.onsuccess = e => { const c = e.target.result; if (c) { results.push(c.value); c.continue(); } else res(results); };
                req.onerror = e => rej(e.target.error);
            });
        },
        async trimStore(store, max) {
            return new Promise(async (resolve, reject) => {
                const db = await this.open(); const tx = db.transaction(store, 'readwrite'); const os = tx.objectStore(store);
                tx.oncomplete = () => resolve(); tx.onerror = e => (console.error(`trimStore for ${store} failed:`, e.target.error), reject(e.target.error));
                const countReq = os.count();
                countReq.onsuccess = () => {
                    if (countReq.result > max) {
                        let numToDelete = countReq.result - max;
                        const cursorReq = os.openCursor(null, 'next');
                        cursorReq.onsuccess = e => {
                            const cursor = e.target.result;
                            if (cursor && numToDelete > 0) {
                                os.delete(cursor.primaryKey);
                                numToDelete--;
                                cursor.continue();
                            }
                        };
                    } else resolve();
                };
            });
        },
        async clear(store) { return new Promise(async (res, rej) => { const r = (await this.getObjectStore(store, 'readwrite')).clear(); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }); },
        async deleteDB() {
            if (this.dbPromise) { (await this.dbPromise).close(); this.dbPromise = null; }
            return new Promise((res, rej) => {
                const req = indexedDB.deleteDatabase(Config.DB_NAME);
                req.onsuccess = () => { console.log(`IndexedDB ${Config.DB_NAME} 已成功删除。`); res(); };
                req.onerror = e => { console.error(`删除数据库 ${Config.DB_NAME} 时出错:`, e.target.error); rej(e.target.error); };
                req.onblocked = () => { console.warn(`删除 ${Config.DB_NAME} 被阻塞。`); alert(`无法删除脚本数据库 ${Config.DB_NAME}。`); rej('数据库删除被阻塞。'); };
            });
        },
        async loadSetting(key, defaultVal) { try { const s = await this.get(Config.STORES.SETTINGS, key); return s ? s.value : defaultVal; } catch (e) { console.error(`从 IndexedDB 加载 ${key} 时出错:`, e); return defaultVal; } },
        async saveSetting(key, value) { try { await this.set(Config.STORES.SETTINGS, { key, value }); } catch (e) { console.error(`保存 ${key} 到 IndexedDB 时出错:`, e); } },
        async saveAccountData() {
            try {
                await Promise.all([
                    this.set(Config.STORES.ACC_DATA, Config.KEYS.ACCOUNT_CACHE, State.accountDataCache),
                    this.set(Config.STORES.ACC_ORDER, Config.KEYS.ACCOUNT_ORDER, State.accountOrder)
                ]);
            } catch (e) { console.error("保存账户数据/排序到 IndexedDB 时出错:", e); }
        },
        async loadPersistedData() {
            console.log("正在从 IndexedDB 加载持久化数据...");
            try {
                await this.open();
                const [cache, order, lastRefresh, colVis, sortConf, logsVis, theme] = await Promise.all([
                    this.get(Config.STORES.ACC_DATA, Config.KEYS.ACCOUNT_CACHE),
                    this.get(Config.STORES.ACC_ORDER, Config.KEYS.ACCOUNT_ORDER),
                    this.loadSetting(Config.KEYS.LAST_REFRESH, null),
                    this.loadSetting(Config.KEYS.COLUMN_VIS, null),
                    this.loadSetting(Config.KEYS.SORT_CONF, { key: 'id', direction: 'asc' }),
                    this.loadSetting(Config.KEYS.LOGS_VISIBLE, true),
                    this.loadSetting(Config.KEYS.THEME_PREF, 'light')
                ]);
                State.accountDataCache = cache || {};
                State.accountOrder = order || [];
                State.lastSuccessfulDataTimestamp = lastRefresh ? new Date(lastRefresh) : null;
                State.sortConfig = sortConf;
                State.areLogsVisible = logsVis;
                State.currentTheme = theme;

                if (colVis === null) {
                    State.columnVisibility = {};
                    Config.COLUMN_CONFIG.forEach(c => { State.columnVisibility[c.id] = c.hideable ? c.defaultVisible : true; });
                    await this.saveSetting(Config.KEYS.COLUMN_VIS, State.columnVisibility);
                } else {
                    State.columnVisibility = colVis;
                }

                for (const accId in State.accountDataCache) {
                    const cacheEntry = State.accountDataCache[accId];
                    Object.assign(cacheEntry, {
                        autoTransferSettings: Utils.initAutoTxSettings(cacheEntry.autoTransferSettings),
                        autoStopReceiptSettings: Utils.initAutoStopSettings(cacheEntry.autoStopReceiptSettings),
                        lastSuccessfulTransferTime: cacheEntry.lastSuccessfulTransferTime ?? 0,
                        lastAutoStopAttempt: cacheEntry.lastAutoStopAttempt ?? 0,
                        lastTransferAttemptTime: cacheEntry.lastTransferAttemptTime ?? 0,
                        isAutoStoppedByScript: cacheEntry.isAutoStoppedByScript ?? false,
                        lastAutoReEnableAttempt: cacheEntry.lastAutoReEnableAttempt ?? 0,
                        lastFailedTransferTime: cacheEntry.lastFailedTransferTime ?? 0,
                        current: cacheEntry.current || {}
                    });
                    cacheEntry.current.balanceHistory = (cacheEntry.current.balanceHistory || []).slice(-Config.MAX_BAL_HISTORY);
                }
                State.operationLogs = (await this.getAll(Config.STORES.OP_LOGS, null, 'prev') || []).slice(0, Config.MAX_LOG_MEM);
                State.frozenBalanceIncreaseLogs = (await this.getAll(Config.STORES.FROZEN_LOGS, null, 'prev') || []).slice(0, Config.MAX_FROZEN_LOG_MEM);
            } catch (e) {
                console.error("加载持久化数据时发生严重错误:", e);
                Object.assign(State, { accountDataCache: {}, accountOrder: [], operationLogs: [], frozenBalanceIncreaseLogs: [] });
                Config.COLUMN_CONFIG.forEach(c => State.columnVisibility[c.id] = c.defaultVisible);
                State.sortConfig = { key: 'id', direction: 'asc' };
            }
        }
    };

    // --- [模块] UI: DOM 操作、渲染和事件 ---
    const UI = {
        elements: {},
        init() {
            this.injectStyles();
            this.injectHTML();
            this.cacheElements();
            this.bindEvents();
        },
        cacheElements() {
            const D = id => document.getElementById(id);
            this.elements = {
                searchInput: D('gds-search'),
                lastRefreshTimeEl: D('gds-last-refresh-time'),
                hourlyRateDisplay: D('gds-hourly-rate-display'),
                columnTogglePanel: D('gds-column-toggle-panel'),
                tableContainer: D('gds-account-info'),
                logDisplayContainer: D('gds-account-log-container'),
                frozenLogDisplayContainer: D('gds-frozen-log-container'),
                toast: D('copy-toast'),
                fetchStatusDiv: D('gds-fetch-status'),
                logsContainer: D('gds-logs-container'),
                toggleLogsBtn: D('gds-toggle-logs-btn'),
                refreshBtn: D('gds-refresh'),
                toggleThemeBtn: D('gds-toggle-theme'),
                clearLogBtn: D('gds-clear-log'),
                exportLogsBtn: D('gds-export-logs'),
                resetBtn: D('gds-clear-prev-data'),
                remarksWidthMeasurer: D('remarks-width-measurer'),
            };
        },
        bindEvents() {
            this.elements.searchInput.addEventListener('input', () => { this.renderTable(); this.renderAllLogs(); });
            this.elements.refreshBtn.addEventListener('click', () => App.fetchData(false));
            this.elements.toggleThemeBtn.addEventListener('click', () => this.toggleTheme());
            this.elements.toggleLogsBtn.addEventListener('click', () => this.toggleLogsVisibility());
            this.elements.exportLogsBtn.addEventListener('click', (e) => this.exportLogs(e));
            this.elements.clearLogBtn.addEventListener('click', async (e) => {
                if (confirm('确定要清空所有操作、变动及冻结增加日志吗？')) {
                    State.operationLogs = []; State.frozenBalanceIncreaseLogs = [];
                    try {
                        await Promise.all([DB.clear(Config.STORES.OP_LOGS), DB.clear(Config.STORES.FROZEN_LOGS)]);
                        this.renderAllLogs();
                        this.showToast('所有日志已清空', e.clientX + 10, e.clientY + 10);
                    } catch (err) { console.error("从 IndexedDB 清空日志时出错:", err); this.showToast('清空日志失败 (DB错误)', e.clientX + 10, e.clientY + 10); }
                }
            });
            this.elements.resetBtn.addEventListener('click', async (e) => {
                if (confirm('警告：这将清空所有本地缓存的账户数据、排序、主题、列显示和日志！\n确定要重置脚本吗？')) {
                    try {
                        await DB.deleteDB();
                        location.reload();
                    } catch (err) { console.error("重置脚本数据时出错:", err); this.showToast(`重置脚本失败: ${err.message || err}`, e.clientX + 10, e.clientY + 10, 3000); }
                }
            });
            this.elements.columnTogglePanel.addEventListener('change', (e) => this.handleColumnToggle(e));
            this.elements.tableContainer.addEventListener('click', (e) => this.handleTableClick(e));
            this.elements.tableContainer.addEventListener('contextmenu', (e) => this.handleTableClick(e));
            this.elements.tableContainer.addEventListener('input', e => { if (e.target.classList.contains('remarks-input')) this.updateAllRemarksInputsWidth(); });
            this.elements.tableContainer.addEventListener('blur', (e) => {
                const target = e.target;
                if (target.type === 'checkbox') return;
                if (target.classList.contains('remarks-input')) this.handleSettingChange(e, 'remarks');
                else if (target.classList.contains('autotransfer-setting')) this.handleSettingChange(e, 'autoTransfer');
                else if (target.classList.contains('autostopreceipt-setting')) this.handleSettingChange(e, 'autoStopReceipt');
            }, true);
            this.elements.tableContainer.addEventListener('keydown', (e) => {
                const target = e.target;
                if ((target.classList.contains('remarks-input') || target.classList.contains('autotransfer-setting') || target.classList.contains('autostopreceipt-setting')) && e.key === 'Enter') {
                    if (target.tagName === 'SELECT' || target.type === 'checkbox') return;
                    e.preventDefault();
                    target.blur();
                }
            });
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible' && State.lastSuccessfulDataTimestamp) {
                    const timeSinceLastUpdate = Date.now() - State.lastSuccessfulDataTimestamp.getTime();
                    if (timeSinceLastUpdate > Config.REFRESH_INTERVAL_MS * 1.5) {
                        this.showFetchStatus('页面已激活，正在刷新数据...', 'info', 2000);
                        App.fetchData(false);
                    }
                }
            });
        },
        showToast(txt, x, y, dur = 1200) {
            this.elements.toast.innerText = txt;
            Object.assign(this.elements.toast.style, { top: `${y}px`, left: `${x}px`, opacity: '1' });
            clearTimeout(this.elements.toast.timeoutId);
            this.elements.toast.timeoutId = setTimeout(() => this.elements.toast.style.opacity = '0', dur);
        },
        showFetchStatus(msg, type = 'info', dur = 3000) {
            const { fetchStatusDiv } = this.elements;
            fetchStatusDiv.textContent = msg;
            fetchStatusDiv.className = type;
            fetchStatusDiv.style.display = 'block';
            clearTimeout(fetchStatusDiv.timer);
            if (dur > 0) fetchStatusDiv.timer = setTimeout(() => fetchStatusDiv.style.display = 'none', dur);
        },
        applyTheme(theme) {
            document.body.className = `${theme}-theme`;
            State.currentTheme = theme;
            DB.saveSetting(Config.KEYS.THEME_PREF, theme);
            this.elements.toggleThemeBtn.textContent = theme === 'dark' ? '浅色主题' : '深色主题';
        },
        toggleTheme() { this.applyTheme(State.currentTheme === 'light' ? 'dark' : 'light'); },
        toggleLogsVisibility(forceState) {
            const shouldBeVisible = forceState !== undefined ? forceState : !State.areLogsVisible;
            this.elements.logsContainer.classList.toggle('hidden', !shouldBeVisible);
            this.elements.toggleLogsBtn.textContent = shouldBeVisible ? '收起日志' : '展开日志';
            State.areLogsVisible = shouldBeVisible;
            DB.saveSetting(Config.KEYS.LOGS_VISIBLE, shouldBeVisible);
        },
        renderColumnTogglePanel() {
            this.elements.columnTogglePanel.innerHTML = '列显示控制: ' + Config.COLUMN_CONFIG.filter(c => c.hideable).map(c => `
              <label title="${Utils.esc(c.label)}"><input type="checkbox" data-col-id="${Utils.esc(c.id)}" ${State.columnVisibility[c.id] ? 'checked' : ''}>${Utils.esc(c.label)}</label>
            `).join('');
        },
        renderTable() {
            let headerHtml = '<thead><tr>';
            Config.COLUMN_CONFIG.forEach(c => {
                let thClass = c.cssClass || '';
                if (c.hideable && !State.columnVisibility[c.id]) thClass += ' gds-col-hidden';
                if (c.sortable) thClass += ' sortable';
                headerHtml += `<th class="${thClass}" data-col-id="${c.id}" title="${Utils.esc(c.label)} ${c.sortable ? '(可排序)' : ''}">${Utils.esc(c.label)}${c.sortable && State.sortConfig.key === c.id ? (State.sortConfig.direction === 'asc' ? ' ▲' : ' ▼') : ''}</th>`;
            });
            headerHtml += '</tr></thead>';

            const searchTerms = this.elements.searchInput.value.toLowerCase().trim().split(/\s+/).filter(k => k);
            let sortedAccounts = State.accountOrder.map(id => State.accountDataCache[id]).filter(Boolean);

            sortedAccounts.sort((a, b) => {
                const getApiStatusOrder = s => { switch (s) { case Config.API_STATUS.ENABLED: return 0; case Config.API_STATUS.STOP_RECEIPT: return 1; case Config.API_STATUS.DISAPPEARED: return 2; case Config.API_STATUS.CUSTOM_STOP: return 3; default: return 99; } };
                const orderA = getApiStatusOrder(a.current?.apiStatus ?? -999);
                const orderB = getApiStatusOrder(b.current?.apiStatus ?? -999);
                if (orderA !== orderB) return orderA - orderB;

                const currentSortCol = Config.COLUMN_CONFIG.find(c => c.id === State.sortConfig.key);
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
                let comparison = (typeof valA === 'number' && typeof valB === 'number') ? (valA - valB) : String(valA).localeCompare(String(valB));
                if (State.sortConfig.direction === 'desc') comparison *= -1;
                return comparison === 0 ? (parseInt(a.current?.id || '0', 10) - parseInt(b.current?.id || '0', 10)) : comparison;
            });

            let bodyHtml = '<tbody>';
            sortedAccounts.forEach(cacheEntry => {
                const acc = cacheEntry.current;
                const searchableText = `${acc.id} ${acc.platform} ${acc.accountName} ${acc.phone} ${acc.remarks || ''} ${acc.failedReason || ''}`.toLowerCase();
                if (searchTerms.length > 0 && !searchTerms.every(k => searchableText.includes(k))) return;

                let rowHtml = `<tr data-account-id="${Utils.esc(acc.id)}">`;
                Config.COLUMN_CONFIG.forEach(col => {
                    let cellClass = col.cssClass || ''; if (col.hideable && !State.columnVisibility[col.id]) cellClass += ' gds-col-hidden';
                    let content = '';
                    switch (col.id) {
                        case 'deleteAction': content = `<button class="delete-account-btn" data-account-id="${Utils.esc(acc.id)}" title="删除此账户的本地记录">删</button>`; break;
                        case 'id': content = Utils.esc(acc.id); break;
                        case 'platform': content = Utils.esc(acc.platform); break;
                        case 'accountName': content = Utils.esc(acc.accountName); cellClass += `" title="${Utils.esc(acc.description || '')}`; break;
                        case 'phone': content = Utils.esc(acc.phone); break;
                        case 'balance':
                            if (acc.balance >= 0 && acc.balance < 200000) { let tierSuffix = '0'; if (acc.balance >= 150000) tierSuffix = '4'; else if (acc.balance >= 100000) tierSuffix = '3'; else if (acc.balance >= 50000) tierSuffix = '2'; else if (acc.balance >= 10000) tierSuffix = '1'; cellClass += ` balance-tier-${tierSuffix}`; }
                            if (acc.balance >= 200000) cellClass += ' bal-high'; else if (acc.balance < 0) cellClass += ' bal-negative';
                            content = Utils.fmtAmt(acc.balance); break;
                        case 'frozenBalance': if (acc.frozenBalance > 0) cellClass += ' frozen-positive'; content = Utils.fmtAmt(acc.frozenBalance); break;
                        case 'apiStatus': const sI = Utils.fmtApiStatus(acc.apiStatus); cellClass += ` ${Utils.esc(sI.class)}`; content = Utils.esc(sI.text); break;
                        case 'loginStatus': const lI = acc.isDisappeared ? Utils.fmtLoginStatus(0) : Utils.fmtLoginStatus(acc.loginStatus); cellClass += ` ${Utils.esc(lI.class)}`; content = Utils.esc(lI.text); break;
                        case 'failedReason': content = Utils.esc(acc.failedReason || '无'); cellClass += `" title="${Utils.esc(acc.failedReason || '')}`; break;
                        case 'balanceFailed': content = acc.balanceFailed ? '是' : '否'; if (acc.balanceFailed) cellClass += ' balance-failed-yes'; break;
                        case 'remarks': content = `<input type="text" class="remarks-input" data-account-id="${Utils.esc(acc.id)}" value="${Utils.esc(acc.remarks || '')}" placeholder="    ">`; break;
                        case 'lastChangeTime': content = acc.lastChangeTime ? Utils.esc(acc.lastChangeTime) : 'N/A'; break;
                        case 'statusOp': content = `<button class="status-op-btn ${acc.apiStatus === Config.API_STATUS.ENABLED && !acc.isDisappeared ? 'active' : ''}" data-op="set-status" data-status="${Config.API_STATUS.ENABLED}">启用</button> <button class="status-op-btn ${acc.apiStatus === Config.API_STATUS.STOP_RECEIPT && !acc.isDisappeared ? 'active' : ''}" data-op="set-status" data-status="${Config.API_STATUS.STOP_RECEIPT}">止收</button> <button class="status-op-btn ${acc.apiStatus === Config.API_STATUS.CUSTOM_STOP && !acc.isDisappeared ? 'active' : ''}" data-op="set-status" data-status="${Config.API_STATUS.CUSTOM_STOP}">停止</button>`; break;
                        case 'autoStopReceiptEnabled': content = `<input type="checkbox" class="autostopreceipt-setting" data-setting="enabled" ${cacheEntry.autoStopReceiptSettings.enabled ? 'checked' : ''}/>`; break;
                        case 'autoStopReceiptTriggerAmount': content = `<input type="number" class="autostopreceipt-setting" data-setting="triggerAmount" value="${Utils.esc(String(cacheEntry.autoStopReceiptSettings.triggerAmount))}" placeholder="金额"/>`; break;
                        case 'autoTransferEnabled': content = `<input type="checkbox" class="autotransfer-setting" data-setting="enabled" ${cacheEntry.autoTransferSettings.enabled ? 'checked' : ''}/>`; break;
                        case 'autoTransferTriggerAmount': content = `<input type="number" class="autotransfer-setting" data-setting="triggerAmount" value="${Utils.esc(String(cacheEntry.autoTransferSettings.triggerAmount))}" placeholder="金额"/>`; break;
                        case 'autoTransferPayeeId': content = `<select class="autotransfer-setting" data-setting="payeeId"><option value="">--选择--</option>${Config.PAYEE_OPTS.map(opt => `<option value="${opt.payeeId}" ${String(cacheEntry.autoTransferSettings.payeeId) === String(opt.payeeId) ? 'selected' : ''}>${Utils.esc(opt.name)}</option>`).join('')}</select>`; break;
                        case 'autoTransferMode': content = `<select class="autotransfer-setting" data-setting="transferMode"><option value="">--选择--</option>${Config.TRANSFER_MODE_OPTS.map(opt => `<option value="${opt.transferMode}" ${String(cacheEntry.autoTransferSettings.transferMode) === String(opt.transferMode) ? 'selected' : ''}>${Utils.esc(opt.name)}</option>`).join('')}</select>`; break;
                        case 'autoTransferPercentage': content = `<select class="autotransfer-setting" data-setting="transferPercentage">${Config.TRANSFER_PERCENT_OPTS.map(opt => `<option value="${opt.value}" ${parseFloat(cacheEntry.autoTransferSettings.transferPercentage) === opt.value ? 'selected' : ''}>${Utils.esc(opt.name)}</option>`).join('')}</select>`; break;
                        case 'autoTransferRoundToInteger': content = `<input type="checkbox" class="autotransfer-setting" data-setting="roundToInteger" ${cacheEntry.autoTransferSettings.roundToInteger ? 'checked' : ''}/>`; break;
                    }
                    rowHtml += `<td class="${cellClass}">${content}</td>`;
                });
                bodyHtml += `${rowHtml}</tr>`;
            });
            this.elements.tableContainer.innerHTML = `<table>${headerHtml}${bodyHtml}</tbody></table>`;
            if (sortedAccounts.length === 0 && Object.keys(State.accountDataCache).length === 0) {
                this.elements.tableContainer.querySelector('tbody').innerHTML = `<tr><td colspan="${Config.COLUMN_CONFIG.length}" style="text-align: center;">没有账户数据或搜索结果。</td></tr>`;
            }
            this.updateAllRemarksInputsWidth();
            const thead = this.elements.tableContainer.querySelector('thead');
            if (thead) {
                thead.removeEventListener('click', this.handleHeaderClick.bind(this));
                thead.addEventListener('click', this.handleHeaderClick.bind(this));
            }
        },
        renderLog(container, logArr, title) {
            if (!container || !logArr || !title) return;
            container.innerHTML = `<span class="log-title">${title}</span>`;
            const searchTerms = this.elements.searchInput.value.toLowerCase().trim().split(/\s+/).filter(k => k);
            logArr.forEach(log => {
                const searchableText = `${log.time || ''} ${log.accountId || ''} ${log.accountName || ''} ${Utils.stripHtml(log.message || '')}`.toLowerCase();
                if (searchTerms.length > 0 && !searchTerms.every(k => searchableText.includes(k))) return;
                const entryDiv = document.createElement('div');
                entryDiv.className = 'log-entry';
                let html = `<span class="log-time">[${Utils.esc(log.time)}]</span> `;
                if (log.accountId) html += `<span class="log-account-id">ID:${Utils.esc(log.accountId)}</span> <span class="log-account-name">(${Utils.esc(log.accountName || 'N/A')})</span>: `;
                html += log.message;
                if (log.interval && log.interval !== 'N/A') html += ` <span class="log-interval">(间隔 ${Utils.esc(log.interval)})</span>`;
                entryDiv.innerHTML = html;
                container.appendChild(entryDiv);
            });
        },
        renderAllLogs() {
            this.renderLog(this.elements.logDisplayContainer, State.operationLogs, '操作与变动日志');
            this.renderLog(this.elements.frozenLogDisplayContainer, State.frozenBalanceIncreaseLogs, '冻结金额增加日志');
        },
        updateAllRemarksInputsWidth() {
            const measurer = this.elements.remarksWidthMeasurer;
            if (!measurer) return;
            const allInputs = this.elements.tableContainer.querySelectorAll('.remarks-input');
            if (allInputs.length === 0) return;
            let maxWidth = 0;
            allInputs.forEach(input => {
                measurer.textContent = input.value || input.placeholder || '';
                if (measurer.offsetWidth > maxWidth) maxWidth = measurer.offsetWidth;
            });
            allInputs.forEach(input => { input.style.width = `${maxWidth + 5}px`; });
        },
        async handleColumnToggle(e) {
            const cb = e.target;
            if (cb.type === 'checkbox' && cb.dataset.colId) {
                State.columnVisibility[cb.dataset.colId] = cb.checked;
                await DB.saveSetting(Config.KEYS.COLUMN_VIS, State.columnVisibility);
                this.renderTable();
            }
        },
        async handleHeaderClick(e) {
            const th = e.target.closest('th');
            if (!th?.dataset.colId) return;
            const colId = th.dataset.colId;
            const col = Config.COLUMN_CONFIG.find(c => c.id === colId);
            if (!col?.sortable) return;
            State.sortConfig = State.sortConfig.key === colId ? { key: colId, direction: State.sortConfig.direction === 'asc' ? 'desc' : 'asc' } : { key: colId, direction: 'asc' };
            await DB.saveSetting(Config.KEYS.SORT_CONF, State.sortConfig);
            this.renderTable();
        },
        async handleTableClick(e) {
            const target = e.target;
            if (e.button === 2 && target.tagName === 'TD') {
                e.preventDefault();
                if (target.innerText.trim()) Utils.copyToClipboard(target.innerText.trim(), e);
                return;
            }
            if (target.classList.contains('delete-account-btn')) {
                const accId = target.dataset.accountId;
                if (!accId) return;
                const accName = State.accountDataCache[accId]?.current?.accountName || 'N/A';
                if (confirm(`确定要从本地删除账户 ID: ${accId} (${accName}) 的所有记录吗？\n此操作不可撤销，且仅影响本地数据。`)) {
                    delete State.accountDataCache[accId];
                    State.accountOrder = State.accountOrder.filter(id => id !== accId);
                    try {
                        await DB.saveAccountData();
                        API.addLog(State.operationLogs, Config.STORES.OP_LOGS, Config.MAX_LOG_MEM, Config.MAX_LOG_DB, { accountId: accId, accountName: accName, message: `<span class="log-local-delete">本地账户记录已删除</span>` });
                        this.showToast(`账户 ID: ${accId} 本地记录已删除`, e.clientX + 10, e.clientY + 10, 2000);
                        this.renderTable();
                    } catch (err) { console.error(`从数据库删除账户 ${accId} 时出错:`, err); this.showToast(`删除账户 ${accId} 本地记录失败 (DB错误)`, e.clientX + 10, e.clientY + 10, 3000); }
                }
                return;
            }
            if (target.classList.contains('status-op-btn') && target.dataset.op === 'set-status') {
                const accId = target.closest('tr').dataset.accountId;
                const newStatus = parseInt(target.dataset.status);
                if (!accId || isNaN(newStatus)) return;
                target.closest('td').querySelectorAll('.status-op-btn').forEach(btn => btn.disabled = true);
                await API.setAccountApiStatus(accId, newStatus, "手动操作");
                target.closest('td').querySelectorAll('.status-op-btn').forEach(btn => btn.disabled = false);
            }
            if (target.type === 'checkbox' && (target.classList.contains('autotransfer-setting') || target.classList.contains('autostopreceipt-setting'))) {
                const type = target.classList.contains('autotransfer-setting') ? 'autoTransfer' : 'autoStopReceipt';
                this.handleSettingChange(e, type);
            }
        },
        async handleSettingChange(e, type) {
            const target = e.target;
            const accId = target.closest('tr').dataset.accountId;
            if (!accId || !State.accountDataCache[accId]) return;

            const cacheEntry = State.accountDataCache[accId];
            let settingsObj, oldSettings, settingDisplayNamePrefix;

            if (type === 'remarks') {
                const newValue = target.value;
                const oldValue = cacheEntry.current.remarks || '';
                if (newValue === oldValue) return;
                cacheEntry.current.remarks = newValue;
                await DB.saveAccountData();
                API.addLog(State.operationLogs, Config.STORES.OP_LOGS, Config.MAX_LOG_MEM, Config.MAX_LOG_DB, { accountId: accId, accountName: cacheEntry.current?.accountName || 'N/A', message: `<span class="log-setting-change">备注更新: 从 "${Utils.esc(oldValue)}" 改为 "${Utils.esc(newValue)}"</span>` });
                this.showToast(`ID ${accId}: 备注已保存`, e.clientX, e.clientY, 1000);
                return;
            }

            if (type === 'autoTransfer') {
                settingsObj = cacheEntry.autoTransferSettings;
                settingDisplayNamePrefix = '自动划转';
            } else { // autoStopReceipt
                settingsObj = cacheEntry.autoStopReceiptSettings;
                settingDisplayNamePrefix = '自动止收';
            }

            oldSettings = { ...settingsObj };
            const settingName = target.dataset.setting;
            let newValue = (target.type === 'checkbox') ? target.checked : target.value;
            let displayValue = newValue;
            let settingDisplayName = settingName;
            let oldDisplayValue = oldSettings[settingName];

            if (settingName.includes('triggerAmount')) {
                const numVal = parseFloat(newValue);
                if (newValue !== '' && (isNaN(numVal) || numVal < 0)) { this.showToast('触发金额必须是有效的非负数字或为空', e.clientX, e.clientY, 2000); target.value = oldSettings[settingName] || ''; return; }
                newValue = newValue === '' ? (type === 'autoStopReceipt' ? Config.DEFAULT_AUTO_STOP_AMT : '') : numVal;
                displayValue = newValue === '' ? '(空)' : Utils.fmtAmt(newValue);
                oldDisplayValue = oldSettings[settingName] === '' || oldSettings[settingName] === undefined ? '(空)' : Utils.fmtAmt(oldSettings[settingName]);
            } else if (settingName === 'payeeId' || settingName === 'transferMode') {
                newValue = newValue === '' ? '' : parseInt(newValue, 10);
                const opts = settingName === 'payeeId' ? Config.PAYEE_OPTS : Config.TRANSFER_MODE_OPTS;
                const key = settingName === 'payeeId' ? 'payeeId' : 'transferMode';
                const newOpt = opts.find(opt => opt[key] === newValue);
                displayValue = newOpt ? newOpt.name : (newValue === '' ? '(空)' : `${key === 'payeeId' ? 'PayeeID' : 'Mode'} ${newValue}`);
                const oldOpt = opts.find(opt => opt[key] === oldSettings[settingName]);
                oldDisplayValue = oldOpt ? oldOpt.name : (oldSettings[settingName] === '' || oldSettings[settingName] === undefined ? '(空)' : `${key === 'payeeId' ? 'PayeeID' : 'Mode'} ${oldSettings[settingName]}`);
            } else if (settingName === 'transferPercentage') {
                newValue = parseFloat(newValue);
                const newOpt = Config.TRANSFER_PERCENT_OPTS.find(opt => opt.value === newValue);
                displayValue = newOpt ? newOpt.name : `${(newValue * 100).toFixed(0)}%`;
                const oldOpt = Config.TRANSFER_PERCENT_OPTS.find(opt => opt.value === oldSettings[settingName]);
                oldDisplayValue = oldOpt ? oldOpt.name : (oldSettings[settingName] !== undefined ? `${(oldSettings[settingName] * 100).toFixed(0)}%` : '(空)');
            } else {
                displayValue = newValue ? '是' : '否';
                oldDisplayValue = oldSettings[settingName] ? '是' : '否';
            }

            if (settingName === 'transferPercentage' && Math.abs(oldSettings.transferPercentage - newValue) < 0.001) return;
            if (String(oldSettings[settingName]) === String(newValue)) return;

            settingsObj[settingName] = newValue;
            await DB.saveAccountData();

            switch(settingName) {
                case 'enabled': settingDisplayName = type === 'autoTransfer' ? '开启自动划转' : '开启自动止收'; break;
                case 'triggerAmount': settingDisplayName = type === 'autoTransfer' ? '触发金额' : '止收触发金额'; break;
                case 'payeeId': settingDisplayName = '收款账户'; break;
                case 'transferMode': settingDisplayName = '划转模式'; break;
                case 'transferPercentage': settingDisplayName = '划转比例'; break;
                case 'roundToInteger': settingDisplayName = '取整'; break;
            }

            API.addLog(State.operationLogs, Config.STORES.OP_LOGS, Config.MAX_LOG_MEM, Config.MAX_LOG_DB, { accountId: accId, accountName: cacheEntry.current?.accountName || 'N/A', message: `<span class="log-setting-change">${settingDisplayNamePrefix}设置: ${Utils.esc(settingDisplayName)} 从 "${Utils.esc(String(oldDisplayValue))}" 改为 "${Utils.esc(String(displayValue))}"</span>` });
            this.showToast(`ID ${accId}: "${Utils.esc(settingDisplayName)}" 已更新`, e.clientX, e.clientY, 1000);
        },
        async exportLogs(e) {
            const exportButton = e.target;
            exportButton.disabled = true;
            this.showToast('正在准备并导出全部日志，请稍候...', e.clientX, e.clientY, 5000);

            setTimeout(async () => {
                try {
                    const allOperationLogs = await DB.getAll(Config.STORES.OP_LOGS, null, 'prev');
                    const allFrozenLogs = await DB.getAll(Config.STORES.FROZEN_LOGS, null, 'prev');
                    const searchTerms = this.elements.searchInput.value.toLowerCase().trim().split(/\s+/).filter(k => k);
                    let content = "GDS 账户信息增强版 - 全量日志导出\n";
                    content += `导出时间: ${Utils.fmtDT(new Date())}\n`;
                    content += `搜索关键词: ${searchTerms.join(' ') || '(无)'}\n\n`;

                    const formatLogs = (logArray, title) => {
                        let matchedCount = 0;
                        let tempContent = "";
                        logArray.forEach(log => {
                            const searchableText = `${log.time || ''} ${log.accountId || ''} ${log.accountName || ''} ${Utils.stripHtml(log.message || '')}`.toLowerCase();
                            if (searchTerms.length > 0 && !searchTerms.every(k => searchableText.includes(k))) return;
                            let line = `[${log.time}] `;
                            if (log.accountId) line += `ID:${log.accountId} (${log.accountName || 'N/A'}): `;
                            line += Utils.stripHtml(log.message);
                            if (log.interval && log.interval !== 'N/A') line += ` (间隔 ${log.interval})`;
                            tempContent += line + '\n';
                            matchedCount++;
                        });
                        if (matchedCount > 0) return `--- ${title} (共 ${logArray.length} 条记录, 匹配 ${matchedCount} 条) ---\n` + tempContent;
                        return '';
                    };

                    const opLogsContent = formatLogs(allOperationLogs, "操作与变动日志");
                    const frozenLogsContent = formatLogs(allFrozenLogs, "冻结金额增加日志");

                    if (!opLogsContent && !frozenLogsContent) {
                        this.showToast('数据库中没有匹配当前搜索条件的日志可导出', e.clientX, e.clientY, 2000);
                        return;
                    }

                    content += opLogsContent + '\n' + frozenLogsContent;
                    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `gds_full_logs_${Utils.fmtDT(new Date()).replace(/[:\s]/g, '_')}.txt`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    this.showToast('全量日志已开始下载', e.clientX, e.clientY, 2000);
                } catch (err) {
                    console.error("导出日志时发生错误:", err);
                    this.showToast('导出日志失败，请查看控制台', e.clientX, e.clientY, 3000);
                } finally {
                    exportButton.disabled = false;
                }
            }, 100);
        },
        injectStyles() {
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
        },
        injectHTML() {
            document.body.insertAdjacentHTML('beforeend', `
                <div id="gds-enhanced-ui">
                    <div id="gds-header">
                        <div id="gds-control-panel">
                          <input id="gds-search" placeholder="ID/平台/账号/手机/备注/失败原因/日志" title="可搜索多个关键词，用空格隔开"/>
                          <button id="gds-refresh" title="手动刷新数据">刷新</button>
                          <button id="gds-toggle-theme" title="切换主题">切换主题</button>
                          <button id="gds-clear-log" title="清空操作、变动及冻结增加日志">清空日志</button>
                          <button id="gds-export-logs" title="导出数据库中所有匹配的日志">导出日志</button>
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
        }
    };

    // --- [模块] API: API 请求与数据处理 ---
    const API = {
    async gmRequest(details) {
        return new Promise((res, rej) => {
            GM_xmlhttpRequest({
                method: details.method || "GET", url: details.url, headers: details.headers || {}, data: details.data, responseType: details.responseType, timeout: details.timeout || 45000,
                onload: r => {
                    const parseGmHeaders = (headerStr) => {
                        const headers = new Headers(); if (!headerStr) return headers;
                            headerStr.split('\r\n').forEach(hp => { const i = hp.indexOf(': '); if (i > 0) headers.append(hp.substring(0, i), hp.substring(i + 2)); });
                            return headers;
                        };
                        res({ status: r.status, ok: r.status >= 200 && r.status < 300, headers: parseGmHeaders(r.responseHeaders), json: () => r.responseType === 'json' ? r.response : JSON.parse(r.responseText), text: () => r.responseText, rawJson: r.response, rawText: r.responseText });
                    },
                    onerror: r => rej(new Error(`网络错误: ${r.error || r.statusText || '未知 GM_xmlhttpRequest 错误'}`)),
                    ontimeout: () => rej(new Error('请求超时')),
                    onabort: () => rej(new Error('请求已中止'))
                });
            });
        },
        async refreshAuthTokens() {
            if (State.isRefreshingToken) return State.refreshPromise;
            State.isRefreshingToken = true;
            State.refreshPromise = (async () => {
                State.refreshToken = localStorage.getItem('refreshToken');
                if (!State.refreshToken) { UI.showFetchStatus('刷新Token缺失。请重新登录。', 'error', 0); return false; }
                UI.showFetchStatus('Token已过期，尝试刷新Token...', 'info', 0);
                try {
                    const res = await this.gmRequest({ method: "GET", url: "https://admin.gdspay.xyz/api/auth/v1/refresh", headers: { "authorization": State.refreshToken, "accept": "application/json" }, responseType: "json" });
                    if (res.ok && res.rawJson?.code === 1) {
                        const { token: newAccessToken, refreshToken: newRefreshToken } = res.rawJson.data;
                        localStorage.setItem('token', newAccessToken); localStorage.setItem('refreshToken', newRefreshToken);
                        State.token = newAccessToken; State.refreshToken = newRefreshToken;
                        UI.showFetchStatus('Token刷新成功!', 'success', 2000);
                        return true;
                    } else {
                        const errMsg = res.rawJson?.msg || res.error || res.rawText || `状态码: ${res.status}`;
                        UI.showFetchStatus(`刷新Token失败: ${errMsg}`, 'error', 4000);
                        return false;
                    }
                } catch (e) { UI.showFetchStatus(`刷新Token请求异常: ${e.message}`, 'error', 4000); return false; }
                finally { State.isRefreshingToken = false; State.refreshPromise = null; }
            })();
            return State.refreshPromise;
        },
        async apiRequest(details, retryCount = 0) {
            State.token = localStorage.getItem('token');
            if (!State.token) return { ok: false, status: 401, error: 'Token missing', rawText: 'Token缺失' };
            try {
                const res = await this.gmRequest({ ...details, headers: { ...details.headers, "authorization": State.token } });
                if (res.status === 401 && retryCount === 0) {
                    const refreshSuccess = await this.refreshAuthTokens();
                    if (refreshSuccess) {
                        UI.showFetchStatus(`Token刷新成功，等待 ${Config.TOKEN_REFRESH_DELAY_MS / 1000} 秒后重试...`, 'info', Config.TOKEN_REFRESH_DELAY_MS + 500);
                        await new Promise(res => setTimeout(res, Config.TOKEN_REFRESH_DELAY_MS));
                        return await this.apiRequest(details, 1);
                    } else { throw new Error('Token刷新失败，无法重试原请求。'); }
                }
                return res;
            } catch (error) {
                if (error.message === 'Token刷新失败，无法重试原请求。') throw error;
                UI.showFetchStatus(`API请求异常: ${error.message}`, 'error', 4000);
                return { ok: false, error: error.message };
            }
        },
        async setAccountApiStatus(accId, newStatus, srcAction = "手动操作") {
            const accCache = State.accountDataCache[accId];
            if (!accCache?.current) { this.addLog(State.operationLogs, Config.STORES.OP_LOGS, Config.MAX_LOG_MEM, Config.MAX_LOG_DB, { accountId: accId, message: `${srcAction}: 设置状态为 "${Utils.fmtApiStatus(newStatus).text}" <span class="log-api-op-fail">(失败: 账户数据缺失)</span>` }); return false; }
            const { accountName, platform: tripartiteId, apiStatus: oldStatus } = accCache.current;
            if (oldStatus === newStatus) return true;
            UI.showFetchStatus(`ID ${accId} (${srcAction}): 设置状态为 "${Utils.fmtApiStatus(newStatus).text}"...`, 'info', 0);
            try {
                const res = await this.apiRequest({ method: "POST", url: "https://admin.gdspay.xyz/api/tripartite/v1/account/status/modify", headers: { "content-type": "application/json" }, data: JSON.stringify({ accountId: parseInt(accId), accountName, tripartiteId, accountStatus: newStatus }), responseType: "json" });
                const r = res.rawJson;
                if (res.ok && r?.code === 1) {
                    UI.showFetchStatus(`ID ${accId} (${srcAction}): 状态设置成功!`, 'success', 2500);
                    accCache.current.apiStatus = newStatus;
                    if (srcAction === "自动止收" && newStatus === Config.API_STATUS.STOP_RECEIPT) accCache.isAutoStoppedByScript = true;
                    else if (newStatus === Config.API_STATUS.ENABLED || newStatus === Config.API_STATUS.CUSTOM_STOP) accCache.isAutoStoppedByScript = false;
                    await DB.saveAccountData();
                    UI.renderTable();
                    this.addLog(State.operationLogs, Config.STORES.OP_LOGS, Config.MAX_LOG_MEM, Config.MAX_LOG_DB, { accountId: accId, accountName, message: `${srcAction}: 在线状态从 ${Utils.fmtApiStatus(oldStatus).text} → <span class="log-status-change">${Utils.fmtApiStatus(newStatus).text}</span> <span class="log-api-op-success">(成功)</span>` });
                    return true;
                } else {
                    const errMsg = r ? r.msg : (res.rawText || '未知错误');
                    UI.showFetchStatus(`ID ${accId} (${srcAction}): 状态设置失败 - ${errMsg}`, 'error', 4000);
                    this.addLog(State.operationLogs, Config.STORES.OP_LOGS, Config.MAX_LOG_MEM, Config.MAX_LOG_DB, { accountId: accId, accountName, message: `${srcAction}: 在线状态从 ${Utils.fmtApiStatus(oldStatus).text} → ${Utils.fmtApiStatus(newStatus).text} <span class="log-api-op-fail">(失败: ${Utils.esc(errMsg)})</span>` });
                    return false;
                }
            } catch (e) {
                UI.showFetchStatus(`ID ${accId} (${srcAction}): 状态设置请求异常 - ${e.message}`, 'error', 4000);
                this.addLog(State.operationLogs, Config.STORES.OP_LOGS, Config.MAX_LOG_MEM, Config.MAX_LOG_DB, { accountId: accId, accountName, message: `${srcAction}: 在线状态从 ${Utils.fmtApiStatus(oldStatus).text} → ${Utils.fmtApiStatus(newStatus).text} <span class="log-api-op-fail">(请求异常: ${Utils.esc(e.message)})</span>` });
                return false;
            }
        },
        async addLog(logArr, dbStore, maxMem, maxDb, entryData) {
            const newLog = { ...entryData, time: Utils.fmtDT(new Date()), id: Date.now() + Math.random() };
            logArr.unshift(newLog);
            if (logArr.length > maxMem) logArr.pop();
            try {
                await DB.set(dbStore, newLog);
                await DB.trimStore(dbStore, maxDb);
            } catch (e) { console.error(`保存日志到 IndexedDB (${dbStore}) 时出错:`, e); }
            UI.renderAllLogs();
        }
    };

    // --- [模块] Automation: 自动化任务 ---
    const Automation = {
        async checkAndPerformAutoStopReceipt(specificAccId = null) {
            const accs = specificAccId ? [specificAccId] : Object.keys(State.accountDataCache);
            for (const accId of accs) {
                const cacheEntry = State.accountDataCache[accId];
                if (!cacheEntry?.current || !cacheEntry.autoStopReceiptSettings?.enabled || cacheEntry.current.isDisappeared) continue;
                const { current: acc, autoStopReceiptSettings: settings } = cacheEntry;
                const trigAmt = parseFloat(settings.triggerAmount);
                if (isNaN(trigAmt) || trigAmt <= 0) continue;
                if (acc.balance > trigAmt && acc.apiStatus === Config.API_STATUS.ENABLED) {
                    const now = Date.now();
                    if (cacheEntry.lastAutoStopAttempt && (now - cacheEntry.lastAutoStopAttempt < Config.THROTTLES.AUTO_STOP_ATTEMPT)) continue;
                    cacheEntry.lastAutoStopAttempt = now;
                    API.addLog(State.operationLogs, Config.STORES.OP_LOGS, Config.MAX_LOG_MEM, Config.MAX_LOG_DB, { accountId: accId, accountName: acc.accountName, message: `<span class="log-transfer-attempt">自动止收触发: 余额 ${Utils.fmtAmt(acc.balance)} > ${Utils.fmtAmt(trigAmt)}. 尝试设置状态为 "止收".</span>` });
                    const success = await API.setAccountApiStatus(accId, Config.API_STATUS.STOP_RECEIPT, "自动止收");
                    if (success) delete cacheEntry.lastAutoStopAttempt;
                    await DB.saveAccountData();
                }
            }
        },
        async checkAndPerformAutoReEnable(specificAccId = null) {
            const accs = specificAccId ? [specificAccId] : Object.keys(State.accountDataCache);
            for (const accId of accs) {
                const cacheEntry = State.accountDataCache[accId];
                if (!cacheEntry?.current || !cacheEntry.autoStopReceiptSettings?.enabled || cacheEntry.current.isDisappeared) continue;
                const { current: acc, autoStopReceiptSettings: settings } = cacheEntry;
                const trigAmt = parseFloat(settings.triggerAmount);
                if (isNaN(trigAmt) || trigAmt <= 0) continue;
                if (acc.apiStatus === Config.API_STATUS.STOP_RECEIPT && cacheEntry.isAutoStoppedByScript && acc.balance < trigAmt) {
                    const now = Date.now();
                    if (cacheEntry.lastAutoReEnableAttempt && (now - cacheEntry.lastAutoReEnableAttempt < Config.THROTTLES.AUTO_RE_ENABLE_ATTEMPT)) continue;
                    cacheEntry.lastAutoReEnableAttempt = now;
                    API.addLog(State.operationLogs, Config.STORES.OP_LOGS, Config.MAX_LOG_MEM, Config.MAX_LOG_DB, { accountId: accId, accountName: acc.accountName, message: `<span class="log-autorenable-attempt">自动解除止收触发: 余额 ${Utils.fmtAmt(acc.balance)} < ${Utils.fmtAmt(trigAmt)}. 尝试设置状态为 "启用".</span>` });
                    const success = await API.setAccountApiStatus(accId, Config.API_STATUS.ENABLED, "自动解除止收");
                    if (success) delete cacheEntry.lastAutoReEnableAttempt;
                    await DB.saveAccountData();
                }
            }
        },
        async checkAndPerformAutoTransfers(specificAccId = null) {
            const nowGlobal = Date.now();
            if (!specificAccId && (nowGlobal - State.lastAutoTransferCheckInitiatedTime < Config.THROTTLES.AUTO_TX_GLOBAL_CHECK)) return;
            if (!specificAccId) State.lastAutoTransferCheckInitiatedTime = nowGlobal;

            for (const accId of specificAccId ? [specificAccId] : Object.keys(State.accountDataCache)) {
                const cacheEntry = State.accountDataCache[accId];
                if (!cacheEntry?.current || !cacheEntry.autoTransferSettings?.enabled || cacheEntry.current.isDisappeared || ![Config.API_STATUS.ENABLED, Config.API_STATUS.STOP_RECEIPT].includes(cacheEntry.current.apiStatus)) continue;

                const { current: acc, autoTransferSettings: settings } = cacheEntry;
                const nowPerAcc = Date.now();
                if ((cacheEntry.lastSuccessfulTransferTime && (nowPerAcc - cacheEntry.lastSuccessfulTransferTime < Config.THROTTLES.AUTO_TX_SUCCESS)) || (cacheEntry.lastFailedTransferTime && (nowPerAcc - cacheEntry.lastFailedTransferTime < Config.THROTTLES.AUTO_TX_FAIL)) || (cacheEntry.lastTransferAttemptTime && (nowPerAcc - cacheEntry.lastTransferAttemptTime < Config.THROTTLES.AUTO_TX_ATTEMPT))) continue;

                const trigAmt = parseFloat(settings.triggerAmount);
                if (isNaN(trigAmt) || trigAmt <= 0 || acc.balance < trigAmt) continue;
                if (!settings.payeeId || !settings.transferMode) { API.addLog(State.operationLogs, Config.STORES.OP_LOGS, Config.MAX_LOG_MEM, Config.MAX_LOG_DB, { accountId: accId, accountName: acc.accountName, message: `<span class="log-transfer-fail">自动划转配置不完整 (收款账户或模式未选)</span>` }); continue; }

                const txPerc = parseFloat(settings.transferPercentage);
                if (isNaN(txPerc) || txPerc <= 0 || txPerc > 1) { API.addLog(State.operationLogs, Config.STORES.OP_LOGS, Config.MAX_LOG_MEM, Config.MAX_LOG_DB, { accountId: accId, accountName: acc.accountName, message: `<span class="log-transfer-fail">自动划转失败: 无效的划转比例 (${Utils.esc(String(settings.transferPercentage))})</span>` }); continue; }

                const baseAmountFromSettings = acc.balance * txPerc;
                let finalTransferAmountYuan = Math.round(baseAmountFromSettings * (Math.random() * (Config.RANDOM_TRANSFER_MAX_FACTOR - Config.RANDOM_TRANSFER_MIN_FACTOR) + Config.RANDOM_TRANSFER_MIN_FACTOR));
                if (settings.roundToInteger) finalTransferAmountYuan = Math.floor(finalTransferAmountYuan / 100) * 100;
                const amtInCents = Math.floor(finalTransferAmountYuan * 100);
                if (amtInCents <= 0) { API.addLog(State.operationLogs, Config.STORES.OP_LOGS, Config.MAX_LOG_MEM, Config.MAX_LOG_DB, { accountId: accId, accountName: acc.accountName, message: `<span class="log-transfer-fail">计算后划转金额为0或负数 (${Utils.fmtAmt(amtInCents/100)})，不执行</span>` }); continue; }

                const payload = { tripartiteId: acc.platform, accountName: acc.accountName, payeeId: parseInt(settings.payeeId), amount: amtInCents, transferMode: parseInt(settings.transferMode), isBulk: false, version: Date.now() };
                const payeeInfo = Config.PAYEE_OPTS.find(p => p.payeeId === payload.payeeId);
                const payeeDisplay = payeeInfo ? `${Utils.esc(payeeInfo.name)} (ID: ${payload.payeeId})` : `PayeeID ${payload.payeeId}`;
                const modeName = Config.TRANSFER_MODE_OPTS.find(m => m.transferMode === payload.transferMode)?.name || `Mode ${payload.transferMode}`;
                const commonLogMsg = `自动划转 ${Utils.fmtAmt(amtInCents / 100)} (随机金额: ${Utils.fmtCurrencyInt(finalTransferAmountYuan)} 元，原预计 ${Utils.fmtAmt(baseAmountFromSettings)}) 到 ${payeeDisplay} (模式: ${Utils.esc(modeName)})`;

                cacheEntry.lastTransferAttemptTime = nowPerAcc;
                delete cacheEntry.lastSuccessfulTransferTime;
                delete cacheEntry.lastFailedTransferTime;
                await DB.saveAccountData();
                API.addLog(State.operationLogs, Config.STORES.OP_LOGS, Config.MAX_LOG_MEM, Config.MAX_LOG_DB, { accountId: accId, accountName: acc.accountName, message: `<span class="log-transfer-attempt">${commonLogMsg}</span>` });
                UI.showFetchStatus(`ID ${accId}: 尝试自动划转 ${Utils.fmtAmt(amtInCents / 100)}...`, 'info', 5000);

                try {
                    const res = await API.apiRequest({ method: "POST", url: "https://admin.gdspay.xyz/api/tripartite/v1/transfer/manual", headers: { "content-type": "application/json", "X-Request-ID": `req-${Date.now()}` }, data: JSON.stringify(payload), responseType: "json" });
                    const r = res.rawJson;
                    if (res.ok && r?.code === 1) {
                        cacheEntry.lastSuccessfulTransferTime = Date.now();
                        API.addLog(State.operationLogs, Config.STORES.OP_LOGS, Config.MAX_LOG_MEM, Config.MAX_LOG_DB, { accountId: accId, accountName: acc.accountName, message: `<span class="log-transfer-success">${commonLogMsg} 成功!</span>` });
                        UI.showFetchStatus(`ID ${accId}: 自动划转成功!`, 'success', 3000);
                    } else {
                        cacheEntry.lastFailedTransferTime = Date.now();
                        const errMsg = r ? r.msg : (res.rawText || '未知错误');
                        API.addLog(State.operationLogs, Config.STORES.OP_LOGS, Config.MAX_LOG_MEM, Config.MAX_LOG_DB, { accountId: accId, accountName: acc.accountName, message: `<span class="log-transfer-fail">${commonLogMsg} 失败: ${Utils.esc(errMsg)}</span>` });
                        UI.showFetchStatus(`ID ${accId}: 自动划转失败 - ${errMsg}`, 'error', 5000);
                    }
                } catch (e) {
                    cacheEntry.lastFailedTransferTime = Date.now();
                    API.addLog(State.operationLogs, Config.STORES.OP_LOGS, Config.MAX_LOG_MEM, Config.MAX_LOG_DB, { accountId: accId, accountName: acc.accountName, message: `<span class="log-transfer-fail">${commonLogMsg} 请求异常: ${Utils.esc(e.message)}</span>` });
                    UI.showFetchStatus(`ID ${accId}: 自动划转请求异常`, 'error', 5000);
                } finally {
                    delete cacheEntry.lastTransferAttemptTime;
                    await DB.saveAccountData();
                }
            }
        },
        calculateEstimatedHourlyRate() {
            const nowTs = Date.now();
            const tenMinAgoTs = nowTs - (10 * 60 * 1000);
            const totalIncrease = Object.values(State.accountDataCache).reduce((total, cacheEntry) => {
                if (!cacheEntry?.current || cacheEntry.current.isDisappeared) return total;
                const history = cacheEntry.current.balanceHistory;
                if (!Array.isArray(history) || history.length < 2) return total;
                const recentHistory = history.filter(h => h.timestamp >= tenMinAgoTs && typeof h.balance === 'number').sort((a, b) => a.timestamp - b.timestamp);
                if (recentHistory.length < 2) return total;
                const accountIncrease = recentHistory.reduce((acc, currH, index, arr) => {
                    if (index === 0) return acc;
                    const prevH = arr[index - 1];
                    return acc + (currH.balance > prevH.balance ? (currH.balance - prevH.balance) : 0);
                }, 0);
                return total + accountIncrease;
            }, 0);

            if (totalIncrease === 0) return `预计速度: <span class="rate-stagnant">N/A (近10分钟无增)</span>`;
            const estimatedHourly = totalIncrease * 6;
            return `预计速度: <span class="rate-positive"><span class="rate-value">+${Utils.fmtAmt(estimatedHourly)}</span>/小时</span>`;
        }
    };

    // --- [模块] App: 主应用 ---
    const App = {
        async init() {
            console.log(`GDS 账户信息增强版 (v${GM_info.script.version}) 启动...`);
            UI.init(); // Initialize UI first to make elements available

            try {
                const configRes = await API.gmRequest({
                    method: "GET",
                    url: "https://gist.githubusercontent.com/lkm888/b71866f0915cacf88fa2b6e3f7e06b37/raw/webcfg.json",
                    responseType: "json",
                    timeout: 30000
                });

                if (!configRes.ok || !configRes.rawJson.is_active) {
                    console.log("GDS Enhancer: Script is disabled by remote config. Halting execution.", configRes.rawJson);
                    UI.elements.tableContainer.innerHTML = '脚本已被远程禁用。';
                    UI.showFetchStatus('脚本已被远程禁用', 'error', 0);
                    return; // 停止执行
                }
                 console.log("GDS Enhancer: Remote config check passed.", configRes.rawJson);
            } catch (e) {
                console.error("GDS Enhancer: Failed to fetch or parse remote config. Halting execution.", e);
                UI.elements.tableContainer.innerHTML = '获取远程配置失败，脚本已停止。';
                UI.showFetchStatus('获取远程配置失败，脚本已停止', 'error', 0);
                return; // 停止执行
            }

            const pendingReloadTimestamp = await GM_getValue(Config.KEYS.RELOAD_DELAY, 0);
            if (pendingReloadTimestamp > 0 && (Date.now() - pendingReloadTimestamp < Config.RELOAD_FLAG_GRACE_MS)) {
                UI.showFetchStatus(`检测到401后刷新。等待 ${Config.RELOAD_DELAY_MS / 1000} 秒后加载...`, 'info', 0);
                await GM_setValue(Config.KEYS.RELOAD_DELAY, 0);
                await new Promise(res => setTimeout(res, Config.RELOAD_DELAY_MS));
            }
            await DB.loadPersistedData();
            UI.applyTheme(State.currentTheme);
            UI.renderColumnTogglePanel();
            UI.renderAllLogs();
            UI.toggleLogsVisibility(State.areLogsVisible);
            if (State.lastSuccessfulDataTimestamp) UI.elements.lastRefreshTimeEl.innerText = `上次成功更新: ${Utils.fmtDT(State.lastSuccessfulDataTimestamp)}`;

            UI.renderTable(); // 立即渲染缓存数据，防止刷新失败时卡在加载界面

            State.token = localStorage.getItem('token');
            State.refreshToken = localStorage.getItem('refreshToken');
            await this.fetchData(true);

            if (State.token) {
                this.startFetchLoop();
            } else if (!State.token && Object.keys(State.accountDataCache).length === 0) {
                UI.elements.tableContainer.innerHTML = '错误：未找到登录 Token。请登录后刷新页面。';
            }
        },
        async startFetchLoop() {
            console.log("GDS Enhancer: Starting continuous data fetch loop.");
            while (true) {
                if (document.visibilityState === 'visible') {
                    await this.fetchData(false);
                } else {
                    // If the page is not visible, wait for a bit before checking again
                    // to avoid busy-looping in the background.
                    await new Promise(res => setTimeout(res, 2000));
                }
            }
        },
        async fetchData(isInitialLoad = false) {
            if (State.isFetchingData) {
                console.log("GDS Enhancer: Fetch already in progress. Skipping this interval.");
                return;
            }
            State.isFetchingData = true;

            const fetchAttemptTime = new Date();
            if (UI.elements.lastRefreshTimeEl && !isInitialLoad) {
                UI.elements.lastRefreshTimeEl.innerText = `正在刷新... (${Utils.fmtDT(fetchAttemptTime)})`;
                UI.elements.lastRefreshTimeEl.classList.remove('error');
            }
            try {
                const res = await API.apiRequest({ method: "GET", url: "https://admin.gdspay.xyz/api/tripartite/v1/account/view", responseType: "json" });
                if (!res.ok || res.rawJson?.code !== 1 || !Array.isArray(res.rawJson?.data?.list)) {
                    const errorMsg = res.rawJson?.msg || res.error || res.rawText || `状态码: ${res.status}`;
                    UI.showFetchStatus(`API错误: ${errorMsg}.`, 'error', 7000);
                    if (UI.elements.lastRefreshTimeEl) { UI.elements.lastRefreshTimeEl.innerText = `API错误于: ${Utils.fmtDT(fetchAttemptTime)}.`; UI.elements.lastRefreshTimeEl.classList.add('error'); }
                    if (Object.keys(State.accountDataCache).length === 0) UI.elements.tableContainer.innerHTML = `获取数据失败：${Utils.esc(errorMsg)}。`;
                    return;
                }

                if (UI.elements.lastRefreshTimeEl) { UI.elements.lastRefreshTimeEl.innerText = `数据更新于: ${Utils.fmtDT(fetchAttemptTime)}`; UI.elements.lastRefreshTimeEl.classList.remove('error'); }
                State.lastSuccessfulDataTimestamp = fetchAttemptTime;
                await DB.saveSetting(Config.KEYS.LAST_REFRESH, State.lastSuccessfulDataTimestamp.toISOString());

                const apiList = res.rawJson.data.list;
                const nowFormattedStr = Utils.fmtDT(new Date());
                const currentApiAccountIds = new Set(apiList.map(item => String(item.accountId)));
                let isDataChanged = false;

                if (State.accountOrder.length === 0 && apiList.length > 0 && isInitialLoad) {
                    State.accountOrder = apiList.map(item => String(item.accountId));
                    isDataChanged = true;
                }

                State.accountOrder.forEach(accIdStr => {
                    const cacheEntry = State.accountDataCache[accIdStr];
                    if (!currentApiAccountIds.has(accIdStr) && cacheEntry?.current && !cacheEntry.current.isDisappeared) {
                        isDataChanged = true;
                        cacheEntry.current.isDisappeared = true;
                        cacheEntry.current.apiStatus = Config.API_STATUS.DISAPPEARED;
                        cacheEntry.current.loginStatus = 0;
                        cacheEntry.current.failedReason = "";
                        API.addLog(State.operationLogs, Config.STORES.OP_LOGS, Config.MAX_LOG_MEM, Config.MAX_LOG_DB, { accountId: accIdStr, accountName: cacheEntry.current.accountName, message: '<span class="status-disappeared">账号在API响应中消失</span>' });
                    }
                });

                apiList.forEach(apiItem => {
                    const accIdStr = String(apiItem.accountId);
                    let cacheEntry = State.accountDataCache[accIdStr];
                    const isNewAccount = !cacheEntry;

                    if (isNewAccount) {
                        isDataChanged = true;
                        cacheEntry = State.accountDataCache[accIdStr] = {
                            autoTransferSettings: Utils.initAutoTxSettings(),
                            autoStopReceiptSettings: Utils.initAutoStopSettings(),
                            current: {}
                        };
                        if (State.accountOrder.indexOf(accIdStr) === -1) State.accountOrder.push(accIdStr);
                    }

                    const prev = { ...cacheEntry.current };
                    const current = {
                        id: accIdStr,
                        platform: apiItem.tripartiteId,
                        accountName: apiItem.accountName,
                        phone: apiItem.otpReceiver,
                        balance: parseFloat(apiItem.balance) / 100,
                        frozenBalance: parseFloat(apiItem.frozenBalance) / 100,
                        apiStatus: parseInt(apiItem.accountStatus),
                        description: apiItem.description,
                        lastHeartbeatTime: apiItem.lastHeartbeatTime ? Utils.fmtDT(new Date(apiItem.lastHeartbeatTime)) : null,
                        lastChangeTime: prev.lastChangeTime || nowFormattedStr,
                        isDisappeared: false,
                        balanceHistory: prev.balanceHistory ? [...prev.balanceHistory] : [],
                        remarks: prev.remarks || '',
                        loginStatus: parseInt(apiItem.loginStatus),
                        failedReason: apiItem.failedReason,
                        balanceFailed: apiItem.balanceFailed,
                    };

                    // [修复] 增加保护性检查，防止API偶然返回0时错误地覆盖数据
                    if (!isInitialLoad && prev.balance > 0 && current.balance === 0) {
                        console.warn(`GDS 脚本 (ID: ${accIdStr}): API 返回余额为 0，上次为 ${Utils.fmtAmt(prev.balance)}。使用上次的值。`);
                        current.balance = prev.balance;
                    }
                    if (!isInitialLoad && prev.frozenBalance > 0 && current.frozenBalance === 0) {
                        console.warn(`GDS 脚本 (ID: ${accIdStr}): API 返回冻结余额为 0，上次为 ${Utils.fmtAmt(prev.frozenBalance)}。使用上次的值。`);
                        current.frozenBalance = prev.frozenBalance;
                    }

                    if (isNewAccount) {
                        API.addLog(State.operationLogs, Config.STORES.OP_LOGS, Config.MAX_LOG_MEM, Config.MAX_LOG_DB, { accountId: accIdStr, accountName: current.accountName, message: '<span class="log-status-change">检测到新账户并已添加</span>' });
                    } else {
                        let logMsgParts = [];
                        if (prev.balance !== current.balance) { isDataChanged = true; const diff = current.balance - prev.balance; logMsgParts.push(`余额: ${Utils.fmtAmt(prev.balance)} → ${Utils.fmtAmt(current.balance)} <span class="${diff > 0 ? 'log-amount-increase' : 'log-amount-decrease'}">(${diff > 0 ? '+' : ''}${Utils.fmtAmt(diff)})</span>`); }
                        if (prev.frozenBalance !== current.frozenBalance) { isDataChanged = true; const diff = current.frozenBalance - prev.frozenBalance; logMsgParts.push(`冻结: ${Utils.fmtAmt(prev.frozenBalance)} → ${Utils.fmtAmt(current.frozenBalance)} <span class="${diff > 0 ? 'log-amount-increase' : 'log-amount-decrease'}">(${diff > 0 ? '+' : ''}${Utils.fmtAmt(diff)})</span>`); if (diff > 0 && prev.frozenBalance >= 0 && !isInitialLoad) API.addLog(State.frozenBalanceIncreaseLogs, Config.STORES.FROZEN_LOGS, Config.MAX_FROZEN_LOG_MEM, Config.MAX_FROZEN_LOG_DB, { accountId: accIdStr, accountName: current.accountName, message: `冻结增加: ${Utils.fmtAmt(prev.frozenBalance)} → ${Utils.fmtAmt(current.frozenBalance)}` }); }
                        if (prev.apiStatus !== current.apiStatus) { isDataChanged = true; logMsgParts.push(`在线状态: ${Utils.fmtApiStatus(prev.apiStatus).text} → <span class="log-status-change">${Utils.fmtApiStatus(current.apiStatus).text}</span>`); }
                        if (prev.balanceFailed !== current.balanceFailed) { isDataChanged = true; logMsgParts.push(`余额查询失败: ${prev.balanceFailed ? '是' : '否'} → <span class="log-status-change">${current.balanceFailed ? '是' : '否'}</span>`); }
                        if (logMsgParts.length > 0) {
                            current.lastChangeTime = nowFormattedStr;
                            let intervalStr = 'N/A';
                            if (prev.lastChangeTime) { const prevDate = new Date(prev.lastChangeTime.replace(/-/g, '/')); const currDate = new Date(current.lastChangeTime.replace(/-/g, '/')); if (!isNaN(prevDate) && !isNaN(currDate)) intervalStr = Utils.fmtInt(Math.round((currDate - prevDate) / 1000)); }
                            API.addLog(State.operationLogs, Config.STORES.OP_LOGS, Config.MAX_LOG_MEM, Config.MAX_LOG_DB, { accountId: accIdStr, accountName: current.accountName, message: logMsgParts.join('， '), interval: intervalStr });
                        }
                    }
                    current.balanceHistory.push({ timestamp: Date.now(), balance: current.balance });
                    if (current.balanceHistory.length > Config.MAX_BAL_HISTORY) current.balanceHistory.shift();
                    cacheEntry.current = current;
                });

                if (isDataChanged || isInitialLoad) {
                    console.log(`数据发生变动，重新渲染UI。初始加载: ${isInitialLoad}`);
                    UI.renderTable();
                } else {
                    console.log("数据无变动，跳过UI渲染。");
                }
                await DB.saveAccountData();
                UI.elements.hourlyRateDisplay.innerHTML = Automation.calculateEstimatedHourlyRate();
                await Automation.checkAndPerformAutoTransfers();
                await Automation.checkAndPerformAutoStopReceipt();
                await Automation.checkAndPerformAutoReEnable();

            } catch (e) {
                if (e.message === 'Token刷新失败，无法重试原请求。' || e.message === 'Token missing') {
                    if (State.refreshIntervalId) clearInterval(State.refreshIntervalId);
                    UI.showFetchStatus('登录已过期或Token无效，即将刷新页面...', 'error', 0);
                    await GM_setValue(Config.KEYS.RELOAD_DELAY, Date.now());
                    location.reload();
                    return;
                }
                UI.showFetchStatus(`脚本错误: ${e.message}.`, 'error', 7000);
                if (UI.elements.lastRefreshTimeEl) { UI.elements.lastRefreshTimeEl.innerText = `脚本错误于: ${Utils.fmtDT(fetchAttemptTime)}.`; UI.elements.lastRefreshTimeEl.classList.add('error'); }
                if (Object.keys(State.accountDataCache).length === 0) UI.elements.tableContainer.innerHTML = `获取数据时发生脚本错误: ${Utils.esc(e.message)}。`;
            } finally {
                State.isFetchingData = false;
            }
        }
    };

    App.init();

})();
