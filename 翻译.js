// ==UserScript==
// @name         GDSPay Admin Helper (Translate & Copy)
// @namespace    http://tampermonkey.net/
// @version      1.9 // Transfer page: Click Amount to copy Amount + Ref. Click Ref to copy Ref.
// @description  Replaces Chinese text on payout pages (with toggle), and adds copy-on-click for amounts and account numbers on the transfer list page. Now robust against column changes.
// @author       Your Name
// @match        https://admin.gdspay.xyz/payout/*
// @match        https://admin.gdspay.xyz/transfe*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/lkm888/tampermonkey/main/翻译.user.js
// @downloadURL  https://raw.githubusercontent.com/lkm888/tampermonkey/main/翻译.user.js
// ==/UserScript==

(function() {
    'use strict';

    // --- URL Check Definitions ---
    const payoutDetailRegex = /^\/payout\/\d+$/;
    const transferListRegex = /^\/transfer(\?.*)?$/;

    function isCurrentPagePayoutDetail() {
        return window.top === window.self && payoutDetailRegex.test(window.location.pathname);
    }

    function isCurrentPageTransferList() {
        return window.top === window.self && transferListRegex.test(window.location.pathname);
    }

    // --- Global State ---
    let isEnglishMode = true;
    const originalTextMap = new Map();
    let activeObserver = null;
    let currentActiveUrl = null;

    // --- State for Transfer Page ---
    const TRANSFER_STYLE_ID = 'gdspay-transfer-copy-styles';
    let transferClickHandler = null;
    let amountColumnIndex = -1;
    let accountColumnIndex = -1;
    let refColumnIndex = -1; // ★ 新增：用于存储“交易参考号”列的索引

    // --- Translations (For Payout Page) ---
    const translations = {
        "币种": "Currency", "金额": "Amount", "手续费（商户/通道）": "Fee (Merchant/Channel)",
        "支付方式": "Payment Method", "银行名称": "Bank Name", "银行编码": "IFSC",
        "收款人账户": "Payee Account", "收款人姓名": "Payee Name", "收款人手机号": "Payee Mobile",
        "收款人邮箱": "Payee's Email", "风控标记": "Risk Control Flag", "附加信息": "Additional Information",
        "交易参考号": "Transaction Reference Number", "创建时间": "Creation Time", "发送时间": "Sending Time",
        "完成时间": "Completion Time", "关闭时间": "Closing Time",
    };
    const translationRegexes = new Map(Object.entries(translations).map(([k, v]) => [new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), v]));

    // --- Generic Helper Functions ---
    function showCopyFeedback(targetElement, message, isError = false) {
        const feedbackDiv = document.createElement('div');
        feedbackDiv.textContent = message;
        Object.assign(feedbackDiv.style, {
            position: 'fixed', background: isError ? '#f8d7da' : '#d4edda', color: isError ? '#721c24' : '#155724',
            padding: '5px 10px', borderRadius: '3px', fontSize: '12px', whiteSpace: 'nowrap',
            zIndex: '10000', opacity: '0', transition: 'opacity 0.3s ease-in-out', pointerEvents: 'none',
        });
        document.body.appendChild(feedbackDiv);
        const rect = targetElement.getBoundingClientRect();
        feedbackDiv.style.top = `${rect.top + window.scrollY + rect.height / 2 - feedbackDiv.offsetHeight / 2}px`;
        feedbackDiv.style.left = `${rect.left + window.scrollX + rect.width / 2 - feedbackDiv.offsetWidth / 2}px`;
        requestAnimationFrame(() => { feedbackDiv.style.opacity = '1'; });
        setTimeout(() => {
            feedbackDiv.style.opacity = '0';
            setTimeout(() => feedbackDiv.remove(), 300);
        }, 800);
    }

    // --- Payout Page Specific Functions ---
    // (These functions remain unchanged, so they are kept concise for readability)
    function processTextNode(node) { if (node.nodeType !== Node.TEXT_NODE || node.nodeValue.trim() === '') return; if (!originalTextMap.has(node)) { originalTextMap.set(node, node.nodeValue); } applyLanguageToSpecificNode(node); }
    function applyLanguageToSpecificNode(node) { let originalText = originalTextMap.get(node); if (!originalText) { processTextNode(node); originalText = originalTextMap.get(node); if (!originalText) return; } if (isEnglishMode) { let translatedText = originalText; for (const [regex, replacement] of translationRegexes.entries()) { translatedText = translatedText.replace(regex, replacement); } if (node.nodeValue !== translatedText) node.nodeValue = translatedText; } else { if (node.nodeValue !== originalText) node.nodeValue = originalText; } }
    function traverseAndProcessNodes(node) { if (node.nodeType === Node.TEXT_NODE) processTextNode(node); else if (node.nodeType === Node.ELEMENT_NODE && !['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'BUTTON'].includes(node.tagName)) { for (const childNode of node.childNodes) traverseAndProcessNodes(childNode); } }
    function applyLanguageToAllKnownNodes() { for (const node of [...originalTextMap.keys()]) { if (node.parentNode) applyLanguageToSpecificNode(node); else originalTextMap.delete(node); } }
    function addCopyOnCLickToTransactionRef(container = document) { container.querySelectorAll('.ant-descriptions-item-label').forEach(labelSpan => { if (["交易参考号", "Transaction Reference Number"].includes(labelSpan.textContent.trim())) { const contentSpan = labelSpan.nextElementSibling; if (contentSpan && !contentSpan.dataset.copyListenerAttached) { contentSpan.addEventListener('click', async () => { const textToCopy = contentSpan.textContent.trim(); if (textToCopy) { await navigator.clipboard.writeText(textToCopy); showCopyFeedback(contentSpan, 'Copied!'); } }); contentSpan.dataset.copyListenerAttached = 'true'; contentSpan.style.cursor = 'pointer'; } } }); }
    function addCopyOnClickToAmountField(container = document) { container.querySelectorAll('.ant-descriptions-item-label').forEach(labelSpan => { if (["金额", "Amount"].includes(labelSpan.textContent.trim())) { const contentSpan = labelSpan.nextElementSibling; if (contentSpan && !contentSpan.dataset.amountCopyListenerAttached) { contentSpan.addEventListener('click', async () => { let amountText = contentSpan.textContent.trim().replace(/,/g, ''); if (amountText.endsWith('.00')) amountText = amountText.slice(0, -3); let transactionRef = ''; for (const label of document.querySelectorAll('.ant-descriptions-item-label')) { if (["交易参考号", "Transaction Reference Number"].includes(label.textContent.trim())) { transactionRef = label.nextElementSibling?.textContent.trim() || ''; break; } } const textToCopy = ` ${amountText}\n ${transactionRef}`; if (textToCopy.trim()) { await navigator.clipboard.writeText(textToCopy); showCopyFeedback(contentSpan, 'Amount & Ref Copied!'); } }); contentSpan.dataset.amountCopyListenerAttached = 'true'; contentSpan.style.cursor = 'pointer'; } } }); }
    const BUTTON_ID = 'gdspay-lang-toggle-button';
    function addToggleButton() { if (document.getElementById(BUTTON_ID)) return; const button = document.createElement('div'); button.id = BUTTON_ID; button.textContent = isEnglishMode ? "显示原文" : "显示英文"; Object.assign(button.style, { position: 'fixed', bottom: '20px', right: '20px', backgroundColor: '#007bff', color: 'white', padding: '10px 15px', borderRadius: '5px', cursor: 'pointer', zIndex: '9999', boxShadow: '0 2px 5px rgba(0,0,0,0.2)', fontFamily: 'sans-serif', fontSize: '14px', userSelect: 'none' }); button.addEventListener('click', () => { isEnglishMode = !isEnglishMode; button.textContent = isEnglishMode ? "显示原文" : "显示英文"; applyLanguageToAllKnownNodes(); }); document.body.appendChild(button); }
    function removeToggleButton() { document.getElementById(BUTTON_ID)?.remove(); }

    // --- Transfer Page Specific Functions (ROBUST VERSION) ---
    async function handleTransferTableClick(event) {
        // ★ 修改：检查所有需要的列
        if (amountColumnIndex === -1 && accountColumnIndex === -1 && refColumnIndex === -1) return;

        const cell = event.target.closest('td.ant-table-cell');
        if (!cell || !cell.closest('.ant-table-tbody')) return;

        const row = cell.closest('.ant-table-row');
        if (!row) return;

        const cells = Array.from(row.children);
        const cellIndex = cells.indexOf(cell);

        try {
            // ★★★ 核心逻辑修改在这里 ★★★

            // 1. 点击“划转金额”列
            if (cellIndex === amountColumnIndex) {
                let amountText = cell.textContent.trim().replace(/,/g, '');
                if (amountText.endsWith('.00')) amountText = amountText.slice(0, -3);

                // 从同一行获取“交易参考号”的文本
                const refNumberText = (refColumnIndex !== -1) ? cells[refColumnIndex]?.textContent.trim() : '';

                if (amountText && refNumberText) {
                    const textToCopy = ` ${amountText}\n ${refNumberText}`;
                    await navigator.clipboard.writeText(textToCopy);
                    showCopyFeedback(cell, 'Amount & Ref Copied!');
                }
            }
            // 2. 点击“交易参考号”列
            else if (cellIndex === refColumnIndex) {
                const textToCopy = cell.textContent.trim();
                if (textToCopy) {
                    await navigator.clipboard.writeText(textToCopy);
                    showCopyFeedback(cell, `Ref Copied: ${textToCopy}`);
                }
            }
            // 3. 点击“收款账号”列 (保留此功能)
            else if (cellIndex === accountColumnIndex) {
                const textToCopy = cell.textContent.trim();
                if (textToCopy) {
                    await navigator.clipboard.writeText(textToCopy);
                    showCopyFeedback(cell, `Copied: ${textToCopy}`);
                }
            }
        } catch (err) {
            console.error('GDSPay Helper: Copy failed', err);
            showCopyFeedback(cell, 'Copy failed!', true);
        }
    }

    // --- Core Initializers & Cleanup ---
    function cleanup() {
        if (activeObserver) { activeObserver.disconnect(); activeObserver = null; }
        originalTextMap.clear();
        removeToggleButton();
        if (transferClickHandler) { document.body.removeEventListener('click', transferClickHandler); transferClickHandler = null; }
        document.getElementById(TRANSFER_STYLE_ID)?.remove();
        amountColumnIndex = -1;
        accountColumnIndex = -1;
        refColumnIndex = -1; // ★ 新增：重置索引
        currentActiveUrl = null;
    }

    function initializeForPayoutPage() {
        traverseAndProcessNodes(document.body);
        addCopyOnCLickToTransactionRef();
        addCopyOnClickToAmountField();
        addToggleButton();
        activeObserver = new MutationObserver((mutationsList) => { for (const mutation of mutationsList) { if (mutation.type === 'childList' && mutation.addedNodes.length > 0) { mutation.addedNodes.forEach(node => { traverseAndProcessNodes(node); if (node.nodeType === Node.ELEMENT_NODE) { addCopyOnCLickToTransactionRef(node); addCopyOnClickToAmountField(node); } }); } else if (mutation.type === 'characterData') { processTextNode(mutation.target); } } });
        activeObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    }

    function findColumnsAndInjectStyles() {
        const headerCells = document.querySelectorAll('.ant-table-thead th');
        if (headerCells.length === 0) return false;

        // Reset indices before searching
        amountColumnIndex = -1;
        accountColumnIndex = -1;
        refColumnIndex = -1; // ★ 新增：重置索引

        headerCells.forEach((th, index) => {
            const headerText = th.textContent.trim();
            // ★ 修改：查找所有需要的列
            if (headerText.includes('金额')) {
                amountColumnIndex = index;
                console.log(`GDSPay Helper: Found '金额' column at index ${index}`);
            } else if (headerText.includes('收款账号')) {
                accountColumnIndex = index;
                console.log(`GDSPay Helper: Found '收款账号' column at index ${index}`);
            } else if (headerText.includes('交易参考号')) {
                refColumnIndex = index;
                console.log(`GDSPay Helper: Found '交易参考号' column at index ${index}`);
            }
        });

        if (amountColumnIndex === -1 && accountColumnIndex === -1 && refColumnIndex === -1) {
            console.log("GDSPay Helper: Could not find any of the target columns ('金额', '收款账号', '交易参考号').");
            return false;
        }

        // ★ 修改：为所有可点击的列生成CSS
        const cssSelectors = [];
        if (amountColumnIndex !== -1) cssSelectors.push(`.ant-table-tbody > tr > td:nth-child(${amountColumnIndex + 1})`);
        if (accountColumnIndex !== -1) cssSelectors.push(`.ant-table-tbody > tr > td:nth-child(${accountColumnIndex + 1})`);
        if (refColumnIndex !== -1) cssSelectors.push(`.ant-table-tbody > tr > td:nth-child(${refColumnIndex + 1})`);

        if (cssSelectors.length > 0) {
            document.getElementById(TRANSFER_STYLE_ID)?.remove();
            const style = document.createElement('style');
            style.id = TRANSFER_STYLE_ID;
            style.innerHTML = `${cssSelectors.join(',\n')} { cursor: pointer; user-select: none; }`;
            document.head.appendChild(style);
            console.log(`GDSPay Helper: Styles injected for clickable columns.`);
        }
        return true;
    }

    function initializeForTransferPage() {
        transferClickHandler = handleTransferTableClick;
        document.body.addEventListener('click', transferClickHandler);

        if (!findColumnsAndInjectStyles()) {
            let attempts = 0;
            const interval = setInterval(() => {
                attempts++;
                if (findColumnsAndInjectStyles() || attempts > 20) {
                    clearInterval(interval);
                    if (attempts > 20) console.error("GDSPay Helper: Timed out waiting for the transfer table.");
                }
            }, 500);
        }
    }

    function mainLoop() {
        const currentUrl = window.location.href;
        if (currentUrl === currentActiveUrl) return;

        const isPayout = isCurrentPagePayoutDetail();
        const isTransfer = isCurrentPageTransferList();

        if (isPayout || isTransfer) {
            cleanup();
            currentActiveUrl = currentUrl;
            if (isPayout) {
                console.log('GDSPay Helper: Initializing for Payout Page.');
                initializeForPayoutPage();
            } else { // isTransfer
                console.log('GDSPay Helper: Initializing for Transfer Page.');
                initializeForTransferPage();
            }
        } else if (currentActiveUrl) {
            console.log('GDSPay Helper: Cleaning up from previous page.');
            cleanup();
        }
    }

    // --- Execution Triggers ---
    mainLoop();
    new MutationObserver(mainLoop).observe(document.querySelector('head > title'), { childList: true });
    setInterval(mainLoop, 500);

})();
