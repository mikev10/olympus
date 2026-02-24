export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const MERMAID_BLOCK_RE = /```mermaid\s*\n([\s\S]*?)```/g;

const VALID_DIAGRAM_TYPES = [
  'graph',
  'flowchart',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'journey',
  'gantt',
  'pie',
  'gitGraph',
  'mindmap',
  'timeline',
  'quadrantChart',
  'xychart-beta',
  'block-beta',
  'sankey-beta',
  'requirementDiagram',
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'C4Deployment',
];

const VALID_ARROW_RE = /-->|---|-->>|-.->|-\.-|==>/;

const NODE_ID_EXTRACT_RE = /\b([A-Za-z_][A-Za-z0-9_-]*)\s*(?:\[|\(|\{|>|$|\s)/g;

export function validateMermaidSyntax(content: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let match: RegExpExecArray | null;
  let blockIndex = 0;

  MERMAID_BLOCK_RE.lastIndex = 0;
  while ((match = MERMAID_BLOCK_RE.exec(content)) !== null) {
    blockIndex++;
    const block = match[1];
    const lines = block.split('\n');
    const prefix = `Mermaid block #${blockIndex}`;

    const firstLine = lines.find((l) => l.trim().length > 0)?.trim() ?? '';
    const hasDiagramType = VALID_DIAGRAM_TYPES.some((t) =>
      firstLine.toLowerCase().startsWith(t.toLowerCase()),
    );
    if (!hasDiagramType) {
      errors.push(
        `${prefix}: Missing or unrecognised diagram type declaration. Found: "${firstLine.slice(0, 40)}"`,
      );
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('%%')) continue;

      if (line.includes('->') || line.includes('---') || line.includes('==>')) {
        if (!VALID_ARROW_RE.test(line)) {
          errors.push(
            `${prefix} line ${i + 1}: Invalid connection syntax. Use -->, ---, -.->, or ==>`,
          );
        }
      }

      const labelStripped = line.replace(/\[.*?\]|\(.*?\)|\{.*?\}|"[^"]*"/g, '');
      NODE_ID_EXTRACT_RE.lastIndex = 0;
      let idMatch: RegExpExecArray | null;
      while ((idMatch = NODE_ID_EXTRACT_RE.exec(labelStripped)) !== null) {
        const id = idMatch[1];
        if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(id)) {
          errors.push(
            `${prefix} line ${i + 1}: Invalid node ID "${id}". Only alphanumeric, underscore, and hyphen allowed.`,
          );
        }
      }

      const labelMatch = line.match(/\["([^"]*)"|'([^']*)'/g);
      if (labelMatch) {
        for (const lm of labelMatch) {
          if ((lm.match(/"/g)?.length ?? 0) % 2 !== 0) {
            warnings.push(`${prefix} line ${i + 1}: Possible unbalanced quote in label.`);
          }
        }
      }
    }

    const openBrackets = (block.match(/\[/g) ?? []).length;
    const closeBrackets = (block.match(/\]/g) ?? []).length;
    if (openBrackets !== closeBrackets) {
      warnings.push(
        `${prefix}: Unbalanced square brackets (${openBrackets} open, ${closeBrackets} close).`,
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

const BOX_DRAWING_RE = /[\u2500-\u257F]/;

const ASCII_DIAGRAM_LINE_RE = /(?:[+\-|]{3,}|[\u2500-\u257F]{2,})/;

export function validateAsciiDiagram(content: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!ASCII_DIAGRAM_LINE_RE.test(line)) continue;

    if (BOX_DRAWING_RE.test(line)) {
      const forbidden = [...line].filter((ch) => /[\u2500-\u257F]/.test(ch));
      const unique = [...new Set(forbidden)];
      errors.push(
        `Line ${i + 1}: Forbidden Unicode box-drawing character(s) found: ${unique.map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')} '${c}'`).join(', ')}. Use ASCII equivalents (+, -, |) instead.`,
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function validateMarkdown(content: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const lines = content.split('\n');

  const fenceMatches = content.match(/^```/gm) ?? [];
  if (fenceMatches.length % 2 !== 0) {
    warnings.push(
      `Markdown has an odd number of code fence markers (\`\`\`): ${fenceMatches.length}. One or more code blocks may be unclosed.`,
    );
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^#{1,6}[^#\s]/.test(line)) {
      warnings.push(
        `Line ${i + 1}: Header marker '#' not followed by a space: "${line.slice(0, 60)}"`,
      );
    }

    if (/^(\s*)[-*][^\s\-*]/.test(line)) {
      warnings.push(
        `Line ${i + 1}: List marker '-' or '*' not followed by a space: "${line.slice(0, 60)}"`,
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

const UNICODE_TO_ASCII: Record<string, string> = {
  '─': '-', '━': '-', '┄': '-', '┅': '-', '┈': '-', '┉': '-', '╌': '-', '╍': '-',
  '│': '|', '┃': '|', '┆': '|', '┇': '|', '┊': '|', '┋': '|', '╎': '|', '╏': '|',
  '┌': '+', '┍': '+', '┎': '+', '┏': '+', '┐': '+', '┑': '+', '┒': '+', '┓': '+',
  '└': '+', '┕': '+', '┖': '+', '┗': '+', '┘': '+', '┙': '+', '┚': '+', '┛': '+',
  '├': '+', '┝': '+', '┞': '+', '┟': '+', '┠': '+', '┡': '+', '┢': '+', '┣': '+',
  '┤': '+', '┥': '+', '┦': '+', '┧': '+', '┨': '+', '┩': '+', '┪': '+', '┫': '+',
  '┬': '+', '┭': '+', '┮': '+', '┯': '+', '┰': '+', '┱': '+', '┲': '+', '┳': '+',
  '┴': '+', '┵': '+', '┶': '+', '┷': '+', '┸': '+', '┹': '+', '┺': '+', '┻': '+',
  '┼': '+', '┽': '+', '┾': '+', '┿': '+', '╀': '+', '╁': '+', '╂': '+', '╃': '+',
  '╄': '+', '╅': '+', '╆': '+', '╇': '+', '╈': '+', '╉': '+', '╊': '+', '╋': '+',
  '═': '-', '║': '|',
  '╒': '+', '╓': '+', '╔': '+', '╕': '+', '╖': '+', '╗': '+',
  '╘': '+', '╙': '+', '╚': '+', '╛': '+', '╜': '+', '╝': '+',
  '╞': '+', '╟': '+', '╠': '+', '╡': '+', '╢': '+', '╣': '+',
  '╤': '+', '╥': '+', '╦': '+', '╧': '+', '╨': '+', '╩': '+',
  '╪': '+', '╫': '+', '╬': '+',
  '╱': '/', '╲': '\\', '╳': 'X',
  '╴': '-', '╵': '|', '╶': '-', '╷': '|',
  '╸': '-', '╹': '|', '╺': '-', '╻': '|',
  '╼': '-', '╽': '|', '╾': '-', '╿': '|',
};

function replaceUnicodeBoxDrawing(line: string): string {
  return [...line].map((ch) => UNICODE_TO_ASCII[ch] ?? ch).join('');
}

function mermaidBlockToText(blockContent: string): string {
  const descriptions: string[] = [];
  for (const line of blockContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;
    const readable = trimmed
      .replace(/-->/g, ' connects to ')
      .replace(/---/g, ' links to ')
      .replace(/-\.->/g, ' dotted-connects to ')
      .replace(/==>/g, ' strongly-connects to ')
      .replace(/\[([^\]]*)\]/g, '($1)')
      .replace(/\{([^}]*)\}/g, '($1)');
    descriptions.push(`> ${readable}`);
  }
  return descriptions.join('\n');
}

function applyMermaidFallback(content: string): string {
  const result = validateMermaidSyntax(content);
  if (result.valid) return content;
  MERMAID_BLOCK_RE.lastIndex = 0;
  return content.replace(MERMAID_BLOCK_RE, (_full, blockContent: string) => {
    console.warn(
      '[content-validation] Mermaid block failed validation — replacing with text fallback.',
    );
    return `> **Note:** Diagram could not be rendered. Text description:\n${mermaidBlockToText(blockContent)}`;
  });
}

function applyAsciiDiagramFallback(content: string): string {
  const result = validateAsciiDiagram(content);
  if (result.valid) return content;
  return content
    .split('\n')
    .map((line) => {
      if (!BOX_DRAWING_RE.test(line)) return line;
      console.warn(
        `[content-validation] Replacing Unicode box-drawing characters on line: "${line.slice(0, 60)}"`,
      );
      return replaceUnicodeBoxDrawing(line);
    })
    .join('\n');
}

function applyMarkdownFixes(content: string): string {
  const result = validateMarkdown(content);
  if (result.warnings.length === 0) return content;

  for (const w of result.warnings) {
    console.warn(`[content-validation] Markdown issue: ${w}`);
  }

  const lines = content.split('\n');
  const fixed: string[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    if (/^```/.test(line)) {
      inCodeBlock = !inCodeBlock;
    }

    if (!inCodeBlock) {
      if (/^#{1,6}[^#\s]/.test(line)) {
        line = line.replace(/^(#{1,6})([^#\s])/, '$1 $2');
        console.warn(`[content-validation] Fixed header spacing on line ${i + 1}`);
      }

      if (/^(\s*)[-*][^\s\-*]/.test(line)) {
        line = line.replace(/^(\s*)([-*])([^\s])/, '$1$2 $3');
        console.warn(`[content-validation] Fixed list marker spacing on line ${i + 1}`);
      }
    }

    fixed.push(line);
  }

  if (inCodeBlock) {
    fixed.push('```');
    console.warn('[content-validation] Closed unclosed code block at end of content.');
  }

  return fixed.join('\n');
}

export function validateAndFallback(content: string): string {
  let result = content;

  try {
    result = applyMermaidFallback(result);
  } catch (err) {
    console.warn('[content-validation] Mermaid validation error (skipped):', err);
  }

  try {
    result = applyAsciiDiagramFallback(result);
  } catch (err) {
    console.warn('[content-validation] ASCII diagram validation error (skipped):', err);
  }

  try {
    result = applyMarkdownFixes(result);
  } catch (err) {
    console.warn('[content-validation] Markdown validation error (skipped):', err);
  }

  return result;
}

export const CONTENT_VALIDATION_RULES = `## Content Validation Rules

Before writing any file containing diagrams or structured content:
1. **Mermaid Diagrams**: Node IDs must be alphanumeric+underscore only. Use standard arrow syntax (-->, ---). Escape special characters in labels.
2. **ASCII Diagrams**: Use only +, -, |, ^, v, <, > characters. NO Unicode box-drawing characters. Corners use +.
3. **Markdown**: Ensure all code blocks are closed. Headers need space after #. Lists need space after - or *.
4. **Fallback**: If a diagram cannot be validated, replace with text description. Never block workflow for validation failure.`;
