import type { FeedbackEntry } from '../../../learning/types.js';

/**
 * Mock feedback for testing clustering - contains 3+ similar TypeScript-related entries
 */
export const MOCK_FEEDBACK_FOR_CLUSTERING: FeedbackEntry[] = [
  {
    id: 'test-1',
    timestamp: '2025-01-20T10:00:00Z',
    session_id: 'session-1',
    project_path: '/test/project',
    event_type: 'revision',
    user_message: "No, that's wrong. Use TypeScript types.",
    feedback_category: 'correction',
    confidence: 0.9,
  },
  {
    id: 'test-2',
    timestamp: '2025-01-20T11:00:00Z',
    session_id: 'session-1',
    project_path: '/test/project',
    event_type: 'revision',
    user_message: "Add TypeScript types to this function.",
    feedback_category: 'correction',
    confidence: 0.85,
  },
  {
    id: 'test-3',
    timestamp: '2025-01-20T12:00:00Z',
    session_id: 'session-1',
    project_path: '/test/project',
    event_type: 'revision',
    user_message: "Missing TypeScript type annotations here.",
    feedback_category: 'correction',
    confidence: 0.88,
  },
  {
    id: 'test-4',
    timestamp: '2025-01-20T13:00:00Z',
    session_id: 'session-1',
    project_path: '/test/project',
    event_type: 'success',
    user_message: "Perfect, that's exactly what I wanted!",
    feedback_category: 'praise',
    confidence: 0.9,
  },
  {
    id: 'test-5',
    timestamp: '2025-01-21T10:00:00Z',
    session_id: 'session-2',
    project_path: '/test/project',
    event_type: 'explicit_preference',
    user_message: "Always use TypeScript strict mode.",
    feedback_category: 'explicit_preference',
    confidence: 0.95,
  },
];

/**
 * Mock feedback with insufficient entries for pattern extraction (only 2 similar)
 */
export const MOCK_FEEDBACK_INSUFFICIENT: FeedbackEntry[] = [
  {
    id: 'insuf-1',
    timestamp: '2025-01-20T10:00:00Z',
    session_id: 'session-1',
    project_path: '/test/project',
    event_type: 'revision',
    user_message: "Add error handling here.",
    feedback_category: 'correction',
    confidence: 0.85,
  },
  {
    id: 'insuf-2',
    timestamp: '2025-01-20T11:00:00Z',
    session_id: 'session-1',
    project_path: '/test/project',
    event_type: 'revision',
    user_message: "Missing error handling.",
    feedback_category: 'correction',
    confidence: 0.82,
  },
];

/**
 * Mock feedback for agent performance testing
 */
export const MOCK_FEEDBACK_AGENTS: FeedbackEntry[] = [
  {
    id: 'agent-1',
    timestamp: '2025-01-20T10:00:00Z',
    session_id: 'session-1',
    project_path: '/test/project',
    event_type: 'success',
    original_task: 'Refactor the auth module',
    agent_used: 'oracle',
    user_message: 'Great work!',
    feedback_category: 'praise',
    confidence: 0.85,
  },
  {
    id: 'agent-2',
    timestamp: '2025-01-20T11:00:00Z',
    session_id: 'session-1',
    project_path: '/test/project',
    event_type: 'revision',
    original_task: 'Fix React component',
    agent_used: 'oracle',
    user_message: 'The React state handling is wrong.',
    feedback_category: 'correction',
    confidence: 0.88,
  },
  {
    id: 'agent-3',
    timestamp: '2025-01-20T12:00:00Z',
    session_id: 'session-1',
    project_path: '/test/project',
    event_type: 'success',
    original_task: 'Add tests',
    agent_used: 'olympian',
    user_message: 'Perfect!',
    feedback_category: 'praise',
    confidence: 0.9,
  },
  {
    id: 'agent-4',
    timestamp: '2025-01-20T13:00:00Z',
    session_id: 'session-1',
    project_path: '/test/project',
    event_type: 'revision',
    original_task: 'Build UI component',
    agent_used: 'frontend-engineer',
    user_message: 'Need to run shadcn add first.',
    feedback_category: 'correction',
    confidence: 0.85,
  },
  {
    id: 'agent-5',
    timestamp: '2025-01-20T14:00:00Z',
    session_id: 'session-1',
    project_path: '/test/project',
    event_type: 'revision',
    original_task: 'Style the form',
    agent_used: 'frontend-engineer',
    user_message: 'Forgot to install shadcn component.',
    feedback_category: 'correction',
    confidence: 0.82,
  },
];
