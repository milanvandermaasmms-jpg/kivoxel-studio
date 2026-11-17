"""Dreamnest: lock the camera of an AI clip (Milan 17-11-2026, motor rule 2: "de camera staat stil").

AI loops drift and slowly zoom in and out. Every frame is aligned to the first frame with its own zoom and shift
(found by minimising the difference on a small, softened copy), then one fixed zoom hides the edges. Characters keep
their own motion; only the camera is taken out.

Usage: python -I lock_camera.py <in.mp4> <out.mp4> <ffmpeg> [fps]
Prints one JSON line with the measured camera range and the fixed zoom.
"""
import json
import subprocess
import sys

import numpy as np
import torch
import torch.nn.functional as F

src, dst, ffmpeg = sys.argv[1], sys.argv[2], sys.argv[3]
fps = sys.argv[4] if len(sys.argv) > 4 else "24"
W, H = 1920, 1080
torch.set_num_threads(max(1, torch.get_num_threads()))

raw = subprocess.run([ffmpeg, "-v", "error", "-i", src, "-vf", f"scale={W}:{H},format=rgb24", "-f", "rawvideo", "-"], capture_output=True, check=True).stdout
frames = np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3)
n = len(frames)


def small(i: int) -> torch.Tensor:
    t = torch.from_numpy(frames[i].astype(np.float32) / 255).permute(2, 0, 1).mean(0, keepdim=True)[None]
    t = F.avg_pool2d(t, 4)  # 480x270
    return F.avg_pool2d(t, 5, stride=1, padding=2)  # soften: ignore AI texture boiling


def grid(s: torch.Tensor, tx: torch.Tensor, ty: torch.Tensor, h: int, w: int) -> torch.Tensor:
    # Output pixel p samples the input at s*p + t (normalised coordinates): s<1 zooms in.
    theta = torch.stack([torch.stack([s, torch.zeros(()), tx]), torch.stack([torch.zeros(()), s, ty])])[None]
    return F.affine_grid(theta, [1, 1, h, w], align_corners=False)


ref = small(0)
_, _, h, w = ref.shape
# Compare only the inner part, so edges that leave the picture do not count.
m = torch.zeros_like(ref)
m[..., h // 10 : -h // 10, w // 10 : -w // 10] = 1
params = [(1.0, 0.0, 0.0)]
s0, x0, y0 = 1.0, 0.0, 0.0
for i in range(1, n):
    cur = small(i)
    s = torch.tensor(s0, requires_grad=True)
    tx = torch.tensor(x0, requires_grad=True)
    ty = torch.tensor(y0, requires_grad=True)
    opt = torch.optim.Adam([s, tx, ty], lr=2e-3)
    for _ in range(60):
        opt.zero_grad()
        warped = F.grid_sample(cur, grid(s, tx, ty, h, w), mode="bilinear", padding_mode="border", align_corners=False)
        loss = ((warped - ref).abs() * m).sum() / m.sum()
        loss.backward()
        opt.step()
    s0, x0, y0 = float(s), float(tx), float(ty)
    params.append((s0, x0, y0))

p = np.array(params)
# No smoothing over time (17-11-2026): AI clips also shake fast (up to 2 px between two frames), and smoothing let that
# shake through. The fit itself is stable to about 0.1 px (measured on loop-b10). LOCK_SMOOTH=k averages over 2k+1 frames.
k = int(__import__("os").environ.get("LOCK_SMOOTH", "0"))
pad = np.pad(p, ((k, k), (0, 0)), mode="edge")
ker = np.ones(2 * k + 1) / (2 * k + 1)
sm = np.stack([np.convolve(pad[:, j], ker, mode="valid") for j in range(3)], 1)
sm[0] = p[0]
# Fixed zoom so no frame shows an edge: the furthest a corrected frame reaches past the picture.
reach = np.max(np.abs(sm[:, 1:]) + np.abs(sm[:, :1] - 1) + 0.0)
zoom = 1 / (1 - min(0.12, reach + 0.004))

enc = subprocess.Popen([ffmpeg, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", fps, "-i", "-", "-vf", "scale=out_range=tv,format=yuv420p", "-c:v", "libx264", "-crf", "14", "-preset", "medium", "-pix_fmt", "yuv420p", "-color_range", "tv", "-colorspace", "smpte170m", dst], stdin=subprocess.PIPE)
for i in range(n):
    s, tx, ty = (torch.tensor(float(v)) for v in sm[i])
    t = torch.from_numpy(frames[i].astype(np.float32) / 255).permute(2, 0, 1)[None]
    g = grid(s / zoom, tx, ty, H, W)
    out = F.grid_sample(t, g, mode="bicubic", padding_mode="border", align_corners=False).clamp(0, 1)
    enc.stdin.write((out[0].permute(1, 2, 0).numpy() * 255 + 0.5).astype(np.uint8).tobytes())
enc.stdin.close()
enc.wait()
print(json.dumps({"frames": n, "zoom_range": [float(p[:, 0].min()), float(p[:, 0].max())], "shift_px": [float(np.abs(p[:, 1]).max() * W / 2), float(np.abs(p[:, 2]).max() * H / 2)], "fixed_zoom": round(float(zoom), 4)}))
