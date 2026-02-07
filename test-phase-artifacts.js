const path = require('path');

// Simulate the getPhaseArtifactPath function
function getPhaseArtifactPath(projectPath, workflowId, phase, stage, filename) {
  const workflowDir = path.join(projectPath, '.olympus', 'workflow', workflowId);
  const subdirStages = ['intents', 'validation', 'units', 'design', 'bolts', 'results'];

  if (subdirStages.includes(stage)) {
    if (stage === 'results') {
      return path.join(workflowDir, phase, 'bolts', 'results', filename);
    }
    return path.join(workflowDir, phase, stage, filename);
  } else {
    return path.join(workflowDir, phase, filename);
  }
}

// Test cases
console.log('Testing getPhaseArtifactPath logic:');
console.log('');

const testCases = [
  ['vision', 'idea', 'idea.md', 'vision\idea.md'],
  ['vision', 'intents', 'INTENT-001.md', 'vision\intents\INTENT-001.md'],
  ['vision', 'validation', 'validation-report.md', 'vision\validation\validation-report.md'],
  ['forge', 'units', 'UNIT-001.md', 'forge\units\UNIT-001.md'],
  ['forge', 'design', 'design-doc.md', 'forge\design\design-doc.md'],
  ['forge', 'bolts', 'BOLT-001.md', 'forge\bolts\BOLT-001.md'],
  ['forge', 'results', 'result.md', 'forge\bolts\results\result.md'],
  ['summit', 'deploy', 'deploy-guide.md', 'summit\deploy-guide.md'],
];

let allPassed = true;

testCases.forEach(([phase, stage, filename, expectedSuffix]) => {
  const result = getPhaseArtifactPath('C:\project', 'wf-123', phase, stage, filename);
  const expectedPath = `C:\project\.olympus\workflow\wf-123\${expectedSuffix}`;
  const passed = result === expectedPath;
  allPassed = allPassed && passed;
  
  console.log(`${passed ? '✓' : '✗'} ${phase}/${stage}/${filename}`);
  if (!passed) {
    console.log(`  Expected: ${expectedPath}`);
    console.log(`  Got:      ${result}`);
  }
});

console.log('');
console.log(allPassed ? 'All tests passed!' : 'Some tests failed!');
process.exit(allPassed ? 0 : 1);
