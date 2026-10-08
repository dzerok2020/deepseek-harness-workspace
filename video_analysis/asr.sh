#!/usr/bin/env bash
W=/home/dzerok/Documents/deepseek-harness/default-workspace/video_analysis
exec >>"$W/asr.log" 2>&1
set -x
trap 'rc=$?; printf "ASR_EXIT %s\n" "$rc"' EXIT
PY="$HOME/.laya-venv/bin/python"
export W

run_faster() {
  "$1" -u - <<'PY'
import json, os
from faster_whisper import WhisperModel
w = os.environ['W']
print('BACKEND faster-whisper MODEL small DEVICE cpu COMPUTE int8', flush=True)
model = WhisperModel('small', device='cpu', compute_type='int8')
segments, info = model.transcribe(w + '/audio.wav', vad_filter=True, beam_size=5)
print(f'LANGUAGE {info.language} PROBABILITY {info.language_probability}', flush=True)
with open(w + '/asr.jsonl', 'a', encoding='utf-8') as out:
    for segment in segments:
        out.write(json.dumps({'start': segment.start, 'end': segment.end, 'text': segment.text}, ensure_ascii=False) + '\n')
        out.flush()
        print(f'SEG {segment.start:.2f} {segment.text}', flush=True)
PY
}

if "$PY" -m pip install --no-input faster-whisper && "$PY" -c 'import faster_whisper'; then
  run_faster "$PY"
  exit $?
fi

if "$PY" -m pip install --no-input openai-whisper && "$PY" -c 'import whisper'; then
  "$PY" -u - <<'PY'
import json, os
import whisper
w = os.environ['W']
print('BACKEND openai-whisper MODEL small DEVICE cpu', flush=True)
model = whisper.load_model('small', device='cpu')
audio = whisper.load_audio(w + '/audio.wav')
mel = whisper.log_mel_spectrogram(whisper.pad_or_trim(audio), n_mels=model.dims.n_mels).to(model.device)
_, probabilities = model.detect_language(mel)
language = max(probabilities, key=probabilities.get)
print(f'LANGUAGE {language} PROBABILITY {probabilities[language]}', flush=True)
result = model.transcribe(audio, language=language, fp16=False, beam_size=5, verbose=True)
with open(w + '/asr.jsonl', 'a', encoding='utf-8') as out:
    for segment in result['segments']:
        out.write(json.dumps({k: segment[k] for k in ('start', 'end', 'text')}, ensure_ascii=False) + '\n')
        out.flush()
        print(f"SEG {segment['start']:.2f} {segment['text']}", flush=True)
PY
  exit $?
fi

python3 -m venv "$W/asrvenv" || exit $?
PY="$W/asrvenv/bin/python"
"$PY" -m pip install --no-input faster-whisper || exit $?
"$PY" -c 'import faster_whisper' || exit $?
run_faster "$PY"
exit $?
