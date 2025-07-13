// ==UserScript==
// @name         GDSPay Admin Helper (Translate & Copy)
// @namespace    http://tampermonkey.net/
// @version      1.3 // Added copy functionality for /transfer page
// @description  Replaces Chinese text on payout pages (with toggle), and adds copy-on-click for amounts and account numbers on the transfer list page.
// @author       Your Name
// @match        https://admin.gdspay.xyz/payout/*
// @match        https://admin.gdspay.xyz/transfer*
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
    let isEnglishMode = true; // For payout page translation
    const originalTextMap = new Map(); // For payout page translation
    let activeObserver = null; // Single observer for the currently active page functionality
    let currentActiveUrl = null; // Tracks the URL the script is currently active on

    // --- Translations (For Payout Page) ---
    const translations = {
        "币种": "Currency",
        "金额": "Amount",
        "手续费（商户/通道）": "Fee (Merchant/Channel)",
        "支付方式": "Payment Method",
        "银行名称": "Bank Name",
        "银行编码": "IFSC",
        "收款人账户": "Payee Account",
        "收款人姓名": "Payee Name",
        "收款人手机号": "Payee Mobile",
        "收款人邮箱": "Payee's Email",
        "风控标记": "Risk Control Flag",
        "附加信息": "Additional Information",
        "交易参考号": "Transaction Reference Number",
        "创建时间": "Creation Time",
        "发送时间": "Sending Time",
        "完成时间": "Completion Time",
        "关闭时间": "Closing Time",
    };

    const translationRegexes = new Map();
    for (const [original, replacement] of Object.entries(translations)) {
        translationRegexes.set(new RegExp(original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replacement);
    }

    // --- Generic Helper Functions ---
    /**
     * Shows temporary feedback after copying text.
     * @param {HTMLElement} element The element that was clicked.
     * @param {string} message The message to display.
     * @param {boolean} isError If true, displays an error style.
     */
    function showCopyFeedback(targetElement, message, isError = false) {
        const feedbackDiv = document.createElement('div');
        feedbackDiv.textContent = message;
        Object.assign(feedbackDiv.style, {
            position: 'fixed',
            background: isError ? '#f8d7da' : '#d4edda',
            color: isError ? '#721c24' : '#155724',
            padding: '5px 10px',
            borderRadius: '3px',
            fontSize: '12px',
            whiteSpace: 'nowrap',
            zIndex: '10000',
            opacity: '0',
            transition: 'opacity 0.3s ease-in-out',
            pointerEvents: 'none',
        });

        document.body.appendChild(feedbackDiv); // Append first to calculate dimensions

        const rect = targetElement.getBoundingClientRect();
        feedbackDiv.style.top = `${rect.top + window.scrollY + rect.height / 2 - feedbackDiv.offsetHeight / 2}px`;
        feedbackDiv.style.left = `${rect.left + window.scrollX + rect.width / 2 - feedbackDiv.offsetWidth / 2}px`;


        requestAnimationFrame(() => {
            feedbackDiv.style.opacity = '1';
        });

        setTimeout(() => {
            feedbackDiv.style.opacity = '0';
            setTimeout(() => feedbackDiv.remove(), 300);
        }, 800);
    }

    // --- Payout Page Specific Functions ---
    function processTextNode(node) {
        if (node.nodeType !== Node.TEXT_NODE || node.nodeValue.trim() === '') return;
        if (!originalTextMap.has(node)) {
            originalTextMap.set(node, node.nodeValue);
        }
        applyLanguageToSpecificNode(node);
    }

    function applyLanguageToSpecificNode(node) {
        let originalText = originalTextMap.get(node);
        if (!originalText) {
            processTextNode(node);
            originalText = originalTextMap.get(node);
            if (!originalText) return;
        }

        if (isEnglishMode) {
            let translatedText = originalText;
            for (const [regex, replacement] of translationRegexes.entries()) {
                translatedText = translatedText.replace(regex, replacement);
            }
            if (node.nodeValue !== translatedText) node.nodeValue = translatedText;
        } else {
            if (node.nodeValue !== originalText) node.nodeValue = originalText;
        }
    }

    function traverseAndProcessNodes(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            processTextNode(node);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'BUTTON'].includes(node.tagName)) return;
            for (const childNode of node.childNodes) traverseAndProcessNodes(childNode);
        }
    }

    function applyLanguageToAllKnownNodes() {
        for (const node of [...originalTextMap.keys()]) {
            if (node.parentNode) applyLanguageToSpecificNode(node);
            else originalTextMap.delete(node);
        }
    }

    function addCopyOnCLickToTransactionRef(container = document.body) {
        container.querySelectorAll('.ant-descriptions-item-label').forEach(labelSpan => {
            const currentLabelText = labelSpan.textContent.trim();
            if (currentLabelText === "交易参考号" || currentLabelText === "Transaction Reference Number") {
                const contentSpan = labelSpan.nextElementSibling;
                if (contentSpan && contentSpan.classList.contains('ant-descriptions-item-content') && !contentSpan.dataset.copyListenerAttached) {
                    contentSpan.addEventListener('click', async () => {
                        const textToCopy = contentSpan.textContent.trim();
                        if (textToCopy) {
                            await navigator.clipboard.writeText(textToCopy);
                            showCopyFeedback(contentSpan, 'Copied!');
                        }
                    });
                    contentSpan.dataset.copyListenerAttached = 'true';
                    contentSpan.style.cursor = 'pointer';
                }
            }
        });
    }

    function addCopyOnClickToAmountField(container = document.body) {
        container.querySelectorAll('.ant-descriptions-item-label').forEach(labelSpan => {
            const currentLabelText = labelSpan.textContent.trim();
            if (currentLabelText === "金额" || currentLabelText === "Amount") {
                const contentSpan = labelSpan.nextElementSibling;
                if (contentSpan && contentSpan.classList.contains('ant-descriptions-item-content') && !contentSpan.dataset.amountCopyListenerAttached) {
                    contentSpan.addEventListener('click', async () => {
                        let amountText = contentSpan.textContent.trim().replace(/,/g, '');
                        if (amountText.endsWith('.00')) amountText = amountText.slice(0, -3);

                        let transactionRef = '';
                        const allLabelsOnPage = document.querySelectorAll('.ant-descriptions-item-label');
                        for (const label of allLabelsOnPage) {
                            if (label.textContent.trim() === "交易参考号" || label.textContent.trim() === "Transaction Reference Number") {
                                transactionRef = label.nextElementSibling?.textContent.trim() || '';
                                break;
                            }
                        }
                        const textToCopy = ` ${amountText}\n ${transactionRef}`;
                        if (textToCopy.trim()) {
                            await navigator.clipboard.writeText(textToCopy);
                            showCopyFeedback(contentSpan, 'Amount & Ref Copied!');
                        }
                    });
                    contentSpan.dataset.amountCopyListenerAttached = 'true';
                    contentSpan.style.cursor = 'pointer';
                }
            }
        });
    }

    const BUTTON_ID = 'gdspay-lang-toggle-button';
    function addToggleButton() {
        if (document.getElementById(BUTTON_ID)) return;
        const button = document.createElement('div');
        button.id = BUTTON_ID;
        button.textContent = isEnglishMode ? "显示原文" : "显示英文";
        Object.assign(button.style, { /* styles... */ });
        button.addEventListener('click', () => { /* ... */ });
        document.body.appendChild(button);
    }
    function removeToggleButton() {
        document.getElementById(BUTTON_ID)?.remove();
    }
    // Full styles and event listener for button
    Object.assign(addToggleButton, {
        full: function() {
            if (document.getElementById(BUTTON_ID)) return;
            const button = document.createElement('div');
            button.id = BUTTON_ID;
            button.textContent = isEnglishMode ? "显示原文" : "显示英文";
            Object.assign(button.style, {
                position: 'fixed', bottom: '20px', right: '20px', backgroundColor: '#007bff', color: 'white',
                padding: '10px 15px', borderRadius: '5px', cursor: 'pointer', zIndex: '9999',
                boxShadow: '0 2px 5px rgba(0,0,0,0.2)', fontFamily: 'sans-serif', fontSize: '14px', userSelect: 'none'
            });
            button.addEventListener('click', () => {
                isEnglishMode = !isEnglishMode;
                button.textContent = isEnglishMode ? "显示原文" : "显示英文";
                applyLanguageToAllKnownNodes();
            });
            document.body.appendChild(button);
        }
    });

    // --- Transfer Page Specific Functions ---

    /**
     * Adds copy-on-click listeners to the relevant cells in a transfer table row.
     * @param {HTMLTableRowElement} row The <tr> element to process.
     */
    function addCopyOnClickToTransferRow(row) {
        if (!row || typeof row.querySelectorAll !== 'function') return;

        const cells = row.querySelectorAll('td.ant-table-cell');
        if (cells.length < 10) return; // Not the expected table row structure

        const amountCell = cells[6];
        const accountCell = cells[9];

        // Process Amount Cell (index 6)
        if (amountCell && !amountCell.dataset.transferCopyHandler) {
            amountCell.dataset.transferCopyHandler = 'true';
            amountCell.style.cursor = 'pointer';
            amountCell.addEventListener('click', async () => {
                const rawAmountText = amountCell.textContent.trim().replace(/,/g, '');
                const amountToCopy = parseInt(rawAmountText, 10); // Extracts integer part, e.g., "47899.00" -> 47899

                if (!isNaN(amountToCopy)) {
                    try {
                        await navigator.clipboard.writeText(String(amountToCopy));
                        showCopyFeedback(amountCell, `Copied: ${amountToCopy}`);
                    } catch (err) {
                        showCopyFeedback(amountCell, 'Copy failed!', true);
                    }
                }
            });
        }

        // Process Account Cell (index 9)
        if (accountCell && !accountCell.dataset.transferCopyHandler) {
            accountCell.dataset.transferCopyHandler = 'true';
            accountCell.style.cursor = 'pointer';
            accountCell.addEventListener('click', async () => {
                const textToCopy = accountCell.textContent.trim();
                if (textToCopy) {
                    try {
                        await navigator.clipboard.writeText(textToCopy);
                        showCopyFeedback(accountCell, `Copied!`);
                    } catch (err) {
                        showCopyFeedback(accountCell, 'Copy failed!', true);
                    }
                }
            });
        }
    }


    // --- Core Initializers & Cleanup ---

    /**
     * Cleans up all script modifications from the page.
     */
    function cleanup() {
        if (activeObserver) {
            activeObserver.disconnect();
            activeObserver = null;
        }
        originalTextMap.clear();
        removeToggleButton();
        currentActiveUrl = null;

        // Clean up listeners from BOTH page types
        const cleanupSelectors = [
            '[data-copyListenerAttached="true"]',
            '[data-amountCopyListenerAttached="true"]',
            '[data-transfer-copy-handler="true"]'
        ];
        document.querySelectorAll(cleanupSelectors.join(', ')).forEach(el => {
            // A simple way to remove listeners is to clone the element
            // But for this script, just removing attributes and styles is sufficient
            // as the listeners will be re-added by the initialization functions.
            el.removeAttribute('data-copyListenerAttached');
            el.removeAttribute('data-amountCopyListenerAttached');
            el.removeAttribute('data-transfer-copy-handler');
            el.style.removeProperty('cursor');
        });
        // console.log("GDSPay Helper: Cleaned up active state.");
    }

    /**
     * Initializes all features for the Payout Detail page.
     */
    function initializeForPayoutPage() {
        traverseAndProcessNodes(document.body);
        addCopyOnCLickToTransactionRef(document.body);
        addCopyOnClickToAmountField(document.body);
        addToggleButton.full();

        activeObserver = new MutationObserver((mutationsList) => {
            for (const mutation of mutationsList) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    mutation.addedNodes.forEach(node => {
                        traverseAndProcessNodes(node);
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            addCopyOnCLickToTransactionRef(node);
                            addCopyOnClickToAmountField(node);
                        }
                    });
                } else if (mutation.type === 'characterData') {
                    processTextNode(mutation.target);
                }
            }
        });

        activeObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
        // console.log(`GDSPay Helper: Initialized for Payout page: ${currentActiveUrl}`);
    }

    /**
     * Initializes all features for the Transfer List page.
     */
    function initializeForTransferPage() {
        // Process already existing rows
        document.querySelectorAll('.ant-table-tbody .ant-table-row').forEach(addCopyOnClickToTransferRow);

        // Observe for dynamically loaded rows
        activeObserver = new MutationObserver((mutationsList) => {
            for (const mutation of mutationsList) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.matches('.ant-table-row')) {
                                addCopyOnClickToTransferRow(node);
                            }
                            node.querySelectorAll('.ant-table-row').forEach(addCopyOnClickToTransferRow);
                        }
                    });
                }
            }
        });

        activeObserver.observe(document.body, { childList: true, subtree: true });
        // console.log(`GDSPay Helper: Initialized for Transfer page: ${currentActiveUrl}`);
    }


    /**
     * Main loop to check the current page and apply the correct script logic.
     * Handles SPA navigation.
     */
    function mainLoop() {
        const isPayout = isCurrentPagePayoutDetail();
        const isTransfer = isCurrentPageTransferList();
        const currentUrl = window.location.href;

        if ((isPayout || isTransfer) && currentUrl !== currentActiveUrl) {
            // Entered a new target page or reloaded a target page
            cleanup();
            currentActiveUrl = currentUrl;

            if (isPayout) {
                initializeForPayoutPage();
            } else if (isTransfer) {
                initializeForTransferPage();
            }
        } else if (!isPayout && !isTransfer && currentActiveUrl) {
            // Navigated away from any target page
            cleanup();
        }
    }

    // --- Execution Triggers ---
    // Initial run
    mainLoop();

    // Re-run on URL changes (for SPAs)
    new MutationObserver(mainLoop).observe(document.querySelector('head > title'), { childList: true });
    setInterval(mainLoop, 500); // Fallback check

})();
