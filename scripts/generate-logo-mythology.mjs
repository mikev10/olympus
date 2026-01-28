#!/usr/bin/env node

/**
 * Generate Olympus logo - Greek Mythology Theme
 *
 * Usage:
 *   node scripts/generate-logo-mythology.mjs
 *
 * Requires: REPLICATE_API_TOKEN in .env.local
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// Load .env.local manually
const envPath = join(projectRoot, '.env.local');
if (!existsSync(envPath)) {
  console.error('❌ Error: .env.local file not found');
  process.exit(1);
}

const envContent = readFileSync(envPath, 'utf-8');
const envLines = envContent.split('\n');
let REPLICATE_API_TOKEN = null;

for (const line of envLines) {
  const trimmed = line.trim();
  if (trimmed.startsWith('REPLICATE_API_TOKEN=')) {
    REPLICATE_API_TOKEN = trimmed.split('=')[1].trim().replace(/['"]/g, '');
    break;
  }
}

if (!REPLICATE_API_TOKEN) {
  console.error('❌ Error: REPLICATE_API_TOKEN not found in .env.local');
  process.exit(1);
}

console.log('✅ Loaded API token from .env.local\n');

// Enhanced prompt leaning into Greek mythology
const prompt = `
Professional minimalist logo for AI orchestration software called "Olympus".

MYTHOLOGY CONCEPT:
Mount Olympus rising majestically with divine golden lightning bolt (Zeus's thunderbolt) striking from above, representing command and power over multiple AI agents. The mountain peak crowned with ethereal glow and stars, symbolizing the pantheon of gods (specialized AI agents) gathering at the summit.

VISUAL ELEMENTS:
- Geometric Mount Olympus silhouette with clean, sharp peak
- Powerful golden Zeus lightning bolt integrated into the design
- Subtle constellation pattern or multiple glowing orbs representing the pantheon (Oracle, Prometheus, Olympian agents)
- Divine light rays or aurora emanating from the peak
- Greek architectural elements: subtle column shapes, sacred geometry, golden ratio
- Circuit-like patterns subtly woven into clouds/mist around the mountain

STYLE & AESTHETIC:
- Modern Greek mythology meets cyberpunk tech
- Minimalist but epic and powerful
- Regal, commanding, divine authority
- Professional software branding, not fantasy game art

COLOR PALETTE:
- Divine gold (#FFD700) - Zeus's power, divine authority
- Deep royal blue (#1E40AF) - night sky, infinite intelligence
- Electric cyan (#60A5FA) - lightning, energy, code execution
- Rich purple/violet accents (#8B5CF6) - mysticism, AI magic
- Dark navy background (#0A0E27) or transparent

COMPOSITION:
- Square format, centered, iconic
- Mountain as foundation (stability), lightning as action (power)
- Balanced, symmetrical like Greek architecture
- Suitable for: GitHub header, favicon, app icon, professional branding

FORBIDDEN:
NO TEXT, NO WORDS, NO LETTERS - pure icon only
Not cartoonish, not overly detailed, not cluttered

THINK: "What if Zeus designed a logo for his cloud infrastructure platform?"
`.trim();

console.log('🏛️ Generating Olympus logo - Greek Mythology Theme...\n');
console.log('⚡ Model: FLUX 1.1 Pro (high quality)');
console.log('🎨 Theme: Divine command over a pantheon of AI agents');
console.log('⏳ This may take 30-60 seconds...\n');

async function generateLogo() {
  try {
    // Create prediction using FLUX 1.1 Pro
    const createResponse = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait'
      },
      body: JSON.stringify({
        version: 'black-forest-labs/flux-1.1-pro',
        input: {
          prompt: prompt,
          aspect_ratio: '1:1',
          output_format: 'png',
          output_quality: 100,
          safety_tolerance: 2,
          prompt_upsampling: true
        }
      })
    });

    if (!createResponse.ok) {
      const error = await createResponse.text();
      throw new Error(`API error (${createResponse.status}): ${error}`);
    }

    const prediction = await createResponse.json();
    console.log('📝 Prediction ID:', prediction.id);

    // Poll for completion
    let result = prediction;
    while (result.status === 'starting' || result.status === 'processing') {
      await new Promise(resolve => setTimeout(resolve, 1000));

      const pollResponse = await fetch(
        `https://api.replicate.com/v1/predictions/${prediction.id}`,
        {
          headers: {
            'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
          }
        }
      );

      result = await pollResponse.json();
      console.log('⏳ Status:', result.status);
    }

    if (result.status !== 'succeeded') {
      throw new Error(`Generation failed with status: ${result.status}`);
    }

    const imageUrl = result.output;
    console.log('\n✅ Generation complete!');
    console.log('🔗 Image URL:', imageUrl);

    // Download the image
    console.log('\n📥 Downloading image...');
    const imageResponse = await fetch(imageUrl);
    const arrayBuffer = await imageResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Save to docs/assets/ with timestamp to preserve old version
    const timestamp = Date.now();
    const logoPath = join(projectRoot, 'docs', 'assets', 'logo-mythology.png');
    const logoWithTimestamp = join(projectRoot, 'docs', 'assets', `logo-${timestamp}.png`);

    writeFileSync(logoPath, buffer);
    writeFileSync(logoWithTimestamp, buffer);

    console.log('✅ Logo saved to:', logoPath);
    console.log('✅ Backup saved to:', logoWithTimestamp);
    console.log('\n🏛️ Greek Mythology Theme Applied:');
    console.log('  ⚡ Zeus\'s thunderbolt - Command & Power');
    console.log('  🏔️ Mount Olympus - Foundation & Stability');
    console.log('  ⭐ Pantheon of agents - Multiple specialized gods');
    console.log('  💫 Divine elements - AI magic & intelligence');
    console.log('\n🎉 Done! Your mythology-themed logo is ready.');
    console.log('\nNext steps:');
    console.log('1. View: docs/assets/logo-mythology.png');
    console.log('2. Compare with original: docs/assets/logo.png');
    console.log('3. Choose your favorite and I\'ll add it to README');
    console.log('4. Not satisfied? Run again for another variation');

  } catch (error) {
    console.error('\n❌ Error:', error.message);

    if (error.message.includes('401') || error.message.includes('authentication')) {
      console.error('\n💡 Tip: Check that your REPLICATE_API_TOKEN is correct');
    } else if (error.message.includes('quota') || error.message.includes('billing')) {
      console.error('\n💡 Tip: Check your Replicate billing');
    }

    process.exit(1);
  }
}

generateLogo();
