// ---------------------------------------------------------------- video editor (runs in the browser)
// Poppins/Inter for Latin; Noto fonts cover Korean, Japanese, Chinese, Thai, Arabic, Hindi
const FONT = '"Poppins","Inter","Noto Sans KR","Noto Sans JP","Noto Sans SC","Noto Sans Thai","Noto Sans Arabic","Noto Sans Devanagari",system-ui,-apple-system,"Segoe UI",sans-serif';
const FPS = 30;
const SR = 48000;

// ---- background music, synthesized (no files, no API)
function noiseBuffer(ctx, seconds, color = "brown") {
  const b = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (color === "brown") {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w * 0.3;
  }
  return b;
}
async function synthMusic(style, seconds) {
  if (!style || style === "none") return null;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
  const out = ctx.createGain();
  out.connect(ctx.destination);
  const tone = (f, gain, { lfo = 0, depth = 0, type = "sine" } = {}) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.value = gain;
    if (lfo) {
      const l = ctx.createOscillator();
      l.frequency.value = lfo;
      const lg = ctx.createGain();
      lg.gain.value = gain * depth;
      l.connect(lg).connect(g.gain);
      l.start();
    }
    o.connect(g).connect(out);
    o.start();
  };
  const noise = (gain, cutoff, color) => {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuffer(ctx, seconds, color);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.value = gain;
    s.connect(f).connect(g).connect(out);
    s.start();
  };
  switch (style) {
    case "upbeat-pulse":
      tone(110, 0.5, { lfo: 2, depth: 1 });
      tone(220, 0.1);
      tone(277.18, 0.08);
      tone(329.63, 0.07, { lfo: 4, depth: 0.6 });
      break;
    case "tense-pulse":
      tone(48, 0.6, { lfo: 1.6, depth: 0.9 });
      noise(0.1, 900, "pink");
      break;
    case "dark-drone":
      noise(0.5, 180, "brown");
      tone(55, 0.4, { lfo: 0.15, depth: 0.6 });
      break;
    case "eerie-tone":
      tone(220, 0.1, { lfo: 0.4, depth: 0.4 });
      tone(233, 0.08);
      noise(0.3, 250, "brown");
      break;
    default: // chill-pad
      tone(130.81, 0.2, { lfo: 0.12, depth: 0.3 });
      tone(164.81, 0.15);
      tone(196, 0.13);
      tone(261.63, 0.06, { lfo: 0.2, depth: 0.5 });
  }
  // fades
  out.gain.setValueAtTime(0, 0);
  out.gain.linearRampToValueAtTime(1, 1.5);
  out.gain.setValueAtTime(1, Math.max(1.6, seconds - 2));
  out.gain.linearRampToValueAtTime(0, seconds);
  const buf = await ctx.startRendering();
  // normalize loudness so every style sits at the same level
  let sum = 0;
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i += 7) sum += d[i] * d[i];
  const rms = Math.sqrt(sum / (d.length / 7)) || 1;
  const k = 0.1 / rms;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < ch.length; i++) ch[i] = clamp(ch[i] * k, -0.95, 0.95);
  }
  return buf;
}

async function decodeAudio(blob) {
  const ctx = new OfflineAudioContext(2, 1, SR);
  return ctx.decodeAudioData(await blob.arrayBuffer());
}

/** Mix voice + music into one stereo buffer of the final length. */
async function mixAudio(voiceBuf, musicStyle, total) {
  const ctx = new OfflineAudioContext(2, Math.ceil(total * SR), SR);
  if (voiceBuf) {
    const s = ctx.createBufferSource();
    s.buffer = voiceBuf;
    s.connect(ctx.destination);
    s.start(0);
  }
  const music = await synthMusic(musicStyle, total);
  if (music) {
    const s = ctx.createBufferSource();
    s.buffer = music;
    const g = ctx.createGain();
    g.gain.value = voiceBuf ? 0.3 : 0.9; // louder when there's no narration
    s.connect(g).connect(ctx.destination);
    s.start(0);
  }
  return ctx.startRendering();
}

