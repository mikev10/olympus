// Backward-compatibility shim: re-exports from code-generation-executor.ts
// This file is retained so existing imports continue to work during migration.

export {
  buildCodePlanPath as buildBoltPlanPath,
  CodeGenerationDispatchResult as BoltDispatchResult,
  extractSections,
  extractTargetFiles,
  selectAgentForCodeGeneration as selectAgentForBolt,
  buildCodeGenerationPrompt as buildBoltPrompt,
  dispatchCodeGeneration as dispatchBolt,
  CODE_PLAN_FORMAT_INSTRUCTIONS as BOLT_PLAN_FORMAT_INSTRUCTIONS,
} from './code-generation-executor.js';
