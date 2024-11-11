class ScriptInjector {
    constructor() {
        this.injectedScripts = new Map();
        this.menuCommands = new Map();
        this.styleSheets = new Map();
        this.resourceCache = new Map();

        // Track injection status
        this.isInitialized = false;
        this.pendingScripts = new Set();

        // Store original functions for SPA detection
        this.originalPushState = history.pushState;
        this.originalReplaceState = history.replaceState;

        this.injectedScripts = new Map();
        this.siteSettings = new Map();
        this.scriptVersions = new Map();

        this.initialize();
    }

    async initialize() {
        try {
            console.log("[DEBUG] Initializing ScriptInjector");

            // Initialize module and data systems
            await this.initializeGlobalSystems();

            // Setup event listeners
            this.setupMessageListener();
            this.setupSPADetection();
            this.setupMutationObserver();

            // Register cleanup
            this.setupCleanup();

            // Mark as initialized
            this.isInitialized = true;

            // Process any pending scripts
            this.processPendingScripts();

            // Load initial scripts
            await this.loadInitialScripts();

        } catch (error) {
            console.error("[DEBUG] Initialization failed:", error);
        }
    }

    async initializeGlobalSystems() {
        // Initialize the module system
        await this.injectGlobalCode(`
            // Global module system
            window._userscriptModules = new Map();
            window._userscriptData = new Map();
            window._userscriptResources = new Map();
            
            // Module definition system
            window.defineModule = function(name, implementation) {
                window._userscriptModules.set(name, implementation);
                return implementation;
            };
            
            window.getModule = function(name) {
                return window._userscriptModules.get(name);
            };
            
            // Resource management system
            window.defineResource = function(name, content) {
                window._userscriptResources.set(name, content);
            };
            
            window.getResource = function(name) {
                return window._userscriptResources.get(name);
            };
        `);
    }

    isScriptDisabledForSite(scriptName, domain) {
        // Check site-specific setting
        const settingKey = `script_${domain}_${scriptName}`;
        const setting = this.siteSettings.get(settingKey);
        return setting?.enabled === false;
    }

    scriptNeedsUpdate(script) {
        const current = this.scriptVersions.get(script.name);
        if (!current) return true;

        return !this.injectedScripts.has(script.name) || 
               current.version !== script.version;
    }

    setupMessageListener() {
        browser.runtime.onMessage.addListener(async (message, _sender, sendResponse) => {
            switch (message.type) {
                case 'INJECT_SCRIPTS':
                    await this.updateSiteSettings();  // Refresh settings before injection
                    await this.handleScriptInjection(message.scripts);
                    sendResponse({ status: 'ok' });
                    break;

                case 'SITE_STATUS_CHANGE':
                    await this.updateSiteSettings();  // Refresh settings
                    sendResponse({ status: 'ok' });
                    break;

                case 'CLEANUP_SCRIPTS':
                    await this.cleanupAllScripts();
                    sendResponse({ status: 'ok' });
                    break;
            }
        });
    }

    async injectScript(script) {
        try {
            console.log("[DEBUG] Starting injection of script:", script.name);

            // Remove existing script if any
            if (this.injectedScripts.has(script.name)) {
                await this.removeScript(script.name);
            }

            // Create script element
            const scriptElement = document.createElement('script');
            scriptElement.id = `userscript-${script.name}`;

            // Handle resources if any exist
            if (script.resources) {
                await this.preloadResources(script.resources);
            }

            // Create and inject the script context
            const context = await this.createScriptContext(script);
            const blob = new Blob([context], { type: 'application/javascript' });
            scriptElement.src = URL.createObjectURL(blob);

            // Track injection
            this.injectedScripts.set(script.name, {
                element: scriptElement,
                version: script.version,
                timestamp: Date.now()
            });

            // Setup load and error handlers
            return new Promise((resolve, reject) => {
                scriptElement.onload = () => {
                    console.log("[DEBUG] Script loaded successfully:", script.name);
                    URL.revokeObjectURL(scriptElement.src);
                    resolve();
                };

                scriptElement.onerror = (error) => {
                    console.error("[DEBUG] Script failed to load:", script.name, '\nerror', error);
                    URL.revokeObjectURL(scriptElement.src);
                    this.injectedScripts.delete(script.name);
                    reject(error);
                };

                (document.head || document.documentElement).appendChild(scriptElement);
            });

        } catch (error) {
            console.error('[DEBUG] Script injection failed:', error);
            await this.removeScript(script.name);
            throw error;
        }
    }

    setupSPADetection() {
        // Intercept history state changes
        history.pushState = (...args) => {
            this.originalPushState.apply(history, args);
            window.dispatchEvent(new Event('locationchange'));
        };

        history.replaceState = (...args) => {
            this.originalReplaceState.apply(history, args);
            window.dispatchEvent(new Event('locationchange'));
        };

        // Listen for navigation events
        window.addEventListener('popstate', () => {
            window.dispatchEvent(new Event('locationchange'));
        });

        window.addEventListener('locationchange', () => {
            this.notifyUrlChange();
        });
    }

    setupMutationObserver() {
        // Create mutation observer for dynamic content
        this.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    this.handleDOMChanges(mutation.addedNodes);
                }
            }
        });

        // Start observing
        this.observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    setupCleanup() {
        window.addEventListener('unload', () => {
            this.cleanupAllScripts();
        });
    }

    async loadInitialScripts() {
        try {
            const response = await browser.runtime.sendMessage({
                type: 'GET_SCRIPTS',
                url: window.location.href
            });

            if (response && response.scripts) {
                await this.handleScriptInjection(response.scripts);
            }
        } catch (error) {
            console.error("[DEBUG] Initial script load failed:", error);
        }
    }

    handleDOMChanges(addedNodes) {
        // Check for relevant DOM changes that might require script reinjection
        for (const node of addedNodes) {
            if (node.tagName === 'BODY' || node.tagName === 'HEAD') {
                this.notifyUrlChange();
                break;
            }
        }
    }

    async notifyUrlChange() {
        try {
            const response = await browser.runtime.sendMessage({
                type: 'GET_SCRIPTS',
                url: window.location.href
            });

            if (response && response.scripts) {
                await this.handleScriptInjection(response.scripts);
            }
        } catch (error) {
            console.error('[DEBUG] Failed to notify URL change:', error);
        }
    }

    async handleScriptInjection(scripts) {
        if (!this.isInitialized) {
            scripts.forEach(script => this.pendingScripts.add(script));
            return;
        }

        try {
            // Remove scripts that are no longer needed or disabled
            for (const [scriptId] of this.injectedScripts) {
                const script = scripts.find(s => s.name === scriptId);
                if (!script || !script.enabled) {
                    await this.removeScript(scriptId);
                }
            }

            // Inject enabled scripts
            for (const script of scripts) {
                if (script.enabled && !this.injectedScripts.has(script.name)) {
                    await this.injectScript(script);
                }
            }
        } catch (error) {
            console.error('[DEBUG] Script injection error:', error);
        }
    }

    async updateSiteSettings() {
        try {
            const storage = await browser.storage.local.get(null);
            this.siteSettings.clear();
            
            for (const [key, value] of Object.entries(storage)) {
                if (key.startsWith('site_script_')) {
                    this.siteSettings.set(key, value);
                }
            }
        } catch (error) {
            console.error('[DEBUG] Failed to load site settings:', error);
        }
    }

    async processPendingScripts() {
        if (this.pendingScripts.size > 0) {
            const scripts = Array.from(this.pendingScripts);
            this.pendingScripts.clear();
            await this.handleScriptInjection(scripts);
        }
    }

    createGMAPI(script) {
        return `
            const GM = {
                info: ${JSON.stringify({
            script: {
                name: script.name,
                version: script.metadata?.version
            },
            ...script.metadata
        })},

                // Storage API
                getValue: async function(key, defaultValue) {
                    const storage = await browser.storage.local.get(\`userscript_\${key}\`);
                    return storage[\`userscript_\${key}\`] ?? defaultValue;
                },
                
                setValue: async function(key, value) {
                    await browser.storage.local.set({
                        [\`userscript_\${key}\`]: value
                    });
                },
                
                deleteValue: async function(key) {
                    await browser.storage.local.remove(\`userscript_\${key}\`);
                },
                
                listValues: async function() {
                    const storage = await browser.storage.local.get(null);
                    return Object.keys(storage)
                        .filter(key => key.startsWith('userscript_'))
                        .map(key => key.replace('userscript_', ''));
                },

                // Resource Management
                getResourceURL: function(resourceName) {
                    return window.getResource(resourceName);
                },
                
                getResourceText: async function(resourceName) {
                    const resource = window.getResource(resourceName);
                    if (!resource) return null;
                    
                    try {
                        const response = await fetch(resource);
                        return await response.text();
                    } catch (error) {
                        console.error('Failed to load resource:', error);
                        return null;
                    }
                },

                // Logging
                log: function(...args) {
                    console.log(\`[${script.name}]\`, ...args);
                },
                
                // Style Management
                addStyle: function(css) {
                    const style = document.createElement('style');
                    style.textContent = css;
                    style.dataset.script = "${script.name}";
                    document.head.appendChild(style);
                    return style;
                },
                
                // Menu Commands
                registerMenuCommand: function(name, fn, accessKey) {
                    if (!window._userscriptMenuCommands) {
                        window._userscriptMenuCommands = new Map();
                    }
                    window._userscriptMenuCommands.set(name, {
                        name,
                        fn,
                        accessKey,
                        scriptName: "${script.name}"
                    });
                },
                
                unregisterMenuCommand: function(name) {
                    if (window._userscriptMenuCommands) {
                        window._userscriptMenuCommands.delete(name);
                    }
                }
            };

            // Alias for compatibility
            const GM_getValue = GM.getValue;
            const GM_setValue = GM.setValue;
            const GM_deleteValue = GM.deleteValue;
            const GM_listValues = GM.listValues;
            const GM_getResourceURL = GM.getResourceURL;
            const GM_getResourceText = GM.getResourceText;
            const GM_addStyle = GM.addStyle;
            const GM_registerMenuCommand = GM.registerMenuCommand;
            const GM_unregisterMenuCommand = GM.unregisterMenuCommand;
        `;
    }

    async createScriptContext(script) {
        const context = `
            (function() {
                console.log("[DEBUG] Initializing script context for: ${script.name}");
                
                // Browser API polyfill
                ${this.createBrowserPolyfill()}
                
                // GM API
                ${this.createGMAPI(script)}
                
                // XMLHttpRequest API if granted
                ${script.metadata?.grant?.includes('GM.xmlHttpRequest') ? this.createXHRAPI() : ''}
                
                // Notification API if granted
                ${script.metadata?.grant?.includes('GM.notification') ? this.createNotificationAPI() : ''}
                
                // Add required @require scripts
                ${await this.processRequires(script)}
                
                // Module definitions
                ${Object.entries(script.modules || {}).map(([name, content]) => `
                    defineModule("${name}", function() {
                        ${content}
                    });
                `).join('\n')}
                
                // Main script
                try {
                    ${script.content}
                    console.log("[DEBUG] Script executed successfully:", "${script.name}");
                } catch (error) {
                    console.error("[DEBUG] Error executing script ${script.name}:", error);
                }
            })();
        `;

        return context;
    }

    createXHRAPI() {
        return `
            GM.xmlHttpRequest = function(details) {
                return new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    
                    xhr.open(details.method || 'GET', details.url);
                    
                    // Set headers
                    if (details.headers) {
                        Object.entries(details.headers).forEach(([key, value]) => {
                            xhr.setRequestHeader(key, value);
                        });
                    }
                    
                    // Set properties
                    if (details.responseType) xhr.responseType = details.responseType;
                    if (details.timeout) xhr.timeout = details.timeout;
                    if (details.overrideMimeType) xhr.overrideMimeType(details.overrideMimeType);
                    
                    // Setup callbacks
                    xhr.onload = function() {
                        const response = {
                            responseText: xhr.responseType === 'arraybuffer' ? '' : xhr.responseText,
                            response: xhr.response,
                            responseHeaders: xhr.getAllResponseHeaders(),
                            readyState: xhr.readyState,
                            status: xhr.status,
                            statusText: xhr.statusText,
                            finalUrl: xhr.responseURL
                        };
                        
                        if (details.onload) details.onload(response);
                        resolve(response);
                    };
                    
                    xhr.onerror = function(e) {
                        if (details.onerror) details.onerror(e);
                        reject(e);
                    };
                    
                    xhr.onprogress = details.onprogress;
                    xhr.ontimeout = details.ontimeout;
                    
                    // Send request
                    xhr.send(details.data);
                });
            };
        `;
    }

    createNotificationAPI() {
        return `
            GM.notification = function(text, title, image, onclick) {
                return new Promise((resolve, reject) => {
                    if (!("Notification" in window)) {
                        reject(new Error("Notifications not supported"));
                        return;
                    }
                    
                    // Handle different parameter combinations
                    let options = {};
                    if (typeof text === 'object') {
                        options = text;
                        onclick = title;
                    } else {
                        options = {
                            text: text,
                            title: title,
                            image: image
                        };
                    }
                    
                    Notification.requestPermission().then(permission => {
                        if (permission === "granted") {
                            const notification = new Notification(options.title || 'Userscript Notification', {
                                body: options.text,
                                icon: options.image
                            });
                            
                            if (onclick) {
                                notification.onclick = onclick;
                            }
                            
                            resolve(notification);
                        } else {
                            reject(new Error("Notification permission denied"));
                        }
                    });
                });
            };
        `;
    }

    async processRequires(script) {
        if (!script.metadata?.require) return '';

        const requires = Array.isArray(script.metadata.require)
            ? script.metadata.require
            : [script.metadata.require];

        const loadedScripts = await Promise.all(
            requires.map(async url => {
                try {
                    if (this.resourceCache.has(url)) {
                        return this.resourceCache.get(url);
                    }

                    const response = await fetch(url);
                    const content = await response.text();
                    this.resourceCache.set(url, content);
                    return content;
                } catch (error) {
                    console.error(`[DEBUG] Failed to load required script: ${url}`, error);
                    return '';
                }
            })
        );

        return loadedScripts.join('\n');
    }

    async preloadResources(resources) {
        const loadPromises = Object.entries(resources).map(async ([name, url]) => {
            try {
                if (this.resourceCache.has(url)) {
                    return [name, this.resourceCache.get(url)];
                }

                const response = await fetch(url);
                const blob = await response.blob();
                const blobUrl = URL.createObjectURL(blob);
                this.resourceCache.set(url, blobUrl);

                return [name, blobUrl];
            } catch (error) {
                console.error(`[DEBUG] Failed to preload resource: ${name}`, error);
                return [name, null];
            }
        });

        const loadedResources = await Promise.all(loadPromises);
        loadedResources.forEach(([name, url]) => {
            if (url) {
                window._userscriptResources.set(name, url);
            }
        });
    }

    setupMenuCommandsForScript(scriptName) {
        // Create menu container if it doesn't exist
        if (!document.getElementById('userscript-menu')) {
            const menuContainer = document.createElement('div');
            menuContainer.id = 'userscript-menu';
            menuContainer.style.cssText = `
                position: fixed;
                top: 0;
                right: 0;
                background: white;
                border: 1px solid #ccc;
                padding: 10px;
                display: none;
                z-index: 999999;
            `;
            document.body.appendChild(menuContainer);

            // Add keyboard listener for menu
            document.addEventListener('keydown', (e) => {
                if (e.ctrlKey && e.shiftKey && e.key === 'u') {
                    const menu = document.getElementById('userscript-menu');
                    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
                }
            });
        }
    }

    async removeScript(scriptName) {
        const scriptData = this.injectedScripts.get(scriptName);
        if (!scriptData) return;

        try {
            // Remove script element
            scriptData.element.remove();

            // Remove associated styles
            const styles = document.querySelectorAll(`style[data-script="${scriptName}"]`);
            styles.forEach(style => style.remove());

            // Clean up menu commands
            if (window._userscriptMenuCommands) {
                for (const [name, command] of window._userscriptMenuCommands.entries()) {
                    if (command.scriptName === scriptName) {
                        window._userscriptMenuCommands.delete(name);
                    }
                }
            }

            // Remove from tracking
            this.injectedScripts.delete(scriptName);

        } catch (error) {
            console.error(`[DEBUG] Error removing script ${scriptName}:`, error);
        }
    }

    async cleanupAllScripts() {
        try {
            // Remove all script elements
            for (const scriptName of this.injectedScripts.keys()) {
                await this.removeScript(scriptName);
            }

            // Clear caches
            this.resourceCache.clear();
            this.injectedScripts.clear();

            // Remove menu container
            const menuContainer = document.getElementById('userscript-menu');
            if (menuContainer) {
                menuContainer.remove();
            }

            // Stop observers
            if (this.observer) {
                this.observer.disconnect();
            }

            // Restore original history methods
            if (this.originalPushState) {
                history.pushState = this.originalPushState;
            }
            if (this.originalReplaceState) {
                history.replaceState = this.originalReplaceState;
            }

        } catch (error) {
            console.error('[DEBUG] Error during cleanup:', error);
        }
    }

    async injectGlobalCode(code) {
        return new Promise((resolve, reject) => {
            try {
                const script = document.createElement('script');

                // Create a unique ID to track this injection
                const uniqueId = `userscript-global-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
                script.id = uniqueId;

                // Wrap code in error handler
                const blob = new Blob([`
                    try {
                        (function() {
                            ${code}
                        })();
                    } catch (error) {
                        console.error('[Userscript Global Code Error]:', error);
                        document.dispatchEvent(new CustomEvent('userscript-global-error', {
                            detail: {
                                id: '${uniqueId}',
                                error: error.message
                            }
                        }));
                    }
                    document.dispatchEvent(new CustomEvent('userscript-global-complete', {
                        detail: { id: '${uniqueId}' }
                    }));
                `], { type: 'application/javascript' });
                script.src = URL.createObjectURL(blob);

                // Listen for completion or error
                const cleanup = () => {
                    document.removeEventListener('userscript-global-complete', handleComplete);
                    document.removeEventListener('userscript-global-error', handleError);
                    if (script && script.parentNode) {
                        script.remove();
                    }
                };

                const handleComplete = (event) => {
                    if (event.detail.id === uniqueId) {
                        cleanup();
                        resolve();
                    }
                };

                const handleError = (event) => {
                    if (event.detail.id === uniqueId) {
                        cleanup();
                        reject(new Error(event.detail.error));
                    }
                };

                document.addEventListener('userscript-global-complete', handleComplete);
                document.addEventListener('userscript-global-error', handleError);

                // Set a timeout for injection
                setTimeout(() => {
                    cleanup();
                    reject(new Error('Global code injection timed out'));
                }, 10000);

                // Inject the script
                (document.head || document.documentElement).appendChild(script);

            } catch (error) {
                reject(new Error(`Failed to inject global code: ${error.message}`));
            }
        });
    }

    createBrowserPolyfill() {
        return `
            // Browser API polyfill with cross-browser compatibility
            if (typeof browser === 'undefined') {
                const browser = (() => {
                    // Check if Chrome API exists
                    if (typeof chrome !== 'undefined') {
                        return {
                            // Storage API
                            storage: {
                                local: {
                                    get: function(keys) {
                                        return new Promise((resolve) => {
                                            chrome.storage.local.get(keys, resolve);
                                        });
                                    },
                                    set: function(items) {
                                        return new Promise((resolve) => {
                                            chrome.storage.local.set(items, resolve);
                                        });
                                    },
                                    remove: function(keys) {
                                        return new Promise((resolve) => {
                                            chrome.storage.local.remove(keys, resolve);
                                        });
                                    }
                                }
                            },
                            
                            // Runtime API
                            runtime: {
                                sendMessage: function(...args) {
                                    return new Promise((resolve) => {
                                        chrome.runtime.sendMessage(...args, resolve);
                                    });
                                },
                                connect: function(...args) {
                                    return chrome.runtime.connect(...args);
                                }
                            },
                            
                            // Tabs API
                            tabs: {
                                query: function(...args) {
                                    return new Promise((resolve) => {
                                        chrome.tabs.query(...args, resolve);
                                    });
                                },
                                sendMessage: function(...args) {
                                    return new Promise((resolve) => {
                                        chrome.tabs.sendMessage(...args, resolve);
                                    });
                                }
                            }
                        };
                    }
                    
                    // Fallback to empty implementation
                    return {
                        storage: {
                            local: {
                                get: async () => ({}),
                                set: async () => {},
                                remove: async () => {}
                            }
                        },
                        runtime: {
                            sendMessage: async () => {},
                            connect: () => ({
                                onMessage: { addListener: () => {} },
                                onDisconnect: { addListener: () => {} },
                                postMessage: () => {}
                            })
                        },
                        tabs: {
                            query: async () => [],
                            sendMessage: async () => {}
                        }
                    };
                })();

                // Make browser API available globally
                Object.defineProperty(window, 'browser', {
                    value: browser,
                    writable: false,
                    enumerable: true,
                    configurable: false
                });
                
                // Also provide chrome API compatibility
                if (typeof chrome === 'undefined') {
                    Object.defineProperty(window, 'chrome', {
                        value: browser,
                        writable: false,
                        enumerable: true,
                        configurable: false
                    });
                }
            }
            
            // Ensure consistent API access
            const browserAPI = window.browser || window.chrome;
            
            // Add helper for checking API availability
            window.hasBrowserAPI = function(apiPath) {
                return apiPath.split('.').reduce((obj, path) => obj && obj[path], browserAPI) !== undefined;
            };
        `;
    }
}

// Initialize injector for HTML documents
if (document.contentType?.includes('html')) {
    console.log('[DEBUG] Creating ScriptInjector instance');
    const injector = new ScriptInjector();
} else {
    console.log('[DEBUG] Skipping injection for non-HTML document');
}