// ---- captions
const CAPTION_STYLES = {
  "bold-yellow": { size: 104, fill: "#ffffff", hi: "#ffe500", stroke: 14, upper: true },
  "clean-white": { size: 88, fill: "#ffffff", hi: "#fff0c8", stroke: 9, upper: false, shadow: true },
  "red-highlight": { size: 100, fill: "#ffffff", hi: "#e61e1e", stroke: 13, upper: true },
  glitch: { size: 96, fill: "#ffffff", hi: "#00ffff", stroke: 6, upper: true, glitch: true },
};
// wide scripts (CJK, Hangul) take about two Latin letters of room per character
const visualWidth = (s) => [...s].reduce((n, ch) => n + (/[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(ch) ? 2 : 1), 0);
function chunkWords(words) {
  const chunks = [];
  let cur = [];
  for (const w of words) {
    // start a new caption if this piece wouldn't fit next to the others
    if (cur.length && visualWidth(cur.map((c) => c.word).join(" ") + " " + w.word) > 18) {
      chunks.push(cur);
      cur = [];
    }
    cur.push(w);
    if (cur.length >= 3 || visualWidth(cur.map((c) => c.word).join(" ")) >= 16 || /[.!?,;:—。！？，、]$/.test(w.word)) {
      chunks.push(cur);
      cur = [];
    }
  }
  if (cur.length) chunks.push(cur);
  return chunks.map((c, i) => ({ words: c, start: c[0].start, end: chunks[i + 1]?.[0]?.start ?? c[c.length - 1].end + 0.3 }));
}
function drawCaption(g, chunks, t, style, bigText) {
  const s = CAPTION_STYLES[style === "horror-red" ? "red-highlight" : style] || CAPTION_STYLES["bold-yellow"];
  const ch = chunks.find((c) => t >= c.start && t < c.end);
  if (!ch) return;
  const words = ch.words.map((w) => (s.upper ? w.word.toUpperCase() : w.word));
  const glue = ch.words.map((w) => !!w.glue);
  const rtl = /[\u0590-\u08ff]/.test(words.join(""));
  const active = ch.words.findIndex((w, i) => t >= w.start && t < (ch.words[i + 1]?.start ?? ch.end));
  let size = bigText ? s.size * 1.25 : s.size;
  g.font = `800 ${size}px ${FONT}`;
  const full = words.map((w, i) => w + (glue[i] ? "" : " ")).join("").trim();
  const maxW = W - 160;
  while (g.measureText(full).width > maxW && size > 48) {
    size -= 4;
    g.font = `800 ${size}px ${FONT}`;
  }
  const pop = clamp((t - ch.start) / 0.08, 0, 1);
  const scale = 0.88 + 0.12 * pop;
  const y = bigText ? H * 0.5 : H * 0.68;
  g.save();
  g.translate(W / 2, y);
  g.scale(scale, scale);
  g.textBaseline = "middle";
  g.lineJoin = "round";
  const space = g.measureText(" ").width;
  const widths = words.map((w) => g.measureText(w).width);
  const gaps = words.map((_, i) => (i < words.length - 1 && !glue[i] ? space : 0));
  let x = -(widths.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0)) / 2;
  // right-to-left scripts (Arabic): lay words out from the right
  const order = rtl ? words.map((_, i) => words.length - 1 - i) : words.map((_, i) => i);
  order.forEach((i) => {
    const w = words[i];
    g.textAlign = "left";
    if (s.glitch) {
      g.fillStyle = "rgba(255,0,60,0.7)";
      g.fillText(w, x - 5, 3);
      g.fillStyle = "rgba(0,255,255,0.7)";
      g.fillText(w, x + 5, -3);
    }
    if (s.shadow) {
      g.fillStyle = "rgba(0,0,0,0.55)";
      g.fillText(w, x + 4, 6);
    }
    g.lineWidth = s.stroke;
    g.strokeStyle = "#000";
    g.strokeText(w, x, 0);
    g.fillStyle = i === active ? s.hi : s.fill;
    g.fillText(w, x, 0);
    x += widths[i] + (rtl ? (i > 0 && !glue[i - 1] ? space : 0) : gaps[i]);
  });
  g.restore();
}

