# KIVOXEL: Chatterbox (Resemble AI, MIT licence) as a small local voice server for the worker.
# Speaks English with the timbre of a short reference recording (zero-shot voice cloning), on this pc only.
# Protocol: one JSON object per line on stdin -> one JSON object per line on stdout.
#   {"text": "...", "out": "C:/.../line.wav", "exaggeration": 0.7, "cfg_weight": 0.3}
#   -> {"ok": true, "ms": 1234} or {"ok": false, "error": "..."}
# The first line on stdout is {"ready": true} once the model is loaded.
# Usage: python -I chatterbox_server.py <reference.wav>
import json
import sys


def main() -> None:
    ref = sys.argv[1]
    try:
        import torch
        import torchaudio
        from chatterbox.tts import ChatterboxTTS

        torch.set_num_threads(max(1, (torch.get_num_threads() or 4)))
        model = ChatterboxTTS.from_pretrained(device="cpu")
        # The voice is prepared once from the reference; every line reuses it.
        model.prepare_conditionals(ref, exaggeration=0.7)
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
