#!/bin/bash

# Create the correct native manifest
cat > ~/.mozilla/native-messaging-hosts/userscript_manager.json <<EOL
{
  "name": "userscript_manager",
  "description": "Native host for UserScript Manager",
  "path": "${HOME}/firefox-userscript-manager/native/userscript_manager.py",
  "type": "stdio",
  "allowed_extensions": ["userscript-manager@local.firefox"]
}
EOL

# Set correct permissions
chmod 644 ~/.mozilla/native-messaging-hosts/userscript_manager.json

# Verify the manifest
echo "=== Native Manifest Content ==="
cat ~/.mozilla/native-messaging-hosts/userscript_manager.json

# Verify Python script permissions and existence
echo -e "\n=== Python Script Permissions ==="
ls -l ${HOME}/firefox-userscript-manager/native/userscript_manager.py

# Make sure the Python script is executable
chmod +x ${HOME}/firefox-userscript-manager/native/userscript_manager.py

# Restart the service
systemctl --user restart userscript-manager

# Check service status
echo -e "\n=== Service Status ==="
systemctl --user status userscript-manager
EOL
