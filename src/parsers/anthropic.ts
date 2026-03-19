/**
 * Anthropic (Claude) 事件流解析器。
 * Claude 使用 `event:` + `data:` 双行 SSE 格式，结构与 OpenAI 完全不同。
 *
 * 事件类型映射：
 * - message_start → 提取 model
 * - content_block_start + type:"thinking" → thinking 阶段开始
 * - thinking_delta → thinking 内容增量
 * - content_block_start + type:"text" → generating 阶段开始
 * - text_delta → 正文内容增量
 * - content_block_start + type:"tool_use" → 工具调用
 * - input_json_delta → 工具参数增量
 * - message_delta + stop_reason → 完成
 */

import type { ChunkParser, ParsedChunk } from '../core/types';

interface ToolCallAccumulator {
  name: string;
  inputJson: string;
}

export class AnthropicChunkParser implements ChunkParser {
  private currentEvent = '';
  private currentBlockType = '';
  private currentBlockIndex = -1;
  private toolCalls = new Map<number, ToolCallAccumulator>();

  parse(raw: string): ParsedChunk | null {
    const line = raw.trim();

    // SSE 注释或空行
    if (!line || line.startsWith(':')) return null;

    // event: 行只记录类型，等待下一行 data:
    if (line.startsWith('event: ')) {
      this.currentEvent = line.slice(7).trim();
      return null;
    }

    if (!line.startsWith('data: ')) return null;

    const dataStr = line.slice(6);
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(dataStr);
    } catch {
      return null;
    }

    const event = this.currentEvent;
    this.currentEvent = '';

    switch (event) {
      case 'message_start':
        return null;

      case 'content_block_start': {
        const block = data.content_block as Record<string, unknown> | undefined;
        this.currentBlockType = (block?.type as string) || '';
        this.currentBlockIndex = (data.index as number) ?? -1;

        if (this.currentBlockType === 'tool_use') {
          this.toolCalls.set(this.currentBlockIndex, {
            name: (block?.name as string) || 'unknown',
            inputJson: '',
          });
        }
        return null;
      }

      case 'content_block_delta': {
        const delta = data.delta as Record<string, unknown> | undefined;
        if (!delta) return null;

        const deltaType = delta.type as string;

        if (deltaType === 'thinking_delta') {
          return { thinking: delta.thinking as string };
        }

        if (deltaType === 'text_delta') {
          return { content: delta.text as string };
        }

        if (deltaType === 'input_json_delta') {
          const acc = this.toolCalls.get(this.currentBlockIndex);
          if (acc) {
            acc.inputJson += (delta.partial_json as string) || '';
          }
          return null;
        }

        return null;
      }

      case 'content_block_stop':
        return null;

      case 'message_delta': {
        const delta = data.delta as Record<string, unknown> | undefined;
        const stopReason = delta?.stop_reason as string | undefined;
        const usage = data.usage as Record<string, number> | undefined;

        const result: ParsedChunk = { done: true };

        if (stopReason === 'tool_use' && this.toolCalls.size > 0) {
          result.finishReason = 'tool_calls';
          result.toolCalls = [];
          for (const [, tc] of this.toolCalls) {
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(tc.inputJson); } catch { /* 静默 */ }
            result.toolCalls.push({ name: tc.name, arguments: args });
          }
        } else {
          result.finishReason = 'stop';
        }

        if (usage) {
          result.tokenUsage = {
            promptTokens: usage.input_tokens || 0,
            completionTokens: usage.output_tokens || 0,
            totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
          };
        }

        return result;
      }

      case 'message_stop':
        return null;

      case 'ping':
        return null;

      default:
        return null;
    }
  }

  reset(): void {
    this.currentEvent = '';
    this.currentBlockType = '';
    this.currentBlockIndex = -1;
    this.toolCalls.clear();
  }
}
