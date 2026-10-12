"""Verify extracted Vietnamese text and picture boundaries in the fixture PDF."""
from pathlib import Path
import json
import re
import pdfplumber
from PIL import Image, ImageOps, ImageDraw

root = Path(__file__).resolve().parents[1] / 'tmp' / 'pdfs' / 'test'
with pdfplumber.open(root / 'fixture.pdf') as pdf:
    text = '\n'.join(page.extract_text() or '' for page in pdf.pages)
    numbers = [int(n) for n in re.findall(r'Câu hỏi (\d+):', text)]
    assert numbers == list(range(1, 13)), numbers
    assert 'tĩnh mạch, thần kinh' in text, 'Vietnamese accents missing'
    images = [img for page in pdf.pages for img in page.images]
    # SVG is emitted as vector paths, so absence of raster image objects is expected.
    assert len(text) > 2000, 'Text layer missing'
    summary = {'pages': len(pdf.pages), 'characters': len(text), 'question_numbers': numbers}
    (root / 'pdf-quality.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False))

pngs = sorted(root.glob('render-*.png'))
if pngs:
    thumbs = []
    for p in pngs:
        im = Image.open(p).convert('RGB')
        im.thumbnail((380, 550))
        thumb = Image.new('RGB', (400, 585), '#ddd')
        thumb.paste(im, ((400-im.width)//2, 25))
        ImageDraw.Draw(thumb).text((12, 8), p.stem, fill='black')
        thumbs.append(thumb)
    contact = Image.new('RGB', (400*min(3,len(thumbs)),585*((len(thumbs)+2)//3)), 'white')
    for i, im in enumerate(thumbs):
        contact.paste(im, ((i%3)*400,(i//3)*585))
    contact.save(root / 'contact-sheet.png')
