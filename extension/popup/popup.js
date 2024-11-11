class UserScriptPopup {
    constructor() {
        // State
        this.currentTab = null;
        this.scripts = new Map();
        this.currentDomain = '';
        this.siteEnabled = true;

        // DOM Elements
        this.elements = {
            siteIcon: document.getElementById('siteIcon'),
            siteDomain: document.getElementById('siteDomain'),
            siteToggle: document.getElementById('siteToggle'),
            scriptList: document.getElementById('scriptList'),
            scriptCount: document.getElementById('scriptCount'),
            emptyState: document.getElementById('emptyState'),
            settingsBtn: document.getElementById('settingsBtn'),
            reloadBtn: document.getElementById('reloadBtn')
        };

        this.initialize();
    }

    async initialize() {
        try {
            // Get current tab first
            const tabs = await browser.tabs.query({ active: true, currentWindow: true });
            this.currentTab = tabs[0];

            if (!this.currentTab?.url?.startsWith('http')) {
                this.showUnsupportedPage();
                return;
            }

            // Setup site information
            await this.setupSiteInfo();

            // Load scripts for current tab
            await this.loadScripts();

            // Setup event listeners
            this.setupEventListeners();

        } catch (error) {
            this.handleError('Failed to initialize popup', error);
        }
    }

    async setupSiteInfo() {
        try {
            const url = new URL(this.currentTab.url);
            this.currentDomain = url.hostname;

            // Update UI
            this.elements.siteDomain.textContent = this.currentDomain;
            this.elements.siteIcon.src = this.currentTab.favIconUrl || '../icons/16/icon.png';
            this.elements.siteIcon.alt = `${this.currentDomain} icon`;

            // Load site status
            const siteKey = `site_${this.currentDomain}`;
            const result = await browser.storage.local.get(siteKey);
            this.siteEnabled = result[siteKey]?.enabled ?? true;
            this.elements.siteToggle.checked = this.siteEnabled;

        } catch (error) {
            this.handleError('Failed to setup site information', error);
        }
    }

    async loadScripts() {
        try {
            // Request scripts for current URL
            const response = await browser.runtime.sendMessage({
                type: 'GET_SCRIPTS',
                url: this.currentTab.url
            });

            if (response?.scripts) {
                // Clear existing scripts
                this.scripts.clear();

                // Store and render new scripts
                response.scripts.forEach(script => this.scripts.set(script.name, script));
                this.renderScripts();
            }

        } catch (error) {
            this.handleError('Failed to load scripts', error);
        }
    }

    setupEventListeners() {
        // Site toggle
        this.elements.siteToggle?.addEventListener('change', () => {
            this.updateSiteStatus(this.elements.siteToggle.checked);
        });

        // Settings button
        this.elements.settingsBtn?.addEventListener('click', () => {
            browser.runtime.openOptionsPage();
            window.close();
        });

        // Reload button
        this.elements.reloadBtn?.addEventListener('click', async () => {
            await this.reloadScripts();
        });
    }

    async updateSiteStatus(enabled) {
        try {
            // Update storage
            const siteKey = `site_${this.currentDomain}`;
            await browser.storage.local.set({
                [siteKey]: { enabled }
            });

            // Notify background script
            await browser.runtime.sendMessage({
                type: 'SITE_STATUS_CHANGE',
                domain: this.currentDomain,
                enabled
            });

            // Reload the current tab
            await browser.tabs.reload(this.currentTab.id);

            // Close popup
            window.close();

        } catch (error) {
            this.handleError('Failed to update site status', error);
        }
    }

    async reloadScripts() {
        try {
            this.elements.reloadBtn.classList.add('loading');

            // Reload scripts from backend
            await browser.runtime.sendMessage({ type: 'RELOAD_SCRIPTS' });

            // Reload current tab
            await browser.tabs.reload(this.currentTab.id);

            // Close popup
            window.close();

        } catch (error) {
            this.handleError('Failed to reload scripts', error);
        } finally {
            this.elements.reloadBtn.classList.remove('loading');
        }
    }

    renderScripts() {
        if (!this.elements.scriptList) return;

        // Update script count
        this.elements.scriptCount.textContent = `${this.scripts.size} scripts`;

        // Clear existing list
        this.elements.scriptList.innerHTML = '';

        // Show/hide empty state
        if (this.scripts.size === 0) {
            this.elements.emptyState.classList.remove('hidden');
            return;
        }

        // Hide empty state and render scripts
        this.elements.emptyState.classList.add('hidden');

        for (const script of this.scripts.values()) {
            const scriptElement = this.createScriptElement(script);
            this.elements.scriptList.appendChild(scriptElement);
        }
    }

    createScriptElement(script) {
        const item = document.createElement('div');
        item.className = 'script-item slide-in';

        item.innerHTML = `
            <div class="script-info">
                <span class="script-name">${this.escapeHtml(script.name)}</span>
                ${script.metadata?.description ?
                `<span class="script-description">${this.escapeHtml(script.metadata.description)}</span>` :
                ''}
            </div>
            <label class="switch" title="Toggle script for this site">
                <input type="checkbox" ${script.enabled ? 'checked' : ''} 
                       data-script="${this.escapeHtml(script.name)}">
                <span class="slider"></span>
            </label>
        `;

        // Add toggle event listener
        const toggle = item.querySelector('input[type="checkbox"]');
        toggle?.addEventListener('change', () => this.toggleScript(script.name, toggle.checked));

        return item;
    }

    async toggleScript(scriptName, enabled) {
        try {
            await browser.runtime.sendMessage({
                type: 'TOGGLE_SCRIPT',
                scriptName,
                domain: this.currentDomain,
                enabled
            });

            // We don't need to manually update storage here as the background script handles it
            // Just update the UI
            const scriptElement = document.querySelector(`[data-script="${scriptName}"]`);
            if (scriptElement) {
                scriptElement.checked = enabled;
            }

        } catch (error) {
            this.handleError(`Failed to toggle script: ${scriptName}`, error);
        }
    }

    renderScriptElement(script) {
        const item = document.createElement('div');
        item.className = 'script-item slide-in';
        
        item.innerHTML = `
            <div class="script-info">
                <span class="script-name">${this.escapeHtml(script.name)}</span>
                ${script.metadata?.description ? 
                    `<span class="script-description">${this.escapeHtml(script.metadata.description)}</span>` : 
                    ''}
            </div>
            <label class="switch" title="Toggle script for this site">
                <input type="checkbox" 
                       ${script.enabled ? 'checked' : ''} 
                       data-script="${this.escapeHtml(script.name)}">
                <span class="slider"></span>
            </label>
        `;

        const toggle = item.querySelector('input[type="checkbox"]');
        toggle?.addEventListener('change', (e) => {
            this.toggleScript(script.name, e.target.checked);
        });

        return item;
    }

    showUnsupportedPage() {
        if (!this.elements.scriptList) return;

        // Disable controls
        this.elements.siteToggle.disabled = true;
        this.elements.reloadBtn.disabled = true;

        // Show message
        this.elements.emptyState.classList.remove('hidden');
        this.elements.emptyState.textContent = 'UserScripts are not supported on this page';

        // Update domain display
        this.elements.siteDomain.textContent = 'Unsupported page';

        // Hide script list
        this.elements.scriptList.innerHTML = '';
    }

    handleError(message, error = null) {
        console.error(message, error);

        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = `${message}${error ? ': ' + error.message : ''}`;

        this.elements.scriptList.insertBefore(errorDiv, this.elements.scriptList.firstChild);

        // Auto-remove error after 3 seconds
        setTimeout(() => errorDiv.remove(), 3000);
    }

    escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new UserScriptPopup();
});