// ---- frames
function drawCover(g, img, k, p) {
  // slow Ken Burns: zoom 1.0→1.1, pan direction alternates per scene
  const base = Math.max(W / img.width, H / img.height);
  const z = base * (1.04 + 0.08 * (k % 2 ? 1 - p : p));
  const w = img.width * z, h = img.height * z;
  const dx = (W - w) * (k % 2 ? p : 1 - p);
  const dy = (H - h) * (k % 3 === 0 ? p : 0.5);
  g.drawImage(img, dx, dy, w, h);
}

/**
 * Render the final MP4. WebCodecs (fast, offline-speed) with H.264 + AAC/Opus.
 * Falls back to real-time MediaRecorder if WebCodecs isn't available.
 */
async function renderVideo({ images, weights, words, captionStyle, voiceBlob, duration, musicStyle, onProgress }) {
  // load the font pieces needed for this text (Google Fonts serves only the characters used)
  const sampleText = (words || []).map((w) => w.word).join("").slice(0, 400) || "Aa";
  await document.fonts.load(`800 100px ${FONT}`, sampleText).catch(() => {});
  const bitmaps = await Promise.all(images.map((b) => createImageBitmap(b)));
  const voiceBuf = voiceBlob ? await decodeAudio(voiceBlob) : null;
  const speech = voiceBuf ? voiceBuf.duration : duration;
  const total = speech + 0.8;
  const wsum = weights.reduce((a, b) => a + b, 0) || 1;
  const durs = weights.map((w) => Math.max(0.8, (w / wsum) * speech));
  durs[durs.length - 1] += total - durs.reduce((a, b) => a + b, 0);
  const starts = durs.map((_, i) => durs.slice(0, i).reduce((a, b) => a + b, 0));
  const chunks = chunkWords(words || []);
  const bigText = !voiceBuf; // text-only videos get larger, centered captions
  const audio = await mixAudio(voiceBuf, musicStyle, total);

  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H });
  const g = canvas.getContext("2d");
  const frame = (t) => {
    let k = starts.findIndex((s, i) => t >= s && t < s + durs[i]);
    if (k < 0) k = bitmaps.length - 1;
    g.fillStyle = "#000";
    g.fillRect(0, 0, W, H);
    drawCover(g, bitmaps[k], k, clamp((t - starts[k]) / durs[k], 0, 1));
    if (bigText) {
      g.fillStyle = "rgba(0,0,0,0.25)";
      g.fillRect(0, 0, W, H);
    }
    drawCaption(g, chunks, t, captionStyle, bigText);
    const fade = t < 0.3 ? 1 - t / 0.3 : t > total - 0.5 ? (t - (total - 0.5)) / 0.5 : 0;
    if (fade > 0) {
      g.fillStyle = `rgba(0,0,0,${clamp(fade, 0, 1)})`;
      g.fillRect(0, 0, W, H);
    }
  };

  if (typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined") {
    try {
      return await encodeWebCodecs({ canvas, frame, total, audio, onProgress });
    } catch (e) {
      console.warn("WebCodecs failed, using real-time recorder", e);
    }
  }
  return encodeRealtime({ source: canvas, frame, total, audio, onProgress });
}

async function pickCodecs() {
  const vOk = async (codec) => (await VideoEncoder.isConfigSupported({ codec, width: W, height: H, bitrate: 4_500_000, framerate: FPS }).catch(() => ({}))).supported;
  const aOk = async (codec) => (await AudioEncoder.isConfigSupported({ codec, sampleRate: SR, numberOfChannels: 2, bitrate: 160000 }).catch(() => ({}))).supported;
  const video = (await vOk("avc1.640028")) ? ["avc1.640028", "avc"] : (await vOk("avc1.42E028")) ? ["avc1.42E028", "avc"] : (await vOk("vp09.00.40.08")) ? ["vp09.00.40.08", "vp9"] : null;
  const audio = (await aOk("mp4a.40.2")) ? ["mp4a.40.2", "aac"] : (await aOk("opus")) ? ["opus", "opus"] : null;
  return { video, audio };
}

