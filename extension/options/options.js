class UserScriptManager {
    constructor() {
        // State
        this.scripts = new Map();
        this.sites = new Map();
        this.currentView = 'scripts';
        this.loading = false;

        // DOM Elements
        this.elements = {
            statusMessage: document.getElementById('statusMessage'),
            scriptGrid: document.querySelector('.script-grid'),
            searchInput: document.querySelector('.search-input'),
            filterSelect: document.querySelector('.filter-select'),
            navItems: document.querySelectorAll('.nav-item'),
            reloadButton: document.getElementById('reloadButton'),
            views: {
                scripts: document.getElementById('scriptsView'),
                sites: document.getElementById('sitesView'),
                settings: document.getElementById('settingsView')
            }
        };

        this.initialize();
    }

    async initialize() {
        try {
            this.showLoading();

            // Setup event listeners
            this.setupEventListeners();

            // Load initial data
            await this.loadScripts();

            // Setup message handlers for backend communication
            this.setupMessageHandlers();

            this.hideLoading();
            this.showStatus('Initialization complete', 'success');
        } catch (error) {
            this.handleError('Initialization failed', error);
        }
    }

    setupEventListeners() {
        // Navigation
        this.elements.navItems.forEach(item => {
            item.addEventListener('click', () => this.switchView(item.dataset.view));
        });

        // Search and Filter
        this.elements.searchInput?.addEventListener('input', () => this.filterScripts());
        this.elements.filterSelect?.addEventListener('change', () => this.filterScripts());

        // Reload button
        this.elements.reloadButton?.addEventListener('click', () => this.reloadScripts());

        // Settings form submission
        document.getElementById('settingsForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveSettings();
        });
    }

    setupMessageHandlers() {
        browser.runtime.onMessage.addListener((message, sender) => {
            switch (message.type) {
                case 'SCRIPTS_UPDATE':
                    this.handleScriptsUpdate(message.scripts);
                    break;
                case 'SITE_UPDATE':
                    this.handleSiteUpdate(message.site);
                    break;
                case 'ERROR':
                    this.handleError(message.error);
                    break;
            }
        });
    }

    async loadScripts() {
        try {
            const response = await browser.runtime.sendMessage({ type: 'GET_SCRIPTS' });
            if (response?.scripts) {
                this.handleScriptsUpdate(response.scripts);
            }
        } catch (error) {
            this.handleError('Failed to load scripts', error);
        }
    }

    handleScriptsUpdate(scripts) {
        this.scripts.clear();
        scripts.forEach(script => this.scripts.set(script.name, script));
        this.renderScripts();
    }

    renderScripts() {
        if (!this.elements.scriptGrid) return;

        this.elements.scriptGrid.innerHTML = '';

        if (this.scripts.size === 0) {
            this.showEmptyState('No scripts found');
            return;
        }

        for (const script of this.scripts.values()) {
            const card = this.createScriptCard(script);
            this.elements.scriptGrid.appendChild(card);
        }
    }

    async loadSiteScriptSettings(domain) {
        const settings = {};
        const storage = await browser.storage.local.get(null);

        for (const [key, value] of Object.entries(storage)) {
            if (key.startsWith(`script_${domain}_`)) {
                const scriptName = key.split('_')[2];
                settings[scriptName] = value.enabled;
            }
        }

        return settings;
    }

    createScriptCard(script, domain) {
        const card = document.createElement('div');
        card.className = 'script-card slide-in';

        // Load site-specific settings if a domain is provided
        const siteEnabled = domain ?
            script.siteSpecific?.enabled :
            script.enabled;

        card.innerHTML = `
            <div class="script-header">
                <h3 class="script-title">${this.escapeHtml(script.name)}</h3>
                <label class="switch">
                    <input type="checkbox" 
                           ${siteEnabled ? 'checked' : ''} 
                           data-script="${this.escapeHtml(script.name)}"
                           ${domain ? `data-domain="${this.escapeHtml(domain)}"` : ''}>
                    <span class="slider"></span>
                </label>
            </div>
            <div class="script-meta">
                ${this.createMetaTags(script)}
            </div>
        `;

        const toggle = card.querySelector('input[type="checkbox"]');
        toggle?.addEventListener('change', () => {
            const scriptName = toggle.dataset.script;
            const domain = toggle.dataset.domain;
            this.toggleScript(scriptName, domain, toggle.checked);
        });

        return card;
    }

    createMetaTags(script) {
        const tags = [];

        if (script.version) {
            tags.push(`<span class="meta-tag">📌 v${this.escapeHtml(script.version)}</span>`);
        }

        if (script.description) {
            tags.push(`<span class="meta-tag">📝 ${this.escapeHtml(script.description)}</span>`);
        }

        if (script.matches) {
            const matches = Array.isArray(script.matches) ? script.matches : [script.matches];
            tags.push(`<span class="meta-tag">🎯 ${this.escapeHtml(matches[0])}${matches.length > 1 ? ` +${matches.length - 1}` : ''}</span>`);
        }

        return tags.join('');
    }

    async toggleScript(scriptName, enabled) {
        try {
            await browser.runtime.sendMessage({
                type: 'TOGGLE_SCRIPT',
                scriptName,
                enabled
            });

            const script = this.scripts.get(scriptName);
            if (script) {
                script.enabled = enabled;
                this.showStatus(`${scriptName} ${enabled ? 'enabled' : 'disabled'}`, 'success');
            }
        } catch (error) {
            this.handleError(`Failed to toggle script: ${scriptName}`, error);
        }
    }

    async reloadScripts() {
        try {
            this.showLoading();
            await browser.runtime.sendMessage({ type: 'RELOAD_SCRIPTS' });
            await this.loadScripts();
            this.showStatus('Scripts reloaded successfully', 'success');
        } catch (error) {
            this.handleError('Failed to reload scripts', error);
        } finally {
            this.hideLoading();
        }
    }

    filterScripts() {
        const searchTerm = this.elements.searchInput?.value.toLowerCase() || '';
        const filterValue = this.elements.filterSelect?.value || 'all';

        const scripts = Array.from(this.scripts.values()).filter(script => {
            const matchesSearch = script.name.toLowerCase().includes(searchTerm) ||
                script.description?.toLowerCase().includes(searchTerm);
            const matchesFilter = filterValue === 'all' ||
                (filterValue === 'enabled' && script.enabled) ||
                (filterValue === 'disabled' && !script.enabled);

            return matchesSearch && matchesFilter;
        });

        this.renderFilteredScripts(scripts);
    }

    renderFilteredScripts(scripts) {
        if (!this.elements.scriptGrid) return;

        this.elements.scriptGrid.innerHTML = '';

        if (scripts.length === 0) {
            this.showEmptyState('No matching scripts found');
            return;
        }

        scripts.forEach(script => {
            const card = this.createScriptCard(script);
            this.elements.scriptGrid.appendChild(card);
        });
    }

    switchView(view) {
        if (this.currentView === view) return;

        this.elements.navItems.forEach(item => {
            item.classList.toggle('active', item.dataset.view === view);
        });

        Object.entries(this.elements.views).forEach(([key, element]) => {
            element?.classList.toggle('hidden', key !== view);
        });

        this.currentView = view;
    }

    async saveSettings() {
        try {
            const settingsForm = document.getElementById('settingsForm');
            if (!settingsForm) return;

            const formData = new FormData(settingsForm);
            const settings = {
                autoReload: formData.get('autoReload') === 'on',
                showDebug: formData.get('showDebug') === 'on',
                scriptDirectory: formData.get('scriptDirectory')
            };

            await browser.runtime.sendMessage({
                type: 'UPDATE_SETTINGS',
                settings
            });

            this.showStatus('Settings saved successfully', 'success');
        } catch (error) {
            this.handleError('Failed to save settings', error);
        }
    }

    showStatus(message, type = 'info') {
        if (!this.elements.statusMessage) return;

        this.elements.statusMessage.textContent = message;
        this.elements.statusMessage.className = `status-message ${type}`;

        // Auto-hide success messages
        if (type === 'success') {
            setTimeout(() => {
                this.elements.statusMessage.textContent = '';
                this.elements.statusMessage.className = 'status-message';
            }, 3000);
        }
    }

    handleError(message, error = null) {
        console.error(message, error);
        this.showStatus(`${message}${error ? ': ' + error.message : ''}`, 'error');
    }

    showLoading() {
        this.loading = true;
        this.elements.reloadButton?.setAttribute('disabled', 'true');
        this.elements.reloadButton?.classList.add('loading');
    }

    hideLoading() {
        this.loading = false;
        this.elements.reloadButton?.removeAttribute('disabled');
        this.elements.reloadButton?.classList.remove('loading');
    }

    showEmptyState(message) {
        if (!this.elements.scriptGrid) return;

        this.elements.scriptGrid.innerHTML = `
            <div class="empty-state">
                <p>${this.escapeHtml(message)}</p>
            </div>
        `;
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

// Initialize the manager when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new UserScriptManager();
});