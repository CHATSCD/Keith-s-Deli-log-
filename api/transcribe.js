// Vercel serverless function: proxies audio to OpenAI's Whisper API.
// Keeps OPENAI_API_KEY server-side only (set it in the Vercel project's
// Environment Variables — never commit it to the repo).
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server is missing OPENAI_API_KEY.' });
    return;
  }

  try {
    const { audio, mimeType } = req.body || {};
    if (!audio) {
      res.status(400).json({ error: 'Missing audio data.' });
      return;
    }

    const buffer = Buffer.from(audio, 'base64');
    const type = mimeType || 'audio/webm';
    const ext = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm';

    const form = new FormData();
    form.append('file', new Blob([buffer], { type }), `audio.${ext}`);
    form.append('model', 'whisper-1');

    const openaiRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form
    });

    const data = await openaiRes.json();
    if (!openaiRes.ok) {
      res.status(openaiRes.status).json({ error: data.error?.message || 'Transcription failed.' });
      return;
    }

    res.status(200).json({ text: data.text || '' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unexpected server error.' });
  }
}
