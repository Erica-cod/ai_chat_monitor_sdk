export { OpenAIChunkParser } from './openai';
export type { OpenAIChunkParserOptions } from './openai';
export { AnthropicChunkParser } from './anthropic';
export { extractTagThinking } from './tag-thinking';
export type { TagThinkingResult } from './tag-thinking';

import type { ChunkParser, BuiltinParserName } from '../core/types';
import { OpenAIChunkParser } from './openai';
import { AnthropicChunkParser } from './anthropic';

/**
 * 自动检测解析器：根据首行内容判断格式，然后委托给对应的解析器。
 * - `event:` 开头 → Anthropic
 * - `data:` 开头 → OpenAI 兼容
 */
class AutoChunkParser implements ChunkParser {
  private delegate: ChunkParser | null = null;
  private openaiParser = new OpenAIChunkParser();
  private anthropicParser = new AnthropicChunkParser();

  parse(raw: string): import('../core/types').ParsedChunk | null {
    if (!this.delegate) {
      const trimmed = raw.trim();
      if (trimmed.startsWith('event:') || trimmed.startsWith('event: ')) {
        this.delegate = this.anthropicParser;
      } else if (trimmed.startsWith('data:') || trimmed.startsWith('data: ') || trimmed === '') {
        this.delegate = this.openaiParser;
      }
    }
    const parser = this.delegate ?? this.openaiParser;
    return parser.parse(raw);
  }

  reset(): void {
    this.delegate = null;
    this.openaiParser.reset();
    this.anthropicParser.reset();
  }
}

/**
 * 根据名称或实例创建 ChunkParser。
 * 传入字符串时返回内置解析器实例；传入 ChunkParser 实例时直接返回。
 */
export function resolveParser(parser: BuiltinParserName | ChunkParser): ChunkParser {
  if (typeof parser !== 'string') return parser;
  switch (parser) {
    case 'openai': return new OpenAIChunkParser();
    case 'anthropic': return new AnthropicChunkParser();
    case 'auto': return new AutoChunkParser();
    default: return new OpenAIChunkParser();
  }
}
