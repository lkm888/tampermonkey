// ==UserScript==
// @name         GDS 综合报表工具集 (数据逻辑修复版)
// @namespace    gds-comprehensive-report-toolkit-logic-fix
// @version      33.3
// @description  【逻辑修复】修复了“按银行账户统计”因新数据格式而遗漏部分UPI流水的问题，确保统计的完整性。
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

    const LAST_REPORT_KEY = 'gds_last_report_type';

    function injectGlobalStyles() {
        const styles = `
            /* General & Launcher Styles */
            #stats-button { position: fixed; bottom: 20px; right: 20px; z-index: 9999; padding: 10px 15px; font-size: 14px; font-weight: bold; color: white; background-color: #007BFF; border: none; border-radius: 5px; cursor: pointer; box-shadow: 0 4px 8px rgba(0,0,0,0.2); transition: all 0.2s ease-in-out; }
            #stats-button:hover { background-color: #0056b3; transform: translateY(-2px); }
            #stats-button:disabled { background-color: #cccccc; cursor: not-allowed; transform: none; }
            #stats-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.6); z-index: 10000; display: none; justify-content: center; align-items: flex-start; padding-top: 5vh; backdrop-filter: blur(3px); }
            #stats-modal { background-color: #fefefe; padding: 20px; border-radius: 8px; width: 98%; max-width: 98vw; height: 90vh; overflow: auto; box-shadow: 0 5px 15px rgba(0,0,0,0.3); position: relative; }
            #stats-close-btn { position: absolute; top: 10px; right: 20px; font-size: 28px; font-weight: bold; color: #aaa; cursor: pointer; z-index: 10; }
            #stats-close-btn:hover { color: #333; }
            #stats-controls { display: flex; align-items: center; gap: 15px; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid #eee; flex-wrap: wrap; justify-content: center; }
            #stats-date-input { font-size: 16px; padding: 8px; border: 1px solid #ccc; border-radius: 4px; }
            #start-generation-btn { font-size: 16px; padding: 8px 15px; background-color: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; transition: all 0.2s ease-in-out; }
            #start-generation-btn:hover { background-color: #218838; transform: translateY(-2px); box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            #start-generation-btn:disabled { background-color: #cccccc; transform: none; box-shadow: none; }
            #table-search-input, #transfer-account-filter { font-size: 16px; padding: 8px; border: 1px solid #ccc; border-radius: 4px; }

            .report-selection-container { display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 20px; padding: 20px; width: 100%; }
            .report-selection-row { display: flex; justify-content: center; align-items: center; gap: 30px; }
            .report-selection-btn { font-size: 18px; font-weight: bold; padding: 20px 30px; border-radius: 8px; border: 2px solid transparent; cursor: pointer; transition: all 0.3s; min-width: 250px; text-align: center; }
            .report-selection-btn:hover { transform: translateY(-5px); box-shadow: 0 8px 15px rgba(0,0,0,0.15); }
            #select-reconciliation-report { background-color: #28a745; color: white; border-color: #218838; }
            #select-merchant-report { background-color: #17a2b8; color: white; border-color: #138496; }
            #select-account-merchant-rate-report { background-color: #ffc107; color: #212529; border-color: #e0a800; }
            #select-transfer-report { background-color: #6610f2; color: white; border-color: #5108d4; }
            #back-to-selection-btn { background: #6c757d; color: white; border: none; font-size: 14px; padding: 8px 12px; margin-right: 10px; border-radius: 4px; display: flex; align-items: center; gap: 5px; transition: all 0.2s ease-in-out; }
            #back-to-selection-btn:hover { background: #5a6268; transform: translateY(-2px); }

            /* Rich Table Visual Styles */
            #stats-results-container { display: flex; flex-direction: column; align-items: center; }
            #stats-results-container h1 { width: 100%; text-align: center; border-bottom: 2px solid #007BFF; padding-bottom: 10px; margin-top: 10px; margin-bottom: 15px; color: #333; }
            #stats-results-container table { display: inline-block; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; max-width: 100%; overflow-x: auto;}
            #stats-results-container td { position: relative; }
            #stats-results-container th, #stats-results-container td { border: 1px solid #ddd; padding: 10px 8px; white-space: nowrap; transition: all 0.2s ease-in-out; vertical-align: middle; }
            #stats-results-container th { background-color: #f2f2f2; font-weight: bold; position: sticky; top: -1px; cursor: pointer; user-select: none; text-align: center; }
            #stats-results-container tbody tr:nth-child(odd) { background-color: #f9f9f9; }
            #stats-results-container tbody tr:hover { background-color: #e6f7ff; transform: scale(1.015); box-shadow: 0 4px 8px rgba(0,0,0,0.1); z-index: 10; position: relative; }
            #stats-results-container tbody tr:hover td { font-size: 13px; }
            #stats-results-container tfoot td { background-color: #e9ecef; font-weight: bold; text-align: right; border-top: 2px solid #ccc; padding: 12px 8px; }
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

            /* Skeleton & Copy Feedback */
            .skeleton-table { width: 100%; }
            .skeleton-table .skeleton-row { display: flex; padding: 10px 0; border-bottom: 1px solid #e0e0e0; }
            .skeleton-table .skeleton-cell { height: 20px; background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%); background-size: 200% 100%; animation: skeleton-shine 1.5s infinite; border-radius: 4px; margin: 0 5px; }
            @keyframes skeleton-shine { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
            
            #copy-tooltip {
                position: fixed;
                background-color: rgba(0, 0, 0, 0.75);
                color: white;
                padding: 8px 12px;
                border-radius: 6px;
                font-size: 14px;
                z-index: 99999;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.3s, transform 0.3s;
                transform: translate(-50%, -100%) scale(0.9);
                white-space: pre-wrap;
                text-align: center;
                max-width: 300px;
            }
            #copy-tooltip.visible {
                opacity: 1;
                transform: translate(-50%, -120%) scale(1);
            }
        `;
        const styleSheet = document.createElement("style");
        styleSheet.type = "text/css";
        styleSheet.innerText = styles;
        document.head.appendChild(styleSheet);
    }

    let uiElements;
    let copyTooltip;
    let tooltipTimeout;

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
            const lastReport = localStorage.getItem(LAST_REPORT_KEY);
            if (lastReport === 'reconciliation') {
                reconciliationReport.initControls();
            } else if (lastReport === 'merchant') {
                merchantReport.initControls();
            } else if (lastReport === 'accountMerchantRate') {
                accountMerchantRateReport.initControls();
            } else if (lastReport === 'transfer') {
                transferReport.initControls();
            } else {
                showReportSelection();
            }
            overlay.style.display = 'flex';
        });

        copyTooltip = document.createElement('div');
        copyTooltip.id = 'copy-tooltip';
        body.appendChild(copyTooltip);

        return { statsButton, overlay, modal, controlsDiv, resultsContainer };
    }

    function showReportSelection() {
        if (!uiElements) return;
        const { controlsDiv, resultsContainer } = uiElements;
        controlsDiv.style.borderBottom = 'none';
        controlsDiv.innerHTML = `
            <div class="report-selection-container">
                <div class="report-selection-row">
                    <button id="select-reconciliation-report" class="report-selection-btn">按银行账户统计</button>
                    <button id="select-merchant-report" class="report-selection-btn">按商户统计</button>
                </div>
                <div class="report-selection-row">
                    <button id="select-account-merchant-rate-report" class="report-selection-btn">账户-商户成功率</button>
                    <button id="select-transfer-report" class="report-selection-btn">划转统计</button>
                </div>
            </div>
        `;
        resultsContainer.innerHTML = '';

        document.getElementById('select-reconciliation-report').addEventListener('click', () => {
            localStorage.setItem(LAST_REPORT_KEY, 'reconciliation');
            reconciliationReport.initControls();
        });
        document.getElementById('select-merchant-report').addEventListener('click', () => {
            localStorage.setItem(LAST_REPORT_KEY, 'merchant');
            merchantReport.initControls();
        });
        document.getElementById('select-account-merchant-rate-report').addEventListener('click', () => {
            localStorage.setItem(LAST_REPORT_KEY, 'accountMerchantRate');
            accountMerchantRateReport.initControls();
        });
        document.getElementById('select-transfer-report').addEventListener('click', () => {
            localStorage.setItem(LAST_REPORT_KEY, 'transfer');
            transferReport.initControls();
        });
    }
    
    function showSkeletonLoader(columns = 8) {
        if (!uiElements) return;
        const { resultsContainer } = uiElements;
        let skeletonHTML = '<div class="skeleton-table">';
        for (let i = 0; i < 10; i++) {
            skeletonHTML += '<div class="skeleton-row">';
            for (let j = 0; j < columns; j++) {
                const width = 80 + Math.random() * 70;
                skeletonHTML += `<div class="skeleton-cell" style="width: ${width}px; flex: 1 1 ${width}px;"></div>`;
            }
            skeletonHTML += '</div>';
        }
        skeletonHTML += '</div>';
        resultsContainer.innerHTML = skeletonHTML;
    }
    
    function addCopyToCell(td) {
        td.addEventListener('contextmenu', e => {
            e.preventDefault();
            const valueToCopy = td.innerText;
            navigator.clipboard.writeText(valueToCopy).then(() => {
                clearTimeout(tooltipTimeout);
                
                copyTooltip.innerHTML = `已复制: <br><b>${valueToCopy}</b>`;
                copyTooltip.style.left = `${e.clientX}px`;
                copyTooltip.style.top = `${e.clientY}px`;
                copyTooltip.classList.add('visible');

                tooltipTimeout = setTimeout(() => {
                    copyTooltip.classList.remove('visible');
                }, 1500);
            });
        });
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
                <button id="back-to-selection-btn">↩ 返回</button>
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
            const dataToRender = isCompleteMode ? this.masterResultData : this.masterResultData.filter(row => this.upiAccountSet.has(row['银行账户']));
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
                // ---【逻辑修复】使用 .includes() 替代 .startsWith() 来匹配UPI流水 ---
                if (!item.txnDescription || !item.txnDescription.toUpperCase().includes('UPI')) continue;
                
                const { channelId, merchantNo, accountName, matchSource, amount } = item;
                const groupKey = accountName || 'N/A';
                if (!statistics[groupKey]) {
                    statistics[groupKey] = {
                        channelId,
                        merchantNo,
                        accountName: groupKey,
                        ...Object.fromEntries(Object.values(MATCH_SOURCE_MAP).map(k => [k, { count: 0, totalAmount: 0 }]))
                    };
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
                const key = tripartiteAccount;
                if (!statistics[key]) {
                    statistics[key] = { '成功': { count: 0, totalAmount: 0 }, '已发送': { count: 0, totalAmount: 0 } };
                }
                if (status === 3) { statistics[key]['成功'].count++; statistics[key]['成功'].totalAmount += (actualAmount / 100); }
                else if (status === 2) { statistics[key]['已发送'].count++; statistics[key]['已发送'].totalAmount += (actualAmount / 100); }
            }
        },
        processPayoutData(statistics, items) {
            for (const item of items) {
                const { tripartiteAccount, amount } = item;
                if (!tripartiteAccount) continue;
                const key = tripartiteAccount;
                if (!statistics[key]) { statistics[key] = { count: 0, totalAmount: 0 }; }
                statistics[key].count++;
                statistics[key].totalAmount += (amount / 100);
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

                        if (key.includes('金额') || key.includes('-金')) {
                            formattedValue = formatCurrency(value);
                            td.classList.add('col-number');
                        } else if (key.includes('笔数') || key.includes('-笔')) {
                            formattedValue = formatInteger(value);
                            td.classList.add('col-number');
                        } else if (key.includes('率')) {
                            const rate = parseFloat(value) || 0;
                            formattedValue = `${rate.toFixed(2)}%`;
                            td.classList.add('col-number');
                        } else {
                            td.classList.add('col-text');
                        }
                        
                        if (key === '银行账户') td.classList.add('col-primary-text');
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
                        addCopyToCell(td);
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
                    const currentlyVisibleData = isCompleteMode ? fullDataForSorting : fullDataForSorting.filter(row => this.upiAccountSet.has(row['银行账户']));
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
            showSkeletonLoader(18);

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
                    uiElements.resultsContainer.innerHTML = `<div id="progress-container"><div id="progress-bar"><div id="progress-bar-inner" style="width: ${totalPagesCombined > 0 ? (progressCounter / totalPagesCombined) * 100 : 0}%"></div></div><div id="progress-text">正在处理: ${progressCounter} / ${totalPagesCombined} 页</div></div>`;
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

                    const allAccountKeys = new Set([...Object.keys(refStats), ...Object.keys(paymentStats), ...Object.keys(payoutStats)]);
                    this.upiAccountSet = new Set(Object.keys(refStats));
                    
                    this.masterResultData = Array.from(allAccountKeys).map(account => {
                        const refGroup = refStats[account] || { channelId: 'N/A', merchantNo: 'N/A', '自动': { count: 0, totalAmount: 0 }, '收银台': { count: 0, totalAmount: 0 }, 'TG补单': { count: 0, totalAmount: 0 }, '未匹配': { count: 0, totalAmount: 0 } };
                        const paymentData = paymentStats[account] || { '成功': { count: 0, totalAmount: 0 }, '已发送': { count: 0, totalAmount: 0 }};
                        const payoutData = payoutStats[account] || { count: 0, totalAmount: 0 };
                        const totalUpiCount = Object.values(refGroup).reduce((acc, val) => acc + (val.count || 0), 0);
                        const paymentSuccessCount = paymentData['成功'].count;
                        const paymentSentCount = paymentData['已发送'].count;
                        return {
                            'Channel ID': refGroup.channelId, 'Merchant No': refGroup.merchantNo, '银行账户': account,
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
                    }).sort((a,b) => String(a['银行账户']).localeCompare(String(b['银行账户'])));

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
                <button id="back-to-selection-btn">↩ 返回</button>
                <label for="stats-date-input" style="font-weight: bold;">选择日期:</label>
                <input type="date" id="stats-date-input" value="${getTodayString()}">
                <label class="filter-label">账户状态:</label>
                ${Object.entries(this.STATUS_MAP).map(([value, text]) => `<label class="status-filter-label"><input type="checkbox" data-status="${value}" checked>${text}</label>`).join('')}
                <label class="filter-label"><input type="checkbox" id="filter-active-merchants" checked>仅显示活跃商户</label>
                <button id="start-generation-btn">生成报表</button>
            `;
            document.getElementById('back-to-selection-btn').addEventListener('click', showReportSelection);
            document.getElementById('start-generation-btn').addEventListener('click', () => this.runReport());
            controlsDiv.querySelectorAll('[data-status], #filter-active-merchants').forEach(el => el.addEventListener('change', () => this.displayResults()));
        },
        displayResults() {
            if (this.masterResultData.length === 0 && this.currentReportDate) {
                 this.renderTable(`商户统计 (${this.currentReportDate})`, []);
                 return;
            }
            const selectedStatuses = Array.from(document.querySelectorAll('[data-status]:checked')).map(cb => this.STATUS_MAP[cb.dataset.status]);
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
                        } else if (key === '代收成功率' || key === '代付成功率') {
                            td.classList.add('col-number', 'col-rate');
                            const rate = parseFloat(value) || 0;
                            formattedValue = formatPercent(rate);
                            if (key === '代收成功率') {
                                if (rate >= 40) td.classList.add('rate-high'); else if (rate >= 30) td.classList.add('rate-medium'); else if (rate > 0) td.classList.add('rate-low');
                            } else if (key === '代付成功率') {
                                if (rate >= 80) td.classList.add('rate-high'); else if (rate >= 50) td.classList.add('rate-medium'); else if (rate > 0) td.classList.add('rate-low');
                            }
                        } else if (key === '账户状态') {
                            td.classList.add('col-center');
                            const statusNum = Object.keys(this.STATUS_MAP).find(k => this.STATUS_MAP[k] === value);
                            if(statusNum) td.classList.add(`status-cell-${statusNum}`);
                        } else if (key === '商户名称') {
                            td.classList.add('col-text', 'col-primary-text');
                        } else {
                            td.classList.add('col-text');
                        }

                        if (key === '账变 (₹)' || key === '当日佣金 (₹)' || key === '可用余额 (₹)' || key === '核对账变 (₹)') {
                            td.classList.add('col-highlight');
                            if (key === '账变 (₹)' || key === '核对账变 (₹)') {
                                if (value > 0) td.classList.add('col-profit');
                                if (value < 0) td.classList.add('col-loss');
                            }
                        }
                        if (key === '差额 (₹)') {
                            td.classList.add('col-highlight');
                            if (Math.abs(value) > 0.01) {
                                td.classList.add('col-loss');
                            }
                        }

                        td.innerText = formattedValue;
                        addCopyToCell(td);
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
            const sumColumns = ['可用余额 (₹)', '代收成功 (₹)', '代付成功 (₹)', '当日佣金 (₹)', '账变 (₹)', '核对账变 (₹)', '差额 (₹)'];
            const totals = {};
            sumColumns.forEach(header => { totals[header] = data.reduce((sum, row) => sum + (row[header] || 0), 0); });
            const footerRow = document.createElement('tr');
            headers.forEach((header, index) => {
                const td = document.createElement('td');
                if (index === 0) { td.innerText = `总计 (${data.length} 商户)`; td.classList.add('col-text'); }
                else if (totals[header] !== undefined) {
                    td.innerText = formatCurrency(totals[header]);
                    td.classList.add('col-number', 'col-highlight');
                    if (header === '账变 (₹)' || header === '核对账变 (₹)') { if(totals[header] > 0) td.classList.add('col-profit'); if(totals[header] < 0) td.classList.add('col-loss'); }
                    if (header === '差额 (₹)') { if (Math.abs(totals[header]) > 0.01) { td.classList.add('col-loss'); } }
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
            showSkeletonLoader(14);

            const token = localStorage.getItem('token');
            if (!token) { alert('无法获取Token，请重新登录。'); startGenBtn.disabled = false; uiElements.statsButton.disabled = false; startGenBtn.innerText = '生成报表'; return; }

            try {
                this.currentReportDate = document.getElementById('stats-date-input').value;
                const diffDays = Math.round((new Date(this.currentReportDate) - new Date(BASE_DATE_STR)) / ONE_DAY_MS);
                const dateBegin = BASE_TIMESTAMP + diffDays * ONE_DAY_MS;

                uiElements.resultsContainer.innerHTML = `<div id="progress-container"><div id="progress-bar"><div id="progress-bar-inner"></div></div><div id="progress-text">阶段 1/2: 获取所有商户列表...</div></div>`;
                let allMerchantsRaw = [];
                for (let page = 1; ; page++) {
                    const url = `https://admin.gdspay.xyz/api/merchant/v1/list?page=${page}&pageSize=${PAGE_SIZE}`;
                    const res = await fetchWithRetry(url, { headers: { "authorization": token } }, `商户列表 p${page}`);
                    const merchants = res?.data?.list || [];
                    if (merchants.length > 0) allMerchantsRaw.push(...merchants);
                    if (!res?.data || merchants.length < PAGE_SIZE) break;
                    await sleep(this.REQUEST_DELAY);
                }

                const filteredMerchants = allMerchantsRaw.filter(merchant => merchant.channelGroupId !== 2);
                console.log(`原始商户数量: ${allMerchantsRaw.length}, 过滤后数量: ${filteredMerchants.length}`);

                if (filteredMerchants.length === 0) {
                    this.masterResultData = [];
                    this.displayResults();
                    uiElements.resultsContainer.innerHTML = `<h1>商户统计 (${this.currentReportDate})</h1><p>没有找到符合条件的商户 (已排除 channelGroupId=2)。</p>`;
                    return;
                }

                uiElements.resultsContainer.innerHTML = `<div id="progress-container"><div id="progress-bar"><div id="progress-bar-inner"></div></div><div id="progress-text">阶段 2/2: 获取每日汇总...</div></div>`;
                const allMerchantIds = filteredMerchants.map(m => m.merchantId);
                const statsMap = new Map();
                for (let i = 0; i < allMerchantIds.length; i += this.STATS_API_BATCH_SIZE) {
                    const progress = (i / allMerchantIds.length) * 100;
                    updateProgressBar(progress, `阶段 2/2: 批次 ${Math.floor(i/this.STATS_API_BATCH_SIZE) + 1}/${Math.ceil(allMerchantIds.length / this.STATS_API_BATCH_SIZE)}`);
                    const batchIds = allMerchantIds.slice(i, i + this.STATS_API_BATCH_SIZE);
                    const statsUrl = `https://admin.gdspay.xyz/api/gateway/v1/statistics/summary/merchant?merchantIds=[${batchIds.join(',')}]&dateBegin=${dateBegin}&monthly=false`;
                    const statsRes = await fetchWithRetry(statsUrl, { headers: { "authorization": token } }, `每日汇总批次`);
                    if (statsRes?.data?.list) statsRes.data.list.forEach(stat => statsMap.set(stat.merchantId, stat));
                    await sleep(this.REQUEST_DELAY);
                }

                const defaultStats = { paymentNumberInitiate: 0, paymentNumberComplete: 0, paymentAmountComplete: 0, payoutNumberInitiate: 0, payoutNumberComplete: 0, payoutAmountComplete: 0, commissionFlow: 0, balanceFlow: 0 };
                this.masterResultData = filteredMerchants.map(m => {
                    const stats = statsMap.get(m.merchantId) || defaultStats;
                    const paymentAmount = stats.paymentAmountComplete / 100, paymentCount = stats.paymentNumberComplete;
                    const payoutAmount = stats.payoutAmountComplete / 100, payoutCount = stats.payoutNumberComplete;
                    const commission = stats.commissionFlow / 100;
                    const balanceChange = stats.balanceFlow / 100;
                    const calculatedChange = paymentAmount - payoutAmount - commission;
                    const difference = balanceChange - calculatedChange;
                    return {
                        '商户ID': m.merchantId, '商户名称': m.merchantName, '账户状态': this.STATUS_MAP[m.status] || '未知',
                        '代收成功(笔)': paymentCount, '代收成功 (₹)': paymentAmount, '代收均额 (₹)': paymentCount > 0 ? paymentAmount / paymentCount : 0,
                        '代收成功率': calculateRate(paymentCount, stats.paymentNumberInitiate),
                        '代付成功(笔)': payoutCount, '代付成功 (₹)': payoutAmount, '代付均额 (₹)': payoutCount > 0 ? payoutAmount / payoutCount : 0,
                        '代付成功率': calculateRate(payoutCount, stats.payoutNumberInitiate),
                        '费率': `${safeToFixed(m.paymentCommissionRate/10)}% / ${safeToFixed(m.payoutCommissionRate/10)}% + ₹${safeToFixed(m.payoutCommissionExtra/100)}`,
                        '当日佣金 (₹)': commission,
                        '账变 (₹)': balanceChange,
                        '核对账变 (₹)': calculatedChange,
                        '差额 (₹)': difference,
                        '可用余额 (₹)': m.availableBalance / 100,
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
    // IV. 账户-商户成功率模块
    // =========================================================================
    const accountMerchantRateReport = {
        masterResultData: [], currentFilteredData: [], currentReportDate: '', BATCH_SIZE: 50,

        initControls() {
            const { controlsDiv, resultsContainer } = uiElements;
            controlsDiv.innerHTML = '';
            controlsDiv.style.borderBottom = '1px solid #eee';
            resultsContainer.innerHTML = '';
            controlsDiv.innerHTML = `
                <button id="back-to-selection-btn">↩ 返回</button>
                <label for="stats-date-input" style="font-weight: bold;">选择日期:</label>
                <input type="date" id="stats-date-input" value="${getTodayString()}">
                <input type="text" id="table-search-input" placeholder="搜索账户/商户/编号..." style="display: none;">
                <button id="start-generation-btn">生成报表</button>
            `;
            document.getElementById('back-to-selection-btn').addEventListener('click', showReportSelection);
            document.getElementById('start-generation-btn').addEventListener('click', () => this.runReport());
            document.getElementById('table-search-input').addEventListener('input', (e) => this.filterTable(e.target.value));
        },
        async runReport() {
            const startGenBtn = document.getElementById('start-generation-btn');
            const dateInput = document.getElementById('stats-date-input');
            const searchInput = document.getElementById('table-search-input');

            startGenBtn.disabled = true; uiElements.statsButton.disabled = true; startGenBtn.innerText = '正在生成...';
            searchInput.style.display = 'none';
            searchInput.value = '';
            showSkeletonLoader(6);
            const token = localStorage.getItem('token');
            if (!token) { alert('无法获取Token，请重新登录。'); startGenBtn.disabled = false; uiElements.statsButton.disabled = false; startGenBtn.innerText = '生成报表'; return; }

            try {
                this.currentReportDate = dateInput.value;
                const diffDays = Math.round((new Date(this.currentReportDate) - new Date(BASE_DATE_STR)) / ONE_DAY_MS);
                const dateBegin = BASE_TIMESTAMP + diffDays * ONE_DAY_MS;
                const url = 'https://admin.gdspay.xyz/api/gateway/v1/payment/list';

                uiElements.resultsContainer.innerHTML = `<div id="progress-container"><div id="progress-bar"><div id="progress-bar-inner"></div></div><div id="progress-text">正在初始化...</div></div>`;
                const firstPageBody = JSON.stringify({ dateBegin, dateEnd: dateBegin, page: 1, pageSize: PAGE_SIZE });
                const firstPageOptions = { method: 'POST', headers: { "accept": "application/json", "content-type": "application/json", "authorization": token }, body: firstPageBody };
                const firstPageRes = await fetchWithRetry(url, firstPageOptions, '支付列表 p1');

                const totalOrders = firstPageRes?.data?.page?.total || 0;
                if (totalOrders === 0) {
                    this.masterResultData = [];
                    this.currentFilteredData = [];
                    this.renderTable(`账户-商户成功率 (${this.currentReportDate})`, []);
                    return;
                }

                const allOrders = firstPageRes.data.list || [];
                const totalPages = Math.ceil(totalOrders / PAGE_SIZE);
                let progressCounter = 1;
                updateProgressBar((progressCounter/totalPages)*100, `正在处理: 1 / ${totalPages} 页`);

                if (totalPages > 1) {
                    for (let batchStartPage = 2; batchStartPage <= totalPages; batchStartPage += this.BATCH_SIZE) {
                        const batchEndPage = Math.min(batchStartPage + this.BATCH_SIZE - 1, totalPages);
                        const batchPromises = [];
                        for (let page = batchStartPage; page <= batchEndPage; page++) {
                            const body = JSON.stringify({ dateBegin, dateEnd: dateBegin, page, pageSize: PAGE_SIZE });
                            const options = { method: 'POST', headers: { "accept": "application/json", "content-type": "application/json", "authorization": token }, body };
                            batchPromises.push(fetchWithRetry(url, options, `支付列表 p${page}`));
                        }

                        const results = await Promise.allSettled(batchPromises);
                        results.forEach(result => {
                            if (result.status === 'fulfilled' && result.value?.data?.list) {
                                allOrders.push(...result.value.data.list);
                            }
                        });
                        progressCounter = Math.min(batchEndPage, totalPages);
                        updateProgressBar((progressCounter/totalPages)*100, `正在处理: ${progressCounter} / ${totalPages} 页`);
                        if (batchEndPage < totalPages) await sleep(200);
                    }
                }

                const stats = {};
                for (const order of allOrders) {
                    const { tripartiteAccount, merchantName, merchantNo, status } = order;
                    if (!tripartiteAccount || !merchantName) continue;
                    const key = `${tripartiteAccount}|${merchantName}|${merchantNo}`;
                    if (!stats[key]) {
                        stats[key] = { tripartiteAccount, merchantName, merchantNo, total: 0, success: 0 };
                    }
                    stats[key].total++;
                    if (status === 3) {
                        stats[key].success++;
                    }
                }

                this.masterResultData = Object.values(stats).map(item => ({
                    '商户编号': item.merchantNo,
                    '银行账户': item.tripartiteAccount,
                    '商户名称': item.merchantName,
                    '成功笔数': item.success,
                    '总笔数': item.total,
                    '成功率': calculateRate(item.success, item.total),
                })).sort((a, b) => String(a['商户编号']).localeCompare(String(b['商户编号'])) || a['银行账户'].localeCompare(b['银行账户']));


                this.currentFilteredData = [...this.masterResultData];
                searchInput.style.display = 'inline-block';
                this.renderTable(`账户-商户成功率 (${this.currentReportDate})`, this.currentFilteredData);

            } catch (error) {
                uiElements.resultsContainer.innerHTML = `<h2>发生严重错误</h2><p>${error.message}</p>`;
            } finally {
                startGenBtn.disabled = false; uiElements.statsButton.disabled = false; startGenBtn.innerText = '生成报表';
            }
        },
        renderTable(title, data) {
            const { resultsContainer } = uiElements;
            resultsContainer.innerHTML = `<h1>${title}</h1>`;

            if (!this.masterResultData || this.masterResultData.length === 0) {
                 resultsContainer.innerHTML += '<p>没有找到任何数据。</p>'; return;
            }
            if (data.length === 0) {
                 resultsContainer.innerHTML += '<p>没有符合搜索条件的数据。</p>';
            }

            const table = document.createElement('table');
            const thead = document.createElement('thead');
            const tbody = document.createElement('tbody');
            table.append(thead, tbody);
            const headers = Object.keys(this.masterResultData[0] || {});

            const populateTbody = (dataToRender) => {
                tbody.innerHTML = '';
                dataToRender.forEach(rowData => {
                    const row = document.createElement('tr');
                    headers.forEach(key => {
                        const td = document.createElement('td');
                        const value = rowData[key];
                        let formattedValue = value;
                        
                        if (key.includes('笔数')) {
                            td.classList.add('col-number');
                            formattedValue = formatInteger(value);
                        } else if (key.includes('率')) {
                            td.classList.add('col-number', 'col-rate');
                            const rate = parseFloat(value) || 0;
                            formattedValue = formatPercent(rate);
                            if (rate >= 80) td.classList.add('rate-high');
                            else if (rate >= 50) td.classList.add('rate-medium');
                            else if (rate > 0) td.classList.add('rate-low');
                        } else {
                            td.classList.add('col-text');
                            if (key === '银行账户' || key === '商户名称' || key === '商户编号') {
                                td.classList.add('col-primary-text');
                            }
                        }
                        td.innerText = formattedValue;
                        addCopyToCell(td);
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

                    this.currentFilteredData.sort((a, b) => {
                        const valA = a[sortKey], valB = b[sortKey];
                        const r = (typeof valA === 'number' && typeof valB === 'number') ? valA - valB : String(valA).localeCompare(String(valB), undefined, { numeric: true });
                        return currentSortDir === 'asc' ? r : -r;
                    });

                    thead.querySelectorAll('th').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
                    e.currentTarget.classList.add(currentSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
                    populateTbody(this.currentFilteredData);
                });
            });
            thead.appendChild(headerRow);
            populateTbody(data);
            resultsContainer.appendChild(table);
        },
        filterTable(searchTerm) {
            const lowerCaseSearchTerm = searchTerm.toLowerCase();
            this.currentFilteredData = this.masterResultData.filter(row => {
                const accountCell = row['银行账户'].toLowerCase();
                const merchantCell = row['商户名称'].toLowerCase();
                const merchantNoCell = String(row['商户编号']).toLowerCase();
                return accountCell.includes(lowerCaseSearchTerm) || merchantCell.includes(lowerCaseSearchTerm) || merchantNoCell.includes(lowerCaseSearchTerm);
            });
            this.renderTable(`账户-商户成功率 (${this.currentReportDate})`, this.currentFilteredData);
        }
    };

    // =========================================================================
    // V. 划转统计模块
    // =========================================================================
    const transferReport = {
        masterResultData: [], currentFilteredData: [], currentReportDate: '', BATCH_SIZE: 100,

        initControls() {
            const { controlsDiv, resultsContainer } = uiElements;
            controlsDiv.innerHTML = '';
            controlsDiv.style.borderBottom = '1px solid #eee';
            resultsContainer.innerHTML = '';
            controlsDiv.innerHTML = `
                <button id="back-to-selection-btn">↩ 返回</button>
                <label for="stats-date-input" style="font-weight: bold;">选择日期:</label>
                <input type="date" id="stats-date-input" value="${getTodayString()}">
                <input type="text" id="transfer-account-filter" placeholder="筛选转出账户(多个用,分隔)">
                <button id="start-generation-btn">生成报表</button>
            `;
            document.getElementById('back-to-selection-btn').addEventListener('click', showReportSelection);
            document.getElementById('start-generation-btn').addEventListener('click', () => this.runReport());
            document.getElementById('transfer-account-filter').addEventListener('input', (e) => this.filterTable(e.target.value));
        },
        async runReport() {
            const startGenBtn = document.getElementById('start-generation-btn');
            const dateInput = document.getElementById('stats-date-input');
            const filterInput = document.getElementById('transfer-account-filter');

            startGenBtn.disabled = true; uiElements.statsButton.disabled = true; startGenBtn.innerText = '正在生成...';
            filterInput.value = '';
            showSkeletonLoader(8);
            const token = localStorage.getItem('token');
            if (!token) { alert('无法获取Token，请重新登录。'); startGenBtn.disabled = false; uiElements.statsButton.disabled = false; startGenBtn.innerText = '生成报表'; return; }

            try {
                this.currentReportDate = dateInput.value;
                const diffDays = Math.round((new Date(this.currentReportDate) - new Date(BASE_DATE_STR)) / ONE_DAY_MS);
                const dateBegin = BASE_TIMESTAMP + diffDays * ONE_DAY_MS;
                const dateEnd = dateBegin;
                
                const allTransfers = [];
                let currentPage = 1;
                while (true) {
                    const url = `https://admin.gdspay.xyz/api/tripartite/v1/transfer/list?dateBegin=${dateBegin}&dateEnd=${dateEnd}&page=${currentPage}&pageSize=${PAGE_SIZE}`;
                    const res = await fetchWithRetry(url, { headers: { "authorization": token } }, `划转列表 p${currentPage}`);
                    const transfers = res?.data?.list || [];
                    if (transfers.length > 0) {
                        allTransfers.push(...transfers);
                    }
                    if (!res?.data?.page || transfers.length < PAGE_SIZE) {
                        break;
                    }
                    currentPage++;
                    await sleep(this.REQUEST_DELAY);
                }

                if (allTransfers.length === 0) {
                    this.masterResultData = [];
                    this.currentFilteredData = [];
                    this.renderTable(`划转统计 (${this.currentReportDate})`, []);
                    return;
                }

                const stats = {};
                const MODE_MAP = { 1: 'IMPS', 2: 'NEFT', 3: 'RTGS' };

                for (const transfer of allTransfers) {
                    const { accountName, status, transferMode, amount } = transfer;
                    if (!accountName) continue;
                    
                    if (!stats[accountName]) {
                        stats[accountName] = {
                            '转出账户': accountName,
                            'IMPS 成功 (₹)': 0, 'IMPS 失败 (₹)': 0,
                            'NEFT 成功 (₹)': 0, 'NEFT 失败 (₹)': 0,
                            'RTGS 成功 (₹)': 0, 'RTGS 失败 (₹)': 0,
                            '成功总金额 (₹)': 0,
                        };
                    }
                    
                    const mode = MODE_MAP[transferMode];
                    if (!mode) continue;

                    const statusKey = status === 3 ? '成功' : status === 4 ? '失败' : null;
                    if (!statusKey) continue;
                    
                    const amountInRupees = amount / 100;
                    stats[accountName][`${mode} ${statusKey} (₹)`] += amountInRupees;
                    
                    if (status === 3) {
                        stats[accountName]['成功总金额 (₹)'] += amountInRupees;
                    }
                }
                
                this.masterResultData = Object.values(stats).sort((a,b) => a['转出账户'].localeCompare(b['转出账户']));
                this.currentFilteredData = [...this.masterResultData];
                this.renderTable(`划转统计 (${this.currentReportDate})`, this.currentFilteredData);

            } catch (error) {
                uiElements.resultsContainer.innerHTML = `<h2>发生严重错误</h2><p>${error.message}</p>`;
            } finally {
                startGenBtn.disabled = false; uiElements.statsButton.disabled = false; startGenBtn.innerText = '生成报表';
            }
        },
        renderTable(title, data) {
             const { resultsContainer } = uiElements;
            resultsContainer.innerHTML = `<h1>${title}</h1>`;

            if (!this.masterResultData || this.masterResultData.length === 0) {
                 resultsContainer.innerHTML += '<p>没有找到任何数据。</p>'; return;
            }
            if (data.length === 0) {
                 resultsContainer.innerHTML += '<p>没有符合筛选条件的数据。</p>';
            }

            const table = document.createElement('table');
            const thead = document.createElement('thead');
            const tbody = document.createElement('tbody');
            const tfoot = document.createElement('tfoot');
            table.append(thead, tbody, tfoot);
            const headers = Object.keys(this.masterResultData[0] || {});

            const populateTbody = (dataToRender) => {
                tbody.innerHTML = '';
                dataToRender.forEach(rowData => {
                    const row = document.createElement('tr');
                    headers.forEach(key => {
                        const td = document.createElement('td');
                        const value = rowData[key];
                        
                        if(key === '转出账户') {
                            td.classList.add('col-text', 'col-primary-text');
                            td.innerText = value;
                        } else {
                            td.classList.add('col-number');
                            td.innerText = formatCurrency(value);
                            if(key.includes('成功') && value > 0) td.classList.add('col-profit');
                            if(key.includes('失败') && value > 0) td.classList.add('col-loss');
                            if(key === '成功总金额 (₹)') td.classList.add('col-highlight');
                        }
                        
                        addCopyToCell(td);
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

                    this.currentFilteredData.sort((a, b) => {
                        const valA = a[sortKey], valB = b[sortKey];
                        const r = (typeof valA === 'number' && typeof valB === 'number') ? valA - valB : String(valA).localeCompare(String(valB), undefined, { numeric: true });
                        return currentSortDir === 'asc' ? r : -r;
                    });

                    thead.querySelectorAll('th').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
                    e.currentTarget.classList.add(currentSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
                    populateTbody(this.currentFilteredData);
                });
            });
            thead.appendChild(headerRow);
            
            const totals = {};
            headers.forEach(header => {
                if(header !== '转出账户'){
                    totals[header] = data.reduce((sum, row) => sum + (row[header] || 0), 0);
                }
            });

            const footerRow = document.createElement('tr');
            headers.forEach((header, index) => {
                const td = document.createElement('td');
                if (index === 0) { td.innerText = `总计 (${data.length} 账户)`; td.classList.add('col-text'); }
                else {
                    td.innerText = formatCurrency(totals[header]);
                    td.classList.add('col-number', 'col-highlight');
                    if (header.includes('成功') && totals[header] > 0) td.classList.add('col-profit');
                    if (header.includes('失败') && totals[header] > 0) td.classList.add('col-loss');
                }
                footerRow.appendChild(td);
            });
            tfoot.appendChild(footerRow);

            populateTbody(data);
            resultsContainer.appendChild(table);
        },
        filterTable(searchTerm) {
            const filterTerms = searchTerm.toLowerCase().split(',').map(term => term.trim()).filter(term => term);
            if (filterTerms.length === 0) {
                this.currentFilteredData = [...this.masterResultData];
            } else {
                this.currentFilteredData = this.masterResultData.filter(row => {
                    const accountNameLower = row['转出账户'].toLowerCase();
                    return filterTerms.some(term => accountNameLower.includes(term));
                });
            }
            this.renderTable(`划转统计 (${this.currentReportDate})`, this.currentFilteredData);
        }
    };

    // =========================================================================
    // VI. 主执行逻辑
    // =========================================================================
    function main() {
        injectGlobalStyles();
        uiElements = createBaseUI();
    }

    main();

})();
