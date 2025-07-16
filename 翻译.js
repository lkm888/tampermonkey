// ==UserScript==
// @name         GDSPay Admin Helper (Translate & Copy)
// @namespace    http://tampermonkey.net/
// @version      1.4 // Refactored transfer page copy to use Event Delegation for dynamic content
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
    let activeObserver = null; // Observer for Payout page
    let currentActiveUrl = null; // Tracks the URL the script is currently active on

    // --- NEW: State for Transfer Page ---
    const TRANSFER_STYLE_ID = 'gdspay-transfer-copy-styles';
    let transferClickHandler = null; // Holds the reference to the click handler function for removal

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

        document.body.appendChild(feedbackDiv);

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
    function removeToggleButton() {
        document.getElementById(BUTTON_ID)?.remove();
    }

    // --- Transfer Page Specific Functions (REFACTORED) ---

    /**
     * Handles clicks on the transfer table using event delegation.
     * @param {MouseEvent} event The click event.
     */
    async function handleTransferTableClick(event) {
        // Find the cell that was clicked, or whose child was clicked
        const cell = event.target.closest('td.ant-table-cell');

        // Check if the click was inside a table body cell.
        // This ensures we don't act on clicks in the header or outside the table.
        if (!cell || !cell.closest('.ant-table-tbody')) {
            return;
        }

        const row = cell.closest('.ant-table-row');
        if (!row) return;

        // Get all cells in the row to determine the index of the clicked cell
        const cells = Array.from(row.children);
        const cellIndex = cells.indexOf(cell);

        // Column 7 (index 6) is "金额" (Amount)
        if (cellIndex === 6) {
            const rawAmountText = cell.textContent.trim().replace(/,/g, '');
            // Extracts integer part, e.g., "47899.00" -> 47899
            const amountToCopy = parseInt(rawAmountText, 10);

            if (!isNaN(amountToCopy)) {
                try {
                    await navigator.clipboard.writeText(String(amountToCopy));
                    showCopyFeedback(cell, `Copied: ${amountToCopy}`);
                } catch (err) {
                    showCopyFeedback(cell, 'Copy failed!', true);
                }
            }
        }

        // Column 10 (index 9) is "收款账号" (Account Number)
        if (cellIndex === 9) {
            const textToCopy = cell.textContent.trim();
            if (textToCopy) {
                try {
                    await navigator.clipboard.writeText(textToCopy);
                    showCopyFeedback(cell, `Copied!`);
                } catch (err) {
                    showCopyFeedback(cell, 'Copy failed!', true);
                }
            }
        }
    }


    // --- Core Initializers & Cleanup ---

    /**
     * Cleans up all script modifications from the page.
     */
    function cleanup() {
        // Cleanup for Payout Page
        if (activeObserver) {
            activeObserver.disconnect();
            activeObserver = null;
        }
        originalTextMap.clear();
        removeToggleButton();

        // Cleanup for Transfer Page
        if (transferClickHandler) {
            document.body.removeEventListener('click', transferClickHandler);
            transferClickHandler = null;
        }
        document.getElementById(TRANSFER_STYLE_ID)?.remove();

        // General cleanup
        currentActiveUrl = null;
    }

    /**
     * Initializes all features for the Payout Detail page.
     */
    function initializeForPayoutPage() {
        traverseAndProcessNodes(document.body);
        addCopyOnCLickToTransactionRef(document.body);
        addCopyOnClickToAmountField(document.body);
        addToggleButton();

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
    }

    /**
     * Initializes all features for the Transfer List page using Event Delegation.
     */
    function initializeForTransferPage() {
        // Inject CSS to provide visual feedback (pointer cursor) on clickable cells.
        if (!document.getElementById(TRANSFER_STYLE_ID)) {
            const style = document.createElement('style');
            style.id = TRANSFER_STYLE_ID;
            // td:nth-child(7) is Amount, td:nth-child(10) is Account Number.
            style.innerHTML = `
                .ant-table-tbody > tr > td:nth-child(7),
                .ant-table-tbody > tr > td:nth-child(10) {
                    cursor: pointer;
                    user-select: none; /* Prevents text selection on click */
                }
            `;
            document.head.appendChild(style);
        }

        // Add a single, delegated event listener to the body.
        transferClickHandler = handleTransferTableClick;
        document.body.addEventListener('click', transferClickHandler);
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
            cleanup();
            currentActiveUrl = currentUrl;

            if (isPayout) {
                initializeForPayoutPage();
            } else if (isTransfer) {
                initializeForTransferPage();
            }
        } else if (!isPayout && !isTransfer && currentActiveUrl) {
            cleanup();
        }
    }

    // --- Execution Triggers ---
    mainLoop();

    // Use a MutationObserver on the <title> element to detect SPA navigation,
    // which is a common and fairly reliable method.
    new MutationObserver(mainLoop).observe(document.querySelector('head > title'), { childList: true });
    // Fallback interval check for cases where title doesn't change.
    setInterval(mainLoop, 500);

})();
