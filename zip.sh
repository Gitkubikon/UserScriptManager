#!/bin/bash

# Define the root directory of your extension
EXTENSION_DIR=~/firefox-userscript-manager/extension

# Create temporary directory for organizing files
TMP_DIR=$(mktemp -d)
echo "Created temporary directory: $TMP_DIR"

# Create directory structure in temp directory
mkdir -p "$TMP_DIR"/{background,content,popup,options,styles,icons/{16,32,48,96,128}}

# Copy all files maintaining directory structure
echo "Copying files..."

# Copy root files
cp "$EXTENSION_DIR"/manifest.json "$TMP_DIR"/

# Copy background files
cp "$EXTENSION_DIR"/background/background.js "$TMP_DIR"/background/

# Copy content files
cp "$EXTENSION_DIR"/content/content.js "$TMP_DIR"/content/

# Copy popup files
cp "$EXTENSION_DIR"/popup/popup.html "$TMP_DIR"/popup/
cp "$EXTENSION_DIR"/popup/popup.js "$TMP_DIR"/popup/
cp "$EXTENSION_DIR"/popup/popup.css "$TMP_DIR"/popup/

# Copy options files
cp "$EXTENSION_DIR"/options/options.html "$TMP_DIR"/options/
cp "$EXTENSION_DIR"/options/options.js "$TMP_DIR"/options/
cp "$EXTENSION_DIR"/options/options.css "$TMP_DIR"/options/

# Copy styles
cp "$EXTENSION_DIR"/styles/common.css "$TMP_DIR"/styles/

# Copy icons
cp "$EXTENSION_DIR"/icons/*/*.png "$TMP_DIR"/icons/

# Create the ZIP file
cd "$TMP_DIR"
zip -r -0 userscript-manager.zip ./* -x "*.DS_Store" -x "*__MACOSX*"

# Move the ZIP to the final location
mv userscript-manager.zip ~/firefox-userscript-manager/

# Clean up
rm -rf "$TMP_DIR"

echo "Extension has been zipped to ~/firefox-userscript-manager/userscript-manager.zip"
echo "Directory structure in ZIP:"
unzip -l ~/firefox-userscript-manager/userscript-manager.zip