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
