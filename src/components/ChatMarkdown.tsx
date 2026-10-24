import React, { useState } from 'react';
import { Copy, Check, FileCode, Terminal as TerminalIcon, ExternalLink } from 'lucide-react';

interface ChatMarkdownProps {
  content: string;
  onOpenFileInEditor?: (filePath: string) => void;
  onRunInTerminal?: (command: string) => void;
}

interface ParsedSegment {
  type: 'text' | 'code' | 'table';
  content: string;
  language?: string;
  headers?: string[];
  rows?: string[][];
}

// Tokenize common code syntax (Kotlin, Java, JS, TS, Bash, JSON, XML)
function highlightCodeLine(line: string, language: string): React.ReactNode[] {
  // Simple regex-based token highlighting
  const tokens: Array<{ type: 'comment' | 'string' | 'keyword' | 'number' | 'text'; value: string }> = [];
  
  let rest = line;
  while (rest.length > 0) {
    // Comments
    const commentMatch = rest.match(/^(\/\/.*|#.*|\/\*.*?\*\/)/);
    if (commentMatch) {
      tokens.push({ type: 'comment', value: commentMatch[0] });
      rest = rest.slice(commentMatch[0].length);
      continue;
    }
    // Strings
    const stringMatch = rest.match(/^("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/);
    if (stringMatch) {
      tokens.push({ type: 'string', value: stringMatch[0] });
      rest = rest.slice(stringMatch[0].length);
      continue;
    }
    // Numbers
    const numberMatch = rest.match(/^(?:0x[0-9a-fA-F]+|\b\d+(?:\.\d+)?(?:f|L|ms)?\b)/);
    if (numberMatch) {
      tokens.push({ type: 'number', value: numberMatch[0] });
      rest = rest.slice(numberMatch[0].length);
      continue;
    }
    // Keywords
    const keywordMatch = rest.match(/^\b(fun|val|var|package|import|class|interface|object|return|if|else|when|for|while|try|catch|throw|override|public|private|protected|internal|const|let|function|async|await|echo|export|default|null|true|false|new|this|typeof|void|type)\b/);
    if (keywordMatch) {
      tokens.push({ type: 'keyword', value: keywordMatch[0] });
      rest = rest.slice(keywordMatch[0].length);
      continue;
    }
    // Default text chunk
    const nextCharMatch = rest.match(/^[^"'/`#0-9a-zA-Z_]+|\b[a-zA-Z_]\w*\b/);
    if (nextCharMatch) {
      tokens.push({ type: 'text', value: nextCharMatch[0] });
      rest = rest.slice(nextCharMatch[0].length);
    } else {
      tokens.push({ type: 'text', value: rest[0] });
      rest = rest.slice(1);
    }
  }

  return tokens.map((tok, idx) => {
    if (tok.type === 'comment') {
      return <span key={idx} className="text-[#8B949E] italic">{tok.value}</span>;
    }
    if (tok.type === 'string') {
      return <span key={idx} className="text-[#A5D6FF]">{tok.value}</span>;
    }
    if (tok.type === 'keyword') {
      return <span key={idx} className="text-[#FF7B72] font-semibold">{tok.value}</span>;
    }
    if (tok.type === 'number') {
      return <span key={idx} className="text-[#79C0FF]">{tok.value}</span>;
    }
    return <span key={idx}>{tok.value}</span>;
  });
}

function parseMarkdownSegments(raw: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      const textChunk = raw.slice(lastIndex, match.index);
      parseTextAndTables(textChunk, segments);
    }
    segments.push({
      type: 'code',
      language: (match[1] || 'code').toLowerCase(),
      content: match[2].replace(/\n$/, ''),
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < raw.length) {
    const remaining = raw.slice(lastIndex);
    // Safely render an unclosed code fence while streaming tokens incrementally
    const unclosedMatch = remaining.match(/^([\s\S]*?)```([a-zA-Z0-9_-]*)\r?\n([\s\S]*)$/);
    if (unclosedMatch) {
      if (unclosedMatch[1]) {
        parseTextAndTables(unclosedMatch[1], segments);
      }
      segments.push({
        type: 'code',
        language: (unclosedMatch[2] || 'code').toLowerCase(),
        content: unclosedMatch[3].replace(/\n$/, ''),
      });
    } else {
      parseTextAndTables(remaining, segments);
    }
  }

  return segments;
}

function parseTextAndTables(chunk: string, segments: ParsedSegment[]) {
  const lines = chunk.split('\n');
  let textBuffer: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const isTableLine = line.trim().startsWith('|') && line.trim().endsWith('|');

    if (isTableLine && i + 1 < lines.length && /^\s*\|?\s*[-:]+[-| :]*\|\s*$/.test(lines[i + 1])) {
      // Flush previous text
      if (textBuffer.length > 0) {
        segments.push({ type: 'text', content: textBuffer.join('\n') });
        textBuffer = [];
      }

      // Parse table
      const headerLine = line;
      const headers = headerLine.split('|').map((s) => s.trim()).filter(Boolean);
      i += 2; // skip header and delimiter

      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        const rowCols = lines[i].split('|').map((s) => s.trim());
        // remove leading/trailing empty splits
        if (rowCols[0] === '') rowCols.shift();
        if (rowCols[rowCols.length - 1] === '') rowCols.pop();
        rows.push(rowCols);
        i++;
      }

      segments.push({
        type: 'table',
        content: '',
        headers,
        rows,
      });
      continue;
    }

    textBuffer.push(line);
    i++;
  }

  if (textBuffer.length > 0) {
    segments.push({ type: 'text', content: textBuffer.join('\n') });
  }
}

function renderInlineFormatting(line: string): React.ReactNode[] {
  // Match `code`, **bold**, *italic*, [link](url)
  const parts = line.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, idx) => {
    // Inline code
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      const inner = part.slice(1, -1);
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 mx-0.5 text-[12px] font-mono bg-[#161B22] border border-[#30363D] rounded-md text-[#C7FF65] break-all select-all"
        >
          {inner}
        </code>
      );
    }
    // Bold
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <strong key={idx} className="font-semibold text-[#F0F6FC]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    // Italic
    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      return (
        <em key={idx} className="italic text-[#E6EDF3]">
          {part.slice(1, -1)}
        </em>
      );
    }
    // Link [text](url)
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={idx}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#58A6FF] hover:text-[#79C0FF] underline underline-offset-2 inline-flex items-center gap-0.5 font-medium"
        >
          <span>{linkMatch[1]}</span>
          <ExternalLink className="w-3 h-3 inline shrink-0" />
        </a>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function cleanRawModelText(raw: string): string {
  if (!raw) return '';
  return raw
    // Strip DeepSeek DSML tool calls and invoke blocks
    .replace(/<[|｜\s]*DSML[|｜\s]*calls>[\s\S]*?<\/[|｜\s]*DSML[|｜\s]*calls>/gi, '')
    .replace(/<[|｜\s]*DSML[|｜\s]*invoke[\s\S]*?<\/[|｜\s]*DSML[|｜\s]*invoke>/gi, '')
    .replace(/<[|｜\s]*DSML[|｜\s]*.*?>/gi, '')
    // Strip reasoning / thought / think tags (including unclosed during streaming)
    .replace(/<thought>[\s\S]*?(?:<\/thought>|$)/gi, '')
    .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '')
    // Strip ```tool_call code blocks (including unclosed during streaming)
    .replace(/```(?:tool_call|tool_calls|json_tool)[\s\S]*?(?:```|$)/gi, '')
    .trim();
}

export const ChatMarkdown: React.FC<ChatMarkdownProps> = ({
  content,
  onRunInTerminal,
}) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const cleaned = cleanRawModelText(content);
  if (!cleaned) return null;
  const segments = parseMarkdownSegments(cleaned);

  const handleCopyCode = (idx: number, code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 1500);
  };

  return (
    <div className="space-y-3.5 text-[14px] sm:text-[14.5px] leading-[1.72] text-[#F0F6FC] min-w-0 max-w-full font-sans">
      {segments.map((seg, idx) => {
        // 1. Code Block with Syntax Highlighting & Line Numbers
        if (seg.type === 'code') {
          const isShell =
            seg.language === 'bash' ||
            seg.language === 'sh' ||
            seg.language === 'shell' ||
            seg.language === 'zsh';
          const codeLines = seg.content.split('\n');

          return (
            <div
              key={idx}
              className="rounded-xl border border-[#30363D] bg-[#090D12] overflow-hidden my-3.5 shadow-sm max-w-full"
            >
              {/* Header Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 bg-[#161B22] border-b border-[#30363D] text-[11px] font-mono text-[#8B949E]">
                <div className="flex items-center gap-2 min-w-0">
                  <FileCode className="w-3.5 h-3.5 text-[#58A6FF] shrink-0" />
                  <span className="text-[#F0F6FC] font-semibold uppercase tracking-wider text-[10.5px]">
                    {seg.language || 'code'}
                  </span>
                  <span className="text-[#30363D]">·</span>
                  <span className="text-[#8B949E] tabular-nums">
                    {codeLines.length} {codeLines.length === 1 ? 'line' : 'lines'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {isShell && onRunInTerminal && (
                    <button
                      type="button"
                      onClick={() => onRunInTerminal(seg.content)}
                      title="Run command in terminal session"
                      aria-label="Run command in terminal session"
                      className="min-h-[26px] px-2.5 py-0.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-[#C7FF65] flex items-center gap-1.5 text-xs font-medium transition-colors cursor-pointer"
                    >
                      <TerminalIcon className="w-3 h-3 text-[#C7FF65] shrink-0" />
                      <span>Run in Terminal</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleCopyCode(idx, seg.content)}
                    title={copiedIndex === idx ? 'Copied to clipboard' : 'Copy code to clipboard'}
                    aria-label={copiedIndex === idx ? 'Copied to clipboard' : 'Copy code snippet'}
                    className="min-h-[26px] px-2.5 py-0.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-[#8B949E] hover:text-[#F0F6FC] flex items-center gap-1.5 text-xs font-medium transition-colors cursor-pointer"
                  >
                    {copiedIndex === idx ? (
                      <>
                        <Check className="w-3 h-3 text-[#72D9A0] shrink-0" />
                        <span className="text-[#72D9A0]">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3 text-[#8B949E] shrink-0" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Code Surface with Syntax Coloring & Line Numbers */}
              <div className="overflow-x-auto max-w-full py-2.5 font-mono text-[12px] leading-[1.65]">
                {codeLines.map((ln, lineIndex) => (
                  <div key={lineIndex} className="flex px-3 hover:bg-[#161B22]/50 transition-colors">
                    <span className="w-8 shrink-0 select-none text-right pr-3.5 text-[#6E7580] tabular-nums font-mono text-[11px]">
                      {lineIndex + 1}
                    </span>
                    <span className="text-[#F0F6FC] whitespace-pre break-normal">
                      {highlightCodeLine(ln || ' ', seg.language || '')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        }

        // 2. Markdown Table
        if (seg.type === 'table' && seg.headers && seg.rows) {
          return (
            <div key={idx} className="overflow-x-auto my-3 rounded-xl border border-[#30363D] bg-[#161B22]/60">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#30363D] bg-[#161B22]">
                    {seg.headers.map((h, hIdx) => (
                      <th key={hIdx} className="px-3.5 py-2.5 font-semibold text-[#F0F6FC] font-mono">
                        {renderInlineFormatting(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#30363D]/60">
                  {seg.rows.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-[#21262D]/40 transition-colors">
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="px-3.5 py-2 text-[#E6EDF3]">
                          {renderInlineFormatting(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        // 3. Regular Text with Headings, Lists, Blockquotes, Paragraphs
        const lines = seg.content.split('\n');
        return (
          <div key={idx} className="space-y-2.5 min-w-0">
            {lines.map((line, lineIdx) => {
              const trimmed = line.trim();
              if (!trimmed) {
                return <div key={lineIdx} className="h-0.5" />;
              }

              // Horizontal Rule
              if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
                return <hr key={lineIdx} className="border-t border-[#30363D] my-3" />;
              }

              // Headings
              if (trimmed.startsWith('#### ')) {
                return (
                  <h5 key={lineIdx} className="text-xs font-bold text-[#F0F6FC] uppercase tracking-wider pt-2">
                    {renderInlineFormatting(trimmed.slice(5))}
                  </h5>
                );
              }
              if (trimmed.startsWith('### ')) {
                return (
                  <h4 key={lineIdx} className="text-sm font-semibold text-[#F0F6FC] pt-2 tracking-tight">
                    {renderInlineFormatting(trimmed.slice(4))}
                  </h4>
                );
              }
              if (trimmed.startsWith('## ')) {
                return (
                  <h3 key={lineIdx} className="text-base font-semibold text-[#F0F6FC] pt-2.5 tracking-tight border-b border-[#30363D]/40 pb-1">
                    {renderInlineFormatting(trimmed.slice(3))}
                  </h3>
                );
              }
              if (trimmed.startsWith('# ')) {
                return (
                  <h2 key={lineIdx} className="text-lg font-bold text-[#F0F6FC] pt-3 tracking-tight border-b border-[#30363D] pb-1.5">
                    {renderInlineFormatting(trimmed.slice(2))}
                  </h2>
                );
              }

              // Blockquotes
              if (trimmed.startsWith('> ')) {
                return (
                  <blockquote key={lineIdx} className="border-l-2 border-[#C7FF65] pl-3 py-1 my-1.5 bg-[#161B22]/40 rounded-r text-[#8B949E] text-xs sm:text-sm italic">
                    {renderInlineFormatting(trimmed.slice(2))}
                  </blockquote>
                );
              }

              // Unordered List (- or *)
              if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                return (
                  <div key={lineIdx} className="flex items-start gap-2.5 pl-1.5 min-w-0">
                    <span className="text-[#C7FF65] select-none mt-2 w-1.5 h-1.5 rounded-full bg-[#C7FF65] shrink-0" />
                    <div className="flex-1 min-w-0 text-[#E6EDF3]">
                      {renderInlineFormatting(trimmed.slice(2))}
                    </div>
                  </div>
                );
              }

              // Ordered List (1. 2. etc.)
              const numberedMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
              if (numberedMatch) {
                return (
                  <div key={lineIdx} className="flex items-start gap-2.5 pl-1.5 min-w-0">
                    <span className="font-mono text-xs text-[#58A6FF] tabular-nums shrink-0 mt-0.5">
                      {numberedMatch[1]}.
                    </span>
                    <div className="flex-1 min-w-0 text-[#E6EDF3]">
                      {renderInlineFormatting(numberedMatch[2])}
                    </div>
                  </div>
                );
              }

              // Regular Paragraph
              return (
                <p key={lineIdx} className="leading-[1.72] text-[#E6EDF3] break-words">
                  {renderInlineFormatting(line)}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};
