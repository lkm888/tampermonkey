// ==UserScript==
// @name         GDS 综合报表工具集 (最终完美版)
// @namespace    gds-comprehensive-report-toolkit-final-perfected
// @version      16.0
// @description  【终极完美版】统一所有报表行为，日期选择不再记录，每次都从当天开始。UI界面精炼，移除多余边框，布局更清爽和谐。
// @author       Your Name
// @match        https://admin.gdspay.xyz/aa*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/lkm888/tampermonkey/main/merchant.user.js
// @downloadURL  https://raw.githubusercontent.com/lkm888/tampermonkey/main/merchant.user.js
// ==/UserScript==

(function() {
    'use strict';

    // =========================================================================
    // I. 共享模块 (Shared Modules)
    // =========================================================================

    function injectGlobalStyles() {
        const styles = `
            /* General & Launcher Styles */
            #stats-button { position: fixed; bottom: 20px; right: 20px; z-index: 9999; padding: 10px 15px; font-size: 14px; font-weight: bold; color: white; background-color: #007BFF; border: none; border-radius: 5px; cursor: pointer; box-shadow: 0 4px 8px rgba(0,0,0,0.2); transition: background-color 0.3s; }
            #stats-button:hover { background-color: #0056b3; }
            #stats-button:disabled { background-color: #cccccc; cursor: not-allowed; }
            #stats-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.5); z-index: 10000; display: none; justify-content: center; align-items: flex-start; padding-top: 5vh; }
            #stats-modal { background-color: #fefefe; padding: 20px; border-radius: 8px; width: 98%; max-width: 98vw; height: 90vh; overflow: auto; box-shadow: 0 5px 15px rgba(0,0,0,0.3); position: relative; }
            #stats-close-btn { position: absolute; top: 10px; right: 20px; font-size: 28px; font-weight: bold; color: #aaa; cursor: pointer; z-index: 10; }
            #stats-close-btn:hover { color: #333; }
            #stats-controls { display: flex; align-items: center; gap: 15px; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid #eee; flex-wrap: wrap; justify-content: flex-start; }
            #stats-date-input { font-size: 16px; padding: 8px; border: 1px solid #ccc; border-radius: 4px; }
            #start-generation-btn { font-size: 16px; padding: 8px 15px; background-color: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; }
            #start-generation-btn:hover { background-color: #218838; }
            #start-generation-btn:disabled { background-color: #cccccc; }

            #progress-container { width: 80%; margin: 50px auto; text-align: center; }
            #progress-bar { background-color: #e9ecef; border-radius: .25rem; height: 20px; width: 100%; overflow: hidden; }
            #progress-bar-inner { background-color: #007bff; height: 100%; width: 0%; transition: width 0.4s ease; }
            #progress-text { margin-top: 10px; font-weight: bold; color: #495057; }
            .copy-feedback { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background-color: #28a745; color: white; display: flex; justify-content: center; align-items: center; font-weight: bold; opacity: 0; transition: opacity 0.5s; pointer-events: none; }
            .filter-label, .status-filter-label, .toggle-label { display: flex; align-items: center; gap: 5px; font-weight: bold; cursor: pointer; user-select: none; }
            .report-selection-container { display: flex; justify-content: center; align-items: center; gap: 30px; padding: 40px 20px; width: 100%; }
            .report-selection-btn { font-size: 20px; font-weight: bold; padding: 25px 40px; border-radius: 8px; border: 2px solid transparent; cursor: pointer; transition: all 0.3s; }
            .report-selection-btn:hover { transform: translateY(-5px); box-shadow: 0 8px 15px rgba(0,0,0,0.15); }
            #select-reconciliation-report { background-color: #28a745; color: white; border-color: #218838; }
            #select-merchant-report { background-color: #17a2b8; color: white; border-color: #138496; }
            #back-to-selection-btn { background: none; border: none; color: #007bff; cursor: pointer; font-size: 14px; padding: 8px 0; margin-right: 10px;}

            /* Rich Table Visual Styles */
            #stats-results-container h1 { border-bottom: 2px solid #007BFF; padding-bottom: 10px; margin-top: 10px; margin-bottom: 15px; color: #333; }
            #stats-results-container table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; table-layout: auto; }
            #stats-results-container td { position: relative; }
            #stats-results-container th, #stats-results-container td { border: 1px solid #ddd; padding: 10px 8px; white-space: nowrap; transition: all 0.2s ease-in-out; vertical-align: middle; }
            #stats-results-container th { background-color: #f2f2f2; font-weight: bold; position: sticky; top: -1px; cursor: pointer; user-select: none; text-align: center; }
            #stats-results-container tbody tr:nth-child(odd) { background-color: #f9f9f9; }
            #stats-results-container tbody tr:hover { background-color: #e6f7ff; transform: scale(1.015); box-shadow: 0 4px 8px rgba(0,0,0,0.1); z-index: 10; position: relative; }
            #stats-results-container tbody tr:hover td { font-size: 13px; }
            #stats-results-container tfoot td { background-color: #e9ecef; font-weight: bold; text-align: right; }
            #stats-results-container tfoot td:first-child { text-align: left; }
            #stats-results-container th.sort-asc::after, #stats-results-container th.sort-desc::after { content: ''; display: inline-block; margin-left: 5px; border-left: 4px solid transparent; border-right: 4px solid transparent; }
            #stats-results-container th.sort-asc::after { border-bottom: 5px solid #333; }
            #stats-results-container th.sort-desc::after { border-top: 5px solid #333; }
            .col-text { text-align: left; }
            .col-number { text-align: right; font-family: 'Roboto Mono', 'Courier New', monospace; }
            .col-center { text-align: center; }
            .col-rate { white-space: normal; }
            .col-primary-text { font-weight: bold; font-size: 13px; }
            .col-secondary { color: #6c757d; font-size: 11px; }
            .col-highlight { font-weight: bold; font-size: 13px; color: #0056b3; }
            .col-profit { color: #28a745 !important; }
            .col-loss { color: #dc3545 !important; }
            .status-cell-1 { color: green; font-weight: bold; }
            .status-cell-2 { color: orange; font-weight: bold; }
            .status-cell-3 { color: red; font-weight: bold; }
            .rate-high { color: #28a745 !important; font-weight:bold; }
            .rate-medium { color: #ffc107 !important; font-weight:bold; }
            .rate-low { color: #dc3545 !important; font-weight:bold; }
        `;
        const styleSheet = document.createElement("style");
        styleSheet.type = "text/css";
        styleSheet.innerText = styles;
        document.head.appendChild(styleSheet);
    }

    let uiElements;

    function createBaseUI() {
        const body = document.body;
        const statsButton = document.createElement('button');
        statsButton.id = 'stats-button';
        statsButton.innerText = 'GDS 报表工具';
        body.appendChild(statsButton);
        const overlay = document.createElement('div');
        overlay.id = 'stats-overlay';
        body.appendChild(overlay);
        const modal = document.createElement('div');
        modal.id = 'stats-modal';
        overlay.appendChild(modal);
        const closeBtn = document.createElement('span');
        closeBtn.id = 'stats-close-btn';
        closeBtn.innerHTML = '×';
        modal.appendChild(closeBtn);
        const controlsDiv = document.createElement('div');
        controlsDiv.id = 'stats-controls';
        modal.appendChild(controlsDiv);
        const resultsContainer = document.createElement('div');
        resultsContainer.id = 'stats-results-container';
        modal.appendChild(resultsContainer);
        closeBtn.onclick = () => overlay.style.display = 'none';
        overlay.onclick = (e) => { if (e.target === overlay) overlay.style.display = 'none'; };
        statsButton.addEventListener('click', () => {
            showReportSelection();
            overlay.style.display = 'flex';
        });
        return { statsButton, overlay, modal, controlsDiv, resultsContainer };
    }

    function showReportSelection() {
        if (!uiElements) return;
        const { controlsDiv, resultsContainer } = uiElements;
        controlsDiv.style.borderBottom = 'none';
        controlsDiv.innerHTML = `
            <div class="report-selection-container">
                <button id="select-reconciliation-report" class="report-selection-btn">按银行账户统计</button>
                <button id="select-merchant-report" class="report-selection-btn">按商户统计</button>
            </div>
        `;
        resultsContainer.innerHTML = '';
        document.getElementById('select-reconciliation-report').addEventListener('click', () => reconciliationReport.initControls());
        document.getElementById('select-merchant-report').addEventListener('click', () => merchantReport.initControls());
    }

    const MAX_RETRIES = 3, RETRY_DELAY = 500, PAGE_SIZE = 100;
    const BASE_DATE_STR = '2025-06-15', BASE_TIMESTAMP = 1749925800000, ONE_DAY_MS = 86400000;
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const formatCurrency = (n) => typeof n !== 'number' ? n : new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
    const formatInteger = (n) => typeof n !== 'number' ? n : new Intl.NumberFormat('en-US').format(n);
    const formatPercent = (n, digits = 2) => typeof n !== 'number' ? n : `${n.toFixed(digits)}%`;
    const calculateRate = (success, total) => total > 0 ? (success / total) * 100 : 0;
    const getTodayString = () => new Date().toISOString().split('T')[0];
    const safeToFixed = (val, digits = 2) => (Number(val) || 0).toFixed(digits);
    const updateProgressBar = (percentage, text) => {
        const progressBarInner = document.getElementById('progress-bar-inner');
        const progressText = document.getElementById('progress-text');
        if (progressBarInner) progressBarInner.style.width = `${percentage}%`;
        if (progressText) progressText.innerText = text;
    };
    const fetchWithRetry = async (url, options, taskInfo = 'Request') => {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const response = await fetch(url, options);
                if (!response.ok) throw new Error(`HTTP Error: ${response.status} for ${taskInfo}`);
                const data = await response.json();
                if (data.code !== 0 && data.code !== 1) { throw new Error(`API 错误 (代码: ${data.code}): ${data.message || data.msg || '未知API错误'}`); }
                return data;
            } catch (error) {
                console.warn(`[第 ${attempt}/${MAX_RETRIES} 次尝试] ${taskInfo} 请求失败:`, error.message);
                if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY * attempt);
                else { console.error(`❌ ${taskInfo} 请求彻底失败。`); throw error; }
            }
        }
        throw new Error(`[${taskInfo}] 所有重试均失败。`);
    };

    // =========================================================================
    // II. 按银行账户统计模块
    // =========================================================================
    const reconciliationReport = {
        masterResultData: [], upiAccountSet: new Set(), currentReportDate: '', BATCH_SIZE: 100,

        initControls() {
            const { controlsDiv, resultsContainer } = uiElements;
            controlsDiv.innerHTML = '';
            controlsDiv.style.borderBottom = '1px solid #eee';
            resultsContainer.innerHTML = '';
            controlsDiv.innerHTML = `
                <button id="back-to-selection-btn">← 返回选择</button>
                <label for="stats-date-input" style="font-weight: bold;">选择日期:</label>
                <input type="date" id="stats-date-input" value="${getTodayString()}">
                <label class="toggle-label" id="view-toggle-label" style="display: none;">
                    <input type="checkbox" id="show-all-accounts-toggle">
                    显示所有账户 (完整模式)
                </label>
                <button id="start-generation-btn">生成报表</button>
            `;

            document.getElementById('back-to-selection-btn').addEventListener('click', showReportSelection);
            controlsDiv.querySelector('#show-all-accounts-toggle').addEventListener('change', () => this.toggleView());
            controlsDiv.querySelector('#start-generation-btn').addEventListener('click', () => this.runReport());
        },
        toggleView() {
            const isCompleteMode = document.getElementById('show-all-accounts-toggle').checked;
            const title = `银行账户统计 (${this.currentReportDate}) - ${isCompleteMode ? '完整模式' : 'UPI流水'}`;
            const dataToRender = isCompleteMode ? this.masterResultData : this.masterResultData.filter(row => this.upiAccountSet.has(row['Account Name']));
            this.renderTable(title, dataToRender, this.masterResultData);
        },
        async fetchAllPaginatedData({ taskName, createFetchPromise, processPageData, onProgress }) {
            const statistics = {};
            const firstPageResponse = await createFetchPromise(1);
            const pageInfo = firstPageResponse.data?.page || firstPageResponse.page;
            const listItems = Array.isArray(firstPageResponse.data) ? firstPageResponse.data : firstPageResponse.data?.list;
            if (!pageInfo || typeof pageInfo.total === 'undefined') { throw new Error(`[${taskName}] API响应格式错误`); }
            processPageData(statistics, listItems || []);
            onProgress();
            const totalPages = Math.ceil(pageInfo.total / PAGE_SIZE);
            if (totalPages > 1) {
                for (let batchStartPage = 2; batchStartPage <= totalPages; batchStartPage += this.BATCH_SIZE) {
                    const batchEndPage = Math.min(batchStartPage + this.BATCH_SIZE - 1, totalPages);
                    const batchPromises = Array.from({ length: batchEndPage - batchStartPage + 1 }, (_, i) => createFetchPromise(batchStartPage + i));
                    const results = await Promise.allSettled(batchPromises);
                    results.forEach(result => {
                        if (result.status === 'fulfilled') {
                            const pageList = Array.isArray(result.value.data) ? result.value.data : result.value.data?.list;
                            processPageData(statistics, pageList || []);
                        }
                        onProgress();
                    });
                    if (batchEndPage < totalPages) await sleep(200);
                }
            }
            return statistics;
        },
        processReferenceData(statistics, items) {
            const MATCH_SOURCE_MAP = { 0: '未匹配', 1: '自动', 3: '收银台', 4: 'TG补单' };
            for (const item of items) {
                if (!item.txnDescription || !item.txnDescription.toUpperCase().startsWith('UPI')) continue;
                const { channelId, merchantNo, accountName, matchSource, amount } = item;
                const groupKey = `${channelId}|${merchantNo}|${accountName || 'N/A'}`;
                if (!statistics[groupKey]) {
                    statistics[groupKey] = { channelId, merchantNo, accountName: accountName || 'N/A', ...Object.fromEntries(Object.values(MATCH_SOURCE_MAP).map(k => [k, { count: 0, totalAmount: 0 }])) };
                }
                const statusName = MATCH_SOURCE_MAP[matchSource];
                if (statusName) {
                    statistics[groupKey][statusName].count++;
                    statistics[groupKey][statusName].totalAmount += (amount / 100);
                }
            }
        },
        processPaymentData(statistics, items) {
            for (const item of items) {
                const { tripartiteAccount, status, actualAmount } = item;
                if (!tripartiteAccount) continue;
                if (!statistics[tripartiteAccount]) {
                    statistics[tripartiteAccount] = { '成功': { count: 0, totalAmount: 0 }, '已发送': { count: 0, totalAmount: 0 } };
                }
                if (status === 3) { statistics[tripartiteAccount]['成功'].count++; statistics[tripartiteAccount]['成功'].totalAmount += (actualAmount / 100); }
                else if (status === 2) { statistics[tripartiteAccount]['已发送'].count++; statistics[tripartiteAccount]['已发送'].totalAmount += (actualAmount / 100); }
            }
        },
        processPayoutData(statistics, items) {
            for (const item of items) {
                const { tripartiteAccount, amount } = item;
                if (!tripartiteAccount) continue;
                if (!statistics[tripartiteAccount]) { statistics[tripartiteAccount] = { count: 0, totalAmount: 0 }; }
                statistics[tripartiteAccount].count++;
                statistics[tripartiteAccount].totalAmount += (amount / 100);
            }
        },
        renderTable(title, dataToRender, fullDataForSorting) {
            const { resultsContainer } = uiElements;
            resultsContainer.innerHTML = `<h1>${title}</h1>`;
            if (!fullDataForSorting || fullDataForSorting.length === 0) {
                resultsContainer.innerHTML += '<p>没有找到任何数据。</p>'; return;
            }
            const table = document.createElement('table');
            const thead = document.createElement('thead');
            const tbody = document.createElement('tbody');
            const tfoot = document.createElement('tfoot');
            table.append(thead, tbody, tfoot);
            const headers = Object.keys(fullDataForSorting[0]);
            const populateTbody = (data) => {
                tbody.innerHTML = '';
                data.forEach(rowData => {
                    const row = document.createElement('tr');
                    headers.forEach(key => {
                        const td = document.createElement('td');
                        const value = rowData[key];
                        let formattedValue = value;
                        td.classList.add('col-number');
                        if (key.includes('金额') || key.includes('-金')) { formattedValue = formatCurrency(value); }
                        else if (key.includes('笔数') || key.includes('-笔')) { formattedValue = formatInteger(value); }
                        else { td.classList.remove('col-number'); td.classList.add('col-text'); }
                        if (key === 'Account Name') td.classList.add('col-primary-text');
                        if (key === '转入金额') td.classList.add('col-profit');
                        if (key === '转出金额') td.classList.add('col-loss');

                        if (key === '成功率 (自动)') {
                            const rate = parseFloat(value);
                            if (rate >= 90) td.classList.add('rate-high');
                            else if (rate >= 80) td.classList.add('rate-medium');
                            else if (rate > 0 || (typeof value === 'string' && value !== '0.00%')) td.classList.add('rate-low');
                        } else if (key.includes('成功率') || key.includes('补单率')) {
                            const rate = parseFloat(value);
                            if (rate >= 40) td.classList.add('rate-high'); else if (rate >= 30) td.classList.add('rate-medium'); else if (rate > 0 || (typeof value === 'string' && value !== '0.00%')) td.classList.add('rate-low');
                        }

                        td.innerText = formattedValue;
                        td.addEventListener('contextmenu', e => { e.preventDefault(); navigator.clipboard.writeText(td.innerText).then(() => {
                                let feedback = td.querySelector('.copy-feedback'); if (!feedback) { feedback = document.createElement('div'); feedback.className = 'copy-feedback'; feedback.innerText = '已复制!'; td.appendChild(feedback); }
                                feedback.style.opacity = '1'; setTimeout(() => { feedback.style.opacity = '0'; }, 1000);
                            });
                        });
                        row.appendChild(td);
                    });
                    tbody.appendChild(row);
                });
            };
            const headerRow = document.createElement('tr');
            headers.forEach(key => {
                const th = document.createElement('th');
                th.innerText = key;
                th.dataset.key = key;
                headerRow.appendChild(th);
                th.addEventListener('click', e => {
                    const sortKey = e.currentTarget.dataset.key;
                    const currentSortDir = table.dataset.sortKey === sortKey && table.dataset.sortDir === 'asc' ? 'desc' : 'asc';
                    table.dataset.sortKey = sortKey; table.dataset.sortDir = currentSortDir;
                    fullDataForSorting.sort((a, b) => {
                        const valA = a[sortKey], valB = b[sortKey]; let r = 0;
                        if (typeof valA === 'number' && typeof valB === 'number') r = valA - valB;
                        else if (String(valA).endsWith('%') && String(valB).endsWith('%')) r = parseFloat(valA) - parseFloat(valB);
                        else r = String(valA).localeCompare(String(valB), undefined, { numeric: true });
                        return currentSortDir === 'asc' ? r : -r;
                    });
                    thead.querySelectorAll('th').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
                    e.currentTarget.classList.add(currentSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
                    const isCompleteMode = document.getElementById('show-all-accounts-toggle').checked;
                    const currentlyVisibleData = isCompleteMode ? fullDataForSorting : fullDataForSorting.filter(row => this.upiAccountSet.has(row['Account Name']));
                    populateTbody(currentlyVisibleData);
                });
            });
            thead.appendChild(headerRow);
            const totals = {};
            headers.forEach(header => {
                if (header.includes('笔数') || header.includes('-笔') || header.includes('金额') || header.includes('-金')) {
                    totals[header] = fullDataForSorting.reduce((sum, row) => sum + (row[header] || 0), 0);
                }
            });
            const totalPaymentSuccess = totals['代收成功-笔'] || 0;
            const totalPaymentSent = totals['代收已发送-笔'] || 0;
            totals['代收成功率'] = (totalPaymentSuccess + totalPaymentSent) > 0 ? `${calculateRate(totalPaymentSuccess, totalPaymentSuccess + totalPaymentSent).toFixed(2)}%` : '0.00%';
            const footerRow = document.createElement('tr');
            headers.forEach((header, index) => {
                const td = document.createElement('td');
                if (index === 0) { td.innerText = '总计'; td.classList.add('col-text');}
                else {
                    const totalValue = totals[header];
                    if (totalValue !== undefined) td.innerText = (header.includes('金额') || header.includes('-金')) ? formatCurrency(totalValue) : (header.includes('笔数') || header.includes('-笔')) ? formatInteger(totalValue) : totalValue;
                    td.classList.add('col-number');
                }
                footerRow.appendChild(td);
            });
            tfoot.appendChild(footerRow);
            populateTbody(dataToRender);
            resultsContainer.appendChild(table);
        },
        async runReport() {
            const dateInput = document.getElementById('stats-date-input');
            const startGenBtn = document.getElementById('start-generation-btn');
            const toggleLabel = document.getElementById('view-toggle-label');

            startGenBtn.disabled = true; uiElements.statsButton.disabled = true; startGenBtn.innerText = '正在统计...';
            toggleLabel.style.display = 'none';
            uiElements.resultsContainer.innerHTML = `<div id="progress-container"><div id="progress-bar"><div id="progress-bar-inner"></div></div><div id="progress-text">正在初始化...</div></div>`;

            this.currentReportDate = dateInput.value;
            const diffDays = Math.round((new Date(this.currentReportDate) - new Date(BASE_DATE_STR)) / ONE_DAY_MS);
            const DATE_BEGIN = BASE_TIMESTAMP + diffDays * ONE_DAY_MS;
            const token = localStorage.getItem('token');
            if (!token) { alert('无法获取Token，请重新登录。'); startGenBtn.disabled = false; uiElements.statsButton.disabled = false; startGenBtn.innerText = '生成报表'; return; }
            const baseHeaders = { "accept": "application/json", "authorization": token };
            const postHeaders = { ...baseHeaders, "content-type": "application/json" };

            try {
                let totalPagesCombined = 0, progressCounter = 0;
                const onProgress = () => {
                    progressCounter++;
                    updateProgressBar((totalPagesCombined > 0 ? progressCounter / totalPagesCombined : 0) * 100, `正在处理: ${progressCounter} / ${totalPagesCombined} 页`);
                };

                const tasks = [
                    { taskName: 'Reference List', createFetchPromise: (page) => fetchWithRetry(`https://admin.gdspay.xyz/api/gateway/v1/reference/list?dateBegin=${DATE_BEGIN}&dateEnd=${DATE_BEGIN}&page=${page}&pageSize=${PAGE_SIZE}`, { headers: baseHeaders }, `Reference-p${page}`), processPageData: this.processReferenceData.bind(this) },
                    { taskName: 'Payment List', createFetchPromise: (page) => fetchWithRetry('https://admin.gdspay.xyz/api/gateway/v1/payment/list', { method: 'POST', headers: postHeaders, body: JSON.stringify({ dateBegin: DATE_BEGIN, dateEnd: DATE_BEGIN, page, pageSize: PAGE_SIZE }) }, `Payment-p${page}`), processPageData: this.processPaymentData.bind(this) },
                    { taskName: 'Payout List', createFetchPromise: (page) => fetchWithRetry('https://admin.gdspay.xyz/api/gateway/v1/payout/list', { method: 'POST', headers: postHeaders, body: JSON.stringify({ statuses: [3], dateBegin: DATE_BEGIN, dateEnd: DATE_BEGIN, page, pageSize: PAGE_SIZE }) }, `Payout-p${page}`), processPageData: this.processPayoutData.bind(this) },
                ];

                const firstPageResponses = await Promise.all(tasks.map(task => task.createFetchPromise(1)));
                totalPagesCombined = firstPageResponses.reduce((sum, res) => sum + Math.ceil((res.data?.page?.total || res.page?.total || 0) / PAGE_SIZE), 0);

                if (totalPagesCombined === 0) {
                     uiElements.resultsContainer.innerHTML = `<h1>银行账户统计 (${this.currentReportDate})</h1><p>在指定日期没有找到任何数据。</p>`;
                } else {
                    const [refStats, paymentStats, payoutStats] = await Promise.all(tasks.map((task) => this.fetchAllPaginatedData({ ...task, onProgress })));
                    const allAccountKeys = new Set([...Object.values(refStats).map(g => g.accountName), ...Object.keys(paymentStats), ...Object.keys(payoutStats)]);
                    this.upiAccountSet = new Set(Object.values(refStats).map(g => g.accountName));
                    this.masterResultData = Array.from(allAccountKeys).map(account => {
                        const refGroupKey = Object.keys(refStats).find(key => key.endsWith(`|${account}`));
                        const refGroup = refStats[refGroupKey] || { channelId: 'N/A', merchantNo: 'N/A', accountName: account, '自动': { count: 0, totalAmount: 0 }, '收银台': { count: 0, totalAmount: 0 }, 'TG补单': { count: 0, totalAmount: 0 }, '未匹配': { count: 0, totalAmount: 0 } };
                        const paymentData = paymentStats[account] || { '成功': { count: 0, totalAmount: 0 }, '已发送': { count: 0, totalAmount: 0 }};
                        const payoutData = payoutStats[account] || { count: 0, totalAmount: 0 };
                        const totalUpiCount = Object.values(refGroup).reduce((acc, val) => acc + (val.count || 0), 0);
                        const paymentSuccessCount = paymentData['成功'].count;
                        const paymentSentCount = paymentData['已发送'].count;
                        return {
                            'Channel ID': refGroup.channelId, 'Merchant No': refGroup.merchantNo, 'Account Name': account,
                            '转入金额': paymentData['成功'].totalAmount, '转出金额': payoutData.totalAmount,
                            '代收成功-笔': paymentSuccessCount, '代收已发送-笔': paymentSentCount, '代收成功率': (paymentSuccessCount + paymentSentCount) > 0 ? `${calculateRate(paymentSuccessCount, paymentSuccessCount + paymentSentCount).toFixed(2)}%` : '0.00%',
                            '成功金额 (自动)': refGroup['自动'].totalAmount, '成功率 (自动)': totalUpiCount > 0 ? `${calculateRate(refGroup['自动'].count, totalUpiCount).toFixed(2)}%` : '0.00%',
                            '补单金额': refGroup['收银台'].totalAmount + refGroup['TG补单'].totalAmount, '补单率': totalUpiCount > 0 ? `${calculateRate(refGroup['收银台'].count + refGroup['TG补单'].count, totalUpiCount).toFixed(2)}%` : '0.00%',
                            '自动-笔': refGroup['自动'].count, '自动-金': refGroup['自动'].totalAmount,
                            '收银台-笔': refGroup['收银台'].count, '收银台-金': refGroup['收银台'].totalAmount,
                            'TG补单-笔': refGroup['TG补单'].count, 'TG补单-金': refGroup['TG补单'].totalAmount,
                            '未匹配-笔': refGroup['未匹配'].count, '未匹配-金': refGroup['未匹配'].totalAmount,
                            '总笔数 (UPI)': totalUpiCount, '总金额 (UPI)': Object.values(refGroup).reduce((acc, val) => acc + (val.totalAmount || 0), 0),
                        };
                    }).sort((a,b) => String(a['Account Name']).localeCompare(String(b['Account Name'])));

                    document.getElementById('show-all-accounts-toggle').checked = false;
                    this.toggleView();
                    toggleLabel.style.display = 'flex';
                }
            } catch (error) {
                uiElements.resultsContainer.innerHTML = `<h2>发生严重错误</h2><p>${error.message}</p>`;
            } finally {
                startGenBtn.disabled = false; uiElements.statsButton.disabled = false; startGenBtn.innerText = '生成报表';
            }
        },
    };

    // =========================================================================
    // III. 按商户统计模块
    // =========================================================================
    const merchantReport = {
        masterResultData: [], currentReportDate: '', STATUS_MAP: { 1: '正常', 2: '止付', 3: '封禁' }, STATS_API_BATCH_SIZE: 40, REQUEST_DELAY: 100,

        initControls() {
            const { controlsDiv, resultsContainer } = uiElements;
            controlsDiv.innerHTML = '';
            controlsDiv.style.borderBottom = '1px solid #eee';
            resultsContainer.innerHTML = '';
            controlsDiv.innerHTML = `
                <button id="back-to-selection-btn">← 返回选择</button>
                <label for="stats-date-input" style="font-weight: bold;">选择日期:</label>
                <input type="date" id="stats-date-input" value="${getTodayString()}">
                <div id="status-filter-group" style="display: flex; gap: 10px; align-items: center;">
                    <label class="filter-label">账户状态:</label>
                    ${Object.entries(this.STATUS_MAP).map(([value, text]) => `<label class="status-filter-label"><input type="checkbox" data-status="${value}" checked>${text}</label>`).join('')}
                </div>
                <label class="filter-label"><input type="checkbox" id="filter-active-merchants" checked>仅显示活跃商户</label>
                <button id="start-generation-btn">生成报表</button>
            `;
            document.getElementById('back-to-selection-btn').addEventListener('click', showReportSelection);
            document.getElementById('start-generation-btn').addEventListener('click', () => this.runReport());
            controlsDiv.querySelectorAll('#status-filter-group input, #filter-active-merchants').forEach(el => el.addEventListener('change', () => this.displayResults()));
        },
        displayResults() {
            if (this.masterResultData.length === 0 && this.currentReportDate) {
                 this.renderTable(`商户统计 (${this.currentReportDate})`, []);
                 return;
            }
            const selectedStatuses = Array.from(document.querySelectorAll('#status-filter-group input:checked')).map(cb => this.STATUS_MAP[cb.dataset.status]);
            let dataToDisplay = this.masterResultData.filter(row => selectedStatuses.includes(row['账户状态']));
            if (document.getElementById('filter-active-merchants').checked) {
                dataToDisplay = dataToDisplay.filter(row => row['代收成功(笔)'] > 0 || row['代付成功(笔)'] > 0);
            }
            this.renderTable(`商户统计 (${this.currentReportDate})`, dataToDisplay);
        },
        renderTable(title, data) {
            const { resultsContainer } = uiElements;
            resultsContainer.innerHTML = `<h1>${title}</h1>`;
            if (!data || data.length === 0) {
                resultsContainer.innerHTML += '<p>没有找到符合条件的数据。</p>'; return;
            }
            const table = document.createElement('table');
            const thead = document.createElement('thead');
            const tbody = document.createElement('tbody');
            const tfoot = document.createElement('tfoot');
            table.append(thead, tbody, tfoot);
            const headers = Object.keys(data[0]);
            const populateTbody = (dataToRender) => {
                tbody.innerHTML = '';
                dataToRender.forEach(rowData => {
                    const row = document.createElement('tr');
                    headers.forEach(key => {
                        const td = document.createElement('td');
                        const value = rowData[key];
                        let formattedValue = value;
                        if (key.includes('(₹)') || key.includes('均额')) {
                            td.classList.add('col-number');
                            if (key.includes('均额')) td.classList.add('col-secondary');
                            formattedValue = formatCurrency(value);
                        } else if (key.includes('(笔)')) {
                            td.classList.add('col-number', 'col-secondary');
                            formattedValue = formatInteger(value);
                        } else if (key.includes('率')) {
                            td.classList.add('col-number', 'col-rate');
                            const rate = parseFloat(value);
                            if (key === '代收成功率') {
                                if (rate >= 40) td.classList.add('rate-high'); else if (rate >= 30) td.classList.add('rate-medium'); else if (rate > 0) td.classList.add('rate-low');
                            } else if (key === '代付成功率') {
                                if (rate >= 80) td.classList.add('rate-high'); else if (rate >= 50) td.classList.add('rate-medium'); else if (rate > 0) td.classList.add('rate-low');
                            }
                            formattedValue = formatPercent(value);
                        } else if (key === '账户状态') {
                            td.classList.add('col-center');
                            const statusNum = Object.keys(this.STATUS_MAP).find(k => this.STATUS_MAP[k] === value);
                            if(statusNum) td.classList.add(`status-cell-${statusNum}`);
                        } else if (key === '商户名称') {
                            td.classList.add('col-text', 'col-primary-text');
                        } else {
                            td.classList.add('col-text');
                        }
                        if (key === '账变 (₹)' || key === '当日佣金 (₹)' || key === '可用余额 (₹)') {
                            td.classList.add('col-highlight');
                            if (key === '账变 (₹)') { if (value > 0) td.classList.add('col-profit'); if (value < 0) td.classList.add('col-loss'); }
                        }
                        td.innerText = formattedValue;
                        td.addEventListener('contextmenu', e => { e.preventDefault(); navigator.clipboard.writeText(td.innerText).then(() => {
                                let feedback = td.querySelector('.copy-feedback'); if (!feedback) { feedback = document.createElement('div'); feedback.className = 'copy-feedback'; feedback.innerText = '已复制!'; td.appendChild(feedback); }
                                feedback.style.opacity = '1'; setTimeout(() => { feedback.style.opacity = '0'; }, 1000);
                            });
                        });
                        row.appendChild(td);
                    });
                    tbody.appendChild(row);
                });
            };
            const headerRow = document.createElement('tr');
            headers.forEach(key => {
                const th = document.createElement('th');
                th.innerText = key;
                th.dataset.key = key;
                headerRow.appendChild(th);
                th.addEventListener('click', e => {
                    const sortKey = e.currentTarget.dataset.key;
                    const currentSortDir = table.dataset.sortKey === sortKey && table.dataset.sortDir === 'asc' ? 'desc' : 'asc';
                    table.dataset.sortKey = sortKey; table.dataset.sortDir = currentSortDir;
                    data.sort((a, b) => {
                        const valA = a[sortKey], valB = b[sortKey];
                        const r = (typeof valA === 'number' && typeof valB === 'number') ? valA - valB : String(valA).localeCompare(String(valB), undefined, { numeric: true });
                        return currentSortDir === 'asc' ? r : -r;
                    });
                    thead.querySelectorAll('th').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
                    e.currentTarget.classList.add(currentSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
                    populateTbody(data);
                });
            });
            thead.appendChild(headerRow);
            const sumColumns = ['可用余额 (₹)', '代收成功 (₹)', '代付成功 (₹)', '当日佣金 (₹)', '账变 (₹)'];
            const totals = {};
            sumColumns.forEach(header => { totals[header] = data.reduce((sum, row) => sum + (row[header] || 0), 0); });
            const footerRow = document.createElement('tr');
            headers.forEach((header, index) => {
                const td = document.createElement('td');
                if (index === 0) { td.innerText = `总计 (${data.length} 商户)`; td.classList.add('col-text'); }
                else if (totals[header] !== undefined) {
                    td.innerText = formatCurrency(totals[header]);
                    td.classList.add('col-number', 'col-highlight');
                    if (header === '账变 (₹)') { if(totals[header] > 0) td.classList.add('col-profit'); if(totals[header] < 0) td.classList.add('col-loss'); }
                }
                footerRow.appendChild(td);
            });
            tfoot.appendChild(footerRow);
            populateTbody(data);
            resultsContainer.appendChild(table);
        },
        async runReport() {
            const startGenBtn = document.getElementById('start-generation-btn');
            startGenBtn.disabled = true; uiElements.statsButton.disabled = true; startGenBtn.innerText = '正在生成...';
            uiElements.resultsContainer.innerHTML = `<div id="progress-container"><div id="progress-bar"><div id="progress-bar-inner"></div></div><div id="progress-text">正在初始化...</div></div>`;
            const token = localStorage.getItem('token');
            if (!token) { alert('无法获取Token，请重新登录。'); startGenBtn.disabled = false; uiElements.statsButton.disabled = false; startGenBtn.innerText = '生成报表'; return; }

            try {
                this.currentReportDate = document.getElementById('stats-date-input').value;
                const diffDays = Math.round((new Date(this.currentReportDate) - new Date(BASE_DATE_STR)) / ONE_DAY_MS);
                const dateBegin = BASE_TIMESTAMP + diffDays * ONE_DAY_MS;

                updateProgressBar(10, '阶段 1/2: 获取所有商户列表...');
                const allMerchantsRaw = [];
                for (let page = 1; ; page++) {
                    const url = `https://admin.gdspay.xyz/api/merchant/v1/list?page=${page}&pageSize=${PAGE_SIZE}`;
                    const res = await fetchWithRetry(url, { headers: { "authorization": token } }, `商户列表 p${page}`);
                    const merchants = res?.data?.list || [];
                    if (merchants.length > 0) allMerchantsRaw.push(...merchants);
                    if (!res?.data || merchants.length < PAGE_SIZE) break;
                    await sleep(this.REQUEST_DELAY);
                }

                updateProgressBar(50, `阶段 2/2: 获取每日汇总...`);
                const allMerchantIds = allMerchantsRaw.map(m => m.merchantId);
                const statsMap = new Map();
                for (let i = 0; i < allMerchantIds.length; i += this.STATS_API_BATCH_SIZE) {
                    const progress = 50 + (i / allMerchantIds.length) * 50;
                    updateProgressBar(progress, `阶段 2/2: 批次 ${Math.floor(i/this.STATS_API_BATCH_SIZE) + 1}/${Math.ceil(allMerchantIds.length / this.STATS_API_BATCH_SIZE)}`);
                    const batchIds = allMerchantIds.slice(i, i + this.STATS_API_BATCH_SIZE);
                    const statsUrl = `https://admin.gdspay.xyz/api/gateway/v1/statistics/summary/merchant?merchantIds=[${batchIds.join(',')}]&dateBegin=${dateBegin}&monthly=false`;
                    const statsRes = await fetchWithRetry(statsUrl, { headers: { "authorization": token } }, `每日汇总批次`);
                    if (statsRes?.data?.list) statsRes.data.list.forEach(stat => statsMap.set(stat.merchantId, stat));
                    await sleep(this.REQUEST_DELAY);
                }

                const defaultStats = { paymentNumberInitiate: 0, paymentNumberComplete: 0, paymentAmountComplete: 0, payoutNumberInitiate: 0, payoutNumberComplete: 0, payoutAmountComplete: 0, commissionFlow: 0, balanceFlow: 0 };
                this.masterResultData = allMerchantsRaw.map(m => {
                    const stats = statsMap.get(m.merchantId) || defaultStats;
                    const paymentAmount = stats.paymentAmountComplete / 100, paymentCount = stats.paymentNumberComplete;
                    const payoutAmount = stats.payoutAmountComplete / 100, payoutCount = stats.payoutNumberComplete;
                    return {
                        '商户ID': m.merchantId, '商户名称': m.merchantName, '账户状态': this.STATUS_MAP[m.status] || '未知',
                        '代收成功(笔)': paymentCount, '代收成功 (₹)': paymentAmount, '代收均额 (₹)': paymentCount > 0 ? paymentAmount / paymentCount : 0,
                        '代收成功率': calculateRate(paymentCount, stats.paymentNumberInitiate),
                        '代付成功(笔)': payoutCount, '代付成功 (₹)': payoutAmount, '代付均额 (₹)': payoutCount > 0 ? payoutAmount / payoutCount : 0,
                        '代付成功率': calculateRate(payoutCount, stats.payoutNumberInitiate),
                        '费率': `${safeToFixed(m.paymentCommissionRate/10)}% / ${safeToFixed(m.payoutCommissionRate/10)}% + ₹${safeToFixed(m.payoutCommissionExtra/100)}`,
                        '当日佣金 (₹)': stats.commissionFlow / 100, '账变 (₹)': stats.balanceFlow / 100, '可用余额 (₹)': m.availableBalance / 100,
                    };
                }).sort((a,b) => b['账变 (₹)'] - a['账变 (₹)']);

                this.displayResults();

            } catch (error) {
                uiElements.resultsContainer.innerHTML = `<h2>发生严重错误</h2><p>${error.message}</p><p style="margin-top:10px; color: #666;"><b>常见原因：</b>登录凭证(Token)已过期。请尝试<b>退出并重新登录</b>，稍后再试。</p>`;
            } finally {
                startGenBtn.disabled = false; uiElements.statsButton.disabled = false; startGenBtn.innerText = '生成报表';
            }
        },
    };

    // =========================================================================
    // IV. 主执行逻辑 (Main Execution Logic)
    // =========================================================================
    function main() {
        injectGlobalStyles();
        uiElements = createBaseUI();
    }

    main();

})();
