/**
 * XML 标签式 thinking 提取工具。
 * 处理部分 AI 模型在 content 中嵌入 `<think>...</think>` 等标签的场景。
 * 支持流式中间态（标签已打开但尚未关闭 = thinking 进行中）。
 */

export interface TagThinkingResult {
  thinking: string;
  content: string;
  /** thinking 标签是否尚未闭合（流式中间态） */
  isThinking: boolean;
}

/**
 * 从累积文本中提取 thinking 内容。
 * @param text 累积的完整文本
 * @param tagName 标签名，默认 `'think'`（即 `<think>...</think>`）
 */
export function extractTagThinking(text: string, tagName = 'think'): TagThinkingResult {
  const openTag = `<${tagName}>`;
  const closeTag = `</${tagName}>`;
  const regex = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'g');

  const matches = text.match(regex);

  if (matches) {
    const thinking = matches
      .map((m) => m.replace(new RegExp(`</?${tagName}>`, 'g'), '').trim())
      .join('\n\n');
    const content = text.replace(regex, '').trim();
    const isThinking = text.lastIndexOf(openTag) > text.lastIndexOf(closeTag);
    return { thinking, content, isThinking };
  }

  if (text.includes(openTag)) {
    const idx = text.indexOf(openTag);
    const before = text.slice(0, idx).trim();
    const thinkingInProgress = text.slice(idx + openTag.length).trim();
    return {
      thinking: thinkingInProgress || '',
      content: before,
      isThinking: true,
    };
  }

  return { thinking: '', content: text, isThinking: false };
}
