// Anthropic Claude adapter. Tool-use loop matches the official SDK pattern:
// keep calling messages.create with the rolling history while stop_reason ===
// 'tool_use', appending the assistant's tool_use blocks and our tool_result
// blocks each iteration. Bail after maxIterations regardless — runaway tool
// loops are a real cost risk for an open-source app.

const Anthropic = require('@anthropic-ai/sdk');

async function runWithTools({
  systemPrompt,
  messages,        // [{ role:'user'|'assistant', content:string }]
  tools,           // [{ name, description, input_schema }]
  onToolCall,
  onStep,
  model,
  apiKey,
  maxIterations,
}) {
  const client = new Anthropic({ apiKey });

  // Translate our generic messages to Anthropic's format. `content` may be a
  // plain string (text) OR an array of generic parts: { type:'text', text } and
  // { type:'image', mime, data /* base64, no data: prefix */ }.
  const history = messages.map(m => ({
    role: m.role,
    content: toAnthropicContent(m.content),
  }));

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finalText = '';
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations += 1;
    const t0 = Date.now();
    const resp = await client.messages.create({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      tools: tools.length > 0 ? tools : undefined,
      messages: history,
    });
    const latency = Date.now() - t0;

    totalInputTokens += resp.usage?.input_tokens || 0;
    totalOutputTokens += resp.usage?.output_tokens || 0;

    await onStep({
      step_type: 'llm_call',
      status: 'ok',
      latency_ms: latency,
      input: { model, message_count: history.length, tool_count: tools.length },
      output: {
        stop_reason: resp.stop_reason,
        input_tokens: resp.usage?.input_tokens,
        output_tokens: resp.usage?.output_tokens,
      },
    });

    // Append assistant turn (mix of text + tool_use) to history verbatim — the
    // Anthropic API requires the exact tool_use blocks to be echoed back when
    // we attach tool_result.
    history.push({ role: 'assistant', content: resp.content });

    // Accumulate any text the model emitted this turn. The model may emit text
    // alongside a tool_use (a thinking aloud preamble); we want the final
    // user-facing answer, which is the text from the turn where stop_reason ===
    // 'end_turn'. But we also keep the last-seen text as a fallback for capped
    // runs.
    const textBlocks = (resp.content || []).filter(b => b.type === 'text').map(b => b.text);
    if (textBlocks.length > 0) finalText = textBlocks.join('\n').trim();

    if (resp.stop_reason !== 'tool_use') {
      return { finalText, totalInputTokens, totalOutputTokens, iterations };
    }

    // Run every tool_use block the model requested THIS turn (parallel tool use)
    const toolUses = (resp.content || []).filter(b => b.type === 'tool_use');
    const toolResults = [];
    for (const tu of toolUses) {
      const tt0 = Date.now();
      let resultText;
      let stepStatus = 'ok';
      let stepError = null;
      try {
        const r = await onToolCall({ name: tu.name, args: tu.input || {} });
        resultText = typeof r === 'string' ? r : JSON.stringify(r);
      } catch (err) {
        stepStatus = 'error';
        stepError = err.message;
        resultText = `Error: ${err.message}`;
      }
      await onStep({
        step_type: 'tool_call',
        tool_type: tu.name,
        status: stepStatus,
        latency_ms: Date.now() - tt0,
        input: tu.input || {},
        output: stepStatus === 'ok' ? safeParse(resultText) : null,
        error_message: stepError,
      });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: resultText,
        is_error: stepStatus === 'error',
      });
    }

    history.push({ role: 'user', content: toolResults });
  }

  return { finalText, totalInputTokens, totalOutputTokens, iterations, capped: true };
}

// Generic content → Anthropic content blocks. A bare string becomes one text
// block; an array of {type:'text'|'image'} parts is mapped block-by-block.
function toAnthropicContent(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (Array.isArray(content)) {
    return content.map(part => {
      if (part?.type === 'image' && part.data) {
        return { type: 'image', source: { type: 'base64', media_type: part.mime || 'image/jpeg', data: part.data } };
      }
      return { type: 'text', text: String(part?.text ?? '') };
    });
  }
  return [{ type: 'text', text: String(content ?? '') }];
}

function safeParse(s) {
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return { text: s.slice(0, 500) }; }
}

module.exports = { runWithTools };
