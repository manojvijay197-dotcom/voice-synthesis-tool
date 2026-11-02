const script = document.querySelector('#script');
const count = document.querySelector('#count');
const generate = document.querySelector('#generate');
const empty = document.querySelector('#emptyState');
const result = document.querySelector('#result');
const audio = document.querySelector('#audio');
const toast = document.querySelector('#toast');
const modelStatus = document.querySelector('#modelStatus');
const statusDot = document.querySelector('#statusDot');
const voiceSelect = document.querySelector('#voice');
const previewButton = document.querySelector('#previewVoice');
const fileName = document.querySelector('#fileName');
const download = document.querySelector('#download');
let audioUrl = null;
let toastTimer;
let fileNameEdited = false;
const voiceLabels = {
  af_heart:'Heart', af_bella:'Bella', af_nova:'Nova', af_sarah:'Sarah', am_michael:'Michael',
  am_fenrir:'Fenrir', am_adam:'Adam', bf_emma:'Emma', bf_isabella:'Isabella', bm_george:'George', bm_fable:'Fable'
};
const styleLabels = { natural:'Natural', expressive:'Expressive', calm:'Calm & measured', formal:'Formal & measured' };

script.addEventListener('input', () => count.textContent = `${script.value.length.toLocaleString()} / 50,000`);
document.querySelector('#clearText').onclick = () => { script.value=''; script.dispatchEvent(new Event('input')); script.focus(); };
document.querySelector('#sampleText').onclick = () => {
  script.value = 'Good morning, and welcome.\n\nTake a moment to settle in. Today is a fresh start — full of possibility, new ideas, and small moments worth noticing.\n\nLet’s make it a good one.';
  script.dispatchEvent(new Event('input')); script.focus();
};

const previews = new Map();
let previewPlayer = null;
function getPreview(voice) {
  if (!previews.has(voice)) {
    const clip = new Audio(new URL(`../previews/${voice}.mp3`, import.meta.url));
    clip.preload = 'auto';
    clip.onended = stopPreview;
    previews.set(voice, clip);
  }
  return previews.get(voice);
}
function stopPreview() {
  if (previewPlayer) { previewPlayer.pause(); previewPlayer.currentTime = 0; previewPlayer = null; }
  previewButton.classList.remove('playing');
  previewButton.title = 'Preview selected voice';
}
async function playPreview() {
  stopPreview();
  const clip = getPreview(voiceSelect.value);
  previewPlayer = clip;
  previewButton.classList.add('playing');
  previewButton.title = 'Stop preview';
  try { await clip.play(); }
  catch (error) {
    if (previewPlayer !== clip) return;
    stopPreview();
    if (error.name !== 'AbortError') showToast('Could not play this voice preview.');
  }
}
previewButton.onclick = () => previewButton.classList.contains('playing') ? stopPreview() : playPreview();
voiceSelect.addEventListener('change', () => { if (previewPlayer) playPreview(); });
for (const option of voiceSelect.options) getPreview(option.value);

const worker = new Worker(new URL('./tts-worker.js', import.meta.url), { type: 'module' });
let engineState = 'idle';
let pendingJob = null;
function setStatus(text, color) { modelStatus.textContent = text; statusDot.style.background = color; }
function warmUpEngine() {
  if (engineState === 'loading' || engineState === 'ready') return;
  engineState = 'loading';
  setStatus('Loading voice engine…', '#e1a935');
  worker.postMessage({ type: 'load' });
}
worker.onmessage = ({ data }) => {
  if (data.type === 'download') setStatus(`Downloading voice model… ${data.progress}%`, '#e1a935');
  else if (data.type === 'ready') { engineState = 'ready'; setStatus('Voice engine ready', '#50b780'); }
  else if (data.type === 'progress') pendingJob?.onProgress(data.part, data.total);
  else if (data.type === 'encoding') pendingJob?.onEncoding();
  else if (data.type === 'done') { engineState = 'ready'; setStatus('Voice engine ready', '#50b780'); pendingJob?.resolve(data); pendingJob = null; }
  else if (data.type === 'error') {
    engineState = 'error';
    setStatus('Voice engine not loaded', '#d67663');
    const offline = /fetch|network|load|import/i.test(data.message);
    const message = offline ? 'Could not download the voice model. Check your internet connection, then try again.' : 'Could not generate speech. Please try again.';
    if (pendingJob) { pendingJob.reject(new Error(message)); pendingJob = null; }
  }
};
worker.onerror = () => {
  engineState = 'error';
  setStatus('Voice engine not loaded', '#d67663');
  if (pendingJob) { pendingJob.reject(new Error('The voice engine stopped unexpectedly. Reload the page and try again.')); pendingJob = null; }
};
if ('requestIdleCallback' in window) requestIdleCallback(warmUpEngine, { timeout: 2000 });
else setTimeout(warmUpEngine, 800);

