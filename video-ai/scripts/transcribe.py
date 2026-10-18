#!/usr/bin/env python3
"""Spracherkennung mit Whisper (lokal, Open Source, keine Cloud-Kosten).

Aufruf: transcribe.py <audio.wav> <ausgabe.json> [--model small] [--language de]

Nutzt bevorzugt faster-whisper (schneller, läuft gut auf CPU), sonst das
Original-Paket openai-whisper. Ausgabe: {"engine": ..., "segments": [{start, end, text}]}
Exit-Code 3 = keine Whisper-Installation gefunden, 4 = Fehler (z. B. Modell nicht ladbar).
"""
import argparse
import json
import sys


def with_faster_whisper(path, model_name, language):
    from faster_whisper import WhisperModel

    model = WhisperModel(model_name, device="auto", compute_type="int8")
    segments, _info = model.transcribe(path, language=language, vad_filter=True, beam_size=5)
    return "faster-whisper", [
        {"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()}
        for s in segments
        if s.text.strip()
    ]


def with_openai_whisper(path, model_name, language):
    import whisper

    model = whisper.load_model(model_name)
    result = model.transcribe(path, language=language, fp16=False)
    return "openai-whisper", [
        {"start": round(s["start"], 2), "end": round(s["end"], 2), "text": s["text"].strip()}
        for s in result["segments"]
        if s["text"].strip()
    ]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("audio")
    parser.add_argument("output")
    parser.add_argument("--model", default="small")
    parser.add_argument("--language", default="de")
    args = parser.parse_args()

    for engine in (with_faster_whisper, with_openai_whisper):
        try:
            name, segments = engine(args.audio, args.model, args.language)
            break
        except ImportError:
            continue
        except Exception as exc:  # z. B. Modell-Download ohne Internet
            print(f"{type(exc).__name__}: {str(exc).splitlines()[0] if str(exc) else ''}", file=sys.stderr)
            sys.exit(4)
    else:
        print("Weder faster-whisper noch openai-whisper ist installiert.", file=sys.stderr)
        sys.exit(3)

    with open(args.output, "w", encoding="utf-8") as fh:
        json.dump({"engine": name, "segments": segments}, fh, ensure_ascii=False)


if __name__ == "__main__":
    main()
