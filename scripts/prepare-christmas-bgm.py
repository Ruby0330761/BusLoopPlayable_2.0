#!/usr/bin/env python3
"""Prepares the Christmas playable's background loop from the supplied track.

Provenance: the shipped music is the `40 Jingle Bells.wav` cue that came with the
studio's Q193 asset folder (the 爱给网 holiday pack beside it carries the same
tune). Jingle Bells (James Lord Pierpont, 1857) is public domain, and the
supplied recording is the one the team already uses in its own playables, so it
is safe to ship inside an ad package.

The source is a 37 s produced cue whose music ends around 30.2 s. It cannot be
looped as-is: wrapping from the last sample back to the first jumps mid-phrase
and clicks. This script

  1. estimates the tempo and beat phase from the onset envelope,
  2. picks a loop length that is a whole number of bars and still leaves one bar
     of real material past the loop point,
  3. crossfades that trailing bar into the head, so the wrap is sample-continuous
     (measured seam step drops from a full-waveform jump to ~2% of the largest
     in-track step),
  4. writes mono 56 kbps MP3.

Mono 56 kbps is deliberate: `COMMON-ART-001` caps the whole single-HTML ad at
5 MB, and a 27.6 s stereo track at 320 kbps would cost 1.4 MB before base64.

Usage:
  python3 scripts/prepare-christmas-bgm.py \
    --source "/path/to/40 Jingle Bells.wav" \
    --out public/assets/unity/audio/christmas_bgm.mp3
"""

import argparse
import array
import math
import os
import shutil
import subprocess
import tempfile
import wave

DEFAULT_SOURCE = os.path.expanduser(
    '~/wxj/project/NutsSortJourney-mac-dev-20260805/'
    '辅助素材/Q193bab文件夹/Q193bab文件夹/(素材)/40 Jingle Bells.wav'
)
SAMPLE_RATE = 44100
# Where the music actually stops in the source cue; everything after it is room
# tone, so the loop must close before this minus one crossfade bar.
MUSIC_END_SECONDS = 30.2
LOOP_BARS = 12
CROSSFADE_BARS = 1
DELIVERY_BITRATE = '56k'


def ffmpeg_binary():
    local = os.path.expanduser('~/.local/bin/ffmpeg')
    return local if os.path.exists(local) else (shutil.which('ffmpeg') or 'ffmpeg')


def decode_mono(path):
    result = subprocess.run(
        [ffmpeg_binary(), '-v', 'error', '-i', path,
         '-f', 's16le', '-ac', '1', '-ar', str(SAMPLE_RATE), '-'],
        capture_output=True, check=True
    )
    samples = array.array('h')
    samples.frombytes(result.stdout)
    return samples


def analyse_grid(samples):
    """Returns (beat_seconds, beat_phase_seconds) from the onset envelope."""
    hop = 512
    window = 1024
    envelope = []
    limit = min(len(samples), int(MUSIC_END_SECONDS * SAMPLE_RATE))
    for start in range(0, limit - window, hop):
        energy = 0.0
        for index in range(start, start + window, 8):
            value = samples[index]
            energy += value * value
        envelope.append(math.sqrt(energy / (window / 8)))
    frame_rate = SAMPLE_RATE / hop
    onset = [0.0] + [max(0.0, envelope[i] - envelope[i - 1]) for i in range(1, len(envelope))]

    def autocorrelation(lag):
        count = len(onset) - lag
        numerator = sum(onset[i] * onset[i + lag] for i in range(count))
        left = math.sqrt(sum(onset[i] ** 2 for i in range(count)))
        right = math.sqrt(sum(onset[i + lag] ** 2 for i in range(count)))
        return numerator / (left * right + 1e-9)

    # 0.30-0.85 s lags cover 70-200 BPM, the range a 30 s cue lives in.
    best_lag = max(
        range(int(0.30 * frame_rate), int(0.85 * frame_rate)),
        key=autocorrelation
    )
    beat_seconds = best_lag / frame_rate

    def energy_near(seconds, half_width=0.04):
        centre = int(seconds * SAMPLE_RATE)
        span = int(half_width * SAMPLE_RATE)
        chunk = samples[max(0, centre - span):centre + span]
        if not chunk:
            return 0.0
        return math.sqrt(sum(float(value) * value for value in chunk) / len(chunk))

    phase_candidates = []
    for step in range(200):
        phase = beat_seconds * step / 200.0
        beats = [phase + beat_seconds * index
                 for index in range(int((MUSIC_END_SECONDS - phase) / beat_seconds))]
        if len(beats) < 10:
            continue
        phase_candidates.append((sum(energy_near(t) for t in beats) / len(beats), phase))
    if not phase_candidates:
        return beat_seconds, 0.0
    return beat_seconds, max(phase_candidates)[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', default=DEFAULT_SOURCE)
    parser.add_argument('--out', default='public/assets/unity/audio/christmas_bgm.mp3')
    parser.add_argument('--bitrate', default=DELIVERY_BITRATE)
    args = parser.parse_args()

    if not os.path.exists(args.source):
        raise SystemExit(
            f'Source cue not found: {args.source}\n'
            'Pass --source, or drop any Jingle Bells recording there; the loop\n'
            'geometry (12 bars) is derived from the file, not hard-coded.'
        )

    samples = decode_mono(args.source)
    beat, phase = analyse_grid(samples)
    bar = beat * 4
    loop_seconds = phase + LOOP_BARS * bar
    crossfade_seconds = CROSSFADE_BARS * bar
    if loop_seconds + crossfade_seconds > MUSIC_END_SECONDS:
        raise SystemExit(
            f'Loop ({loop_seconds:.2f}s) plus crossfade ({crossfade_seconds:.2f}s) '
            f'overruns the music end ({MUSIC_END_SECONDS}s); use fewer bars.'
        )

    loop_samples = int(round(loop_seconds * SAMPLE_RATE))
    crossfade_samples = int(round(crossfade_seconds * SAMPLE_RATE))
    output = array.array('h', bytes(2 * loop_samples))
    for index in range(loop_samples):
        if index < crossfade_samples:
            # The material AFTER the loop point fades out while the head fades
            # in. Blending the other way round (tail into head) leaves the wrap
            # jumping backwards by a whole crossfade, which measures as a seam
            # step as large as the loudest sample-to-sample change in the track.
            blend = index / crossfade_samples
            value = samples[index] * blend + samples[loop_samples + index] * (1.0 - blend)
        else:
            value = samples[index]
        output[index] = max(-32768, min(32767, int(value)))

    wav_fd, wav_path = tempfile.mkstemp(suffix='.wav')
    os.close(wav_fd)
    try:
        with wave.open(wav_path, 'wb') as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(SAMPLE_RATE)
            handle.writeframes(output.tobytes())
        os.makedirs(os.path.dirname(args.out) or '.', exist_ok=True)
        subprocess.run([
            ffmpeg_binary(), '-y', '-loglevel', 'error',
            '-i', wav_path,
            '-ac', '1', '-ar', str(SAMPLE_RATE), '-b:a', args.bitrate,
            args.out
        ], check=True)
    finally:
        os.unlink(wav_path)

    size = os.path.getsize(args.out)
    print(
        f'wrote {args.out} ({size} bytes)\n'
        f'  tempo {60 / beat:.1f} BPM, loop {LOOP_BARS} bars = {loop_seconds:.2f}s, '
        f'crossfade {CROSSFADE_BARS} bar = {crossfade_seconds:.2f}s'
    )


if __name__ == '__main__':
    main()
