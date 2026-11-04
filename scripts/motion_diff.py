import sys
from PIL import Image, ImageChops

a = Image.open(sys.argv[1]).convert('L')
b = Image.open(sys.argv[2]).convert('L')
boxes = {
    'm31':  (330, 20, 660, 190),
    'm33':  (1000, 130, 1200, 240),
    'lmc':  (330, 540, 560, 690),
}
for name, box in boxes.items():
    d = ImageChops.difference(a.crop(box), b.crop(box))
    px = list(d.getdata())
    mean = sum(px) / len(px)
    moved = sum(1 for p in px if p > 12) / len(px)
    print(f'{name:4s} mean={mean:6.2f} moved={moved*100:5.1f}%')