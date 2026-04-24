const filter = require('../skills/gostdocs/scripts/lib/ai-artifact-filter');

describe('detect — filename patterns', () => {
  test('TECHNICAL_SPECIFICATION.md flagged medium on filename alone', () => {
    const r = filter.detect('/repo/docs/TECHNICAL_SPECIFICATION.md', '');
    expect(r.confidence).toBe('medium');
    expect(r.is_ai_artifact).toBe(true);
  });

  test('ARCHITECTURE_GUIDELINES.md flagged medium', () => {
    const r = filter.detect('/repo/docs/ARCHITECTURE_GUIDELINES.md', '');
    expect(r.confidence).toBe('medium');
  });

  test('GENERATED_OVERVIEW.md flagged medium', () => {
    const r = filter.detect('/repo/GENERATED_OVERVIEW.md', '');
    expect(r.is_ai_artifact).toBe(true);
  });

  test('README.md not flagged on filename', () => {
    const r = filter.detect('/repo/README.md', '');
    expect(r.is_ai_artifact).toBe(false);
  });
});

describe('detect — footer patterns', () => {
  test('Claude Code footer raises confidence to high', () => {
    const r = filter.detect(
      '/repo/NOTES.md',
      '# Notes\n\ncontent\n\nGenerated with [Claude Code](https://...)',
    );
    expect(r.confidence).toBe('high');
    expect(r.is_ai_artifact).toBe(true);
  });

  test('Co-Authored-By: Claude flagged high', () => {
    const r = filter.detect('/repo/x.md', '## Changes\nCo-Authored-By: Claude <claude@anthropic.com>');
    expect(r.confidence).toBe('high');
  });
});

describe('detect — phrasing patterns', () => {
  test('single phrasing hit is low confidence', () => {
    const r = filter.detect('/repo/guide.md', '# Comprehensive Guide to Something\n\nText here.');
    expect(r.confidence).toBe('low');
    expect(r.is_ai_artifact).toBe(false);
  });

  test('two phrasing hits is medium', () => {
    const r = filter.detect(
      '/repo/guide.md',
      '# Complete Guide\n\nThis document provides a comprehensive overview.\nLet me walk you through it.',
    );
    expect(r.confidence).toBe('medium');
  });

  test('suspicious filename + phrasing is high', () => {
    const r = filter.detect(
      '/repo/TECHNICAL_SPECIFICATION.md',
      '# Comprehensive Documentation\n\nThis document outlines...',
    );
    expect(r.confidence).toBe('high');
  });
});

describe('partition', () => {
  test('splits sources into human vs ai lists', () => {
    const sources = [
      { path: '/repo/README.md', content: '# Title\n\nPlain docs.' },
      { path: '/repo/ARCHITECTURE_GUIDELINES.md', content: '' },
      { path: '/repo/notes.md', content: 'Generated with [Claude Code]' },
    ];
    const { human, ai } = filter.partition(sources);
    expect(human.map((s) => s.path)).toEqual(['/repo/README.md']);
    expect(ai.map((s) => s.path)).toEqual([
      '/repo/ARCHITECTURE_GUIDELINES.md',
      '/repo/notes.md',
    ]);
    expect(ai[1].detection.confidence).toBe('high');
  });

  test('handles empty input', () => {
    expect(filter.partition([])).toEqual({ human: [], ai: [] });
    expect(filter.partition(null)).toEqual({ human: [], ai: [] });
  });
});
