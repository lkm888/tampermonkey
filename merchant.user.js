// ==UserScript==
// @name         GDS 商户综合报表 
// @namespace    gds-merchant-comprehensive-report-custom
// @version      9.5
// @description  【体验升级】引入“悬停放大”效果和动态字体层次，在不牺牲信息密度的前提下，大幅提升可读性。
// @author       Your Name
// @match        https://admin.gdspay.xyz/dd*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/lkm888/tampermonkey/main/merchant.user.js
// @downloadURL  https://raw.githubusercontent.com/lkm888/tampermonkey/main/merchant.user.js

// ==/UserScript==

(function() {
    'use strict';

    // --- 全局变量 ---
    let masterResultData = [];
    let currentReportDate = '';
    const STATUS_MAP = { 1: '正常', 2: '止付', 3: '封禁' };
    const STORAGE_KEY = 'gds_report_filters';

    // --- 样式注入 (核心修改处) ---
    const styles = `
        /* General Styles */
        #stats-button { position: fixed; bottom: 20px; right: 20px; z-index: 9999; padding: 10px 15px; font-size: 14px; font-weight: bold; color: white; background-color: #007BFF; border: none; border-radius: 5px; cursor: pointer; box-shadow: 0 4px 8px rgba(0,0,0,0.2); transition: background-color 0.3s; }
        #stats-button:hover { background-color: #0056b3; }
        #stats-button:disabled { background-color: #cccccc; cursor: not-allowed; }
        #stats-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.5); z-index: 10000; display: none; justify-content: center; align-items: flex-start; padding-top: 5vh; }
        #stats-modal { background-color: #fefefe; padding: 20px; border-radius: 8px; width: 98%; max-width: 1800px; height: 90vh; overflow: auto; box-shadow: 0 5px 15px rgba(0,0,0,0.3); position: relative; }
        #stats-close-btn { position: absolute; top: 10px; right: 20px; font-size: 28px; font-weight: bold; color: #aaa; cursor: pointer; }
        #stats-close-btn:hover { color: #333; }
        #stats-controls { display: flex; align-items: center; gap: 15px; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid #eee; flex-wrap: wrap; }
        #stats-date-input { font-size: 16px; padding: 8px; border: 1px solid #ccc; border-radius: 4px; }
        #start-generation-btn { font-size: 16px; padding: 8px 15px; background-color: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; }
        #start-generation-btn:hover { background-color: #218838; }
        #start-generation-btn:disabled { background-color: #cccccc; }
        .filter-label, .status-filter-label { display: flex; align-items: center; gap: 5px; font-weight: bold; cursor: pointer; user-select: none; }
        #status-filter-group { display: flex; gap: 10px; border: 1px solid #ccc; padding: 5px 10px; border-radius: 4px; align-items: center; }
        #status-filter-group > label { font-weight: normal; }
        #progress-container { width: 80%; margin: 50px auto; text-align: center; }
        #progress-bar { background-color: #e9ecef; border-radius: .25rem; height: 20px; width: 100%; overflow: hidden; }
        #progress-bar-inner { background-color: #007bff; height: 100%; width: 0%; transition: width 0.4s ease; }
        #progress-text { margin-top: 10px; font-weight: bold; color: #495057; }
        #stats-results-container h1 { border-bottom: 2px solid #007BFF; padding-bottom: 10px; margin-top: 10px; margin-bottom: 15px; color: #333; }
        .copy-feedback { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background-color: #28a745; color: white; display: flex; justify-content: center; align-items: center; font-weight: bold; opacity: 0; transition: opacity 0.5s; pointer-events: none; }

        /* --- 【新】表格视觉优化样式 --- */
        #stats-results-container table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; }
        #stats-results-container td { position: relative; }
        #stats-results-container th, #stats-results-container td {
            border: 1px solid #ddd;
            padding: 10px 8px; /* 增加垂直内边距 */
            white-space: nowrap;
            transition: all 0.2s ease-in-out; /* 平滑过渡效果 */
            vertical-align: middle;
        }
        #stats-results-container th { background-color: #f2f2f2; font-weight: bold; position: sticky; top: -1px; cursor: pointer; user-select: none; text-align: center; }
        #stats-results-container tbody tr:nth-child(odd) { background-color: #f9f9f9; }
        #stats-results-container tbody tr:hover {
            background-color: #e6f7ff;
            transform: scale(1.015); /* 悬停时轻微放大行 */
            box-shadow: 0 4px 8px rgba(0,0,0,0.1);
            z-index: 10;
            position: relative;
        }
        #stats-results-container tbody tr:hover td {
            font-size: 13px; /* 悬停时放大该行字体 */
        }
        #stats-results-container tfoot td { background-color: #e9ecef; font-weight: bold; }

        /* Sorting Arrows */
        #stats-results-container th.sort-asc::after, #stats-results-container th.sort-desc::after { content: ''; display: inline-block; margin-left: 5px; border-left: 4px solid transparent; border-right: 4px solid transparent; }
        #stats-results-container th.sort-asc::after { border-bottom: 5px solid #333; }
        #stats-results-container th.sort-desc::after { border-top: 5px solid #333; }

        /* Alignment & Font */
        .col-text { text-align: left; }
        .col-number { text-align: right; font-family: 'Roboto Mono', 'Courier New', monospace; }
        .col-center { text-align: center; }
        .col-rate { white-space: normal; }

        /* Highlighting & Colors */
        .col-highlight { font-weight: bold; font-size: 13px; color: #0056b3; }
        .col-profit { color: #28a745; }
        .col-loss { color: #dc3545; }
        .col-secondary { color: #6c757d; font-size: 11px; }
        .col-primary-text { font-weight: bold; font-size: 13px; }

        /* Status Colors */
        .status-cell-1 { color: green; font-weight: bold; }
        .status-cell-2 { color: orange; font-weight: bold; }
        .status-cell-3 { color: red; font-weight: bold; }

        /* Success Rate Colors */
        .rate-high { color: #28a745 !important; font-weight:bold; }
        .rate-medium { color: #ffc107 !important; font-weight:bold; }
        .rate-low { color: #dc3545 !important; font-weight:bold; }
    `;
    const styleSheet = document.createElement("style"); styleSheet.type = "text/css"; styleSheet.innerText = styles; document.head.appendChild(styleSheet);

    // --- UI 元素创建 (无变化) ---
    const body = document.body;
    const statsButton = document.createElement('button'); statsButton.id = 'stats-button'; statsButton.innerText = '商户综合报表'; body.appendChild(statsButton);
    const overlay = document.createElement('div'); overlay.id = 'stats-overlay'; body.appendChild(overlay);
    const modal = document.createElement('div'); modal.id = 'stats-modal'; overlay.appendChild(modal);
    const closeBtn = document.createElement('span'); closeBtn.id = 'stats-close-btn'; closeBtn.innerHTML = '×'; modal.appendChild(closeBtn);
    const controlsDiv = document.createElement('div'); controlsDiv.id = 'stats-controls'; modal.appendChild(controlsDiv);
    const dateLabel = document.createElement('label'); dateLabel.innerText = '选择日期:'; dateLabel.style.fontWeight = 'bold'; controlsDiv.appendChild(dateLabel);
    const dateInput = document.createElement('input'); dateInput.type = 'date'; dateInput.id = 'stats-date-input';
    controlsDiv.appendChild(dateInput);
    const statusFilterGroup = document.createElement('div');
    statusFilterGroup.id = 'status-filter-group';
    const statusLabel = document.createElement('span'); statusLabel.innerText = '账户状态:'; statusLabel.style.fontWeight = 'bold';
    statusFilterGroup.appendChild(statusLabel);
    Object.entries(STATUS_MAP).forEach(([value, text]) => {
        const label = document.createElement('label');
        label.className = 'status-filter-label';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.status = value;
        label.appendChild(checkbox);
        label.append(text);
        statusFilterGroup.appendChild(label);
    });
    controlsDiv.appendChild(statusFilterGroup);
    const filterLabel = document.createElement('label'); filterLabel.className = 'filter-label';
    const filterCheckbox = document.createElement('input'); filterCheckbox.type = 'checkbox'; filterCheckbox.id = 'filter-active-merchants';
    filterLabel.appendChild(filterCheckbox); filterLabel.append('仅显示活跃商户'); controlsDiv.appendChild(filterLabel);
    const startGenBtn = document.createElement('button'); startGenBtn.id = 'start-generation-btn'; startGenBtn.innerText = '生成报表'; controlsDiv.appendChild(startGenBtn);
    const resultsContainer = document.createElement('div'); resultsContainer.id = 'stats-results-container'; modal.appendChild(resultsContainer);
    closeBtn.onclick = () => overlay.style.display = 'none';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.style.display = 'none'; };

    // --- 核心逻辑 ---
    const MAX_RETRIES = 3, RETRY_DELAY = 500, PAGE_SIZE = 100;
    const STATS_API_BATCH_SIZE = 40, REQUEST_DELAY = 100;
    const BASE_DATE_STR = '2025-06-15', BASE_TIMESTAMP = 1749925800000, ONE_DAY_MS = 86400000;

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const formatCurrency = (n) => typeof n !=='number'?n:new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
    const formatInteger = (n) => typeof n!=='number'?n:new Intl.NumberFormat('en-US').format(n);
    const formatPercent = (n, digits = 2) => typeof n !== 'number' ? n : `${n.toFixed(digits)}%`;
    const calculateRate = (success, total) => total > 0 ? (success / total) * 100 : 0;
    const getTodayString = () => {
        const today = new Date();
        return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    };

    const saveFilters = () => {
        const statusFilters = {};
        document.querySelectorAll('#status-filter-group input').forEach(cb => {
            statusFilters[cb.dataset.status] = cb.checked;
        });
        const filters = {
            date: dateInput.value,
            statuses: statusFilters,
            activeOnly: filterCheckbox.checked,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
    };

    const loadFilters = () => {
        const savedFilters = localStorage.getItem(STORAGE_KEY);
        if (savedFilters) {
            const filters = JSON.parse(savedFilters);
            dateInput.value = filters.date || getTodayString();
            filterCheckbox.checked = typeof filters.activeOnly === 'boolean' ? filters.activeOnly : true;
            if (filters.statuses) {
                document.querySelectorAll('#status-filter-group input').forEach(cb => {
                    cb.checked = typeof filters.statuses[cb.dataset.status] === 'boolean' ? filters.statuses[cb.dataset.status] : true;
                });
            }
        } else {
            dateInput.value = getTodayString();
            filterCheckbox.checked = true;
            document.querySelectorAll('#status-filter-group input').forEach(cb => {
                cb.checked = true;
            });
        }
    };

    const updateProgressBar = (percentage, text) => {
        const progressBarInner = document.getElementById('progress-bar-inner');
        const progressText = document.getElementById('progress-text');
        if (progressBarInner) progressBarInner.style.width = `${percentage}%`;
        if (progressText) progressText.innerText = text;
    };

    const fetchWithRetry = async (url, options, taskInfo) => {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const response = await fetch(url, options);
                if (!response.ok) {
                    if (response.status === 429) {
                        console.warn(`[${taskInfo}] 收到 429 错误，等待更长时间后重试...`);
                        await sleep(RETRY_DELAY * attempt * 2);
                        continue;
                    }
                    throw new Error(`HTTP 错误: ${response.status} (${taskInfo})`);
                }
                const data = await response.json();
                if (data.code !== 0 && data.code !== 1) {
                    const errorMessage = data.message || data.msg || '未知API错误';
                    throw new Error(`API 错误 (代码: ${data.code}): ${errorMessage}`);
                }
                return data || { data: { list: [] } };
            } catch (error) {
                console.warn(`[第 ${attempt}/${MAX_RETRIES} 次尝试] ${taskInfo} 请求失败:`, error.message);
                if (attempt < MAX_RETRIES) { await sleep(RETRY_DELAY * attempt); }
                else {
                    console.error(`❌ ${taskInfo} 请求彻底失败。`);
                    throw error;
                }
            }
        }
        throw new Error(`[${taskInfo}] 所有重试均失败，未能获取数据。`);
    };

    const renderTable = (container, title, data) => {
        container.innerHTML = `<h1>${title}</h1>`;
        if (!data || data.length === 0) {
            container.innerHTML += '<p>没有找到符合条件的数据。</p>';
            return;
        }
        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const tbody = document.createElement('tbody');
        const tfoot = document.createElement('tfoot');
        table.append(thead, tbody, tfoot);
        const headers = Object.keys(data[0]);
        const sumColumns = ['可用余额 (₹)', '代收成功 (₹)', '代付成功 (₹)', '当日佣金 (₹)', '账变 (₹)'];
        const totals = {};
        sumColumns.forEach(header => {
            totals[header] = data.reduce((sum, row) => sum + (row[header] || 0), 0);
        });
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
                        if(key.includes('均额')) td.classList.add('col-secondary');
                        formattedValue = formatCurrency(value);
                    } else if (key.includes('(笔)')) {
                        td.classList.add('col-number', 'col-secondary');
                        formattedValue = formatInteger(value);
                    } else if (key.includes('率')) {
                        td.classList.add('col-number', 'col-secondary');
                        td.dataset.sort = typeof value === 'number' ? value : -1;
                        if (key === '代收成功率') {
                            if (value >= 40) td.classList.add('rate-high');
                            else if (value >= 30) td.classList.add('rate-medium');
                            else if (value > 0) td.classList.add('rate-low');
                        } else if (key === '代付成功率') {
                            if (value >= 80) td.classList.add('rate-high');
                            else if (value >= 50) td.classList.add('rate-medium');
                            else if (value > 0) td.classList.add('rate-low');
                        }
                        formattedValue = formatPercent(value);
                    } else if (key === '账户状态') {
                        td.classList.add('col-center');
                        const statusNum = Object.keys(STATUS_MAP).find(k => STATUS_MAP[k] === value);
                        if(statusNum) td.classList.add(`status-cell-${statusNum}`);
                    } else if (key === '费率') {
                        td.classList.add('col-rate', 'col-secondary');
                    }
                    else if (key === '商户名称') {
                        td.classList.add('col-text', 'col-primary-text');
                    }
                     else {
                        td.classList.add('col-text');
                    }

                    if (key === '账变 (₹)' || key === '当日佣金 (₹)' || key === '可用余额 (₹)') {
                        td.classList.add('col-highlight');
                        if (key === '账变 (₹)') {
                           if (value > 0) td.classList.add('col-profit');
                           if (value < 0) td.classList.add('col-loss');
                        }
                    }

                    td.innerText = formattedValue;
                    td.addEventListener('contextmenu', (e) => {
                        e.preventDefault();
                        navigator.clipboard.writeText(td.innerText).then(() => {
                            let feedback = td.querySelector('.copy-feedback');
                            if (!feedback) {
                                feedback = document.createElement('div');
                                feedback.className = 'copy-feedback';
                                feedback.innerText = '已复制!';
                                td.appendChild(feedback);
                            }
                            feedback.style.opacity = '1';
                            setTimeout(() => { feedback.style.opacity = '0'; }, 1000);
                        }).catch(err => console.error('复制失败:', err));
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
            th.addEventListener('click', (e) => {
                const sortKey = e.currentTarget.dataset.key;
                const currentSortDir = table.dataset.sortKey === sortKey && table.dataset.sortDir === 'asc' ? 'desc' : 'asc';
                table.dataset.sortKey = sortKey;
                table.dataset.sortDir = currentSortDir;
                thead.querySelectorAll('th').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
                e.currentTarget.classList.add(currentSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
                data.sort((a, b) => {
                    const valA = a[sortKey]; const valB = b[sortKey];
                    let compareResult = 0;
                    if (typeof valA === 'number' && typeof valB === 'number') { compareResult = valA - valB; }
                    else { compareResult = String(valA).localeCompare(String(valB), undefined, {numeric: true}); }
                    return currentSortDir === 'asc' ? compareResult : -compareResult;
                });
                populateTbody(data);
            });
        });
        thead.appendChild(headerRow);
        const footerRow = document.createElement('tr');
        headers.forEach((header, index) => {
            const td = document.createElement('td');
            td.classList.add('col-number');
            if (index === 0) {
                td.innerText = `总计 (${data.length} 商户)`;
                td.classList.remove('col-number');
                td.classList.add('col-text');
            } else {
                const totalValue = totals[header];
                if (typeof totalValue !== 'undefined' && !header.includes('均额')) {
                    td.innerText = formatCurrency(totalValue);
                    if (header === '账变 (₹)' || header === '当日佣金 (₹)' || header === '可用余额 (₹)') {
                        td.classList.add('col-highlight');
                         if (header === '账变 (₹)') {
                            if (totalValue > 0) td.classList.add('col-profit');
                            if (totalValue < 0) td.classList.add('col-loss');
                        }
                    }
                } else {
                    td.innerText = '';
                }
            }
            footerRow.appendChild(td);
        });
        tfoot.appendChild(footerRow);
        populateTbody(data);
        container.appendChild(table);
    };

    function displayResults() {
        if (masterResultData.length === 0) {
             renderTable(resultsContainer, `商户综合报表 (${currentReportDate})`, []);
             return;
        }
        const selectedStatuses = [];
        document.querySelectorAll('#status-filter-group input:checked').forEach(cb => {
            selectedStatuses.push(STATUS_MAP[cb.dataset.status]);
        });
        let dataToDisplay = masterResultData.filter(row => selectedStatuses.includes(row['账户状态']));
        if (document.getElementById('filter-active-merchants').checked) {
            dataToDisplay = dataToDisplay.filter(row =>
                row['代收成功(笔)'] > 0 || row['代付成功(笔)'] > 0
            );
        }
        renderTable(resultsContainer, `商户综合报表 (${currentReportDate})`, dataToDisplay);
        saveFilters();
    }

    startGenBtn.addEventListener('click', async () => {
        startGenBtn.disabled = true; statsButton.disabled = true; startGenBtn.innerText = '正在生成...';
        resultsContainer.innerHTML = `<div id="progress-container"><div id="progress-bar"><div id="progress-bar-inner"></div></div><div id="progress-text">正在初始化...</div></div>`;
        const token = localStorage.getItem('token');
        if (!token) { return; }
        const baseHeaders = { "accept": "application/json", "authorization": token };

        try {
            saveFilters();
            currentReportDate = dateInput.value;
            const baseDate = new Date(BASE_DATE_STR + 'T00:00:00Z');
            const selectedDate = new Date(currentReportDate + 'T00:00:00Z');
            const diffDays = Math.round((selectedDate - baseDate) / ONE_DAY_MS);
            const dateBegin = BASE_TIMESTAMP + diffDays * ONE_DAY_MS;

            updateProgressBar(10, '阶段 1/2: 获取所有商户列表...');
            const allMerchantsRaw = [];
            let merchantPage = 1;
            while (true) {
                const url = `https://admin.gdspay.xyz/api/merchant/v1/list?page=${merchantPage}&pageSize=${PAGE_SIZE}`;
                const response = await fetchWithRetry(url, { headers: baseHeaders }, `商户列表第${merchantPage}页`);
                const merchants = response?.data?.list || [];
                if (merchants.length > 0) { allMerchantsRaw.push(...merchants); }
                await sleep(REQUEST_DELAY);
                if (!response?.data || merchants.length < PAGE_SIZE) {
                    break;
                }
                merchantPage++;
            }
            if (allMerchantsRaw.length === 0) {
                throw new Error("API 未返回任何商户数据。");
            }

            updateProgressBar(50, `阶段 2/2: 获取每日汇总...`);
            const allMerchantIds = allMerchantsRaw.map(m => m.merchantId);
            const statsMap = new Map();
            const totalBatches = Math.ceil(allMerchantIds.length / STATS_API_BATCH_SIZE);
            for (let i = 0; i < totalBatches; i++) {
                const progressPercentage = 50 + (i / totalBatches) * 50;
                updateProgressBar(progressPercentage, `阶段 2/2: 获取每日汇总 (${i + 1}/${totalBatches})`);
                const batchIds = allMerchantIds.slice(i * STATS_API_BATCH_SIZE, (i + 1) * STATS_API_BATCH_SIZE);
                const statsUrl = `https://admin.gdspay.xyz/api/gateway/v1/statistics/summary/merchant?merchantIds=[${batchIds.join(',')}]&dateBegin=${dateBegin}&monthly=false`;
                const statsResponse = await fetchWithRetry(statsUrl, { headers: baseHeaders }, `每日汇总批次${i+1}`);
                if (statsResponse?.data?.list) {
                    statsResponse.data.list.forEach(stat => statsMap.set(stat.merchantId, stat));
                }
                await sleep(REQUEST_DELAY);
            }

            const defaultStats = {
                paymentNumberInitiate: 0, paymentNumberComplete: 0, paymentAmountComplete: 0,
                payoutNumberInitiate: 0, payoutNumberComplete: 0, payoutAmountComplete: 0,
                commissionFlow: 0, balanceFlow: 0,
            };
            masterResultData = allMerchantsRaw.map(merchant => {
                const stats = statsMap.get(merchant.merchantId) || defaultStats;
                const paymentRate = (merchant.paymentCommissionRate / 10).toFixed(2);
                const payoutRate = (merchant.payoutCommissionRate / 10).toFixed(2);
                const payoutExtra = (merchant.payoutCommissionExtra / 100).toFixed(2);
                const combinedRate = `${paymentRate}% / ${payoutRate}% + ₹${payoutExtra}`;
                const paymentAmount = stats.paymentAmountComplete / 100;
                const paymentCount = stats.paymentNumberComplete;
                const payoutAmount = stats.payoutAmountComplete / 100;
                const payoutCount = stats.payoutNumberComplete;

                return {
                    '商户ID': merchant.merchantId,
                    '商户名称': merchant.merchantName,
                    '账户状态': STATUS_MAP[merchant.status] || '未知',
                    '代收成功(笔)': paymentCount,
                    '代收成功 (₹)': paymentAmount,
                    '代收均额 (₹)': paymentCount > 0 ? paymentAmount / paymentCount : 0,
                    '代收成功率': calculateRate(paymentCount, stats.paymentNumberInitiate),
                    '代付成功(笔)': payoutCount,
                    '代付成功 (₹)': payoutAmount,
                    '代付均额 (₹)': payoutCount > 0 ? payoutAmount / payoutCount : 0,
                    '代付成功率': calculateRate(payoutCount, stats.payoutNumberInitiate),
                    '费率': combinedRate,
                    '当日佣金 (₹)': stats.commissionFlow / 100,
                    '账变 (₹)': stats.balanceFlow / 100,
                    '可用余额 (₹)': merchant.availableBalance / 100,
                };
            }).sort((a,b) => b['账变 (₹)'] - a['账变 (₹)']);

            displayResults();

        } catch (error) {
            resultsContainer.innerHTML = `<h2>发生严重错误</h2><p>${error.message}</p><p style="margin-top:10px; color: #666;"><b>常见原因：</b>登录凭证(Token)已过期或服务器请求过于频繁。请尝试<b>退出 GDS 后台并重新登录</b>，稍后再试。</p>`;
            console.error(error);
        } finally {
            startGenBtn.disabled = false; statsButton.disabled = false; startGenBtn.innerText = '生成报表';
        }
    });

    // --- 事件监听器 ---
    filterCheckbox.addEventListener('change', displayResults);
    document.querySelectorAll('#status-filter-group input').forEach(checkbox => {
        checkbox.addEventListener('change', displayResults);
    });
    dateInput.addEventListener('change', saveFilters);

    statsButton.addEventListener('click', () => {
        masterResultData = [];
        resultsContainer.innerHTML = '';
        overlay.style.display = 'flex';
    });

    // 首次加载脚本时，加载保存的筛选器状态
    loadFilters();

})();
