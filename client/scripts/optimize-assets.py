#!/usr/bin/env python3
"""Shrink heavy assets in-place before a single-file build (same filenames).
PNG/WebP >260KB: downscale to 1024 + 256-color quantize / q80.
MP3: re-encode 80k mono (needs ffmpeg). Restore originals with:
  git checkout -- client/src/assets
"""
import os, subprocess
from PIL import Image
os.chdir(os.path.join(os.path.dirname(__file__), '..', 'src', 'assets'))
for root, _, fs in os.walk('.'):
    for f in fs:
        p = os.path.join(root, f)
        if not f.lower().endswith(('.png', '.webp')) or os.path.getsize(p) < 260_000:
            continue
        im = Image.open(p)
        if max(im.size) > 1024:
            im.thumbnail((1024, 1024), Image.LANCZOS)
        if f.lower().endswith('.png'):
            if im.mode != 'RGBA': im = im.convert('RGBA')
            im.quantize(colors=256, method=Image.Quantize.FASTOCTREE,
                        dither=Image.Dither.FLOYDSTEINBERG).save(p, optimize=True)
        else:
            im.save(p, quality=80, method=6)
        print(f, '->', os.path.getsize(p) // 1024, 'K')
for root, _, fs in os.walk('bgm'):
    for f in fs:
        if f.endswith('.mp3'):
            p = os.path.join(root, f)
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', p,
                            '-ac', '1', '-b:a', '80k', '/tmp/_o.mp3'], check=True)
            os.replace('/tmp/_o.mp3', p)
            print(f, '->', os.path.getsize(p) // 1024, 'K')
