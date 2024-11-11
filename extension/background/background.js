class ScriptManager {
    constructor() {
        this.scripts = new Map();
        this.siteSettings = new Map();
        this.retryCount = 0;
        this.maxRetries = 5;
        this.watcherEnabled = false;
        this.settings = {
            autoReload: false,
            showDebug: false,
            scriptDirectory: ''
        };

        // Initialize manager
        this.initialize();
    }

    async initialize() {
        try {
            // Load all settings
            await this.loadSettings();

            // Load site settings from storage
            const storage = await browser.storage.local.get(null);
            for (const [key, value] of Object.entries(storage)) {
                if (key.startsWith('site_')) {
                    this.siteSettings.set(key.replace('site_', ''), value);
                }
            }

            // Connect to native host
            await this.connectNative();

            // Setup listeners
            this.setupMessageListeners();
            this.setupTabListeners();
            this.setupStorageListener();

            // Start file watcher if enabled
            if (this.settings.autoReload) {
                this.startScriptWatcher();
            }

            this.log('ScriptManager initialized successfully');
        } catch (error) {
            this.error('Initialization error:', error);
        }
    }

    log(...args) {
        if (this.settings.showDebug) {
            console.log('[DEBUG]', ...args);
        }
    }

    error(...args) {
        console.error('[ERROR]', ...args);
    }

    async connectNative() {
        try {
            this.log("Connecting to native host...");

            // Create native port
            this.port = browser.runtime.connectNative("userscript_manager");

            // Setup message handler
            this.port.onMessage.addListener(msg => this.handleNativeMessage(msg));

            // Test connection and get initial scripts
            this.port.postMessage({
                type: "INITIALIZE",
                settings: this.settings
            });

            // Setup disconnect handler with exponential backoff
            this.port.onDisconnect.addListener((p) => {
                const error = browser.runtime.lastError;
                this.error("Native connection lost:", error?.message);

                if (this.retryCount < this.maxRetries) {
                    this.retryCount++;
                    const delay = Math.min(1000 * Math.pow(2, this.retryCount), 30000);
                    setTimeout(() => this.connectNative(), delay);
                }
            });

            this.retryCount = 0;
        } catch (error) {
            this.error('Native connection failed:', error);
            if (this.retryCount < this.maxRetries) {
                this.retryCount++;
                setTimeout(() => this.connectNative(), 1000 * this.retryCount);
            }
        }
    }

    setupMessageListeners() {
        browser.runtime.onMessage.addListener((message, sender) => {
            return this.handleMessage(message, sender);
        });
    }

    setupTabListeners() {
        browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            if (changeInfo.status === 'loading' && tab.url) {
                this.injectScripts(tabId, tab.url);
            }
        });

        browser.tabs.onActivated.addListener(async (activeInfo) => {
            const tab = await browser.tabs.get(activeInfo.tabId);
            if (tab.url) {
                this.updateBadge(tab.url);
            }
        });
    }

    setupStorageListener() {
        browser.storage.onChanged.addListener((changes, area) => {
            if (area === 'local') {
                this.handleStorageChanges(changes);
            }
        });
    }

    async handleStorageChanges(changes) {
        for (const [key, { newValue }] of Object.entries(changes)) {
            if (key === 'autoReload') {
                this.settings.autoReload = newValue;
                if (newValue) {
                    this.startScriptWatcher();
                } else {
                    this.stopScriptWatcher();
                }
            } else if (key === 'showDebug') {
                this.settings.showDebug = newValue;
            } else if (key === 'scriptDirectory') {
                this.settings.scriptDirectory = newValue;
                await this.reloadAllScripts();
            } else if (key.startsWith('site_')) {
                const siteKey = key.replace('site_', '');
                this.siteSettings.set(siteKey, newValue);
                await this.updateAllTabs();
            }
        }
    }

    startScriptWatcher() {
        if (!this.watcherEnabled && this.settings.autoReload) {
            this.watcherEnabled = true;
            this.port.postMessage({
                type: 'START_WATCHER',
                directory: this.settings.scriptDirectory
            });
        }
    }

    stopScriptWatcher() {
        if (this.watcherEnabled) {
            this.watcherEnabled = false;
            this.port.postMessage({ type: 'STOP_WATCHER' });
        }
    }

    async handleMessage(message, sender) {
        this.log("Received message:", message.type);

        switch (message.type) {
            case 'GET_SCRIPTS':
                return {
                    scripts: this.getScriptsForUrl(message.url || sender.tab?.url)
                };

            case 'SITE_STATUS_CHANGE':
                await this.updateSiteStatus(message.domain, message.enabled);
                await this.updateAllTabs();
                return true;

            case 'TOGGLE_SCRIPT':
                await this.toggleScript(message.scriptName, message.domain, message.enabled);
                await this.updateAllTabs();
                return true;

            case 'RELOAD_SCRIPTS':
                await this.reloadAllScripts();
                return true;

            case 'GET_SETTINGS':
                return {
                    settings: this.settings,
                    siteSettings: Object.fromEntries(this.siteSettings)
                };

            case 'UPDATE_SETTINGS':
                await this.updateSettings(message.settings);
                return true;

            case 'EXECUTE_SCRIPT_COMMAND':
                return await this.executeScriptCommand(message.scriptName, message.command, message.args);
        }
    }

    async executeScriptCommand(scriptName, command, args) {
        const script = this.scripts.get(scriptName);
        if (!script || !script.commands || !script.commands[command]) {
            throw new Error(`Command ${command} not found for script ${scriptName}`);
        }

        try {
            return await script.commands[command](...args);
        } catch (error) {
            this.error(`Error executing command ${command}:`, error);
            throw error;
        }
    }

    handleNativeMessage(message) {
        this.log("Native message:", message.type);

        switch (message.type) {
            case 'SCRIPTS_UPDATE':
                this.updateScripts(message.scripts);
                break;

            case 'SCRIPT_CHANGED':
                this.handleScriptChange(message.script);
                break;

            case 'ERROR':
                this.error('Native host error:', message.error);
                break;
        }
    }

    async handleScriptChange(scriptData) {
        const script = this.scripts.get(scriptData.name);
        if (script) {
            this.scripts.set(scriptData.name, {
                ...script,
                ...scriptData,
                enabled: script.enabled
            });
        } else {
            this.scripts.set(scriptData.name, scriptData);
        }

        await this.updateAllTabs();
    }

    updateScripts(scripts) {
        // Preserve enabled states when updating scripts
        const enabledStates = new Map(
            Array.from(this.scripts.entries())
                .map(([name, script]) => [name, script.enabled])
        );

        this.scripts.clear();
        scripts.forEach(script => {
            const enabled = enabledStates.has(script.name)
                ? enabledStates.get(script.name)
                : script.enabled !== false;

            this.scripts.set(script.name, { ...script, enabled });
        });

        // Update all tabs
        this.updateAllTabs();
    }

    async updateAllTabs() {
        const tabs = await browser.tabs.query({});
        for (const tab of tabs) {
            if (tab.url && tab.url.startsWith('http')) {
                await this.injectScripts(tab.id, tab.url);
                this.updateBadge(tab.url, tab.id);
            }
        }
    }

    updateBadge(url, tabId) {
        const scripts = this.getScriptsForUrl(url);
        const count = scripts.length;

        if (!tabId) {
            browser.tabs.query({ active: true, currentWindow: true })
                .then(tabs => {
                    if (tabs[0]) {
                        this.setBadge(tabs[0].id, count);
                    }
                });
        } else {
            this.setBadge(tabId, count);
        }
    }

    setBadge(tabId, count) {
        browser.browserAction.setBadgeText({
            text: count > 0 ? count.toString() : '',
            tabId
        });

        browser.browserAction.setBadgeBackgroundColor({
            color: count > 0 ? '#738adb' : '#6c7086',
            tabId
        });
    }

    prepareScript(script) {
        const prepared = {
            ...script,
            modules: script.modules || {},
            metadata: script.metadata || {},
            content: `
                // Handle modules
                ${Object.entries(script.modules || {}).map(([name, content]) => `
                    define("${name}", function() {
                        ${content}
                    });
                `).join('\n')}
    
                // Main script
                (function() {
                    ${script.content}
                })();
            `
        };

        // Add helper functions
        if (script.metadata?.grant?.includes('GM.xmlHttpRequest')) {
            prepared.content = this.addXHRSupport(prepared.content);
        }

        if (script.metadata?.grant?.includes('GM.notification')) {
            prepared.content = this.addNotificationSupport(prepared.content);
        }

        return prepared;
    }

    addXHRSupport(content) {
        return `
            // XHR Support
            if (typeof GM.xmlHttpRequest === 'undefined') {
                GM.xmlHttpRequest = function(details) {
                    return new Promise((resolve, reject) => {
                        const xhr = new XMLHttpRequest();
                        xhr.open(details.method || 'GET', details.url);
                        
                        Object.entries(details.headers || {}).forEach(([key, value]) => {
                            xhr.setRequestHeader(key, value);
                        });
                        
                        xhr.onload = function() {
                            resolve({
                                response: xhr.response,
                                responseText: xhr.responseText,
                                responseHeaders: xhr.getAllResponseHeaders(),
                                status: xhr.status,
                                statusText: xhr.statusText
                            });
                        };
                        
                        xhr.onerror = reject;
                        xhr.send(details.data);
                    });
                };
            }
            
            ${content}
        `;
    }

    addNotificationSupport(content) {
        return `
            // Notification Support
            if (typeof GM.notification === 'undefined') {
                GM.notification = function(text, options = {}) {
                    return new Promise((resolve) => {
                        if (!("Notification" in window)) {
                            console.warn("Notifications not supported");
                            resolve(false);
                            return;
                        }
                        
                        Notification.requestPermission().then(permission => {
                            if (permission === "granted") {
                                new Notification(options.title || 'Userscript Notification', {
                                    body: text,
                                    icon: options.image
                                });
                                resolve(true);
                            } else {
                                resolve(false);
                            }
                        });
                    });
                };
            }
            
            ${content}
        `;
    }

    getScriptsForUrl(url) {
        if (!url) return [];

        try {
            const domain = new URL(url).hostname;
            const siteEnabled = this.isSiteEnabled(domain);

            return Array.from(this.scripts.values())
                .filter(script => {
                    if (!this.matchesUrlPatterns(script, url)) return false;

                    // Check global script state
                    if (!script.enabled) return false;

                    // Check site-wide enable/disable
                    if (!siteEnabled) return false;

                    // Check site-specific script settings
                    const scriptSettings = this.getScriptSettings(script.name, domain);
                    return scriptSettings?.enabled !== false; // Default to true if no setting exists
                })
                .map(script => ({
                    ...script,
                    siteSpecific: {
                        enabled: this.getScriptSettings(script.name, domain)?.enabled ?? true
                    }
                }));
        } catch (error) {
            this.error('Error getting scripts for URL:', error);
            return [];
        }
    }

    getScriptSettings(scriptName, domain) {
        const key = `script_${domain}_${scriptName}`;
        return this.siteSettings.get(key);
    }

    async toggleScript(scriptName, domain, enabled) {
        try {
            const settingKey = `site_script_${domain}_${scriptName}`;
            
            // Update storage
            await browser.storage.local.set({
                [settingKey]: { enabled }
            });

            // Update in-memory settings
            this.siteSettings.set(settingKey, { enabled });

            // Get tabs for this domain and refresh scripts
            const tabs = await browser.tabs.query({ url: `*://${domain}/*` });
            for (const tab of tabs) {
                if (tab.url && tab.url.startsWith('http')) {
                    await this.injectScripts(tab.id, tab.url);
                }
            }

            return true;
        } catch (error) {
            this.error('Failed to toggle script:', error);
            throw error;
        }
    }

    getScriptsForUrl(url) {
        if (!url) return [];

        try {
            const domain = new URL(url).hostname;
            const siteEnabled = this.isSiteEnabled(domain);

            // If site is disabled entirely, return no scripts
            if (!siteEnabled) return [];

            return Array.from(this.scripts.values())
                .filter(script => this.matchesUrlPatterns(script, url))
                .map(script => {
                    // Get site-specific setting for this script
                    const siteSpecificKey = `site_script_${domain}_${script.name}`;
                    const siteSpecificSetting = this.siteSettings.get(siteSpecificKey);
                    
                    return {
                        ...script,
                        // Use site-specific setting if exists, otherwise use global enabled state
                        enabled: siteSpecificSetting !== undefined ? 
                                siteSpecificSetting.enabled : 
                                script.enabled !== false
                    };
                });
        } catch (error) {
            this.error('Error getting scripts for URL:', error);
            return [];
        }
    }

    // Update how we load settings from storage
    async loadSettings() {
        try {
            const storage = await browser.storage.local.get(null);
            
            // Load general settings
            this.settings = {
                autoReload: storage.autoReload ?? false,
                showDebug: storage.showDebug ?? false,
                scriptDirectory: storage.scriptDirectory ?? ''
            };

            // Load site settings
            this.siteSettings.clear();
            for (const [key, value] of Object.entries(storage)) {
                if (key.startsWith('site_script_') || key.startsWith('site_')) {
                    this.siteSettings.set(key, value);
                }
            }
        } catch (error) {
            this.error('Failed to load settings:', error);
        }
    }

    // Update the setupStorageListener to handle script toggles
    setupStorageListener() {
        browser.storage.onChanged.addListener((changes, area) => {
            if (area === 'local') {
                for (const [key, { newValue }] of Object.entries(changes)) {
                    if (key.startsWith('script_')) {
                        const [, domain, scriptName] = key.split('_');
                        this.siteSettings.set(key, newValue);
                        this.updateTabsForDomain(domain);
                    }
                }
            }
        });
    }

    async updateTabsForDomain(domain) {
        const tabs = await browser.tabs.query({
            url: `*://${domain}/*`
        });

        for (const tab of tabs) {
            if (tab.url?.startsWith('http')) {
                await this.injectScripts(tab.id, tab.url);
            }
        }
    }

    shouldInjectScript(script, url, domain) {
        // Check if script is enabled globally
        if (script.enabled === false) return false;

        // Check if script is enabled for this domain
        const scriptSettings = this.getScriptSettings(script.name, domain);
        if (scriptSettings && !scriptSettings.enabled) return false;

        // Check URL patterns
        return this.matchesUrlPatterns(script, url);
    }

    matchesUrlPatterns(script, url) {
        if (!script.metadata?.match) return false;

        const patterns = Array.isArray(script.metadata.match)
            ? script.metadata.match
            : [script.metadata.match];

        return patterns.some(pattern => {
            try {
                const regex = this.convertMatchPatternToRegex(pattern);
                return regex.test(url);
            } catch (e) {
                this.error('Invalid pattern:', pattern, e);
                return false;
            }
        });
    }

    convertMatchPatternToRegex(pattern) {
        // Handle TLD wildcards
        if (pattern.includes('.tld/')) {
            pattern = pattern.replace('.tld/', '.(com|net|org|edu|gov|mil|biz|info|name|museum|coop|aero|[a-z]{2})/');
        }

        let regexPattern = pattern
            .replace(/\./g, '\\.')
            .replace(/\*/g, '.*')
            .replace(/\//g, '\\/');

        if (regexPattern.startsWith('.*://')) {
            regexPattern = '(http|https)' + regexPattern.slice(2);
        }

        return new RegExp(`^${regexPattern}$`);
    }

    async injectScripts(tabId, url) {
        const scripts = this.getScriptsForUrl(url);

        try {
            await browser.tabs.sendMessage(tabId, {
                type: 'INJECT_SCRIPTS',
                scripts: scripts
            });
        } catch (error) {
            // Tab might not have content script yet
            if (!error.message.includes('receiving end does not exist')) {
                this.error('Injection error:', error);
            }
        }
    }

    isSiteEnabled(domain) {
        const settings = this.siteSettings.get(domain);
        return settings ? settings.enabled : true; // Enabled by default
    }

    getScriptSettings(scriptName, domain) {
        const key = `site_${domain}_${scriptName}`;
        return this.siteSettings.get(key);
    }

    async updateSiteStatus(domain, enabled) {
        try {
            await browser.storage.local.set({
                [`site_${domain}`]: { enabled }
            });
            this.siteSettings.set(domain, { enabled });

            // Notify all tabs about the change
            const tabs = await browser.tabs.query({ url: `*://${domain}/*` });
            for (const tab of tabs) {
                browser.tabs.sendMessage(tab.id, {
                    type: 'SITE_STATUS_CHANGE',
                    enabled
                }).catch(() => { }); // Ignore errors for inactive tabs
            }
        } catch (error) {
            this.error('Failed to update site status:', error);
            throw error;
        }
    }

    async toggleScript(scriptName, domain, enabled) {
        try {
            const key = `${domain}_${scriptName}`;
            await browser.storage.local.set({
                [`site_${key}`]: { enabled }
            });
            this.siteSettings.set(key, { enabled });

            // If this is a global toggle (no domain specified)
            if (!domain) {
                const script = this.scripts.get(scriptName);
                if (script) {
                    script.enabled = enabled;
                    await this.persistScriptState(scriptName, enabled);
                }
            }

            // Notify affected tabs
            const pattern = domain ? `*://${domain}/*` : null;
            const tabs = await browser.tabs.query(pattern ? { url: pattern } : {});
            for (const tab of tabs) {
                if (tab.url && tab.url.startsWith('http')) {
                    await this.injectScripts(tab.id, tab.url);
                }
            }
        } catch (error) {
            this.error('Failed to toggle script:', error);
            throw error;
        }
    }

    async persistScriptState(scriptName, enabled) {
        try {
            await browser.storage.local.set({
                [`script_state_${scriptName}`]: { enabled }
            });
        } catch (error) {
            this.error('Failed to persist script state:', error);
        }
    }

    async reloadAllScripts() {
        try {
            // Request fresh scripts from native host
            this.port.postMessage({
                type: 'REQUEST_SCRIPTS_UPDATE',
                directory: this.settings.scriptDirectory
            });

            // Wait for response and update all tabs
            return new Promise((resolve) => {
                const handler = (message) => {
                    if (message.type === 'SCRIPTS_UPDATE') {
                        this.port.onMessage.removeListener(handler);
                        this.updateScripts(message.scripts);
                        resolve();
                    }
                };
                this.port.onMessage.addListener(handler);

                // Timeout after 5 seconds
                setTimeout(() => {
                    this.port.onMessage.removeListener(handler);
                    resolve();
                }, 5000);
            });
        } catch (error) {
            this.error('Failed to reload scripts:', error);
            throw error;
        }
    }

    async updateSettings(newSettings) {
        try {
            // Validate new settings
            const validatedSettings = {
                autoReload: Boolean(newSettings.autoReload),
                showDebug: Boolean(newSettings.showDebug),
                scriptDirectory: String(newSettings.scriptDirectory || '')
            };

            // Save to storage
            await browser.storage.local.set(validatedSettings);

            // Update local settings
            this.settings = {
                ...this.settings,
                ...validatedSettings
            };

            // Handle autoReload changes
            if (this.settings.autoReload !== validatedSettings.autoReload) {
                if (validatedSettings.autoReload) {
                    this.startScriptWatcher();
                } else {
                    this.stopScriptWatcher();
                }
            }

            // If script directory changed, reload scripts
            if (this.settings.scriptDirectory !== validatedSettings.scriptDirectory) {
                await this.reloadAllScripts();
            }

            return true;
        } catch (error) {
            this.error('Failed to update settings:', error);
            throw error;
        }
    }

    async importSettings(settings) {
        try {
            // Validate settings structure
            if (!this.validateSettingsStructure(settings)) {
                throw new Error('Invalid settings structure');
            }

            // Clear existing settings
            await browser.storage.local.clear();

            // Import site settings
            for (const [key, value] of Object.entries(settings.siteSettings || {})) {
                await browser.storage.local.set({
                    [`site_${key}`]: value
                });
            }

            // Import script states
            for (const [name, state] of Object.entries(settings.scriptStates || {})) {
                await browser.storage.local.set({
                    [`script_state_${name}`]: state
                });
            }

            // Import general settings
            await this.updateSettings(settings.settings || {});

            // Reload everything
            await this.initialize();

            return true;
        } catch (error) {
            this.error('Failed to import settings:', error);
            throw error;
        }
    }

    async exportSettings() {
        try {
            return {
                version: 1,
                timestamp: Date.now(),
                settings: this.settings,
                siteSettings: Object.fromEntries(this.siteSettings),
                scriptStates: Object.fromEntries(
                    Array.from(this.scripts.entries())
                        .map(([name, script]) => [name, { enabled: script.enabled }])
                )
            };
        } catch (error) {
            this.error('Failed to export settings:', error);
            throw error;
        }
    }

    validateSettingsStructure(settings) {
        // Basic structure validation
        if (!settings || typeof settings !== 'object') return false;

        // Version check
        if (!settings.version || settings.version !== 1) return false;

        // Validate settings object
        if (settings.settings && typeof settings.settings !== 'object') return false;

        // Validate site settings
        if (settings.siteSettings && typeof settings.siteSettings !== 'object') return false;

        // Validate script states
        if (settings.scriptStates && typeof settings.scriptStates !== 'object') return false;

        return true;
    }

    async cleanup() {
        try {
            // Stop file watcher
            this.stopScriptWatcher();

            // Disconnect from native host
            if (this.port) {
                this.port.disconnect();
            }

            // Clear any intervals or timeouts
            if (this.reconnectTimeout) {
                clearTimeout(this.reconnectTimeout);
            }

            this.log('Cleanup completed successfully');
        } catch (error) {
            this.error('Cleanup error:', error);
        }
    }
}

// Create extension icon context menu
browser.contextMenus?.create({
    id: 'toggle-scripts',
    title: 'Enable/Disable Scripts',
    contexts: ['browser_action']
});

// Handle context menu clicks
browser.contextMenus?.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'toggle-scripts') {
        try {
            const domain = new URL(tab.url).hostname;
            const isEnabled = manager.isSiteEnabled(domain);
            await manager.updateSiteStatus(domain, !isEnabled);

            // Reload the tab to apply changes
            await browser.tabs.reload(tab.id);
        } catch (error) {
            console.error('[ERROR] Context menu error:', error);
        }
    }
});

// Handle extension updates
browser.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        // First time installation
        await browser.storage.local.set({
            autoReload: true,
            showDebug: false,
            scriptDirectory: ''
        });
    } else if (details.reason === 'update') {
        // Handle any necessary migrations
        await performMigrations(details.previousVersion);
    }
});

async function performMigrations(previousVersion) {
    // Add any necessary migration logic here
    // Version comparisons and data structure updates
}

// Initialize manager
console.log("[DEBUG] Initializing ScriptManager");
const manager = new ScriptManager();

// Cleanup on extension unload
browser.runtime.onSuspend?.addListener(() => {
    manager.cleanup();
});