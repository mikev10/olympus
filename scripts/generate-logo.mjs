#!/usr/bin/env node

/**
 * Generate Olympus logo using Replicate
 *
 * Usage:
 *   node scripts/generate-logo.mjs
 *
 * Requires: REPLICATE_API_TOKEN in .env.local
 */

import Replicate from 'replicate';
import { config } from 'dotenv';
import { writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// Load .env.local
const envPath = join(projectRoot, '.env.local');
if (existsSync(envPath)) {
  config({ path: envPath });
  console.log('✅ Loaded environment from .env.local\n');
} else {
  console.error('❌ Error: .env.local file not found');
  process.exit(1);
}

// Check for API token
if (!process.env.REPLICATE_API_TOKEN) {
  console.error('❌ Error: REPLICATE_API_TOKEN not found in .env.local');
  console.error('');
  console.error('Add to .env.local:');
  console.error('  REPLICATE_API_TOKEN=your_token_here');
  console.error('');
  console.error('Get your token at: https://replicate.com/account/api-tokens');
  process.exit(1);
}

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const prompt = `
Professional minimalist logo for developer tool software.
Geometric Mount Olympus mountain peak with integrated golden lightning bolt.
Clean modern tech aesthetic with circuit board patterns.
Color palette: rich gold (#FFD700) to deep blue (#1E40AF) gradient with electric blue (#60A5FA) accents.
Dark navy background (#0A0E27) or transparent.
Flat design, iconic symbol, centered composition.
High quality, square format, suitable for GitHub repository header.
Style: minimalist, geometric, modern software branding.
NO TEXT, NO WORDS, NO LETTERS - icon only.
`.trim();

const negativePrompt = `
text, words, letters, typography, font, label, title,
blurry, low quality, 3d render, photorealistic,
cluttered, busy, cartoon, clipart, watermark, signature
`.trim();

console.log('🎨 Generating Olympus logo...\n');
console.log('Prompt:', prompt);
console.log('\nNegative:', negativePrompt);
console.log('\n⏳ This may take 30-60 seconds...\n');

try {
  // Using FLUX 1.1 Pro for high-quality logo generation
  const output = await replicate.run(
    "black-forest-labs/flux-1.1-pro",
    {
      input: {
        prompt: prompt,
        aspect_ratio: "1:1",
        output_format: "png",
        output_quality: 100,
        safety_tolerance: 2,
        prompt_upsampling: true
      }
    }
  );

  console.log('✅ Generation complete!');
  console.log('Output URL:', output);

  // Download the image
  console.log('\n📥 Downloading image...');
  const response = await fetch(output);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Save to docs/assets/
  const logoPath = join(projectRoot, 'docs', 'assets', 'logo.png');
  writeFileSync(logoPath, buffer);

  console.log('✅ Logo saved to:', logoPath);
  console.log('\n🎉 Done! Your logo is ready.');
  console.log('\nNext steps:');
  console.log('1. View the logo: docs/assets/logo.png');
  console.log('2. If you like it, we can add it to README.md');
  console.log('3. If not, run this script again or try a different model');
  console.log('\nTo generate variations, modify the prompt in scripts/generate-logo.mjs');

} catch (error) {
  console.error('❌ Error generating logo:', error.message);

  if (error.message.includes('authentication')) {
    console.error('\n💡 Tip: Check that your REPLICATE_API_TOKEN is correct');
  } else if (error.message.includes('quota') || error.message.includes('billing')) {
    console.error('\n💡 Tip: Check your Replicate billing at https://replicate.com/account/billing');
  }

  process.exit(1);
}
