#!/usr/bin/env node

/**
 * Generate Olympus logo - Hybrid Version
 * Merges clean modern aesthetic with Greek mythology symbolism
 *
 * Usage:
 *   node scripts/generate-logo-hybrid.mjs
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

// Hybrid prompt: Clean modern + Greek mythology symbolism
const prompt = `
Professional minimalist logo for AI orchestration platform "Olympus".
Merge modern tech aesthetic with subtle Greek mythology symbolism.

CORE CONCEPT:
Geometric Mount Olympus peak (clean, minimal silhouette) with stylized Zeus golden lightning bolt striking down the center. Three to five small glowing points or stars around the peak representing the pantheon of specialized AI agents (Oracle, Prometheus, Olympian). The mountain forms the stable foundation, the lightning represents command and action, the stars represent distributed intelligence.

STYLE DIRECTION:
- MINIMALIST FIRST: Clean geometric shapes, not overly detailed
- Modern software branding like Vercel, Linear, or Stripe
- Subtle Greek mythology elements (not fantasy art)
- Flat design with strategic use of gradients
- Professional, iconic, memorable at any size
- Think: "Google meets Greek mythology" not "Game of Thrones"

VISUAL ELEMENTS:
- Geometric mountain peak: Sharp, angular, clean lines (like first logo)
- Golden lightning bolt: Stylized, integrated into design (not sitting on top)
- 3-5 subtle glowing orbs or stars: Arranged symmetrically around peak
- Optional: Very subtle circuit patterns in background mist
- Optional: Hint of Greek column shapes in negative space

COLOR PALETTE:
- Primary: Golden yellow to electric gold gradient (#FFD700 to #FFA500)
- Secondary: Deep blue to royal blue (#1E40AF to #3B82F6)
- Accents: Bright cyan for lightning energy (#60A5FA)
- Stars/orbs: White or golden glow (#FFFFFF or #FDE68A)
- Background: Dark navy (#0A0E27) or transparent

COMPOSITION:
- Centered, balanced, symmetrical
- Square format (1:1 aspect ratio)
- Mountain takes up 50-60% of canvas
- Lightning bolt as central vertical element
- Stars positioned around peak in pleasing arrangement
- Negative space is important - don't overcrowd

TECHNICAL REQUIREMENTS:
- High resolution, sharp edges
- Suitable for: favicon (64px), GitHub header (1200px), app icon
- Works in monochrome (single color version still recognizable)
- No gradients on tiny details (they'll blur at small sizes)

ABSOLUTELY FORBIDDEN:
- NO text, words, letters, or typography
- NOT overly detailed or cluttered
- NOT cartoonish or game-like
- NOT photorealistic or 3D rendered
- NOT fantasy art style

REFERENCE AESTHETIC:
Think modern tech logos (Notion, Linear, Vercel) but with personality and story. Clean enough for professional branding, interesting enough to be memorable. The mythology is in the symbolism, not in the rendering style.

BALANCE TARGET:
70% clean modern minimalism + 30% Greek mythology symbolism
`.trim();

console.log('⚡ Generating Olympus Hybrid Logo...\n');
console.log('🎯 Approach: Modern minimalism + Greek symbolism');
console.log('📊 Balance: 70% clean tech, 30% mythology');
console.log('🏔️ Elements: Geometric mountain + lightning + constellation');
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
    const logoPath = join(projectRoot, 'docs', 'assets', 'logo-hybrid.png');
    const timestamp = Date.now();
    const logoWithTimestamp = join(projectRoot, 'docs', 'assets', `logo-hybrid-${timestamp}.png`);

    writeFileSync(logoPath, buffer);
    writeFileSync(logoWithTimestamp, buffer);

    console.log('✅ Logo saved to:', logoPath);
    console.log('✅ Backup saved to:', logoWithTimestamp);
    console.log('\n⚡ Hybrid Logo Features:');
    console.log('  ✓ Clean geometric mountain (modern aesthetic)');
    console.log('  ✓ Stylized Zeus lightning (Greek power symbol)');
    console.log('  ✓ Constellation of agent stars (pantheon concept)');
    console.log('  ✓ Professional minimalism meets mythology');
    console.log('\n🎉 Done! Your hybrid logo is ready.');
    console.log('\n📊 Compare all three versions:');
    console.log('  1. docs/assets/logo.png (original simple)');
    console.log('  2. docs/assets/logo-mythology.png (full mythology)');
    console.log('  3. docs/assets/logo-hybrid.png (NEW - best of both)');
    console.log('\nNext: Choose your favorite and I\'ll add it to README!');

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