async function encodeWebCodecs({ canvas, frame, total, audio, onProgress }) {
  const c = await pickCodecs();
  if (!c.video || !c.audio) throw new Error("No supported codecs");
  const muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: c.video[1], width: W, height: H },
    audio: { codec: c.audio[1], sampleRate: SR, numberOfChannels: 2 },
    fastStart: "in-memory",
  });
  let failure = null;
  const ve = new VideoEncoder({ output: (ch, m) => muxer.addVideoChunk(ch, m), error: (e) => (failure = e) });
  ve.configure({ codec: c.video[0], width: W, height: H, bitrate: 4_500_000, framerate: FPS });
  const n = Math.ceil(total * FPS);
  for (let i = 0; i < n; i++) {
    if (failure) throw failure;
    frame(i / FPS);
    const vf = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
    ve.encode(vf, { keyFrame: i % 60 === 0 });
    vf.close();
    while (ve.encodeQueueSize > 6) await sleep(2);
    if (i % 15 === 0) {
      onProgress?.(i / n);
      await sleep(0); // keep the page responsive
    }
  }
  await ve.flush();
  const ae = new AudioEncoder({ output: (ch, m) => muxer.addAudioChunk(ch, m), error: (e) => (failure = e) });
  ae.configure({ codec: c.audio[0], sampleRate: SR, numberOfChannels: 2, bitrate: 160000 });
  const L = audio.getChannelData(0), R = audio.getChannelData(1);
  for (let s = 0; s < audio.length; s += 1024) {
    const k = Math.min(1024, audio.length - s);
    const d = new Float32Array(k * 2);
    d.set(L.subarray(s, s + k), 0);
    d.set(R.subarray(s, s + k), k);
    ae.encode(new AudioData({ format: "f32-planar", sampleRate: SR, numberOfFrames: k, numberOfChannels: 2, timestamp: Math.round((s * 1e6) / SR), data: d }));
  }
  await ae.flush();
  if (failure) throw failure;
  muxer.finalize();
  onProgress?.(1);
  return { blob: new Blob([muxer.target.buffer], { type: "video/mp4" }), ext: "mp4", codec: `${c.video[1]}+${c.audio[1]}` };
}

/** Fallback for browsers without WebCodecs: plays the video in real time and records it. */
async function encodeRealtime({ source, frame, total, audio, onProgress }) {
  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const g2 = canvas.getContext("2d");
  const ac = new AudioContext({ sampleRate: SR });
  const dest = ac.createMediaStreamDestination();
  const src = ac.createBufferSource();
  src.buffer = audio;
  src.connect(dest);
  const stream = new MediaStream([...canvas.captureStream(FPS).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const type = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 4_500_000 });
  const parts = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const done = new Promise((r) => (rec.onstop = r));
  rec.start(500);
  src.start();
  const t0 = ac.currentTime;
  await new Promise((resolve) => {
    const tick = () => {
      const t = ac.currentTime - t0;
      if (t >= total) return resolve();
      frame(t);
      g2.drawImage(source, 0, 0); // copy the rendered frame onto the recorded canvas
      onProgress?.(t / total);
      requestAnimationFrame(tick);
    };
    tick();
  });
  rec.stop();
  await done;
  ac.close();
  const isMp4 = (type || "").includes("mp4");
  return { blob: new Blob(parts, { type: isMp4 ? "video/mp4" : "video/webm" }), ext: isMp4 ? "mp4" : "webm", codec: type };
}

/** Read width/height/duration of a finished video. */
function probeVideo(blob) {
  return new Promise((res, rej) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    const url = URL.createObjectURL(blob);
    v.onloadedmetadata = () => {
      res({ width: v.videoWidth, height: v.videoHeight, duration: v.duration });
      URL.revokeObjectURL(url);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      rej(new Error("This browser can't read the finished video"));
    };
    v.src = url;
  });
}
