// ==UserScript==
// @name         GDS 综合报表工具集 (v35.0-refactored)
// @namespace    gds-comprehensive-report-toolkit-refactored
// @version      35.0
// @description  【重构优化版】重构UI渲染与执行逻辑，消除冗余代码，提升性能与可维护性。新增通用表格渲染器，统一报表生成流程。
// @author       Cline
// @match        https://admin.gdspay.xyz/aa*
// @grant        none
// @run-at       document-end
// @connect      gist.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/lkm888/tampermonkey/main/merchant.user.js
// @downloadURL  https://raw.githubusercontent.com/lkm888/tampermonkey/main/merchant.user.js
// ==/UserScript==

(function() {
    'use strict';

    // =========================================================================
    // I. 配置与工具模块 (Config & Utils)
    // =========================================================================
    const config = {
        LAST_REPORT_KEY: 'gds_last_report_type',
        MAX_RETRIES: 3,
        RETRY_DELAY: 500,
        PAGE_SIZE: 100,
        BASE_DATE_STR: '2025-06-15',
        BASE_TIMESTAMP: 1749925800000,
        ONE_DAY_MS: 86400000,
        HTML2CANVAS_URL: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
        STATUS_MAP: { 1: '正常', 2: '止付', 3: '封禁' },
        MATCH_SOURCE_MAP: { 0: '未匹配', 1: '自动', 3: '收银台', 4: 'TG补单' },
        TRANSFER_MODE_MAP: { 1: 'IMPS', 2: 'NEFT', 3: 'RTGS' },
        CONCURRENCY_LIMIT: 50, // Increased concurrency for faster, non-blocking requests
    };

    const utils = {
        sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
        formatCurrency: (n) => typeof n !== 'number' ? n : new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n),
        formatInteger: (n) => typeof n !== 'number' ? n : new Intl.NumberFormat('en-US').format(n),
        formatPercent: (n, digits = 2) => typeof n !== 'number' ? n : `${n.toFixed(digits)}%`,
        calculateRate: (success, total) => total > 0 ? (success / total) * 100 : 0,
        getTodayString: () => new Date().toISOString().split('T')[0],
        safeToFixed: (val, digits = 2) => (Number(val) || 0).toFixed(digits),
        getToken: () => localStorage.getItem('token'),
        async fetchWithRetry(url, options, taskInfo = 'Request') {
            for (let attempt = 1; attempt <= config.MAX_RETRIES; attempt++) {
                try {
                    const response = await fetch(url, options);
                    if (!response.ok) throw new Error(`HTTP Error: ${response.status} for ${taskInfo}`);
                    const data = await response.json();
                    if (data.code !== 0 && data.code !== 1) { throw new Error(`API 错误 (代码: ${data.code}): ${data.message || data.msg || '未知API错误'}`); }
                    return data;
                } catch (error) {
                    console.warn(`[第 ${attempt}/${config.MAX_RETRIES} 次尝试] ${taskInfo} 请求失败:`, error.message);
                    if (attempt < config.MAX_RETRIES) await utils.sleep(config.RETRY_DELAY * attempt);
                    else { console.error(`❌ ${taskInfo} 请求彻底失败。`); throw error; }
                }
            }
            throw new Error(`[${taskInfo}] 所有重试均失败。`);
        },
        async runPromisesWithConcurrency(promiseFactories, concurrency, onProgress) {
            const results = new Array(promiseFactories.length);
            let currentIndex = 0;
            const worker = async () => {
                while (currentIndex < promiseFactories.length) {
                    const taskIndex = currentIndex++;
                    const factory = promiseFactories[taskIndex];
                    if (factory) {
                        try {
                            const result = await factory();
                            results[taskIndex] = { status: 'fulfilled', value: result };
                        } catch (error) {
                            results[taskIndex] = { status: 'rejected', reason: error };
                        }
                        if (onProgress) onProgress();
                    }
                }
            };
            const workers = Array(concurrency).fill(null).map(worker);
            await Promise.all(workers);
            return results;
        }
    };

    // =========================================================================
    // II. UI & 交互模块 (UI & Interaction)
    // =========================================================================
    const ui = {
        elements: {},
        html2canvasPromise: null,
        tooltipTimeout: null,

        init() {
            this.injectGlobalStyles();
            this.createBaseUI();
            this.attachEventListeners();
        },

        injectGlobalStyles() {
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
            #stats-date-input, #table-search-input, #transfer-account-filter { font-size: 16px; padding: 8px; border: 1px solid #ccc; border-radius: 4px; }
            .action-btn { font-size: 16px; padding: 8px 15px; color: white; border: none; border-radius: 4px; cursor: pointer; transition: all 0.2s ease-in-out; }
            .action-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .action-btn:disabled { transform: none; box-shadow: none; background-color: #cccccc !important; cursor: not-allowed; }
            #start-generation-btn { background-color: #28a745; }
            #start-generation-btn:hover:not(:disabled) { background-color: #218838; }
            #screenshot-btn { background-color: #007bff; }
            #screenshot-btn:hover:not(:disabled) { background-color: #0056b3; }

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

            #copy-tooltip { position: fixed; background-color: rgba(0, 0, 0, 0.75); color: white; padding: 8px 12px; border-radius: 6px; font-size: 14px; z-index: 99999; pointer-events: none; opacity: 0; transition: opacity 0.3s, transform 0.3s; transform: translate(-50%, -100%) scale(0.9); white-space: pre-wrap; text-align: center; max-width: 300px; }
            #copy-tooltip.visible { opacity: 1; transform: translate(-50%, -120%) scale(1); }
            #progress-container { padding: 20px; text-align: center; }
            #progress-bar { width: 100%; background-color: #e0e0e0; border-radius: 4px; overflow: hidden; margin-bottom: 10px; }
            #progress-bar-inner { height: 20px; width: 0%; background-color: #007bff; transition: width 0.2s; }
            `;
            const styleSheet = document.createElement("style");
            styleSheet.type = "text/css";
            styleSheet.innerText = styles;
            document.head.appendChild(styleSheet);
        },

        createBaseUI() {
            const body = document.body;
            this.elements.statsButton = this.createElement('button', { id: 'stats-button', text: 'GDS 报表工具' });
            this.elements.overlay = this.createElement('div', { id: 'stats-overlay' });
            this.elements.modal = this.createElement('div', { id: 'stats-modal' });
            this.elements.closeBtn = this.createElement('span', { id: 'stats-close-btn', html: '×' });
            this.elements.controlsDiv = this.createElement('div', { id: 'stats-controls' });
            this.elements.resultsContainer = this.createElement('div', { id: 'stats-results-container' });
            this.elements.copyTooltip = this.createElement('div', { id: 'copy-tooltip' });

            this.elements.modal.append(this.elements.closeBtn, this.elements.controlsDiv, this.elements.resultsContainer);
            this.elements.overlay.appendChild(this.elements.modal);
            body.append(this.elements.statsButton, this.elements.overlay, this.elements.copyTooltip);
        },

        createElement(tag, props = {}) {
            const el = document.createElement(tag);
            if (props.id) el.id = props.id;
            if (props.class) el.className = props.class;
            if (props.text) el.innerText = props.text;
            if (props.html) el.innerHTML = props.html;
            if (props.type) el.type = props.type;
            if (props.value) el.value = props.value;
            if (props.placeholder) el.placeholder = props.placeholder;
            return el;
        },

        attachEventListeners() {
            this.elements.statsButton.addEventListener('click', () => {
                const lastReport = localStorage.getItem(config.LAST_REPORT_KEY);
                const reportModule = reportModules[lastReport];
                if (reportModule) {
                    reportModule.initControls();
                } else {
                    this.showReportSelection();
                }
                this.elements.overlay.style.display = 'flex';
            });

            this.elements.closeBtn.onclick = () => this.elements.overlay.style.display = 'none';
            this.elements.overlay.onclick = (e) => { if (e.target === this.elements.overlay) this.elements.overlay.style.display = 'none'; };

            // Centralized event handler for the controls container
            this.elements.controlsDiv.addEventListener('click', (e) => {
                const target = e.target.closest('button');
                if (!target) return;

                // Handle report selection
                if (target.matches('.report-selection-btn')) {
                    let reportName = target.id.replace('select-', '').replace('-report', '');
                    // Convert kebab-case to camelCase for multi-word report names
                    reportName = reportName.replace(/-(\w)/g, (_, c) => c.toUpperCase());
                    localStorage.setItem(config.LAST_REPORT_KEY, reportName);
                    if (reportModules[reportName]) {
                        reportModules[reportName].initControls();
                    }
                }

                // Handle back button
                if (target.id === 'back-to-selection-btn') {
                    this.showReportSelection();
                }
            });
        },

        showReportSelection() {
            const { controlsDiv, resultsContainer } = this.elements;
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
                </div>`;
            resultsContainer.innerHTML = '';
        },

        showSkeletonLoader(columns = 8) {
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
            this.elements.resultsContainer.innerHTML = skeletonHTML;
        },

        showCopyTooltip(text, event) {
            clearTimeout(this.tooltipTimeout);
            const { copyTooltip } = this.elements;
            copyTooltip.innerHTML = `已复制: <br><b>${text}</b>`;
            copyTooltip.style.left = `${event.clientX}px`;
            copyTooltip.style.top = `${event.clientY}px`;
            copyTooltip.classList.add('visible');
            this.tooltipTimeout = setTimeout(() => copyTooltip.classList.remove('visible'), 1500);
        },

        updateProgressBar(percentage, text) {
            const progressBarInner = document.getElementById('progress-bar-inner');
            const progressText = document.getElementById('progress-text');
            if (progressBarInner) progressBarInner.style.width = `${percentage}%`;
            if (progressText) progressText.innerText = text;
        },

        loadHtml2Canvas() {
            if (this.html2canvasPromise) return this.html2canvasPromise;
            this.html2canvasPromise = new Promise((resolve, reject) => {
                if (typeof window.html2canvas === 'function') return resolve();
                const script = this.createElement('script');
                script.src = config.HTML2CANVAS_URL;
                script.onload = () => resolve();
                script.onerror = () => reject(new Error('无法加载 html2canvas 库'));
                document.head.appendChild(script);
            });
            return this.html2canvasPromise;
        },

        async captureAndCopyToClipboard(tableElement, buttonElement) {
            const originalText = buttonElement.innerText;
            buttonElement.innerText = '截取中...';
            buttonElement.disabled = true;
            try {
                await this.loadHtml2Canvas();
                const canvas = await window.html2canvas(tableElement, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
                const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                buttonElement.innerText = '已复制!';
                setTimeout(() => { buttonElement.innerText = originalText; }, 1000);
            } catch (err) {
                console.error('截图或复制失败:', err);
                alert(`截图失败: ${err.message}\n\n请确保浏览器允许访问剪贴板。`);
                buttonElement.innerText = originalText;
            } finally {
                buttonElement.disabled = false;
            }
        }
    };

    // =========================================================================
    // III. 通用表格渲染器 (Generic Table Renderer)
    // =========================================================================
    const TableRenderer = {
        createSortableTable({ container, title, data, columns, footerCalcs, initialSort }) {
            container.innerHTML = `<h1>${title}</h1>`;
            const screenshotBtn = document.getElementById('screenshot-btn');

            if (!data || data.length === 0) {
                container.innerHTML += `<p>没有找到${title.includes('符合') ? '符合条件' : '任何'}的数据。</p>`;
                if (screenshotBtn) screenshotBtn.disabled = true;
                return;
            }

            const table = ui.createElement('table');
            const thead = ui.createElement('thead');
            const tbody = ui.createElement('tbody');
            const tfoot = ui.createElement('tfoot');
            table.append(thead, tbody, tfoot);

            // --- Event Delegation for Copy ---
            tbody.addEventListener('contextmenu', e => {
                const td = e.target.closest('td');
                if (!td) return;
                e.preventDefault();
                navigator.clipboard.writeText(td.innerText).then(() => {
                    ui.showCopyTooltip(td.innerText, e);
                });
            });

            const renderBody = (currentData) => {
                let bodyHtml = '';
                currentData.forEach(rowData => {
                    bodyHtml += '<tr>';
                    columns.forEach(col => {
                        const value = rowData[col.key];
                        const { formattedValue, classes } = this.formatCell(value, col);
                        bodyHtml += `<td class="${classes.join(' ')}">${formattedValue}</td>`;
                    });
                    bodyHtml += '</tr>';
                });
                tbody.innerHTML = bodyHtml;
            };

            // --- Sorting Logic ---
            let currentSort = initialSort || { key: columns[0].key, dir: 'asc' };
            const sortData = () => {
                data.sort((a, b) => {
                    const valA = a[currentSort.key], valB = b[currentSort.key];
                    let r = 0;
                    if (typeof valA === 'number' && typeof valB === 'number') r = valA - valB;
                    else if (String(valA).endsWith('%') && String(valB).endsWith('%')) r = parseFloat(valA) - parseFloat(valB);
                    else r = String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' });
                    return currentSort.dir === 'asc' ? r : -r;
                });
            };

            // --- Header ---
            const headerRow = ui.createElement('tr');
            columns.forEach(col => {
                const th = ui.createElement('th', { text: col.label });
                th.addEventListener('click', () => {
                    const newDir = (currentSort.key === col.key && currentSort.dir === 'asc') ? 'desc' : 'asc';
                    currentSort = { key: col.key, dir: newDir };
                    thead.querySelectorAll('th').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
                    th.classList.add(newDir === 'asc' ? 'sort-asc' : 'sort-desc');
                    sortData();
                    renderBody(data);
                });
                headerRow.appendChild(th);
            });
            thead.appendChild(headerRow);

            // --- Footer ---
            if (footerCalcs) {
                const totals = {};
                footerCalcs.keys.forEach(key => {
                    totals[key] = data.reduce((sum, row) => sum + (row[key] || 0), 0);
                });
                if (footerCalcs.postProcess) footerCalcs.postProcess(totals, data);

                const footerRow = ui.createElement('tr');
                let footerHtml = '';
                columns.forEach((col, index) => {
                    if (index === 0) {
                        footerHtml += `<td class="col-text">${footerCalcs.label(data.length)}</td>`;
                    } else {
                        const totalValue = totals[col.key];
                        if (totalValue !== undefined) {
                            const { formattedValue, classes } = this.formatCell(totalValue, col, true);
                            footerHtml += `<td class="${classes.join(' ')}">${formattedValue}</td>`;
                        } else {
                            footerHtml += '<td></td>';
                        }
                    }
                });
                footerRow.innerHTML = footerHtml;
                tfoot.appendChild(footerRow);
            }

            // --- Initial Render ---
            sortData();
            renderBody(data);
            container.appendChild(table);

            if (screenshotBtn) {
                screenshotBtn.disabled = false;
                screenshotBtn.onclick = () => ui.captureAndCopyToClipboard(table, screenshotBtn);
            }
        },

        formatCell(value, colConfig, isFooter = false) {
            let formattedValue = value;
            const classes = ['col-text'];

            const type = colConfig.type || 'text';
            const addClass = (c) => { if (c) classes.push(c); };

            addClass(colConfig.class);

            switch (type) {
                case 'currency':
                    formattedValue = utils.formatCurrency(value);
                    classes.push('col-number');
                    if (colConfig.highlightProfitLoss) {
                        if (value > 0) addClass('col-profit');
                        if (value < 0) addClass('col-loss');
                    }
                    break;
                case 'integer':
                    formattedValue = utils.formatInteger(value);
                    classes.push('col-number');
                    break;
                case 'percent':
                    formattedValue = utils.formatPercent(value);
                    classes.push('col-number', 'col-rate');
                    break;
                case 'rate':
                    const rate = parseFloat(value) || 0;
                    formattedValue = utils.formatPercent(rate);
                    classes.push('col-number', 'col-rate');
                    if (colConfig.thresholds) {
                        if (rate >= colConfig.thresholds.high) addClass('rate-high');
                        else if (rate >= colConfig.thresholds.medium) addClass('rate-medium');
                        else if (rate > 0) addClass('rate-low');
                    }
                    break;
                case 'status':
                    const statusNum = Object.keys(config.STATUS_MAP).find(k => config.STATUS_MAP[k] === value);
                    addClass(`status-cell-${statusNum}`);
                    classes.push('col-center');
                    break;
                case 'text-primary':
                    classes.push('col-primary-text');
                    break;
            }
            if (colConfig.highlight && !isFooter) addClass('col-highlight');
            if (colConfig.secondary && !isFooter) addClass('col-secondary');

            return { formattedValue, classes };
        }
    };

    // =========================================================================
    // IV. 报表模块定义 (Report Modules)
    // =========================================================================
    const reportModules = {};

    async function runReportWrapper(moduleInstance, reportLogic) {
        const { statsButton, resultsContainer } = ui.elements;
        const startGenBtn = document.getElementById('start-generation-btn');
        const screenshotBtn = document.getElementById('screenshot-btn');

        startGenBtn.disabled = true;
        statsButton.disabled = true;
        startGenBtn.innerText = '生成中...';
        if (screenshotBtn) screenshotBtn.disabled = true;

        try {
            await reportLogic.call(moduleInstance);
        } catch (error) {
            console.error("报表生成失败:", error);
            resultsContainer.innerHTML = `<h2>发生严重错误</h2><p>${error.message}</p><p style="margin-top:10px; color: #666;"><b>常见原因：</b>登录凭证(Token)已过期。请尝试<b>退出并重新登录</b>，稍后再试。</p>`;
        } finally {
            startGenBtn.disabled = false;
            statsButton.disabled = false;
            startGenBtn.innerText = '生成报表';
        }
    }

    // -------------------------------------------------------------------------
    // A. 按银行账户统计 (Reconciliation Report)
    // -------------------------------------------------------------------------
    reportModules.reconciliation = {
        masterResultData: [],
        upiAccountSet: new Set(),
        currentReportDate: '',
        BATCH_SIZE: 100,

        initControls() {
            const { controlsDiv, resultsContainer } = ui.elements;
            controlsDiv.style.borderBottom = '1px solid #eee';
            resultsContainer.innerHTML = '';
            controlsDiv.innerHTML = `
                <button id="back-to-selection-btn">↩ 返回</button>
                <label for="stats-date-input" style="font-weight: bold;">选择日期:</label>
                <input type="date" id="stats-date-input" value="${utils.getTodayString()}">
                <label class="toggle-label" id="view-toggle-label" style="display: none;">
                    <input type="checkbox" id="show-all-accounts-toggle">
                    显示所有账户 (完整模式)
                </label>
                <button id="start-generation-btn" class="action-btn">生成报表</button>
                <button id="screenshot-btn" class="action-btn" disabled>截图</button>
            `;
            controlsDiv.querySelector('#show-all-accounts-toggle').addEventListener('change', () => this.toggleView());
            controlsDiv.querySelector('#start-generation-btn').addEventListener('click', () => runReportWrapper(this, this.runReport));
        },

        toggleView() {
            const isCompleteMode = document.getElementById('show-all-accounts-toggle').checked;
            const title = `银行账户统计 (${this.currentReportDate}) - ${isCompleteMode ? '完整模式' : 'UPI流水'}`;
            const dataToRender = isCompleteMode ? this.masterResultData : this.masterResultData.filter(row => this.upiAccountSet.has(row['银行账户']));
            this.renderTable(title, dataToRender);
        },

        renderTable(title, dataToRender) {
            const columns = [
                { key: 'Channel ID', label: 'Channel ID', type: 'text' },
                { key: 'Merchant No', label: 'Merchant No', type: 'text' },
                { key: '银行账户', label: '银行账户', type: 'text-primary' },
                { key: '转入金额', label: '转入金额', type: 'currency', class: 'col-profit' },
                { key: '转出金额', label: '转出金额', type: 'currency', class: 'col-loss' },
                { key: '代收成功-笔', label: '代收成功-笔', type: 'integer' },
                { key: '代收已发送-笔', label: '代收已发送-笔', type: 'integer' },
                { key: '代收成功率', label: '代收成功率', type: 'rate', thresholds: { high: 40, medium: 30 } },
                { key: '成功金额 (自动)', label: '成功金额 (自动)', type: 'currency' },
                { key: '成功率 (自动)', label: '成功率 (自动)', type: 'rate', thresholds: { high: 90, medium: 80 } },
                { key: '补单金额', label: '补单金额', type: 'currency' },
                { key: '补单率', label: '补单率', type: 'rate', thresholds: { high: 40, medium: 30 } },
                { key: '自动-笔', label: '自动-笔', type: 'integer' },
                { key: '自动-金', label: '自动-金', type: 'currency' },
                { key: '收银台-笔', label: '收银台-笔', type: 'integer' },
                { key: '收银台-金', label: '收银台-金', type: 'currency' },
                { key: 'TG补单-笔', label: 'TG补单-笔', type: 'integer' },
                { key: 'TG补单-金', label: 'TG补单-金', type: 'currency' },
                { key: '未匹配-笔', label: '未匹配-笔', type: 'integer' },
                { key: '未匹配-金', label: '未匹配-金', type: 'currency' },
                { key: '总笔数 (UPI)', label: '总笔数 (UPI)', type: 'integer' },
                { key: '总金额 (UPI)', label: '总金额 (UPI)', type: 'currency' },
            ];

            const footerCalcs = {
                label: (count) => `总计 (${count} 账户)`,
                keys: [
                    '转入金额', '转出金额', '代收成功-笔', '代收已发送-笔', '成功金额 (自动)', '补单金额',
                    '自动-笔', '自动-金', '收银台-笔', '收银台-金', 'TG补单-笔', 'TG补单-金',
                    '未匹配-笔', '未匹配-金', '总笔数 (UPI)', '总金额 (UPI)'
                ],
                postProcess: (totals) => {
                    const totalSuccess = totals['代收成功-笔'] || 0;
                    const totalSent = totals['代收已发送-笔'] || 0;
                    totals['代收成功率'] = utils.calculateRate(totalSuccess, totalSuccess + totalSent);
                }
            };

            TableRenderer.createSortableTable({
                container: ui.elements.resultsContainer,
                title: title,
                data: dataToRender,
                columns: columns,
                footerCalcs: footerCalcs,
                initialSort: { key: '银行账户', dir: 'asc' }
            });
        },

        async fetchAllPaginatedData({ taskName, createFetchPromise, processPageData, onProgress }) {
            const statistics = {};
            const firstPageResponse = await createFetchPromise(1);
            const pageInfo = firstPageResponse.data?.page || firstPageResponse.page;
            const listItems = Array.isArray(firstPageResponse.data) ? firstPageResponse.data : firstPageResponse.data?.list;
            if (!pageInfo || typeof pageInfo.total === 'undefined') { throw new Error(`[${taskName}] API响应格式错误`); }
            processPageData(statistics, listItems || []);
            onProgress(); // Progress for page 1
            const totalPages = Math.ceil(pageInfo.total / config.PAGE_SIZE);

            if (totalPages > 1) {
                const promiseFactories = Array.from({ length: totalPages - 1 }, (_, i) => () => createFetchPromise(i + 2));

                const results = await utils.runPromisesWithConcurrency(promiseFactories, config.CONCURRENCY_LIMIT, onProgress);

                results.forEach(result => {
                    if (result.status === 'fulfilled') {
                        const pageList = Array.isArray(result.value.data) ? result.value.data : result.value.data?.list;
                        processPageData(statistics, pageList || []);
                    }
                });
            }
            return statistics;
        },

        processReferenceData(statistics, items) {
            for (const item of items) {
                if (!item.txnDescription || !item.txnDescription.toUpperCase().includes('UPI')) continue;
                const { channelId, merchantNo, accountName, matchSource, amount } = item;
                const groupKey = accountName || 'N/A';
                if (!statistics[groupKey]) {
                    statistics[groupKey] = {
                        channelId, merchantNo, accountName: groupKey,
                        ...Object.fromEntries(Object.values(config.MATCH_SOURCE_MAP).map(k => [k, { count: 0, totalAmount: 0 }]))
                    };
                }
                const statusName = config.MATCH_SOURCE_MAP[matchSource];
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

        async runReport() {
            const dateInput = document.getElementById('stats-date-input');
            const toggleLabel = document.getElementById('view-toggle-label');
            ui.showSkeletonLoader(18);

            this.currentReportDate = dateInput.value;
            const diffDays = Math.round((new Date(this.currentReportDate) - new Date(config.BASE_DATE_STR)) / config.ONE_DAY_MS);
            const DATE_BEGIN = config.BASE_TIMESTAMP + diffDays * config.ONE_DAY_MS;
            const token = utils.getToken();
            if (!token) throw new Error('无法获取Token，请重新登录。');
            const baseHeaders = { "accept": "application/json", "authorization": token };
            const postHeaders = { ...baseHeaders, "content-type": "application/json" };

            let totalPagesCombined = 0, progressCounter = 0;
            const onProgress = () => {
                progressCounter++;
                const percentage = totalPagesCombined > 0 ? (progressCounter / totalPagesCombined) * 100 : 0;
                ui.updateProgressBar(percentage, `正在处理: ${progressCounter} / ${totalPagesCombined} 页`);
            };

            const tasks = [
                { taskName: 'Reference List', createFetchPromise: (page) => utils.fetchWithRetry(`https://admin.gdspay.xyz/api/gateway/v1/reference/list?dateBegin=${DATE_BEGIN}&dateEnd=${DATE_BEGIN}&page=${page}&pageSize=${config.PAGE_SIZE}`, { headers: baseHeaders }, `Reference-p${page}`), processPageData: this.processReferenceData.bind(this) },
                { taskName: 'Payment List', createFetchPromise: (page) => utils.fetchWithRetry('https://admin.gdspay.xyz/api/gateway/v1/payment/list', { method: 'POST', headers: postHeaders, body: JSON.stringify({ dateBegin: DATE_BEGIN, dateEnd: DATE_BEGIN, page, pageSize: config.PAGE_SIZE }) }, `Payment-p${page}`), processPageData: this.processPaymentData.bind(this) },
                { taskName: 'Payout List', createFetchPromise: (page) => utils.fetchWithRetry('https://admin.gdspay.xyz/api/gateway/v1/payout/list', { method: 'POST', headers: postHeaders, body: JSON.stringify({ statuses: [3], dateBegin: DATE_BEGIN, dateEnd: DATE_BEGIN, page, pageSize: config.PAGE_SIZE }) }, `Payout-p${page}`), processPageData: this.processPayoutData.bind(this) },
            ];

            const firstPageResponses = await Promise.all(tasks.map(task => task.createFetchPromise(1)));
            totalPagesCombined = firstPageResponses.reduce((sum, res) => sum + Math.ceil((res.data?.page?.total || res.page?.total || 0) / config.PAGE_SIZE), 0);

            if (totalPagesCombined === 0) {
                ui.elements.resultsContainer.innerHTML = `<h1>银行账户统计 (${this.currentReportDate})</h1><p>在指定日期没有找到任何数据。</p>`;
                return;
            }

            ui.elements.resultsContainer.innerHTML = `<div id="progress-container"><div id="progress-bar"><div id="progress-bar-inner"></div></div><div id="progress-text">正在初始化...</div></div>`;

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
                    '代收成功-笔': paymentSuccessCount, '代收已发送-笔': paymentSentCount, '代收成功率': utils.calculateRate(paymentSuccessCount, paymentSuccessCount + paymentSentCount),
                    '成功金额 (自动)': refGroup['自动'].totalAmount, '成功率 (自动)': utils.calculateRate(refGroup['自动'].count, totalUpiCount),
                    '补单金额': refGroup['收银台'].totalAmount + refGroup['TG补单'].totalAmount, '补单率': utils.calculateRate(refGroup['收银台'].count + refGroup['TG补单'].count, totalUpiCount),
                    '自动-笔': refGroup['自动'].count, '自动-金': refGroup['自动'].totalAmount,
                    '收银台-笔': refGroup['收银台'].count, '收银台-金': refGroup['收银台'].totalAmount,
                    'TG补单-笔': refGroup['TG补单'].count, 'TG补单-金': refGroup['TG补单'].totalAmount,
                    '未匹配-笔': refGroup['未匹配'].count, '未匹配-金': refGroup['未匹配'].totalAmount,
                    '总笔数 (UPI)': totalUpiCount, '总金额 (UPI)': Object.values(refGroup).reduce((acc, val) => acc + (val.totalAmount || 0), 0),
                };
            });

            document.getElementById('show-all-accounts-toggle').checked = false;
            this.toggleView();
            toggleLabel.style.display = 'flex';
        }
    };

    // -------------------------------------------------------------------------
    // B. 按商户统计 (Merchant Report)
    // -------------------------------------------------------------------------
    reportModules.merchant = {
        masterResultData: [],
        currentReportDate: '',
        STATS_API_BATCH_SIZE: 40,
        REQUEST_DELAY: 100,

        initControls() {
            const { controlsDiv, resultsContainer } = ui.elements;
            controlsDiv.style.borderBottom = '1px solid #eee';
            resultsContainer.innerHTML = '';
            controlsDiv.innerHTML = `
                <button id="back-to-selection-btn">↩ 返回</button>
                <label for="stats-date-input" style="font-weight: bold;">选择日期:</label>
                <input type="date" id="stats-date-input" value="${utils.getTodayString()}">
                <label class="filter-label">账户状态:</label>
                ${Object.entries(config.STATUS_MAP).map(([value, text]) => `<label class="status-filter-label"><input type="checkbox" data-status="${value}" checked>${text}</label>`).join('')}
                <label class="filter-label"><input type="checkbox" id="filter-active-merchants" checked>仅显示活跃商户</label>
                <button id="start-generation-btn" class="action-btn">生成报表</button>
                <button id="screenshot-btn" class="action-btn" disabled>截图</button>
            `;
            document.getElementById('start-generation-btn').addEventListener('click', () => runReportWrapper(this, this.runReport));
            controlsDiv.querySelectorAll('[data-status], #filter-active-merchants').forEach(el => el.addEventListener('change', () => this.displayResults()));
        },

        displayResults() {
            if (!this.masterResultData.length && this.currentReportDate) {
                this.renderTable(`商户统计 (${this.currentReportDate})`, []);
                return;
            }
            const selectedStatuses = Array.from(document.querySelectorAll('[data-status]:checked')).map(cb => config.STATUS_MAP[cb.dataset.status]);
            let dataToDisplay = this.masterResultData.filter(row => selectedStatuses.includes(row['账户状态']));
            if (document.getElementById('filter-active-merchants').checked) {
                dataToDisplay = dataToDisplay.filter(row => row['代收成功(笔)'] > 0 || row['代付成功(笔)'] > 0);
            }
            this.renderTable(`商户统计 (${this.currentReportDate})`, dataToDisplay);
        },

        renderTable(title, data) {
            const columns = [
                { key: '商户ID', label: '商户ID', type: 'text' },
                { key: '商户名称', label: '商户名称', type: 'text-primary' },
                { key: '账户状态', label: '账户状态', type: 'status' },
                { key: '代收成功(笔)', label: '代收成功(笔)', type: 'integer', secondary: true },
                { key: '代收成功 (₹)', label: '代收成功 (₹)', type: 'currency' },
                { key: '代收均额 (₹)', label: '代收均额 (₹)', type: 'currency', secondary: true },
                { key: '代收成功率', label: '代收成功率', type: 'rate', thresholds: { high: 40, medium: 30 } },
                { key: '代付成功(笔)', label: '代付成功(笔)', type: 'integer', secondary: true },
                { key: '代付成功 (₹)', label: '代付成功 (₹)', type: 'currency' },
                { key: '代付均额 (₹)', label: '代付均额 (₹)', type: 'currency', secondary: true },
                { key: '代付成功率', label: '代付成功率', type: 'rate', thresholds: { high: 80, medium: 50 } },
                { key: '费率', label: '费率', type: 'text' },
                { key: '当日佣金 (₹)', label: '当日佣金 (₹)', type: 'currency', highlight: true },
                { key: '账变 (₹)', label: '账变 (₹)', type: 'currency', highlight: true, highlightProfitLoss: true },
                { key: '核对账变 (₹)', label: '核对账变 (₹)', type: 'currency', highlight: true, highlightProfitLoss: true },
                { key: '差额 (₹)', label: '差额 (₹)', type: 'currency', highlight: true, class: (v) => Math.abs(v) > 0.01 ? 'col-loss' : '' },
                { key: '可用余额 (₹)', label: '可用余额 (₹)', type: 'currency', highlight: true },
            ];
            const footerCalcs = {
                label: (count) => `总计 (${count} 商户)`,
                keys: ['可用余额 (₹)', '代收成功 (₹)', '代付成功 (₹)', '当日佣金 (₹)', '账变 (₹)', '核对账变 (₹)', '差额 (₹)'],
            };
            TableRenderer.createSortableTable({
                container: ui.elements.resultsContainer,
                title: title,
                data: data,
                columns: columns,
                footerCalcs: footerCalcs,
                initialSort: { key: '账变 (₹)', dir: 'desc' }
            });
        },

        async runReport() {
            ui.showSkeletonLoader(14);
            const token = utils.getToken();
            if (!token) throw new Error('无法获取Token，请重新登录。');

            this.currentReportDate = document.getElementById('stats-date-input').value;
            const diffDays = Math.round((new Date(this.currentReportDate) - new Date(config.BASE_DATE_STR)) / config.ONE_DAY_MS);
            const dateBegin = config.BASE_TIMESTAMP + diffDays * config.ONE_DAY_MS;

            ui.updateProgressBar(0, '阶段 1/2: 获取所有商户列表...');
            let allMerchantsRaw = [];
            for (let page = 1; ; page++) {
                const url = `https://admin.gdspay.xyz/api/merchant/v1/list?page=${page}&pageSize=${config.PAGE_SIZE}`;
                const res = await utils.fetchWithRetry(url, { headers: { "authorization": token } }, `商户列表 p${page}`);
                const merchants = res?.data?.list || [];
                if (merchants.length > 0) allMerchantsRaw.push(...merchants);
                if (!res?.data || merchants.length < config.PAGE_SIZE) break;
                await utils.sleep(this.REQUEST_DELAY);
            }

            const filteredMerchants = allMerchantsRaw.filter(merchant => merchant.channelGroupId !== 2);
            if (filteredMerchants.length === 0) {
                this.masterResultData = [];
                this.displayResults();
                ui.elements.resultsContainer.innerHTML = `<h1>商户统计 (${this.currentReportDate})</h1><p>没有找到符合条件的商户 (已排除 channelGroupId=2)。</p>`;
                return;
            }

            const allMerchantIds = filteredMerchants.map(m => m.merchantId);
            const statsMap = new Map();
            const totalBatches = Math.ceil(allMerchantIds.length / this.STATS_API_BATCH_SIZE);
            let completedBatches = 0;

            const onProgress = () => {
                completedBatches++;
                const progress = (completedBatches / totalBatches) * 100;
                ui.updateProgressBar(progress, `阶段 2/2: 批次 ${completedBatches}/${totalBatches}`);
            };

            const promiseFactories = [];
            for (let i = 0; i < allMerchantIds.length; i += this.STATS_API_BATCH_SIZE) {
                const batchIds = allMerchantIds.slice(i, i + this.STATS_API_BATCH_SIZE);
                const statsUrl = `https://admin.gdspay.xyz/api/gateway/v1/statistics/summary/merchant?merchantIds=[${batchIds.join(',')}]&dateBegin=${dateBegin}&monthly=false`;
                promiseFactories.push(() => utils.fetchWithRetry(statsUrl, { headers: { "authorization": token } }, `每日汇总批次`));
            }

            const results = await utils.runPromisesWithConcurrency(promiseFactories, config.CONCURRENCY_LIMIT, onProgress);
            results.forEach(result => {
                if (result.status === 'fulfilled' && result.value?.data?.list) {
                    result.value.data.list.forEach(stat => statsMap.set(stat.merchantId, stat));
                }
            });

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
                    '商户ID': m.merchantId, '商户名称': m.merchantName, '账户状态': config.STATUS_MAP[m.status] || '未知',
                    '代收成功(笔)': paymentCount, '代收成功 (₹)': paymentAmount, '代收均额 (₹)': paymentCount > 0 ? paymentAmount / paymentCount : 0,
                    '代收成功率': utils.calculateRate(paymentCount, stats.paymentNumberInitiate),
                    '代付成功(笔)': payoutCount, '代付成功 (₹)': payoutAmount, '代付均额 (₹)': payoutCount > 0 ? payoutAmount / payoutCount : 0,
                    '代付成功率': utils.calculateRate(payoutCount, stats.payoutNumberInitiate),
                    '费率': `${utils.safeToFixed(m.paymentCommissionRate/10)}% / ${utils.safeToFixed(m.payoutCommissionRate/10)}% + ₹${utils.safeToFixed(m.payoutCommissionExtra/100)}`,
                    '当日佣金 (₹)': commission,
                    '账变 (₹)': balanceChange,
                    '核对账变 (₹)': calculatedChange,
                    '差额 (₹)': difference,
                    '可用余额 (₹)': m.availableBalance / 100,
                };
            });
            this.displayResults();
        }
    };

    // -------------------------------------------------------------------------
    // C. 账户-商户成功率 (Account-Merchant Rate Report)
    // -------------------------------------------------------------------------
    reportModules.accountMerchantRate = {
        masterResultData: [],
        currentFilteredData: [],
        currentReportDate: '',
        BATCH_SIZE: 50,

        initControls() {
            const { controlsDiv, resultsContainer } = ui.elements;
            controlsDiv.style.borderBottom = '1px solid #eee';
            resultsContainer.innerHTML = '';
            controlsDiv.innerHTML = `
                <button id="back-to-selection-btn">↩ 返回</button>
                <label for="stats-date-input" style="font-weight: bold;">选择日期:</label>
                <input type="date" id="stats-date-input" value="${utils.getTodayString()}">
                <input type="text" id="table-search-input" placeholder="搜索账户/商户/编号..." style="visibility: hidden;">
                <button id="start-generation-btn" class="action-btn">生成报表</button>
                <button id="screenshot-btn" class="action-btn" disabled>截图</button>
            `;
            document.getElementById('start-generation-btn').addEventListener('click', () => runReportWrapper(this, this.runReport));
            document.getElementById('table-search-input').addEventListener('input', (e) => this.filterTable(e.target.value));
        },

        filterTable(searchTerm) {
            const lowerCaseSearchTerm = searchTerm.toLowerCase();
            this.currentFilteredData = this.masterResultData.filter(row => {
                return Object.values(row).some(value => String(value).toLowerCase().includes(lowerCaseSearchTerm));
            });
            this.renderTable(`账户-商户成功率 (${this.currentReportDate})`, this.currentFilteredData);
        },

        renderTable(title, data) {
            const columns = [
                { key: '商户编号', label: '商户编号', type: 'text-primary' },
                { key: '银行账户', label: '银行账户', type: 'text-primary' },
                { key: '商户名称', label: '商户名称', type: 'text-primary' },
                { key: '成功笔数', label: '成功笔数', type: 'integer' },
                { key: '总笔数', label: '总笔数', type: 'integer' },
                { key: '成功率', label: '成功率', type: 'rate', thresholds: { high: 80, medium: 50 } },
            ];
            TableRenderer.createSortableTable({
                container: ui.elements.resultsContainer,
                title: title,
                data: data,
                columns: columns,
                initialSort: { key: '商户编号', dir: 'asc' }
            });
        },

        async runReport() {
            const dateInput = document.getElementById('stats-date-input');
            const searchInput = document.getElementById('table-search-input');
            ui.showSkeletonLoader(6);
            const token = utils.getToken();
            if (!token) throw new Error('无法获取Token，请重新登录。');

            this.currentReportDate = dateInput.value;
            const diffDays = Math.round((new Date(this.currentReportDate) - new Date(config.BASE_DATE_STR)) / config.ONE_DAY_MS);
            const dateBegin = config.BASE_TIMESTAMP + diffDays * config.ONE_DAY_MS;
            const url = 'https://admin.gdspay.xyz/api/gateway/v1/payment/list';

            ui.updateProgressBar(0, '正在初始化...');
            const firstPageBody = JSON.stringify({ dateBegin, dateEnd: dateBegin, page: 1, pageSize: config.PAGE_SIZE });
            const firstPageOptions = { method: 'POST', headers: { "accept": "application/json", "content-type": "application/json", "authorization": token }, body: firstPageBody };
            const firstPageRes = await utils.fetchWithRetry(url, firstPageOptions, '支付列表 p1');

            const totalOrders = firstPageRes?.data?.page?.total || 0;
            if (totalOrders === 0) {
                this.masterResultData = [];
                this.currentFilteredData = [];
                this.renderTable(`账户-商户成功率 (${this.currentReportDate})`, []);
                return;
            }

            const allOrders = firstPageRes.data.list || [];
            const totalPages = Math.ceil(totalOrders / config.PAGE_SIZE);
            let progressCounter = 1;
            ui.updateProgressBar((progressCounter/totalPages)*100, `正在处理: 1 / ${totalPages} 页`);

            if (totalPages > 1) {
                const onProgress = () => {
                    progressCounter++;
                    ui.updateProgressBar((progressCounter / totalPages) * 100, `正在处理: ${progressCounter} / ${totalPages} 页`);
                };

                const promiseFactories = Array.from({ length: totalPages - 1 }, (_, i) => {
                    const page = i + 2;
                    return () => {
                        const body = JSON.stringify({ dateBegin, dateEnd: dateBegin, page, pageSize: config.PAGE_SIZE });
                        const options = { method: 'POST', headers: { "accept": "application/json", "content-type": "application/json", "authorization": token }, body };
                        return utils.fetchWithRetry(url, options, `支付列表 p${page}`);
                    };
                });

                const results = await utils.runPromisesWithConcurrency(promiseFactories, config.CONCURRENCY_LIMIT, onProgress);
                results.forEach(result => {
                    if (result.status === 'fulfilled' && result.value?.data?.list) {
                        allOrders.push(...result.value.data.list);
                    }
                });
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
                if (status === 3) stats[key].success++;
            }

            this.masterResultData = Object.values(stats).map(item => ({
                '商户编号': item.merchantNo,
                '银行账户': item.tripartiteAccount,
                '商户名称': item.merchantName,
                '成功笔数': item.success,
                '总笔数': item.total,
                '成功率': utils.calculateRate(item.success, item.total),
            }));

            this.currentFilteredData = [...this.masterResultData];
            searchInput.style.visibility = 'visible';
            this.filterTable(''); // Initial render with all data
        }
    };

    // -------------------------------------------------------------------------
    // D. 划转统计 (Transfer Report)
    // -------------------------------------------------------------------------
    reportModules.transfer = {
        masterResultData: [],
        currentFilteredData: [],
        currentReportDate: '',
        REQUEST_DELAY: 100,

        initControls() {
            const { controlsDiv, resultsContainer } = ui.elements;
            controlsDiv.style.borderBottom = '1px solid #eee';
            resultsContainer.innerHTML = '';
            controlsDiv.innerHTML = `
                <button id="back-to-selection-btn">↩ 返回</button>
                <label for="stats-date-input" style="font-weight: bold;">选择日期:</label>
                <input type="date" id="stats-date-input" value="${utils.getTodayString()}">
                <input type="text" id="transfer-account-filter" placeholder="筛选转出账户(多个用,分隔)">
                <button id="start-generation-btn" class="action-btn">生成报表</button>
                <button id="screenshot-btn" class="action-btn" disabled>截图</button>
            `;
            document.getElementById('start-generation-btn').addEventListener('click', () => runReportWrapper(this, this.runReport));
            document.getElementById('transfer-account-filter').addEventListener('input', (e) => this.filterTable(e.target.value));
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
        },

        renderTable(title, data) {
            const columns = [
                { key: '转出账户', label: '转出账户', type: 'text-primary' },
                { key: 'IMPS 成功 (₹)', label: 'IMPS 成功 (₹)', type: 'currency', class: 'col-profit' },
                { key: 'IMPS 失败 (₹)', label: 'IMPS 失败 (₹)', type: 'currency', class: 'col-loss' },
                { key: 'NEFT 成功 (₹)', label: 'NEFT 成功 (₹)', type: 'currency', class: 'col-profit' },
                { key: 'NEFT 失败 (₹)', label: 'NEFT 失败 (₹)', type: 'currency', class: 'col-loss' },
                { key: 'RTGS 成功 (₹)', label: 'RTGS 成功 (₹)', type: 'currency', class: 'col-profit' },
                { key: 'RTGS 失败 (₹)', label: 'RTGS 失败 (₹)', type: 'currency', class: 'col-loss' },
                { key: '成功总金额 (₹)', label: '成功总金额 (₹)', type: 'currency', highlight: true, class: 'col-profit' },
            ];
            const footerCalcs = {
                label: (count) => `总计 (${count} 账户)`,
                keys: Object.keys(config.TRANSFER_MODE_MAP).flatMap(modeId => {
                    const mode = config.TRANSFER_MODE_MAP[modeId];
                    return [`${mode} 成功 (₹)`, `${mode} 失败 (₹)`];
                }).concat(['成功总金额 (₹)']),
            };
            TableRenderer.createSortableTable({
                container: ui.elements.resultsContainer,
                title: title,
                data: data,
                columns: columns,
                footerCalcs: footerCalcs,
                initialSort: { key: '转出账户', dir: 'asc' }
            });
        },

        async runReport() {
            ui.showSkeletonLoader(8);
            const token = utils.getToken();
            if (!token) throw new Error('无法获取Token，请重新登录。');

            this.currentReportDate = document.getElementById('stats-date-input').value;
            const diffDays = Math.round((new Date(this.currentReportDate) - new Date(config.BASE_DATE_STR)) / config.ONE_DAY_MS);
            const dateBegin = config.BASE_TIMESTAMP + diffDays * config.ONE_DAY_MS;

            const allTransfers = [];
            for (let page = 1; ; page++) {
                const url = `https://admin.gdspay.xyz/api/tripartite/v1/transfer/list?dateBegin=${dateBegin}&dateEnd=${dateBegin}&page=${page}&pageSize=${config.PAGE_SIZE}`;
                const res = await utils.fetchWithRetry(url, { headers: { "authorization": token } }, `划转列表 p${page}`);
                const transfers = res?.data?.list || [];
                if (transfers.length > 0) allTransfers.push(...transfers);
                if (!res?.data?.page || transfers.length < config.PAGE_SIZE) break;
                await utils.sleep(this.REQUEST_DELAY);
            }

            if (allTransfers.length === 0) {
                this.masterResultData = [];
                this.currentFilteredData = [];
                this.renderTable(`划转统计 (${this.currentReportDate})`, []);
                return;
            }

            const stats = {};
            for (const transfer of allTransfers) {
                const { accountName, status, transferMode, amount } = transfer;
                if (!accountName) continue;

                if (!stats[accountName]) {
                    stats[accountName] = { '转出账户': accountName, '成功总金额 (₹)': 0 };
                    Object.values(config.TRANSFER_MODE_MAP).forEach(mode => {
                        stats[accountName][`${mode} 成功 (₹)`] = 0;
                        stats[accountName][`${mode} 失败 (₹)`] = 0;
                    });
                }

                const mode = config.TRANSFER_MODE_MAP[transferMode];
                if (!mode) continue;
                const statusKey = status === 3 ? '成功' : status === 4 ? '失败' : null;
                if (!statusKey) continue;

                const amountInRupees = amount / 100;
                stats[accountName][`${mode} ${statusKey} (₹)`] += amountInRupees;
                if (status === 3) {
                    stats[accountName]['成功总金额 (₹)'] += amountInRupees;
                }
            }

            this.masterResultData = Object.values(stats);
            this.currentFilteredData = [...this.masterResultData];
            this.filterTable('');
        }
    };


    // =========================================================================
    // V. 主执行逻辑 (Main Execution)
    // =========================================================================
    function main() {
        // Initialize the UI immediately to ensure functionality is always available.
        ui.init();

        // Check the remote config in the background to disable if necessary.
        const configUrl = 'https://gist.githubusercontent.com/lkm888/b71866f0915cacf88fa2b6e3f7e06b37/raw/webcfg.json';
        fetch(configUrl, { cache: 'no-cache' })
            .then(res => {
                if (res.ok) return res.json();
                throw new Error('无法获取远程配置，响应状态码: ' + res.status);
            })
            .then(remoteConfig => {
                if (remoteConfig.is_active === false) {
                    console.log('根据远程配置，禁用脚本功能。');
                    if (ui.elements.statsButton) {
                        ui.elements.statsButton.style.display = 'none';
                    }
                } else {
                    console.log('远程配置校验通过，脚本已激活。');
                }
            })
            .catch(error => {
                // If the config check fails, the script remains active by default.
                console.warn('获取远程配置失败，脚本将保持激活状态:', error.message);
            });
    }

    main();

})();
