// ==UserScript==
// @name         You.com UI Enhancer - Optimized Version
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  优化版：隐藏You.com欢迎区域，简化模型选择区，隐藏特定模型选项和侧边栏按钮，准确显示所有模型的上下文长度，降低CPU占用
// @author
// @match        https://you.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // 配置项
    const config = {
        debug: false,               // 调试日志开关
        checkInterval: 2000,        // 定时检测间隔（毫秒），降低频率减少CPU负担
        welcomeText: "What will you tackle today?",  // 欢迎区域的标题文本
        hiddenModels: ["Smart", "Compute", "Research", "Create"],  // 需要隐藏的模型选项
        hiddenSidebarButtons: ["Business", "Download", "More"],  // 需要隐藏的侧边栏按钮
        mutationDebounce: 100,      // MutationObserver回调的去抖时间（毫秒）
        showContextLengths: true    // 是否显示模型的上下文长度
    };

    // 统一的模型关键字数组，便于后续维护和扩展
    const MODEL_KEYWORDS = [
        'Claude',
        'Grok',
        'QwQ',
        'GPT',
        'Smart',
        'Gemini',
        'o3',
        'o1',
        'DeepSeek',
        'Research',
        'Genius',
        'Creative',
        'Qwen',
        'Llama',
        'Mistral',
        'DBRX',
        'R+',
        'Solar',
        'Dolphin'
    ];

    // 检查文本是否包含任一模型关键字
    function hasModelKeyword(text) {
        return MODEL_KEYWORDS.some(keyword => text.includes(keyword));
    }

    // 日志函数（仅在debug为true时输出）
    const log = (...args) => {
        if (config.debug) console.log('[Optimized You.com UI Enhancer]', ...args);
    };

    // 通用去抖函数
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            if (timeout) clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    // 获取当前窗口尺寸
    function getWindowDimensions() {
        return { width: window.innerWidth, height: window.innerHeight };
    }

    // 从页面数据中提取模型上下文长度信息
    function extractModelContextLimits() {
        try {
            // 尝试从页面的NEXT_DATA脚本中获取模型信息
            const nextDataScript = document.getElementById('__NEXT_DATA__');
            if (!nextDataScript) {
                log('未找到NEXT_DATA脚本');
                return {};
            }

            const nextData = JSON.parse(nextDataScript.textContent);
            // 模型信息通常在props.pageProps.aiModels路径下
            const aiModels = nextData?.props?.pageProps?.aiModels || [];

            if (config.debug) {
                log('从页面获取到的原始模型数据:', aiModels);
            }

            // 创建精确的模型ID和名称映射
            const modelMap = {};

            aiModels.forEach(model => {
                // 直接使用ID作为主键
                if (model.id && model.contextLimit) {
                    modelMap[model.id] = {
                        name: model.name || model.id,
                        contextLimit: model.contextLimit
                    };
                }

                // 使用名称作为键
                if (model.name && model.contextLimit) {
                    // 存储完整名称
                    const fullName = model.name.trim();
                    modelMap[fullName] = {
                        id: model.id,
                        contextLimit: model.contextLimit
                    };

                    // 为OpenAI特殊模型创建简化名称映射
                    if (model.id === 'gpt_4o') {
                        modelMap['GPT-4o'] = { id: model.id, contextLimit: model.contextLimit };
                    }
                    else if (model.id === 'gpt_4o_mini') {
                        modelMap['GPT-4o mini'] = { id: model.id, contextLimit: model.contextLimit };
                    }
                    else if (model.id === 'gpt_4_turbo') {
                        modelMap['GPT-4 Turbo'] = { id: model.id, contextLimit: model.contextLimit };
                    }
                    else if (model.id === 'gpt_4') {
                        modelMap['GPT-4'] = { id: model.id, contextLimit: model.contextLimit };
                    }
                    else if (model.id === 'gpt_4_5_preview') {
                        modelMap['GPT-4.5 Preview'] = { id: model.id, contextLimit: model.contextLimit };
                    }
                    // 处理OpenAI o系列模型
                    else if (model.id === 'openai_o3_mini_high') {
                        modelMap['o3 Mini (High Effort)'] = { id: model.id, contextLimit: model.contextLimit };
                    }
                    else if (model.id === 'openai_o3_mini_medium') {
                        modelMap['o3 Mini'] = { id: model.id, contextLimit: model.contextLimit };
                    }
                    else if (model.id === 'openai_o1') {
                        modelMap['o1'] = { id: model.id, contextLimit: model.contextLimit };
                    }
                    else if (model.id === 'openai_o1_preview') {
                        modelMap['o1 Preview'] = { id: model.id, contextLimit: model.contextLimit };
                    }
                    else if (model.id === 'openai_o1_mini') {
                        modelMap['o1 Mini'] = { id: model.id, contextLimit: model.contextLimit };
                    }

                    // 处理Claude模型
                    if (model.name.includes('Claude')) {
                        const simpleClaudeName = model.name.replace(/\s*\([^)]*\)/g, '').trim();
                        modelMap[simpleClaudeName] = { id: model.id, contextLimit: model.contextLimit };
                    }
                }
            });

            if (config.debug) {
                log('处理后的模型映射:', modelMap);
            }

            return modelMap;
        } catch (error) {
            log('提取模型上下文长度时出错:', error);
            return {};
        }
    }

    // 格式化上下文长度（例如，将"126000"转换为"126k"）
    function formatContextLimit(limit) {
        if (typeof limit !== 'number' || isNaN(limit)) return '';

        // 转换为千字节并四舍五入
        const inK = Math.round(limit / 1000);
        return `(${inK}k)`;
    }

    // 获取模型的ID或名称
    function getModelIdentifier(text) {
        // 常见模型名称的正则表达式
        const patterns = [
            // OpenAI新模型
            { regex: /\bGPT-4\.5\s*Preview\b/i, id: 'GPT-4.5 Preview' },
            { regex: /\bo3\s*Mini\s*\(High\s*Effort\)/i, id: 'o3 Mini (High Effort)' },
            { regex: /\bo3\s*Mini\b(?!\s*\()/i, id: 'o3 Mini' },
            { regex: /\bo1\s*Preview\b/i, id: 'o1 Preview' },
            { regex: /\bo1\s*Mini\b/i, id: 'o1 Mini' },
            { regex: /\bo1\b(?!\s*Preview|\s*Mini)/i, id: 'o1' },

            // GPT models
            { regex: /\bGPT-4o\b(?!\s+mini)/i, id: 'GPT-4o' },
            { regex: /\bGPT-4o\s+mini\b/i, id: 'GPT-4o mini' },
            { regex: /\bGPT-4\s+Turbo\b/i, id: 'GPT-4 Turbo' },
            { regex: /\bGPT-4\b(?!\s+Turbo|\s+o|\.5)/i, id: 'GPT-4' },

            // Claude models
            { regex: /\bClaude\s+3\.7\s+Sonnet\s+\(Extended\)/i, id: 'Claude 3.7 Sonnet (Extended)' },
            { regex: /\bClaude\s+3\.7\s+Sonnet\b(?!\s+\()/i, id: 'Claude 3.7 Sonnet' },
            { regex: /\bClaude\s+3\.5\s+Sonnet\b/i, id: 'Claude 3.5 Sonnet' },
            { regex: /\bClaude\s+3\s+Opus\b/i, id: 'Claude 3 Opus' },
            { regex: /\bClaude\s+3\s+Sonnet\b/i, id: 'Claude 3 Sonnet' },
            { regex: /\bClaude\s+3\.5\s+Haiku\b/i, id: 'Claude 3.5 Haiku' },

            // Other models with simple patterns
            { regex: /\bQwQ\s+32B\b/i, id: 'QwQ 32B' },
            { regex: /\bQwen2\.5\s+72B\b/i, id: 'Qwen2.5 72B' },
            { regex: /\bQwen2\.5\s+Coder\s+32B\b/i, id: 'Qwen2.5 Coder 32B' },
            { regex: /\bGrok\s+2\b/i, id: 'Grok 2' },
            { regex: /\bMistral\s+Large\s+2\b/i, id: 'Mistral Large 2' },
            { regex: /\bGemini\s+2\.0\s+Flash\b/i, id: 'Gemini 2.0 Flash' },
            { regex: /\bGemini\s+1\.5\s+Flash\b/i, id: 'Gemini 1.5 Flash' },
            { regex: /\bGemini\s+1\.5\s+Pro\b/i, id: 'Gemini 1.5 Pro' },
            { regex: /\bDBRX-Instruct\b/i, id: 'DBRX-Instruct' },
            { regex: /\bCommand\s+R\+\b/i, id: 'Command R+' },
            { regex: /\bDeepSeek-R1\b/i, id: 'DeepSeek-R1' },
            { regex: /\bDeepSeek-V3\b/i, id: 'DeepSeek-V3' },
            { regex: /\bLlama\s+3\.3\s+70B\b/i, id: 'Llama 3.3 70B' },
            { regex: /\bLlama\s+3\.2\s+90B\b/i, id: 'Llama 3.2 90B' },
            { regex: /\bLlama\s+3\.1\s+405B\b/i, id: 'Llama 3.1 405B' },
            { regex: /\bSolar\s+1\s+Mini\b/i, id: 'Solar 1 Mini' },
            { regex: /\bDolphin\s+2\.5\b/i, id: 'Dolphin 2.5' }
        ];

        // 检查文本是否匹配任何模型模式
        for (const pattern of patterns) {
            if (pattern.regex.test(text)) {
                return pattern.id;
            }
        }

        // 如果没有匹配特定模式，返回null
        return null;
    }

    // 为下拉菜单中的模型名称添加上下文长度显示
    function addContextLimitsToModelNames(popup, modelMap) {
        if (!config.showContextLengths || !popup || !modelMap || Object.keys(modelMap).length === 0) return;

        // 查找下拉菜单中的所有可能的模型选项元素
        const allElements = Array.from(popup.querySelectorAll('div, button, a, li, span'));

        // 筛选出看起来像模型选项的元素，统一使用hasModelKeyword检测
        const modelElements = allElements.filter(el => {
            // 跳过没有文本内容或已经添加了上下文长度的元素
            if (!el.textContent || el.textContent.includes('k)')) return false;
            // 检查该元素是否不太复杂
            const childCount = el.querySelectorAll('div, button, li').length;
            if (childCount > 3) return false;
            const text = el.textContent.trim();
            return hasModelKeyword(text);
        });

        log('找到潜在的模型元素数量:', modelElements.length);

        // 为每个模型元素添加上下文长度
        modelElements.forEach(el => {
            const text = el.textContent.trim();

            // 如果文本已经包含上下文长度格式，则跳过
            if (text.match(/\(\d+k\)$/)) return;

            // 识别模型
            const modelId = getModelIdentifier(text);
            if (!modelId) {
                log('无法识别模型:', text);
                return;
            }

            // 查找模型的上下文长度
            const modelInfo = modelMap[modelId];
            if (!modelInfo || !modelInfo.contextLimit) {
                log('未找到模型信息:', modelId);
                return;
            }

            // 格式化上下文长度
            const formattedLimit = formatContextLimit(modelInfo.contextLimit);

            // 查找文本节点并添加上下文长度
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
            const textNodes = [];
            let node;
            while (node = walker.nextNode()) {
                if (node.textContent.trim()) {
                    textNodes.push(node);
                }
            }

            // 找到包含模型名称的文本节点
            let targetNode = null;
            // 先尝试精确匹配
            for (const node of textNodes) {
                if (node.textContent.trim() === modelId || node.textContent.includes(modelId)) {
                    targetNode = node;
                    break;
                }
            }

            // 如果没有找到精确匹配，使用最后一个文本节点
            if (!targetNode && textNodes.length > 0) {
                targetNode = textNodes[textNodes.length - 1];
            }

            if (targetNode) {
                // 确保不会重复添加上下文长度
                if (!targetNode.textContent.includes(formattedLimit)) {
                    targetNode.textContent = targetNode.textContent.trim() + ' ' + formattedLimit;
                    log('为模型添加了上下文长度:', modelId, formattedLimit);
                }
            }
        });
    }

    // 1. 隐藏欢迎区域
    function hideWelcomeArea() {
        const { height } = getWindowDimensions();
        // 查询包含欢迎区域标题的元素
        const welcomeHeading = Array.from(document.querySelectorAll('h1, h2, h3, div'))
            .find(el => el.textContent && el.textContent.trim() === config.welcomeText);
        if (welcomeHeading) {
            log('找到欢迎区域标题');
            let container = welcomeHeading;
            let found = false;
            // 向上查找最多4层的父容器
            for (let i = 0; i < 4 && container; i++) {
                if (!container.parentElement) break;
                container = container.parentElement;
                // 检测是否包含选项卡或卡片区域
                const hasTabs = container.querySelector('[role="tab"]') ||
                    Array.from(container.querySelectorAll('button')).some(btn => {
                        const txt = btn.textContent;
                        return txt && (txt.includes('Featured') || txt.includes('Marketing') || txt.includes('Sales'));
                    });
                const hasCards = container.textContent &&
                    container.textContent.includes('Research') &&
                    container.textContent.includes('Create') &&
                    container.textContent.includes('Compute');
                if ((hasTabs || hasCards) && container.getBoundingClientRect().top < height / 2) {
                    container.style.display = 'none';
                    log('隐藏整个欢迎区域容器');
                    found = true;
                    break;
                }
            }
            if (!found) {
                welcomeHeading.style.display = 'none';
                log('以标题为备选方案隐藏欢迎区域');
            }
            return true;
        }
        return false;
    }

    // 2. 判断元素是否在侧边栏区域（通常采用特定导航或位置判断）
    function isInSidebar(element) {
        if (element.closest('nav') ||
            element.closest('[aria-label="Sidebar"]') ||
            element.closest('#sidebar')) {
            return true;
        }
        const rect = element.getBoundingClientRect();
        if (rect.left < window.innerWidth * 0.25 && rect.right < window.innerWidth * 0.3) {
            return true;
        }
        const isNearBottom = rect.bottom > window.innerHeight * 0.7 && rect.top > window.innerHeight * 0.5;
        const isInBottomCenter = rect.left > window.innerWidth * 0.3 && rect.right < window.innerWidth * 0.9;
        if (isNearBottom && isInBottomCenter) {
            return false;
        }
        const parentText = element.parentElement ? element.parentElement.textContent : '';
        if (parentText.includes('New Chat') || parentText.includes('Agents') ||
            parentText.includes('Business') || parentText.includes('Download')) {
            return true;
        }
        return false;
    }

    // 3. 处理模型选择区域
    function handleModelArea() {
        const { height } = getWindowDimensions();
        const buttons = Array.from(document.querySelectorAll('button'));

        // 筛选出位于页面底部且不在侧边栏的模型按钮
        const bottomButtons = buttons.filter(button => {
            const rect = button.getBoundingClientRect();
            const isAtBottom = rect.top > window.innerHeight * 0.5 && rect.bottom < window.innerHeight * 0.95;
            const isNotInSidebar = !isInSidebar(button);
            const text = button.textContent.trim();
            // 使用全局统一检测模型关键字，允许“More”或“Model selector”直接判断
            const isModelButton = hasModelKeyword(text) || text === 'More' || text === 'Model Selector';
            return isAtBottom && isNotInSidebar && isModelButton;
        });

        if (!bottomButtons.length) {
            log('未找到模型按钮');
            return false;
        }
        log('找到模型按钮数量:', bottomButtons.length);

        // 找到"More"按钮，并将其重命名为"Model selector"
        const moreButton = bottomButtons.find(button =>
            button.textContent.trim() === 'More' ||
            button.textContent.trim() === 'Model Selector'
        );
        if (!moreButton) {
            log('未找到模型区域的 "More" 按钮');
            return false;
        }
        if (moreButton.textContent.trim() === 'More') {
            moreButton.textContent = 'Model Selector';
            log('将 "More" 按钮重命名为 "Model Selector"');
        }

        // 隐藏除了"Model selector"之外的所有模型按钮
        bottomButtons.forEach(button => {
            if (button !== moreButton) {
                let container = button;
                let parent = button.parentElement;
                // 向上查找最多3层，寻找合适的父容器隐藏
                for (let i = 0; i < 3 && parent; i++) {
                    if (parent.childElementCount <= 2) {
                        const hasSiblingButton = Array.from(parent.children)
                            .some(child => child !== button && child.tagName === 'BUTTON');
                        if (!hasSiblingButton) {
                            container = parent;
                            parent = parent.parentElement;
                        } else {
                            break;
                        }
                    } else {
                        break;
                    }
                }
                container.style.display = 'none';
                log('隐藏模型按钮:', button.textContent.trim());
            }
        });

        return true;
    }

    // 4. 隐藏下拉菜单中需要隐藏的模型选项并添加上下文长度
    function hideModelOptionsInPopup() {
        // 从页面数据中提取模型上下文长度信息
        const modelMap = extractModelContextLimits();

        // 优化选择器：避免使用过于通用的选择器，只查询可能的弹出菜单元素
        const popups = Array.from(document.querySelectorAll(
            'div[role="dialog"], [aria-modal="true"], [class*="dropdown"], [class*="popover"], [class*="menu"], [class*="popup"]'
        ));

        const modelPopups = popups.filter(popup => {
            const style = window.getComputedStyle(popup);
            if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
                return false;
            }
            // 使用统一的模型关键字检测
            const hasModelText = popup.textContent && hasModelKeyword(popup.textContent);
            // 通过宽度判断是否为弹出层
            const isPopupSize = popup.offsetWidth < window.innerWidth * 0.9;
            return hasModelText && isPopupSize;
        });

        if (!modelPopups.length) return;

        log('找到模型选项弹出层数量:', modelPopups.length);

        modelPopups.forEach(popup => {
            // 首先为模型名称添加上下文长度
            addContextLimitsToModelNames(popup, modelMap);

            // 然后隐藏需要隐藏的模型选项
            const options = Array.from(popup.querySelectorAll('div, button, a, li')).filter(el => {
                if (!el.textContent) return false;
                const matchesHiddenModel = config.hiddenModels.some(model =>
                    el.textContent.trim() === model ||
                    (el.textContent.includes(model) && !el.textContent.includes('Claude') &&
                     !el.textContent.includes('GPT') && !el.textContent.includes('Grok'))
                );
                // 忽略内容结构过于复杂的容器
                const isTooLarge = el.querySelectorAll('div, button, a, li').length > 5;
                return matchesHiddenModel && !isTooLarge;
            });

            options.forEach(option => {
                let containerToHide = option;
                let parent = option.parentElement;
                // 向上查找3层以内，寻找合适的父容器进行隐藏
                for (let i = 0; i < 3 && parent; i++) {
                    if (parent.tagName === 'LI' ||
                        parent.getAttribute('role') === 'option' ||
                        parent.getAttribute('role') === 'menuitem' ||
                        (parent.className && (parent.className.includes('item') ||
                                               parent.className.includes('card') ||
                                               parent.className.includes('option')))
                    ) {
                        containerToHide = parent;
                        break;
                    }
                    const siblingOptions = Array.from(parent.children).filter(child => {
                        return child.textContent && (
                            child.textContent.includes('Claude') ||
                            child.textContent.includes('GPT') ||
                            child.textContent.includes('Grok') ||
                            child.textContent.includes('Gemini') ||
                            config.hiddenModels.some(model => child.textContent.includes(model))
                        );
                    });
                    if (siblingOptions.length > 1) break;
                    containerToHide = parent;
                    parent = parent.parentElement;
                }
                containerToHide.style.display = 'none';
                log('隐藏模型下拉选项:', option.textContent.trim());
            });
        });
    }

    // 5. 隐藏侧边栏的指定按钮
    function hideSidebarButtons() {
        // 查找侧边栏区域
        const sidebar = document.querySelector('nav, [aria-label="Sidebar"], #sidebar') ||
                      document.querySelector('div[style*="position: fixed"][style*="left: 0"]');

        if (!sidebar) {
            log('未找到侧边栏');
            return;
        }

        // 在整个文档中查找可能的侧边栏按钮
        const allElements = document.querySelectorAll('a, button, div[role="button"], [class*="sidebar"] a, [class*="sidebar"] button');

        // 筛选出要隐藏的侧边栏按钮
        const sidebarButtons = Array.from(allElements).filter(el => {
            if (!el.textContent) return false;
            const buttonText = el.textContent.trim();
            const isTargetButton = config.hiddenSidebarButtons.some(btn => buttonText === btn);
            const rect = el.getBoundingClientRect();
            const isInLeftSide = rect.left < window.innerWidth * 0.25;
            const sidebarCheck = isInSidebar(el);
            return isTargetButton && (isInLeftSide || sidebarCheck || el.closest('nav') === sidebar);
        });

        log('找到侧边栏按钮数量:', sidebarButtons.length);

        // 隐藏找到的按钮
        sidebarButtons.forEach(button => {
            let containerToHide = button;
            let parent = button.parentElement;
            for (let i = 0; i < 3 && parent; i++) {
                if (parent.tagName === 'LI' ||
                    parent.getAttribute('role') === 'menuitem' ||
                    (parent.className &&
                     (parent.className.includes('item') ||
                      parent.className.includes('nav') ||
                      parent.className.includes('sidebar')))) {
                    containerToHide = parent;
                    parent = parent.parentElement;
                } else {
                    if (parent.childElementCount <= 2) {
                        containerToHide = parent;
                        parent = parent.parentElement;
                    } else {
                        break;
                    }
                }
            }
            containerToHide.style.display = 'none';
            log('隐藏侧边栏按钮:', button.textContent.trim());
        });
    }

    // 统一处理UI更新操作，采用去抖技术避免重复调用
    const debouncedUIUpdate = debounce(() => {
        hideWelcomeArea();
        handleModelArea();
        hideModelOptionsInPopup();
        hideSidebarButtons();
    }, config.mutationDebounce);

    // 6. 设置事件监听器，兼顾点击和DOM变动
    function setupEventHandlers() {
        document.addEventListener('click', event => {
            const clickedButton = event.target.closest('button');
            if (!clickedButton) return;
            const buttonText = clickedButton.textContent.trim();

            // 针对"Model selector"或"More"按钮（且不在侧边栏）
            if ((buttonText === 'Model Selector' || buttonText === 'More') && !isInSidebar(clickedButton)) {
                log('点击了模型选择器按钮');
                setTimeout(debouncedUIUpdate, 200);
            }
            // 针对其他模型按钮，使用统一的关键字检测
            if (hasModelKeyword(buttonText) && buttonText !== 'More' && buttonText !== 'Model Selector') {
                log('点击了模型按钮:', buttonText);
                setTimeout(debouncedUIUpdate, 300);
            }
        }, true);

        // 使用MutationObserver监听DOM变化，仅关注必要的节点及属性变化
        const observer = new MutationObserver(() => {
            debouncedUIUpdate();
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class', 'aria-hidden']
        });
    }

    // 初始化
    function init() {
        log('初始化优化版You.com UI增强脚本');
        setTimeout(() => {
            hideWelcomeArea();
            handleModelArea();
            hideSidebarButtons();
            setupEventHandlers();
            log('初始化完成');
        }, 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
