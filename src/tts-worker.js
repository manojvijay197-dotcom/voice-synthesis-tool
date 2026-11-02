const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const SAMPLE_RATE = 24000;
let enginePromise = null;
let Mp3Encoder;

function loadEngine() {
  enginePromise ||= (async () => {
    const [kokoro, lame] = await Promise.all([
      import('https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js'),
      import('https://cdn.jsdelivr.net/npm/@breezystack/lamejs@1.2.7/+esm')
    ]);
    Mp3Encoder = lame.Mp3Encoder;
    return kokoro.KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: info => {
        if (info.status === 'progress' && info.file?.endsWith('.onnx')) postMessage({ type: 'download', progress: Math.round(info.progress) });
      }
    });
  })().catch(error => { enginePromise = null; throw error; });
  return enginePromise;
}

function encodeMp3(samples) {
  const encoder = new Mp3Encoder(1, SAMPLE_RATE, 128);
  const data = [];
  for (let i = 0; i < samples.length; i += 1152) {
    const end = Math.min(i + 1152, samples.length);
    const pcm = new Int16Array(end - i);
    for (let j = i; j < end; j++) pcm[j - i] = Math.max(-32768, Math.min(32767, Math.round(samples[j] * 32767)));
    const encoded = encoder.encodeBuffer(pcm);
    if (encoded.length) data.push(new Int8Array(encoded));
  }
  const tail = encoder.flush();
  if (tail.length) data.push(new Int8Array(tail));
  return new Blob(data, { type: 'audio/mpeg' });
}

async function generate({ chunks, voice, speed }) {
  const engine = await loadEngine();
  const parts = [];
  let total = 0;
  for (let i = 0; i < chunks.length; i++) {
    postMessage({ type: 'progress', part: i + 1, total: chunks.length });
    const { audio } = await engine.generate(chunks[i].text, { voice, speed });
    parts.push(audio); total += audio.length;
    if (i < chunks.length - 1) {
      const pause = new Float32Array(Math.round(SAMPLE_RATE * chunks[i].pause));
      parts.push(pause); total += pause.length;
    }
  }
  const merged = new Float32Array(total);
  let offset = 0;
  for (const part of parts) { merged.set(part, offset); offset += part.length; }
  postMessage({ type: 'encoding' });
  return { blob: encodeMp3(merged), seconds: total / SAMPLE_RATE };
}

onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      await loadEngine();
      postMessage({ type: 'ready' });
    } else if (data.type === 'generate') {
      const result = await generate(data);
      postMessage({ type: 'done', id: data.id, ...result });
    }
  } catch (error) {
    postMessage({ type: 'error', id: data.id, stage: data.type, message: String(error?.message || error) });
  }
};
