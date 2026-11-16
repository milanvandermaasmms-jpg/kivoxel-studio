# KIVOXEL: Chatterbox (Resemble AI, MIT licence) as a small local voice server for the worker.
# Two modes, both with the timbre of a short reference recording, on this pc only:
#   "tts": Chatterbox speaks the text itself (zero-shot cloning). Carries the accent of the reference.
#   "vc":  voice conversion: an American TTS line (Google/Kokoro) keeps its pronunciation and timing, only the voice
#          colour becomes the reference's. Milan, 16-11-2026: "hij heeft een Indiaas accent, laat hem Amerikaans klinken".
# Protocol: one JSON object per line on stdin -> one JSON object per line on stdout.
#   {"mode": "tts", "text": "...", "out": "C:/.../line.wav", "exaggeration": 0.7, "cfg_weight": 0.3}
#   {"mode": "vc", "source": "C:/.../american.wav", "out": "C:/.../line.wav"}
#   -> {"ok": true, "ms": 1234} or {"ok": false, "error": "..."}
# The first line on stdout is {"ready": true} once the model is loaded.
# Usage: python -I chatterbox_server.py <reference.wav> [tts|vc]
import json
import sys


def main() -> None:
    ref = sys.argv[1]
    first = sys.argv[2] if len(sys.argv) > 2 else "tts"
    models = {}
    try:
        import torch
        import torchaudio

        def load(mode):
            if mode in models:
                return models[mode]
            if mode == "vc":
                from chatterbox.vc import ChatterboxVC

                m = ChatterboxVC.from_pretrained(device="cpu")
                m.set_target_voice(ref)
            else:
                from chatterbox.tts import ChatterboxTTS

                m = ChatterboxTTS.from_pretrained(device="cpu")
                m.prepare_conditionals(ref, exaggeration=0.7)
            models[mode] = m
            return m

        load(first)
    except Exception as e:  # noqa: BLE001 - report every load failure to the worker
        print(json.dumps({"ready": False, "error": str(e)[:300]}), flush=True)
        return
    print(json.dumps({"ready": True}), flush=True)
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            job = json.loads(raw)
            mode = job.get("mode", "tts")
            model = load(mode)
            if mode == "vc":
                wav = model.generate(job["source"])
            else:
                wav = model.generate(
                    job["text"],
                    exaggeration=float(job.get("exaggeration", 0.7)),
                    cfg_weight=float(job.get("cfg_weight", 0.3)),
                    temperature=float(job.get("temperature", 0.8)),
                )
            torchaudio.save(job["out"], wav, model.sr)
            print(json.dumps({"ok": True, "ms": round(wav.shape[-1] * 1000 / model.sr)}), flush=True)
        except Exception as e:  # noqa: BLE001
            print(json.dumps({"ok": False, "error": str(e)[:300]}), flush=True)


if __name__ == "__main__":
    main()
