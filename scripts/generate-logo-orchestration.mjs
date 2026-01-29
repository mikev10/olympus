#!/usr/bin/env node

/**
 * Generate Olympus logo - True Orchestration Concept
 * Focus: Multiple agents collaborating on a platform
 *
 * Usage:
 *   node scripts/generate-logo-orchestration.mjs
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

// TRUE CONCEPT: Multi-Agent Orchestration
const prompt = `
Minimalist logo for "Olympus" - Multi-Agent AI Orchestration Platform.
Focus on the core concept: Multiple specialized agents collaborating together on a unified platform.

CORE CONCEPT - THE PANTHEON:
Mount Olympus as the platform (foundation) with MULTIPLE distinct elements representing different specialized AI agents (the pantheon of gods) working together in harmony. Each agent has their own domain but collaborates under one orchestrator.

Think: "A constellation of specialized intelligences gathering at Mount Olympus"

VISUAL METAPHOR OPTIONS (choose the clearest):

Option A - Constellation Around Mountain:
- Central Mount Olympus peak (the platform/infrastructure)
- 5-7 distinct glowing orbs/nodes arranged in a circle around the peak
- Each orb represents a specialized agent (Oracle, Prometheus, Olympian, Librarian, etc.)
- Subtle connecting lines or energy flows between orbs showing collaboration
- Central orchestrator element (small lightning or crown) at the peak

Option B - Multiple Pillars/Columns:
- 5-7 stylized Greek columns/pillars of varying heights arranged together
- Each pillar represents a specialized agent
- Columns support a shared platform/roof structure above (Mount Olympus/the infrastructure)
- Central taller column = the orchestrator
- Golden and blue color coding for different agents

Option C - Network/Hub Design:
- Central hub node (the orchestrator) at Mount Olympus peak
- 5-7 satellite nodes (agents) connected to the hub in a radial pattern
- Clean geometric lines connecting all nodes
- Each node glows with different subtle color variations
- Overall shape still suggests a mountain/peak silhouette

DESIGN PRINCIPLES:
- MULTIPLICITY: Must clearly show MULTIPLE distinct entities (not just one element)
- COLLABORATION: Visual connection between agents (lines, orbits, arrangement)
- HIERARCHY: One central orchestrator, multiple specialized agents
- HARMONY: Balanced, symmetrical, working together
- PLATFORM: Mount Olympus as the foundation where agents gather

STYLE:
- Modern, clean, geometric
- Professional tech branding (think Notion, Linear, Kubernetes)
- Minimalist but tells the story
- Works at small sizes (favicon)

COLORS:
- Each agent/node can have subtle color variation:
  - Gold/yellow for wisdom agents (Oracle)
  - Blue for execution agents (Olympian)
  - Purple for planning agents (Prometheus)
  - Cyan for research agents (Librarian)
  - White/silver for the orchestrator
- Background: Dark navy (#0F172A) or transparent
- Maintain overall cohesion despite variety

COMPOSITION:
- Centered, balanced, symmetrical
- Square format (1:1)
- Clear visual hierarchy (orchestrator at top/center)
- Negative space for clarity
- Must be recognizable at 64px

TECHNICAL:
- High resolution PNG
- Clean edges for scaling
- Test mentally: "Does this communicate 'multiple agents working together'?"

FORBIDDEN:
- NO text, letters, words
- NOT a single monolithic element (must show multiplicity)
- NOT cluttered or overcomplicated
- NOT generic mountain-and-lightning (been there)

THE KEY QUESTION:
"Looking at this logo, can someone understand it's about multiple specialized AI agents collaborating on a platform?"

The logo should make someone ask: "What are those different elements/nodes?"
And the answer: "Different specialized agents - Oracle for debugging, Prometheus for planning, Olympian for execution, etc."
`.trim();

console.log('🏛️ Generating TRUE Olympus Logo...\n');
console.log('🎯 Focus: Multi-Agent Orchestration');
console.log('👥 Showing: Multiple specialized agents collaborating');
console.log('🤝 Concept: Pantheon gathering at Mount Olympus');
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
    const logoPath = join(projectRoot, 'docs', 'assets', 'logo-orchestration.png');
    const timestamp = Date.now();
    const logoWithTimestamp = join(projectRoot, 'docs', 'assets', `logo-orchestration-${timestamp}.png`);

    writeFileSync(logoPath, buffer);
    writeFileSync(logoWithTimestamp, buffer);

    console.log('✅ Logo saved to:', logoPath);
    console.log('✅ Backup saved to:', logoWithTimestamp);
    console.log('\n🏛️ TRUE Olympus Concept:');
    console.log('  ✓ Multiple specialized agents visible');
    console.log('  ✓ Collaboration/orchestration shown');
    console.log('  ✓ Platform where agents gather (Mount Olympus)');
    console.log('  ✓ Tells the story of multi-agent coordination');
    console.log('\n🎉 Done! This should capture the real Olympus vision.');
    console.log('\nView: docs/assets/logo-orchestration.png');

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
