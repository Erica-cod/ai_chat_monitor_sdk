import { describe, it, expect, beforeEach } from 'vitest';
import { OpenAIChunkParser } from './openai';

describe('OpenAIChunkParser', () => {
  let parser: OpenAIChunkParser;

  beforeEach(() => {
    parser = new OpenAIChunkParser();
  });

  it('忽略空行和注释行', () => {
    expect(parser.parse('')).toBeNull();
    expect(parser.parse(': comment')).toBeNull();
    expect(parser.parse('   ')).toBeNull();
  });

  it('解析 [DONE] 信号', () => {
    const result = parser.parse('data: [DONE]');
    expect(result?.done).toBe(true);
    expect(result?.finishReason).toBe('stop');
  });

  it('解析普通 content delta', () => {
    const line = 'data: {"choices":[{"delta":{"content":"Hello"},"index":0}]}';
    const result = parser.parse(line);
    expect(result?.content).toBe('Hello');
  });

  it('解析 reasoning_content（thinking）', () => {
    const line = 'data: {"choices":[{"delta":{"reasoning_content":"Let me think..."},"index":0}]}';
    const result = parser.parse(line);
    expect(result?.thinking).toBe('Let me think...');
  });

  it('解析 finish_reason: stop', () => {
    const line = 'data: {"choices":[{"delta":{},"finish_reason":"stop","index":0}]}';
    const result = parser.parse(line);
    expect(result?.done).toBe(true);
    expect(result?.finishReason).toBe('stop');
  });

  it('累积 tool_calls 并在 finish_reason: tool_calls 时输出', () => {
    parser.parse('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"search","arguments":"{\\"q\\""}}]},"index":0}]}');
    parser.parse('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":": \\"hello\\"}"}}]},"index":0}]}');
    const result = parser.parse('data: {"choices":[{"delta":{},"finish_reason":"tool_calls","index":0}]}');
    expect(result?.done).toBe(true);
    expect(result?.finishReason).toBe('tool_calls');
    expect(result?.toolCalls?.[0]?.name).toBe('search');
  });

  it('提取 usage 字段', () => {
    parser.parse('data: {"choices":[{"delta":{"content":"Hi"},"index":0}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}');
    const result = parser.parse('data: [DONE]');
    expect(result?.tokenUsage?.promptTokens).toBe(10);
    expect(result?.tokenUsage?.completionTokens).toBe(5);
    expect(result?.tokenUsage?.totalTokens).toBe(15);
  });

  it('reset() 清空累积状态', () => {
    parser.parse('data: {"choices":[{"delta":{"content":"Hi"},"index":0}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}');
    parser.reset();
    const result = parser.parse('data: [DONE]');
    expect(result?.tokenUsage).toBeUndefined();
  });
});
