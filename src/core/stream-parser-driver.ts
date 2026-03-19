import type { ChunkParser, ParsedChunk, StreamTrace, StreamResult } from './types';

/**
 * 流式解析驱动器。
 * 将 ChunkParser 的解析结果统一映射到 StreamTrace 的生命周期方法，
 * 消除 FetchPlugin / SSEAutoPlugin / WebSocketPlugin 中的重复逻辑。
 */
export class StreamParserDriver {
  private parser: ChunkParser;
  private trace: StreamTrace;
  private isInThinking = false;
  private hasContentStarted = false;
  private ended = false;
  private reportedToolCalls = new Set<string>();

  constructor(parser: ChunkParser, trace: StreamTrace) {
    this.parser = parser;
    this.trace = trace;
    this.parser.reset();
  }

  /**
   * 喂入一行 SSE / JSON 数据，解析后自动驱动 trace。
   * 返回解析结果（供调用方做额外处理），无有效内容时返回 null。
   */
  feed(line: string): ParsedChunk | null {
    if (this.ended) return null;

    const chunk = this.parser.parse(line);
    if (!chunk) return null;

    if (chunk.thinking && !this.isInThinking) {
      this.isInThinking = true;
      this.trace.onPhase('thinking', 'start');
    }
    if (this.isInThinking && chunk.content && !chunk.thinking) {
      this.isInThinking = false;
      this.trace.onPhase('thinking', 'end');
    }

    if (chunk.content && !this.hasContentStarted) {
      this.hasContentStarted = true;
      if (!this.isInThinking) {
        this.trace.onPhase('generating', 'start');
      }
    }

    if (chunk.toolCalls) {
      for (const tc of chunk.toolCalls) {
        const key = `${tc.name}_${JSON.stringify(tc.arguments)}`;
        if (!this.reportedToolCalls.has(key)) {
          this.reportedToolCalls.add(key);
          this.trace.onToolCall(tc.name, tc.arguments);
        }
      }
    }

    if (chunk.done) {
      this.finalize(chunk.tokenUsage);
    }

    return chunk;
  }

  /**
   * 手动结束驱动（流正常关闭但 parser 未产生 done 信号时调用）。
   */
  finalize(tokenUsage?: ParsedChunk['tokenUsage']): void {
    if (this.ended) return;
    this.ended = true;

    if (this.isInThinking) {
      this.trace.onPhase('thinking', 'end');
      this.isInThinking = false;
    }
    if (this.hasContentStarted) {
      this.trace.onPhase('generating', 'end');
    }

    const result: StreamResult = {};
    if (tokenUsage) {
      if (tokenUsage.promptTokens != null) result.promptTokens = tokenUsage.promptTokens;
      if (tokenUsage.completionTokens != null) result.completionTokens = tokenUsage.completionTokens;
      if (tokenUsage.totalTokens != null) result.totalTokens = tokenUsage.totalTokens;
    }
    this.trace.complete(result);
  }

  get isEnded(): boolean {
    return this.ended;
  }
}
