export { InceptionOrchestrator, registerStageHandler } from './orchestrator.js';
export type { InceptionStageResult, InceptionProgress, StageHandler } from './orchestrator.js';

// Stage registrations — importing each module triggers registerStageHandler() at module level
export { executeWorkspaceDetection } from './stages/workspace-detection.js';
export { executeReverseEngineering } from './stages/reverse-engineering.js';
export { executeRequirementsAnalysis } from './stages/requirements-analysis.js';
export { executeApplicationDesign } from './stages/application-design.js';
export { executeUserStories } from './stages/user-stories.js';
export { executeWorkflowPlanning } from './stages/workflow-planning.js';
export { executeUnitsGeneration } from './stages/units-generation.js';
export { updateExecutionPlanCheckbox } from './execution-plan-updater.js';
