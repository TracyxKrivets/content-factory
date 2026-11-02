import { key as apiKey } from "../../keys";
import fs from "node:fs/promises";
import { env } from "../../env";
import { httpError, ProviderError } from "../../errors";
import { bins, ffmpeg, run } from "../../ffmpeg";
import { PRICE } from "../pricing";
import type { VoiceProvider } from "../types";

async function save(res: Response, outPath: string) {
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new ProviderError("bad_output", "Audio too small");
  await fs.writeFile(outPath, buf);
}

export const elevenlabsVoice: VoiceProvider = {
  id: "elevenlabs",
  label: "ElevenLabs",
  capability: "voice",
  available: () => !!apiKey("ELEVENLABS_API_KEY"),
  async speak({ text, outPath }) {
    const key = apiKey("ELEVENLABS_API_KEY");
    if (!key) throw new ProviderError("missing_key", "ELEVENLABS_API_KEY not set", { provider: "elevenlabs" });
    const voice = env().ELEVENLABS_VOICE_ID || "pNInz6obpgDQGcFmaJgB";
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
        signal: AbortSignal.timeout(180_000),
        body: JSON.stringify({
          text,
          model_id: env().ELEVENLABS_MODEL || "eleven_multilingual_v2",
          voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.3 },
        }),
      },
    );
    if (!res.ok) throw await httpError(res, "elevenlabs");
    await save(res, outPath);
    return { cost: text.length * PRICE.elevenlabsPerChar, units: text.length };
  },
};

export const openaiVoice: VoiceProvider = {
  id: "openai-tts",
  label: "OpenAI voice",
  capability: "voice",
  available: () => !!apiKey("OPENAI_API_KEY"),
  async speak({ text, style, outPath }) {
    const key = apiKey("OPENAI_API_KEY");
    if (!key) throw new ProviderError("missing_key", "OPENAI_API_KEY not set", { provider: "openai-tts" });
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(180_000),
      body: JSON.stringify({
        model: env().OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
        voice: env().OPENAI_TTS_VOICE || "onyx",
        input: text,
        instructions: `Speak in a ${style} tone. Short-form video narration: clear, engaging, well-paced.`,
        response_format: "mp3",
      }),
    });
    if (!res.ok) throw await httpError(res, "openai-tts");
    await save(res, outPath);
    return { cost: text.length * PRICE.openaiTtsPerChar, units: text.length };
  },
};

/**
 * Built-in robot voice (no API). Uses ffmpeg's flite when available, otherwise the
 * computer's own voice: macOS "say", Windows speech, Linux espeak-ng/espeak.
 */
export const offlineVoice: VoiceProvider = {
  id: "offline-voice",
  label: "Robot voice (offline)",
  capability: "voice",
  offline: true,
  available: () => true,
  async speak({ text, outPath }) {
    const txt = outPath + ".txt";
    const clean = text.replace(/[—–]/g, ", ");
    await fs.writeFile(txt, clean);
    try {
      const b = await bins();
      const raw = outPath + ".raw.wav";
      if (b.flite) {
        const esc = txt.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
        await ffmpeg(["-f", "lavfi", "-i", `flite=textfile='${esc}':voice=awb`, raw]);
      } else await osVoice(txt, raw);
      await ffmpeg([
        "-i", raw,
        "-af", "aresample=44100,loudnorm=I=-16:TP=-1.5",
        "-c:a", "libmp3lame", "-b:a", "128k", outPath,
      ]);
      await fs.rm(raw, { force: true });
    } finally {
      await fs.rm(txt, { force: true });
    }
    return { cost: 0, units: text.length };
  },
};

async function osVoice(txtFile: string, wavOut: string) {
  const fail = () =>
    new ProviderError("missing_key", "No offline voice on this computer (no flite, say, Windows speech or espeak).", {
      provider: "offline-voice",
    });
  if (process.platform === "darwin") {
    await run("say", ["-f", txtFile, "-o", wavOut, "--file-format=WAVE", "--data-format=LEI16@22050"], 120_000).catch(() => {
      throw fail();
    });
    return;
  }
  if (process.platform === "win32") {
    const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile('${wavOut.replace(/'/g, "''")}'); $s.Speak([IO.File]::ReadAllText('${txtFile.replace(/'/g, "''")}')); $s.Dispose()`;
    await run("powershell", ["-NoProfile", "-Command", ps], 120_000).catch(() => {
      throw fail();
    });
    return;
  }
  for (const bin of ["espeak-ng", "espeak"]) {
    try {
      await run(bin, ["-s", "155", "-w", wavOut, "-f", txtFile], 120_000);
      return;
    } catch {
      /* try next */
    }
  }
  throw fail();
}
