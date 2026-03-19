/**
 * OpenAI 兼容 SSE 格式解析器。
 * 覆盖 OpenAI / DeepSeek / 火山引擎豆包 / vLLM 等所有 OpenAI 兼容 API。
 *
 * 解析 `data: {...}` SSE 行，提取：
 * - delta.content（正文）
 * - delta.reasoning_content（DeepSeek R1 / OpenAI o1/o3 的 thinking）
 * - delta.tool_calls（流式工具调用累积）
 * - usage（token 用量）
 * - finish_reason（stop / tool_calls）
 *
 * 同时支持 content 中嵌入 `<think>` 标签的国内模型场景。
 */

import type { ChunkParser, ParsedChunk } from '../core/types';
import { extractTagThinking } from './tag-thinking';

export interface OpenAIChunkParserOptions {
  /**
   * 是否启用标签式 thinking 检测（从 content 中提取 `<think>` 标签）。
   * 部分国内模型将 thinking 以 XML 标签形式嵌入 content 字段。
   * 默认 true。
   */
  enableTagThinking?: boolean;
  /** 标签名，默认 `'think'` */
  thinkingTag?: string;
}

interface AccumulatedToolCall {
  name?: string;
  arguments: string;
}

export class OpenAIChunkParser implements ChunkParser {
  private options: Required<OpenAIChunkParserOptions>;
  private accumulatedToolCalls = new Map<number, AccumulatedToolCall>();
  private accumulatedContent = '';
  private lastTokenUsage: ParsedChunk['tokenUsage'] = undefined;

  constructor(options: OpenAIChunkParserOptions = {}) {
    this.options = {
      enableTagThinking: options.enableTagThinking ?? true,
      thinkingTag: options.thinkingTag ?? 'think',
    };
  }

  parse(raw: string): ParsedChunk | null {
    const line = raw.trim();
    if (!line || line.startsWith(':')) return null;
    if (!line.startsWith('data: ')) return null;

    const data = line.slice(6);
    if (data === '[DONE]') {
      return { done: true, finishReason: 'stop', tokenUsage: this.lastTokenUsage };
    }

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(data);
    } catch {
      return null;
    }

    if ((json as Record<string, unknown>).usage) {
      const u = json.usage as Record<string, number>;
      this.lastTokenUsage = {
        promptTokens: u.prompt_tokens || 0,
        completionTokens: u.completion_tokens || 0,
        totalTokens: u.total_tokens || 0,
      };
    }

    const choices = json.choices as Array<Record<string, unknown>> | undefined;
    const choice = choices?.[0];
    if (!choice?.delta) return null;

    const delta = choice.delta as Record<string, unknown>;
    const result: ParsedChunk = {};

    // reasoning_content（DeepSeek R1、OpenAI o-series）
    if (delta.reasoning_content) {
      result.thinking = delta.reasoning_content as string;
    }

    // 流式 tool_calls 累积
    const toolCallDeltas = delta.tool_calls as Array<Record<string, unknown>> | undefined;
    if (toolCallDeltas?.length) {
      for (const tc of toolCallDeltas) {
        const idx = (tc.index as number) || 0;
        if (!this.accumulatedToolCalls.has(idx)) {
          this.accumulatedToolCalls.set(idx, { arguments: '' });
        }
        const acc = this.accumulatedToolCalls.get(idx)!;
        const fn = tc.function as Record<string, string> | undefined;
        if (fn?.name) acc.name = fn.name;
        if (fn?.arguments) acc.arguments += fn.arguments;
      }
      return null;
    }

    // finish_reason: tool_calls → 输出完整的工具调用列表
    const finishReason = choice.finish_reason as string | null;
    if (finishReason === 'tool_calls') {
      const calls: ParsedChunk['toolCalls'] = [];
      for (const [, acc] of this.accumulatedToolCalls) {
        if (!acc.name) continue;
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(acc.arguments); } catch { /* 静默 */ }
        calls.push({ name: acc.name, arguments: args });
      }
      this.accumulatedToolCalls.clear();
      return { done: true, finishReason: 'tool_calls', toolCalls: calls, tokenUsage: this.lastTokenUsage };
    }

    // 普通 content
    const content = delta.content as string | undefined;
    if (content) {
      this.accumulatedContent += content;

      if (this.options.enableTagThinking) {
        const extracted = extractTagThinking(this.accumulatedContent, this.options.thinkingTag);
        if (extracted.thinking) {
          result.thinking = extracted.thinking;
        }
        result.content = content;
      } else {
        result.content = content;
      }
    }

    // finish_reason: stop
    if (finishReason === 'stop') {
      result.done = true;
      result.finishReason = 'stop';
      result.tokenUsage = this.lastTokenUsage;
    }

    if (!result.content && !result.thinking && !result.done) return null;
    return result;
  }

  reset(): void {
    this.accumulatedToolCalls.clear();
    this.accumulatedContent = '';
    this.lastTokenUsage = undefined;
  }
}
