// OpenAI adapter. Same shape as the Anthropic adapter (see ./index.js for the
// contract). We translate the generic tool schema to OpenAI's
// `tools=[{type:'function', function:{...}}]` format and loop on
// finish_reason === 'tool_calls' until the model stops requesting tools.

const OpenAI = require('openai');

function toOpenAITools(tools) {
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema || { type: 'object', properties: {} },
    },
  }));
}

async function runWithTools({
  systemPrompt,
  messages,
  tools,
  onToolCall,
  onStep,
  model,
  apiKey,
  maxIterations,
}) {
  const client = new OpenAI({ apiKey });
  const oaiTools = toOpenAITools(tools);

  const history = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({ role: m.role, content: toOpenAIContent(m.content) })),
  ];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finalText = '';
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations += 1;
    const t0 = Date.now();
    const resp = await client.chat.completions.create({
      model,
      messages: history,
      tools: oaiTools.length > 0 ? oaiTools : undefined,
      max_tokens: 1024,
    });
    const latency = Date.now() - t0;

    totalInputTokens += resp.usage?.prompt_tokens || 0;
    totalOutputTokens += resp.usage?.completion_tokens || 0;

    const choice = resp.choices?.[0];
    const msg = choice?.message;
    const finishReason = choice?.finish_reason;

    await onStep({
      step_type: 'llm_call',
      status: 'ok',
      latency_ms: latency,
      input: { model, message_count: history.length, tool_count: oaiTools.length },
      output: {
        finish_reason: finishReason,
        prompt_tokens: resp.usage?.prompt_tokens,
        completion_tokens: resp.usage?.completion_tokens,
      },
    });

    if (msg?.content) finalText = msg.content.trim();

    // Always push the assistant turn — OpenAI requires the tool_calls echo when
    // we attach the matching tool messages below.
    history.push(msg);

    const toolCalls = msg?.tool_calls || [];
    if (finishReason !== 'tool_calls' || toolCalls.length === 0) {
      return { finalText, totalInputTokens, totalOutputTokens, iterations };
    }

    for (const tc of toolCalls) {
      const name = tc.function?.name;
      let args = {};
      try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { /* leave empty */ }
      const tt0 = Date.now();
      let resultText;
      let stepStatus = 'ok';
      let stepError = null;
      try {
        const r = await onToolCall({ name, args });
        resultText = typeof r === 'string' ? r : JSON.stringify(r);
      } catch (err) {
        stepStatus = 'error';
        stepError = err.message;
        resultText = `Error: ${err.message}`;
      }
      await onStep({
        step_type: 'tool_call',
        tool_type: name,
        status: stepStatus,
        latency_ms: Date.now() - tt0,
        input: args,
        output: stepStatus === 'ok' ? safeParse(resultText) : null,
        error_message: stepError,
      });
      history.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: resultText,
      });
    }
  }

  return { finalText, totalInputTokens, totalOutputTokens, iterations, capped: true };
}

// Generic content → OpenAI content. A bare string passes through unchanged; an
// array of {type:'text'|'image'} parts becomes OpenAI's multimodal parts
// ({type:'text'} / {type:'image_url', image_url:{url:'data:<mime>;base64,...'}}).
function toOpenAIContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (part?.type === 'image' && part.data) {
        return { type: 'image_url', image_url: { url: `data:${part.mime || 'image/jpeg'};base64,${part.data}` } };
      }
      return { type: 'text', text: String(part?.text ?? '') };
    });
  }
  return String(content ?? '');
}

function safeParse(s) {
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return { text: s.slice(0, 500) }; }
}

module.exports = { runWithTools };
