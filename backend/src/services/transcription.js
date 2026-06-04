// Speech-to-text for inbound WhatsApp voice notes, via OpenAI Whisper.
//
// Used by the agent engine: when an agent with transcribe_audio=TRUE receives
// an audio message, we download it (mediaDownloader.downloadOne) and run it
// through whisper-1 using the workspace's OpenAI key (from the AI Models
// registry), then feed the resulting text to the LLM like any other message.

const fs = require('fs');
const OpenAI = require('openai');

/**
 * Transcribe a local audio file with OpenAI whisper-1.
 *  - filePath: path returned by mediaDownloader.downloadOne (mp3/ogg/…)
 *  - apiKey:   an OpenAI API key
 * Returns the transcript text, or '' if it couldn't transcribe.
 */
async function transcribeAudioFile({ filePath, apiKey, model = 'whisper-1' }) {
  if (!filePath || !apiKey) return '';
  if (!fs.existsSync(filePath)) return '';
  const client = new OpenAI({ apiKey });
  const res = await client.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model,
  });
  return res && res.text ? String(res.text).trim() : '';
}

module.exports = { transcribeAudioFile };
