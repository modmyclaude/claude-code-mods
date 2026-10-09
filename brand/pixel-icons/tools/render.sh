#!/bin/bash
# render.sh : build icons, then screenshot the contact sheet + before/after into brand/pixel-icons (cropped to content)
set -e
cd "$(dirname "$0")"
OUT="$(cd .. && pwd)"
python3 build.py
../scripts/shot.sh "$PWD/contact-raw.png" 1300 1400 "file://$PWD/contact-sheet.html"
../scripts/shot.sh "$PWD/ba-raw.png" 1000 800 "file://$PWD/before-after.html"
python3 - "$OUT" <<'PY'
import sys
from PIL import Image
out=sys.argv[1]
def crop(src,dst):
    im=Image.open(src).convert('RGB'); w,h=im.size; bg=im.getpixel((2,h-2)); last=h-1
    for y in range(h-1,0,-1):
        if any(im.getpixel((x,y))!=bg for x in range(0,w,3)): last=y; break
    im.crop((0,0,w,min(h,last+18))).save(dst, optimize=True); print('saved',dst,im.crop((0,0,w,min(h,last+18))).size)
crop('contact-raw.png', out+'/contact-sheet.png')
crop('ba-raw.png', out+'/before-after.png')
PY
