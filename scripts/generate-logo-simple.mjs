#!/usr/bin/env node

/**
 * Generate Olympus logo using Replicate API (no SDK needed)
 *
 * Usage:
 *   node scripts/generate-logo-simple.mjs
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
  console.error('');
  console.error('Add to .env.local:');
  console.error('  REPLICATE_API_TOKEN=your_token_here');
  process.exit(1);
}

console.log('✅ Loaded API token from .env.local\n');

const prompt = `
Professional minimalist logo for developer tool software.
Geometric Mount Olympus mountain peak with integrated golden lightning bolt.
Clean modern tech aesthetic with subtle circuit board patterns.
Color palette: rich gold (#FFD700) to deep blue (#1E40AF) gradient with electric blue (#60A5FA) accents.
Dark navy background (#0A0E27) or transparent.
Flat design, iconic symbol, centered composition.
Vector art style, suitable for GitHub repository header and favicon.
Style: minimalist, geometric, modern software branding, clean lines.
NO TEXT, NO WORDS, NO LETTERS - icon only.
`.trim();

console.log('🎨 Generating Olympus logo with Recraft V3 (SVG)...\n');
console.log('📐 Output format: SVG (scalable vector graphics)');
console.log('⏳ This may take 30-60 seconds...\n');

async function generateLogo() {
  try {
    // Create prediction using recraft-ai/recraft-v3-svg
    const createResponse = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait'
      },
      body: JSON.stringify({
        version: 'recraft-ai/recraft-v3-svg',
        input: {
          prompt: prompt,
          size: '1024',
          style: 'digital_illustration'
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
    console.log('  - Infinitely scalable without quality loss');
    console.log('  - Smaller file size than PNG');
    console.log('  - Can be styled with CSS');
    console.log('  - Perfect for favicons, headers, and prints');
    console.log('\nNext steps:');
    console.log('1. View the logo: docs/assets/logo.svg');
    console.log('2. If you like it, we can add it to README.md');
    console.log('3. We can also convert to PNG for compatibility');
    console.log('4. If not satisfied, run this script again for a new generation');

  } catch (error) {
    console.error('\n❌ Error:', error.message);

    if (error.message.includes('401') || error.message.includes('authentication')) {
      console.error('\n💡 Tip: Check that your REPLICATE_API_TOKEN is correct');
    } else if (error.message.includes('quota') || error.message.includes('billing')) {
      console.error('\n💡 Tip: Check your Replicate billing at https://replicate.com/account/billing');
    }

    process.exit(1);
  }
}

generateLogo();
