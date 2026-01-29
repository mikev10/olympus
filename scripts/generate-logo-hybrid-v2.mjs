#!/usr/bin/env node

/**
 * Generate Olympus logo - Hybrid Version 2
 * Alternative variation of the hybrid approach
 *
 * Usage:
 *   node scripts/generate-logo-hybrid-v2.mjs
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

// Hybrid V2: Slightly different emphasis - more iconic, bold, memorable
const prompt = `
Minimalist iconic logo for "Olympus" - AI orchestration platform.
Greek mythology symbolism meets modern tech branding.

PRIMARY CONCEPT:
Bold geometric Mount Olympus peak (sharp angular silhouette) with a powerful stylized Zeus lightning bolt forming the vertical centerline. The lightning bolt should be integrated AS PART OF the mountain structure, not separate. Small constellation of 4 glowing points arranged symmetrically around the peak representing the divine pantheon of AI agents working in harmony.

KEY DESIGN PRINCIPLES:
- ICONIC: Instantly recognizable even at 32x32px favicon size
- BOLD: Strong shapes, confident lines, commanding presence
- BALANCED: Perfect symmetry like Greek architecture
- MEANINGFUL: Every element represents Olympus's purpose (mountain = foundation, lightning = command, stars = agents)
- SCALABLE: Works from favicon to billboard

VISUAL COMPOSITION:
- Mountain: Geometric triangle/peak with clean edges, 60% of canvas height
- Lightning bolt: Central vertical element, golden, merges with mountain form
- Stars/orbs: 4 points arranged in cross or diamond pattern around peak
- Negative space: Dark background lets the icon breathe
- Sacred geometry: Proportions follow golden ratio if possible

COLOR STRATEGY:
- Dominant gold (#FFD700 to #FFAA00) - Divine power, premium quality
- Supporting blue (#1E3A8A to #3B82F6) - Intelligence, sky/cloud infrastructure
- Accent cyan (#06B6D4) - Energy, lightning, code execution
- Highlight white/gold glow (#FEF3C7) - Stars, divine light
- Background dark navy (#0F172A) or transparent

STYLE REFERENCES:
- Geometric precision of Stripe's logo
- Bold simplicity of Linear's mark
- Memorable iconography like Vercel's triangle
- But with: Greek mythology soul + AI orchestration story

COMPOSITION RULES:
- Center-aligned, perfectly symmetrical
- Mountain forms stable triangular base
- Lightning creates vertical energy line
- Stars create horizontal balance points
- All elements connect into unified symbol

TECHNICAL SPECS:
- Square format (1024x1024px)
- Clean vector-style edges (even though PNG output)
- High contrast for visibility
- No thin lines that disappear at small sizes
- Test mentally: "Does this work as a 64px favicon?"

FORBIDDEN ELEMENTS:
- NO text, letters, typography, words
- NO excessive detail or texture
- NO photorealism or 3D effects
- NO cartoony or playful style
- NO busy backgrounds or patterns

FINAL CHECK:
Ask yourself: "If Zeus was a modern tech CEO launching a cloud platform for AI orchestration, what logo would he commission?" Professional. Powerful. Divine. But minimalist and modern.

VARIATION NOTES FOR V2:
Make this version slightly bolder and more graphic than V1. Stronger shapes, more confident composition. Think "This logo could be painted on the side of SpaceX rocket" - that level of bold simplicity.
`.trim();

console.log('⚡ Generating Olympus Hybrid Logo V2...\n');
console.log('🎯 Variation: Bolder, more iconic, stronger shapes');
console.log('📊 Emphasis: Command + symmetry + memorability');
console.log('🏔️ Lightning integrated INTO mountain structure');
console.log('⏳ Generating with FLUX 1.1 Pro...\n');

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

    // Save to docs/assets/
    const logoPath = join(projectRoot, 'docs', 'assets', 'logo-hybrid-v2.png');
    const timestamp = Date.now();
    const logoWithTimestamp = join(projectRoot, 'docs', 'assets', `logo-hybrid-v2-${timestamp}.png`);

    writeFileSync(logoPath, buffer);
    writeFileSync(logoWithTimestamp, buffer);

    console.log('✅ Logo saved to:', logoPath);
    console.log('✅ Backup saved to:', logoWithTimestamp);
    console.log('\n⚡ Hybrid V2 Features:');
    console.log('  ✓ Bolder, more iconic shapes');
    console.log('  ✓ Lightning integrated into mountain');
    console.log('  ✓ Perfect symmetry (Greek architecture)');
    console.log('  ✓ Designed for maximum recognition');
    console.log('\n🎉 Done! Your hybrid V2 logo is ready.');
    console.log('\n📊 Now compare both hybrid versions:');
    console.log('  - docs/assets/logo-hybrid.png (V1 - first hybrid)');
    console.log('  - docs/assets/logo-hybrid-v2.png (V2 - NEW, bolder)');
    console.log('\nNext: Choose your favorite and we\'ll finalize it!');

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
