#!/usr/bin/env node

/**
 * Generate Olympus logo - Infinity + O + Pantheon Concept
 * The perfect fusion of all ideas
 *
 * Usage:
 *   node scripts/generate-logo-infinity.mjs
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

// THE PERFECT CONCEPT: Infinity + O + Pantheon
const prompt = `
Minimalist logo for "Olympus" - Multi-Agent AI Orchestration Platform.
Combining three powerful concepts: Infinity symbol, Letter O, and Greek Pantheon.

CORE VISUAL CONCEPT:

An elegant infinity symbol (∞) that ALSO reads as the letter "O" for Olympus. The infinity loop represents:
- Continuous orchestration cycle
- Never-ending improvement (The Ascent)
- Eternal nature of the gods (Greek mythology)
- Multi-agent coordination flowing in harmony

DESIGN STRUCTURE:

Primary Element - The Infinity Loop:
- Clean, geometric infinity symbol (∞) as the main shape
- Styled to also suggest a circular "O" when viewed as a whole
- Golden gradient flowing along the loop path
- Width and curves optimized for clarity at small sizes

Agent Nodes - The Pantheon:
- 5-7 small glowing nodes/orbs placed strategically along the infinity path
- Each node represents a specialized agent (Oracle, Prometheus, Olympian, Librarian, etc.)
- Nodes positioned at key points: the loops, crossover, and curves
- Subtle variation in node colors (gold, blue, cyan, purple) to show specialization
- Nodes should look like they're "orbiting" or "flowing" along the infinity path

Central Orchestrator:
- At the center intersection of the infinity symbol
- A subtle glow, small mountain peak silhouette, or crown element
- Represents Zeus/the orchestrator coordinating the pantheon
- Should not overpower the infinity symbol - very subtle

SYMBOLISM LAYERS:
1. Infinity (∞) = Continuous orchestration, eternal loop, never stops
2. Letter O = Olympus branding, circular wholeness
3. Orbital path = Agents flowing around the platform in harmony
4. Greek mythology = The eternal pantheon of gods working together
5. Figure-8 flow = Multi-agent coordination, information flowing

STYLE:
- Modern, clean, geometric
- Professional tech branding (think Notion, Linear, Vercel level quality)
- Minimalist but rich in meaning
- Works perfectly at favicon size (64px)

COLOR PALETTE:
- Primary infinity loop: Gold to electric gold gradient (#FFD700 to #FFAA00)
- Agent nodes: Varied colors
  - Gold/yellow (#FFD700) - wisdom agents
  - Blue (#3B82F6) - execution agents
  - Purple (#A855F7) - planning agents
  - Cyan (#06B6D4) - research agents
- Central orchestrator: Bright white/gold glow (#FFFFFF or #FEF3C7)
- Background: Dark navy (#0F172A) or transparent

COMPOSITION:
- Centered, perfect balance
- Square format (1:1)
- Infinity symbol takes up 70% of canvas
- Nodes clearly visible but not overwhelming
- Negative space for breathing room

REFERENCE AESTHETIC:
Think: "What if the Olympic rings were redesigned as an infinity symbol representing eternal multi-agent orchestration?"

Professional, elegant, meaningful. Every element tells part of the Olympus story.

TECHNICAL REQUIREMENTS:
- High resolution PNG (1024x1024)
- Clean vector-style edges
- Must work as favicon (64x64px) - test mentally
- Recognizable at any size
- Unique and memorable

FORBIDDEN:
- NO text, letters, words, typography
- NOT overly complex or detailed
- NOT cluttered with too many elements
- NOT realistic or photographic
- NOT cartoony or playful style

THE KEY TEST:
"Does this logo communicate: continuous orchestration + multiple agents + the letter O + Greek eternal pantheon?"

Someone looking at this should think: "That's elegant... it's an infinity loop... wait, it also reads as an O... and those are multiple agents flowing together... that's clever!"
`.trim();

console.log('∞ Generating Olympus Infinity Logo...\n');
console.log('🎯 Concept: Infinity + O + Pantheon in ONE symbol');
console.log('♾️  Infinity = Continuous orchestration');
console.log('⭕ O = Olympus branding');
console.log('👥 Nodes = Multiple specialized agents');
console.log('🏛️ Greek = Eternal pantheon of gods');
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
    const logoPath = join(projectRoot, 'docs', 'assets', 'logo-infinity.png');
    const timestamp = Date.now();
    const logoWithTimestamp = join(projectRoot, 'docs', 'assets', `logo-infinity-${timestamp}.png`);

    writeFileSync(logoPath, buffer);
    writeFileSync(logoWithTimestamp, buffer);

    console.log('✅ Logo saved to:', logoPath);
    console.log('✅ Backup saved to:', logoWithTimestamp);
    console.log('\n♾️  THE PERFECT FUSION:');
    console.log('  ✓ Infinity symbol = Continuous orchestration');
    console.log('  ✓ Letter O = Olympus branding');
    console.log('  ✓ Multiple nodes = Specialized agents (pantheon)');
    console.log('  ✓ Greek mythology = Eternal gods working together');
    console.log('  ✓ Figure-8 flow = Multi-agent coordination');
    console.log('\n🎉 This should be THE ONE!');
    console.log('\nView: docs/assets/logo-infinity.png');

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
