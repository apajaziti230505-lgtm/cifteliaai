from __future__ import annotations
import hashlib
import json
import shutil
import subprocess
from pathlib import Path
import numpy as np

SR = 22050
MAX_SECONDS = 1800


def ffmpeg():
    exe = shutil.which("ffmpeg")
    if exe: return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError as e:
        raise RuntimeError("Instalo FFmpeg ose imageio-ffmpeg.") from e


def decode(path, sr=SR):
    """Decode whole file. Refuse oversize, never silently truncate a song."""
    path = Path(path)
    metadata = {}
    probe = shutil.which("ffprobe")
    if probe:
        p = subprocess.run([probe, "-v", "error", "-select_streams", "a:0", "-show_entries",
                            "stream=sample_rate,channels:format=duration", "-of", "json", str(path)],
                           capture_output=True, timeout=30)
        if p.returncode == 0:
            info = json.loads(p.stdout)
            streams = info.get("streams", [])
            metadata = {"original_sample_rate": int(streams[0].get("sample_rate", sr)) if streams else None,
                        "original_channels": streams[0].get("channels") if streams else None}
            if float(info.get("format", {}).get("duration", 0)) > MAX_SECONDS:
                raise ValueError("Kufiri aktual është 30 minuta; ndaje regjistrimin në pjesë.")
    p = subprocess.run([ffmpeg(), "-hide_banner", "-v", "error", "-nostdin", "-i", str(path),
                        "-vn", "-t", str(MAX_SECONDS + 1), "-ac", "1", "-ar", str(sr), "-f", "f32le", "pipe:1"],
                       capture_output=True, timeout=300)
    if p.returncode:
        raise ValueError("Audioja nuk dekodohet: " + p.stderr.decode(errors="replace")[-300:])
    y = np.frombuffer(p.stdout, dtype="<f4").copy()
    if len(y) == 0 or not np.isfinite(y).all(): raise ValueError("Audio bosh ose e pavlefshme.")
    if len(y) > sr * MAX_SECONDS: raise ValueError("Kufiri aktual është 30 minuta.")
    # Stereo energy cancellation is not repaired silently. Metadata makes mono mix explicit.
    return y, {"filename": path.name, "sample_rate": sr, "num_samples": len(y), "duration": len(y) / sr,
               "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "channels": 1, **metadata,
               "time_reference": "decoded_pcm_samples", "decoder": "ffmpeg"}


def waveform(y, points=3000):
    step = max(1, int(np.ceil(len(y) / points)))
    return [round(float(np.max(np.abs(y[i:i + step]))), 5) for i in range(0, len(y), step)]
