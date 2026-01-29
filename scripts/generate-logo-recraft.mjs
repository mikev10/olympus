#!/usr/bin/env node

/**
 * Generate Olympus logo using Recraft V3 SVG
 *
 * Usage:
 *   node scripts/generate-logo-recraft.mjs
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

const prompt = `
Minimalist logo icon for developer tool.
Mount Olympus geometric peak with golden lightning bolt.
Vector art style, clean lines, modern tech aesthetic.
Gold to blue gradient (#FFD700 to #1E40AF).
Dark background or transparent.
Flat design, centered, iconic symbol.
NO TEXT - icon only.
`.trim();

console.log('🎨 Generating Olympus logo with Recraft V3 SVG...\n');
console.log('📐 Output: Scalable Vector Graphics (SVG)');
console.log('⏳ This may take 30-60 seconds...\n');

async function generateLogo() {
  try {
    // Using Recraft V3 SVG model
    // Model page: https://replicate.com/recraft-ai/recraft-v3-svg
    const createResponse = await fetch('https://api.replicate.com/v1/models/recraft-ai/recraft-v3-svg/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: {
          prompt: prompt,
          size: '1024x1024',
          style: 'line_circuit'
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
      await new Promise(resolve => setTimeout(resolve, 2000));

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
      throw new Error(`Generation failed with status: ${result.status}. ${result.error || ''}`);
    }

    const svgUrl = result.output;
    console.log('\n✅ Generation complete!');
    console.log('🔗 SVG URL:', svgUrl);

    // Download the SVG
    console.log('\n📥 Downloading SVG...');
    const svgResponse = await fetch(svgUrl);
    const svgContent = await svgResponse.text();

    // Save SVG to docs/assets/
    const svgPath = join(projectRoot, 'docs', 'assets', 'logo.svg');
    writeFileSync(svgPath, svgContent);

    console.log('✅ Logo saved to:', svgPath);
    console.log('\n🎉 Done! Your SVG logo is ready.');
    console.log('\n📐 SVG Benefits:');
    console.log('  ✓ Infinitely scalable without quality loss');
    console.log('  ✓ Smaller file size than PNG');
    console.log('  ✓ Can be styled with CSS');
    console.log('  ✓ Perfect for favicons, headers, and all sizes');
    console.log('\nNext steps:');
    console.log('1. View: docs/assets/logo.svg');
    console.log('2. If approved, I\'ll add it to README and create PNG versions');
    console.log('3. If not satisfied, run again for a new generation');

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
