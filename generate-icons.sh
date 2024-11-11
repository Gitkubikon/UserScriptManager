#!/bin/bash

# Create project structure
echo "Creating project structure..."
mkdir -p userscript-manager/{background,content,popup,options,styles,icons/{16,32,48,96,128}}

# Copy files to their respective directories
echo "Copying files..."

# Create icons directory and save SVG
cat > userscript-manager/icons/icon.svg << 'EOL'
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <circle cx="64" cy="64" r="60" fill="#4CAF50"/>
  <path d="M40 38v52c0 2.2-1.8 4-4 4h-4c-2.2 0-4-1.8-4-4V38c0-2.2 1.8-4 4-4h4c2.2 0 4 1.8 4 4z" fill="white"/>
  <path d="M50 44l24 20-24 20" fill="none" stroke="white" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M100 44l-24 20 24 20" fill="none" stroke="white" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="32" cy="38" r="4" fill="white"/>
  <circle cx="32" cy="90" r="4" fill="white"/>
</svg>
EOL

# Install required packages for icon generation
echo "Installing dependencies..."
npm init -y
npm install sharp

# Copy icon generator script
cat > userscript-manager/generate-icons.js << 'EOL'
const fs = require('fs');
const sharp = require('sharp');

const sizes = [16, 32, 48, 96, 128];

async function generateIcons() {
    const svgBuffer = fs.readFileSync('icons/icon.svg');
    for (const size of sizes) {
        try {
            await sharp(svgBuffer)
                .resize(size, size)
                .png()
                .toFile(`icons/${size}/icon.png`);
            console.log(`Generated ${size}x${size} icon`);
        } catch (error) {
            console.error(`Failed to generate ${size}x${size} icon:`, error);
        }
    }
}

generateIcons().then(() => {
    console.log('Icon generation complete!');
}).catch((error) => {
    console.error('Icon generation failed:', error);
    process.exit(1);
});
EOL

# Generate icons
echo "Generating icons..."
cd userscript-manager
node generate-icons.js

echo "Setup complete! Project structure created and icons generated."
echo "You can now copy the extension files into their respective directories."
