#!/bin/bash

# Configuration
BASE_DIR="$HOME/firefox-userscript-manager"
EXTENSION_DIR="$BASE_DIR/extension"
NATIVE_DIR="$BASE_DIR/native"
SCRIPTS_DIR="$HOME/Public/Scripts"

# Print with colors
print_info() {
    echo -e "\e[34m[INFO]\e[0m $1"
}

print_success() {
    echo -e "\e[32m[SUCCESS]\e[0m $1"
}

print_error() {
    echo -e "\e[31m[ERROR]\e[0m $1"
}

# Create necessary directories
print_info "Creating directories..."
mkdir -p "$SCRIPTS_DIR"
mkdir -p "$EXTENSION_DIR"
mkdir -p "$NATIVE_DIR"
mkdir -p "$HOME/.mozilla/native-messaging-hosts"
mkdir -p "$HOME/.local/share"

# Install dependencies
print_info "Installing dependencies..."
if command -v pacman &> /dev/null; then
    sudo pacman -S --noconfirm python-pip python-watchdog
elif command -v apt-get &> /dev/null; then
    sudo apt-get update && sudo apt-get install -y python3-pip python3-watchdog
elif command -v dnf &> /dev/null; then
    sudo dnf install -y python3-pip python3-watchdog
else
    pip3 install --user watchdog
fi

# Copy files to their locations
print_info "Setting up extension files..."
cp manifest.json background.js content.js options.html options.js "$EXTENSION_DIR/"

print_info "Setting up native components..."
cp userscript_manager.py "$NATIVE_DIR/"
chmod +x "$NATIVE_DIR/userscript_manager.py"

# Set up native messaging host manifest
print_info "Configuring native messaging..."
sed "s/YOUR_USERNAME/$USER/" native_manifest.json > "$HOME/.mozilla/native-messaging-hosts/userscript_manager.json"

# Create systemd service
print_info "Setting up systemd service..."
mkdir -p "$HOME/.config/systemd/user/"
cat > "$HOME/.config/systemd/user/userscript-manager.service" <<EOL
[Unit]
Description=UserScript Manager Native Helper
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 ${NATIVE_DIR}/userscript_manager.py
Restart=always
RestartSec=1
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=default.target
EOL

# Create a test script
print_info "Creating test script..."
cat > "$SCRIPTS_DIR/test.js" <<EOL
// ==UserScript==
// @name Test Script
// @description A test script to verify the installation
// @version 1.0
// @match *://*/*
// ==/UserScript==

console.log('UserScript Manager: Test script loaded successfully!');
document.body.style.border = '2px solid #89b4fa';
EOL

# Set permissions
chmod 644 "$EXTENSION_DIR"/*
chmod 755 "$SCRIPTS_DIR"
chmod 644 "$SCRIPTS_DIR"/*

# Start the service
print_info "Starting the service..."
systemctl --user daemon-reload
systemctl --user enable userscript-manager
systemctl --user restart userscript-manager

# Check service status
if systemctl --user is-active --quiet userscript-manager; then
    print_success "Service started successfully!"
else
    print_error "Service failed to start. Check logs with: journalctl --user -u userscript-manager"
fi

print_success "Setup complete! Follow these steps to finish:"
echo "
1. Go to about:debugging in Firefox
2. Click 'This Firefox' in the left sidebar
3. Click 'Load Temporary Add-on'
4. Navigate to $EXTENSION_DIR and select manifest.json

Your scripts directory is: $SCRIPTS_DIR
Any .js files you put there will automatically:
- Run on matching websites
- Update in real-time when modified
- Support UserScript metadata headers

To check logs:
- Extension logs: Browser console (Ctrl+Shift+J)
- Native helper logs: ~/.local/share/userscript-manager.log
- Service logs: journalctl --user -u userscript-manager -f
"
