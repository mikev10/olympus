// Writes the two model catalogs the driver hands the Codex CLI (D-R26-04).
//
// Run once, as root, while the image is built: `node catalog.js <bundled> <dir>`.
// <bundled> is what `codex debug models --bundled` printed, the catalog the
// pinned CLI ships. Nothing of it is copied into the repository; it is read
// here, inside the build, and the result is owned by root, so no task can
// rewrite what a later task's session is configured by.
//
// Each catalog holds the three models the driver maps tiers to, with the
// overrides that make the session's tools a list the driver can compare to a
// grant:
//   tool_mode "direct"          the tools arrive as the request's `tools`, not
//                               as globals of a JavaScript program (code mode);
//   use_responses_lite false    the request is the ordinary Responses shape;
//   multi_agent_version null    no multi-agent tools (out of scope);
//   supports_search_tool false  no tool_search;
//   prefer_websockets false     HTTP only, through the relay;
//   upgrade null                no migration prompt.
// `catalog-patch.json` keeps the bundled apply_patch tool type, and
// `catalog-no-patch.json` sets it to null, which is the only way the pinned
// CLI leaves apply_patch out (core/src/tools/spec_plan.rs:1426 at rust-v0.166.0).
/* global require, process, console -- run by node during the image build, never imported */
/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS script: the image runs it with plain node, before any package exists */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const [, , bundledPath, outDir] = process.argv;
const MODELS = ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'];

function fail(why) {
  console.error('catalog: ' + why);
  process.exit(1);
}

const bundled = JSON.parse(fs.readFileSync(bundledPath, 'utf8'));
if (bundled === null || typeof bundled !== 'object' || !Array.isArray(bundled.models)) fail('the bundled catalog has no models list');

function entries(patch) {
  return MODELS.map(function (slug) {
    const model = bundled.models.find(function (m) { return m !== null && typeof m === 'object' && m.slug === slug; });
    if (model === undefined) fail('the bundled catalog has no ' + slug);
    if (patch && (model.apply_patch_tool_type === null || model.apply_patch_tool_type === undefined)) {
      fail(slug + ' has no apply_patch tool type to keep');
    }
    return Object.assign({}, model, {
      tool_mode: 'direct',
      use_responses_lite: false,
      multi_agent_version: null,
      supports_search_tool: false,
      prefer_websockets: false,
      upgrade: null,
      apply_patch_tool_type: patch ? model.apply_patch_tool_type : null,
    });
  });
}

fs.writeFileSync(path.join(outDir, 'catalog-patch.json'), JSON.stringify({ models: entries(true) }));
fs.writeFileSync(path.join(outDir, 'catalog-no-patch.json'), JSON.stringify({ models: entries(false) }));
