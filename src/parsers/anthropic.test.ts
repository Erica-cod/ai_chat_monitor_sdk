import { describe, it, expect, beforeEach } from 'vitest';
import { AnthropicChunkParser } from './anthropic';

describe('AnthropicChunkParser', () => {
  let parser: AnthropicChunkParser;

  beforeEach(() => {
    parser = new AnthropicChunkParser();
  });

  it('忽略空行和注释行', () => {
    expect(parser.parse('')).toBeNull();
    expect(parser.parse(': comment')).toBeNull();
  });

  it('event 行只记录类型、不产生结果', () => {
    expect(parser.parse('event: content_block_delta')).toBeNull();
  });

  it('解析 text_delta', () => {
    parser.parse('event: content_block_delta');
    const result = parser.parse('data: {"delta":{"type":"text_delta","text":"Hello"}}');
    expect(result?.content).toBe('Hello');
  });

  it('解析 thinking_delta', () => {
    parser.parse('event: content_block_delta');
    const result = parser.parse('data: {"delta":{"type":"thinking_delta","thinking":"Hmm..."}}');
    expect(result?.thinking).toBe('Hmm...');
  });

  it('解析 message_delta 完成信号（stop）', () => {
    parser.parse('event: message_delta');
    const result = parser.parse('data: {"delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":10,"output_tokens":20}}');
    expect(result?.done).toBe(true);
    expect(result?.finishReason).toBe('stop');
    expect(result?.tokenUsage?.promptTokens).toBe(10);
    expect(result?.tokenUsage?.completionTokens).toBe(20);
  });

  it('解析 tool_use 完成信号', () => {
    parser.parse('event: content_block_start');
    parser.parse('data: {"content_block":{"type":"tool_use","name":"search"},"index":0}');
    parser.parse('event: content_block_delta');
    parser.parse('data: {"delta":{"type":"input_json_delta","partial_json":"{\\"q\\": \\"hello\\"}"}}');
    parser.parse('event: message_delta');
    const result = parser.parse('data: {"delta":{"stop_reason":"tool_use"},"usage":{"input_tokens":5,"output_tokens":10}}');
    expect(result?.done).toBe(true);
    expect(result?.finishReason).toBe('tool_calls');
    expect(result?.toolCalls?.[0]?.name).toBe('search');
  });

  it('reset() 清空累积状态', () => {
    parser.parse('event: content_block_start');
    parser.parse('data: {"content_block":{"type":"tool_use","name":"search"},"index":0}');
    parser.reset();
    parser.parse('event: message_delta');
    const result = parser.parse('data: {"delta":{"stop_reason":"end_turn"},"usage":{}}');
    expect(result?.finishReason).toBe('stop');
    expect(result?.toolCalls).toBeUndefined();
  });
});