const styleSettings = {
  natural:    { speed: 1,    sentencePause: 0.18, paragraphPause: 0.6, perSentence: false },
  expressive: { speed: 1.1,  sentencePause: 0.1,  paragraphPause: 0.45, perSentence: false },
  calm:       { speed: 0.86, sentencePause: 0.4,  paragraphPause: 0.9, perSentence: true },
  formal:     { speed: 0.93, sentencePause: 0.5,  paragraphPause: 1.1, perSentence: true }
};
function getSettings() {
  const settings = { ...styleSettings[document.querySelector('#style').value] || styleSettings.natural };
  const pacing = document.querySelector('#pacing').value;
  const factor = pacing === 'slow' ? 0.85 : pacing === 'fast' ? 1.15 : 1;
  settings.speed = Math.min(1.3, Math.max(0.7, settings.speed * factor));
  settings.sentencePause /= factor;
  settings.paragraphPause /= factor;
  return settings;
}
function splitText(text, settings, maxLength = 400) {
  const chunks = [];
  const paragraphs = text.trim().replace(/\r/g, '').split(/\n\s*\n/);
  for (const paragraph of paragraphs) {
    const sentences = [];
    for (let line of paragraph.split('\n')) {
      line = line.trim();
      if (!line) continue;
      if (!/[.!?:;,…”’"]$/.test(line)) line += '.';
      sentences.push(...(line.match(/[^.!?…]+(?:[.!?…]+[”’"]*)?/g) || [line]));
    }
    let chunk = '';
    const flush = () => { if (chunk) { chunks.push({ text: chunk, pause: settings.sentencePause }); chunk = ''; } };
    for (let sentence of sentences) {
      sentence = sentence.trim();
      if (!sentence) continue;
      if (sentence.length > maxLength) {
        flush();
        for (let i = 0; i < sentence.length; i += maxLength) chunks.push({ text: sentence.slice(i, i + maxLength), pause: 0.08 });
      } else if (settings.perSentence || (chunk + ' ' + sentence).length > maxLength) {
        flush(); chunk = sentence;
      } else chunk = (chunk + ' ' + sentence).trim();
    }
    flush();
    if (chunks.length) chunks.at(-1).pause = settings.paragraphPause;
  }
  return chunks;
}
function synthesize(text, voice, onProgress, onEncoding) {
  const settings = getSettings();
  return new Promise((resolve, reject) => {
    pendingJob = { resolve, reject, onProgress, onEncoding };
    if (engineState !== 'ready') { engineState = 'loading'; setStatus('Loading voice engine…', '#e1a935'); }
    worker.postMessage({ type: 'generate', id: Date.now(), chunks: splitText(text, settings), voice, speed: settings.speed });
  });
}

function cleanFileName(value) {
  return value.replace(/\.mp3$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}
function suggestFileName(text) {
  const words = text.split(/\s+/).slice(0, 6).join(' ').replace(/[^\p{L}\p{N} -]+/gu, '').trim().toLowerCase().replace(/\s+/g, '-');
  return words || `voice-synthesis-${new Date().toISOString().slice(0, 10)}`;
}
function updateDownloadName() {
  download.download = `${cleanFileName(fileName.value) || fileName.placeholder}.mp3`;
}
fileName.addEventListener('input', () => { fileNameEdited = true; updateDownloadName(); });
fileName.addEventListener('keydown', event => { if (event.key === 'Enter') download.click(); });

generate.onclick = async () => {
  const text = script.value.trim();
  if (!text) { script.focus(); showToast('Add some text to your script first.'); return; }
  stopPreview();
  generate.disabled = true;
  const tag = document.querySelector('#outputTag');
  const label = generate.querySelector('span');
  tag.textContent = engineState === 'ready' ? 'GENERATING' : 'LOADING MODEL';
  label.textContent = engineState === 'ready' ? 'Creating your audio…' : 'Loading voice engine…';
  const voice = voiceSelect.value;
  try {
    const { blob, seconds } = await synthesize(text, voice, (part, total) => {
      tag.textContent = `GENERATING ${part}/${total}`;
      label.textContent = total > 1 ? `Creating speech · ${part} of ${total}` : 'Creating your audio…';
    }, () => { label.textContent = 'Encoding MP3…'; });
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(blob);
    audio.src = audioUrl;
    download.href = audioUrl;
    fileName.placeholder = suggestFileName(text);
    if (!fileNameEdited) fileName.value = fileName.placeholder;
    updateDownloadName();
    document.querySelector('#resultVoice').textContent = `${voiceLabels[voice]} · ${styleLabels[document.querySelector('#style').value]}`;
    document.querySelector('#fileSize').textContent = blob.size < 1024*1024 ? `${Math.max(1,Math.round(blob.size/1024))} KB` : `${(blob.size/1024/1024).toFixed(1)} MB`;
    const secs = Math.max(1, Math.round(seconds));
    document.querySelector('#duration').textContent = secs < 60 ? `${secs} sec` : `${Math.floor(secs / 60)} min ${secs % 60} sec`;
    empty.style.display = 'none'; result.classList.add('visible'); tag.textContent = 'MP3 · READY';
  } catch (error) {
    showToast(error.message || 'Could not generate speech. Please try again.');
    tag.textContent = 'READY WHEN YOU ARE';
  } finally {
    generate.disabled = false; label.textContent = 'Generate speech';
  }
};
function showToast(message) { toast.textContent=message; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>toast.classList.remove('show'),5000); }
