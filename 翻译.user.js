// ==UserScript==
// @name         GDSPay Admin Text Replacer (Toggle)
// @namespace    http://tampermonkey.net/
// @version      1.2 // Increased version number for combined copy feature
// @description  Replaces specific Chinese text with English on GDSPay admin payout detail pages, with a toggle button. Robust for SPA navigation and adds silent copy-on-click for transaction reference and combined amount/ref fields.
// @author       Your Name
// @match        https://admin.gdspay.xyz/payout/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/lkm888/tampermonkey/main/翻译.user.js
// @downloadURL  https://raw.githubusercontent.com/lkm888/tampermonkey/main/翻译.user.js
// ==/UserScript==

(function() {
    'use strict';

    // --- URL Check Definition ---
    const payoutDetailRegex = /^\/payout\/\d+$/;

    function isCurrentPagePayoutDetail() {
        return window.top === window.self && payoutDetailRegex.test(window.location.pathname);
    }

    // --- Global State ---
    let isEnglishMode = true; // True: display English; False: display original Chinese
    const originalTextMap = new Map(); // Key: TextNode object, Value: Original Chinese string
    let observer = null; // MutationObserver instance
    let currentActiveUrl = null; // Tracks the URL the script is currently active on

    // --- Translations ---
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
        // Add more translations as needed
    };

    // Pre-compile regexes for better performance
    const translationRegexes = new Map();
    for (const [original, replacement] of Object.entries(translations)) {
        translationRegexes.set(new RegExp(original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replacement);
    }

    /**
     * Processes a single text node: stores its original value if new, then applies current language.
     * @param {TextNode} node The text node to process.
     */
    function processTextNode(node) {
        if (node.nodeType !== Node.TEXT_NODE) return;
        if (node.nodeValue.trim() === '') return;

        if (!originalTextMap.has(node)) {
            originalTextMap.set(node, node.nodeValue);
        }

        applyLanguageToSpecificNode(node);
    }

    /**
     * Applies the current language mode (English or original) to a specific text node.
     * @param {TextNode} node The text node to update.
     */
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
            if (node.nodeValue !== translatedText) {
                node.nodeValue = translatedText;
            }
        } else {
            if (node.nodeValue !== originalText) {
                node.nodeValue = originalText;
            }
        }
    }

    /**
     * Recursively traverses and processes DOM nodes for translation.
     * @param {Node} node The root node to start processing from.
     */
    function traverseAndProcessNodes(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            processTextNode(node);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME'].includes(node.tagName)) {
                return;
            }
            for (const childNode of node.childNodes) {
                traverseAndProcessNodes(childNode);
            }
        }
    }

    /**
     * Applies the current language mode to all known text nodes in the originalTextMap.
     */
    function applyLanguageToAllKnownNodes() {
        for (const node of [...originalTextMap.keys()]) {
            if (node.parentNode) {
                applyLanguageToSpecificNode(node);
            } else {
                originalTextMap.delete(node);
            }
        }
    }

    // --- Copy-on-Click Functionality ---
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

        const rect = targetElement.getBoundingClientRect();
        feedbackDiv.style.top = `${rect.top + window.scrollY + rect.height / 2}px`;
        feedbackDiv.style.left = `${rect.left + window.scrollX + rect.width / 2}px`;
        feedbackDiv.style.transform = 'translate(-50%, -50%)';

        document.body.appendChild(feedbackDiv);

        requestAnimationFrame(() => {
            feedbackDiv.style.opacity = '1';
        });

        setTimeout(() => {
            feedbackDiv.style.opacity = '0';
            setTimeout(() => feedbackDiv.remove(), 300);
        }, 800);
    }

    /**
     * Adds copy-on-click functionality to transaction reference numbers.
     * @param {HTMLElement} container The DOM element to search within.
     */
    function addCopyOnCLickToTransactionRef(container = document.body) {
        const labelSpans = container.querySelectorAll('.ant-descriptions-item-label');

        labelSpans.forEach(labelSpan => {
            const currentLabelText = labelSpan.textContent.trim();

            if (currentLabelText === "交易参考号" || currentLabelText === "Transaction Reference Number") {
                const contentSpan = labelSpan.nextElementSibling;

                if (
                    contentSpan &&
                    contentSpan.classList.contains('ant-descriptions-item-content') &&
                    !contentSpan.dataset.copyListenerAttached
                ) {
                    const clickHandler = async (event) => {
                        if (event.target !== contentSpan) return;

                        const textToCopy = contentSpan.textContent.trim();
                        if (textToCopy) {
                            try {
                                await navigator.clipboard.writeText(textToCopy);
                                showCopyFeedback(contentSpan, 'Copied!');
                            } catch (err) {
                                console.error('GDSPay Admin Text Replacer: Failed to copy text: ', err);
                                showCopyFeedback(contentSpan, 'Failed to copy!', true);
                            }
                        }
                    };

                    contentSpan.addEventListener('click', clickHandler);
                    contentSpan.dataset.copyListenerAttached = 'true';
                    contentSpan.style.cursor = 'pointer'; // Add visual cue
                }
            }
        });
    }

    /**
     * Adds copy-on-click functionality to amount fields, processing the number format
     * and combining with the transaction reference number.
     * @param {HTMLElement} container The DOM element to search within.
     */
    function addCopyOnClickToAmountField(container = document.body) {
        const labelSpans = container.querySelectorAll('.ant-descriptions-item-label');

        labelSpans.forEach(labelSpan => {
            const currentLabelText = labelSpan.textContent.trim();

            if (currentLabelText === "金额" || currentLabelText === "Amount") {
                const contentSpan = labelSpan.nextElementSibling;

                if (
                    contentSpan &&
                    contentSpan.classList.contains('ant-descriptions-item-content') &&
                    !contentSpan.dataset.amountCopyListenerAttached
                ) {
                    const clickHandler = async (event) => {
                        if (event.target !== contentSpan) return;

                        // 1. 获取并处理金额
                        let amountText = contentSpan.textContent.trim();
                        amountText = amountText.replace(/,/g, ''); // 移除所有逗号
                        if (amountText.endsWith('.00')) {
                            amountText = amountText.slice(0, -3); // 如果以 ".00" 结尾，则移除
                        }

                        // 2. 查找交易参考号
                        let transactionRef = '';
                        // 遍历页面上所有描述项的标签，找到交易参考号
                        const allLabelsOnPage = document.querySelectorAll('.ant-descriptions-item-label');
                        for (const label of allLabelsOnPage) {
                            if (label.textContent.trim() === "交易参考号" || label.textContent.trim() === "Transaction Reference Number") {
                                const refContentSpan = label.nextElementSibling;
                                if (refContentSpan && refContentSpan.classList.contains('ant-descriptions-item-content')) {
                                    transactionRef = refContentSpan.textContent.trim();
                                    break; // 找到后立即退出循环
                                }
                            }
                        }

                        // 3. 组合文本
                        const textToCopy = ` ${amountText}\n ${transactionRef}`;

                        if (textToCopy.trim()) { // 确保有内容可以复制
                            try {
                                await navigator.clipboard.writeText(textToCopy);
                                showCopyFeedback(contentSpan, '金额 & 参考号已复制!'); // 更友好的中文提示
                            } catch (err) {
                                console.error('GDSPay Admin Text Replacer: Failed to copy amount and ref: ', err);
                                showCopyFeedback(contentSpan, '复制失败!', true);
                            }
                        }
                    };

                    contentSpan.addEventListener('click', clickHandler);
                    contentSpan.dataset.amountCopyListenerAttached = 'true';
                    contentSpan.style.cursor = 'pointer'; // 添加鼠标手势提示
                }
            }
        });
    }

    // --- Toggle Button UI ---
    const BUTTON_ID = 'gdspay-lang-toggle-button';

    function addToggleButton() {
        if (document.getElementById(BUTTON_ID)) return;

        const button = document.createElement('div');
        button.id = BUTTON_ID;
        button.textContent = isEnglishMode ? "显示原文" : "显示英文";

        Object.assign(button.style, {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            backgroundColor: '#007bff',
            color: 'white',
            padding: '10px 15px',
            borderRadius: '5px',
            cursor: 'pointer',
            zIndex: '9999',
            boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
            fontFamily: 'sans-serif',
            fontSize: '14px',
            userSelect: 'none'
        });

        button.addEventListener('click', () => {
            isEnglishMode = !isEnglishMode;
            button.textContent = isEnglishMode ? "显示原文" : "显示英文";
            applyLanguageToAllKnownNodes();
        });

        document.body.appendChild(button);
    }

    function removeToggleButton() {
        const button = document.getElementById(BUTTON_ID);
        if (button) {
            button.remove();
        }
    }

    /**
     * Cleans up the script's active state.
     */
    function cleanup() {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        originalTextMap.clear();
        removeToggleButton();
        currentActiveUrl = null;

        // 清理所有可能添加了复制监听器和鼠标手势的元素
        document.querySelectorAll('[data-copyListenerAttached="true"], [data-amountCopyListenerAttached="true"]').forEach(el => {
            el.removeAttribute('data-copyListenerAttached');
            el.removeAttribute('data-amountCopyListenerAttached');
            el.style.removeProperty('cursor'); // 移除鼠标手势
        });
        // console.log("GDSPay Admin Text Replacer: Cleaned up.");
    }

    /**
     * Initializes or re-initializes the script for the current page.
     */
    function initializeForPayoutPage() {
        const isDetail = isCurrentPagePayoutDetail();
        const currentUrl = window.location.href;

        if (isDetail && currentUrl !== currentActiveUrl) {
            cleanup();
            currentActiveUrl = currentUrl;

            traverseAndProcessNodes(document.body);
            addCopyOnCLickToTransactionRef(document.body);
            addCopyOnClickToAmountField(document.body); // 调用金额字段的复制功能

            observer = new MutationObserver((mutationsList) => {
                if (!isCurrentPagePayoutDetail() || window.location.href !== currentActiveUrl) {
                    cleanup();
                    return;
                }

                for (const mutation of mutationsList) {
                    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                        mutation.addedNodes.forEach(node => {
                            traverseAndProcessNodes(node);
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                addCopyOnCLickToTransactionRef(node);
                                addCopyOnClickToAmountField(node); // 处理动态添加的金额字段
                            }
                        });
                    } else if (mutation.type === 'characterData' && mutation.target.nodeType === Node.TEXT_NODE) {
                        processTextNode(mutation.target);
                        if (mutation.target.parentNode && mutation.target.parentNode.classList.contains('ant-descriptions-item-content')) {
                            // 当描述项内容文本变化时，重新检查添加复制监听器
                            addCopyOnCLickToTransactionRef(mutation.target.parentNode.parentNode);
                            addCopyOnClickToAmountField(mutation.target.parentNode.parentNode); // 处理金额字段的文本变化
                        }
                    }
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true,
                characterData: true
            });

            addToggleButton();
            // console.log(`GDSPay Admin Text Replacer: Initialized for payout page: ${currentActiveUrl}`);
        } else if (!isDetail && currentActiveUrl) {
            cleanup();
            // console.log("GDSPay Admin Text Replacer: Navigated away from payout detail page, cleaned up.");
        }
    }

    // --- Execution Triggers ---
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initializeForPayoutPage();
    } else {
        document.addEventListener('DOMContentLoaded', initializeForPayoutPage);
    }

    window.addEventListener('popstate', initializeForPayoutPage);
    setInterval(initializeForPayoutPage, 500);
})();
