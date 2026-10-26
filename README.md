# Ali — Web to PDF for sites that don't want to be saved

Straight up: I built this for annoying sites. Right-click disabled, copy blocked, print blocked, images only load when you scroll, virtualized lists, endless Facebook-style feeds, 3D pages full of iframes and canvas.

If Ctrl+P works fine on your site, you don't need this. If you keep getting blank PDFs, missing images, half-loaded text — that's where Ali comes in.

How it works:

- Runs right in the Chrome tab where you're already logged in. No passwords in code, nothing uploaded anywhere, no AI rewriting stuff.
- In full mode, DOM text stays as text, so you can search and copy it. Text baked into images stays as images, I don't OCR for you. Exact-region mode captures only the dragged rectangle as an image.
- Images get packed into an offline HTML file, then you print that to A4 with Chrome's normal print dialog. Turn on Background graphics and you're good.
- If something fails, it says so in `.report.json`. Missing images show up as placeholders, I don't silently hide them.

Best fit is lesson-style pages (like Edubit): one long column of questions, images, answers. Facebook feeds and fancy 3D sites? You can try, but don't expect to grab a whole newsfeed in one shot.

Doesn't fit your site? Fork it. Everything's in `src/` and `extension/`, nothing locked.

## Installation

I only use the extension build day to day. It's already in `extension/`, currently `v2.5.0`.

v2.5.0 adds **Copy đúng khung kéo** next to **Chọn vùng copy full**. Exact-region mode saves the visible rectangle at screenshot resolution without auto-scrolling; its text is part of the image. Keep the page position and window size unchanged after selecting the rectangle, or select again. Full mode continues to preserve searchable DOM text.

For a single open page, **Lưu ảnh gốc để so sánh cạnh bản xuất** is enabled by default. Ali captures the selected column while scrolling and opens **Bản gốc** and **Bản xuất** side by side. Each column scrolls independently. Screenshots are saved in Ali's local document so comparison still works after closing the source tab or going offline. Printing/downloading HTML includes the export only. Background batch scans do not capture screenshots. Reference captures are limited to 60 frames or approximately 20 MB per lesson; the comparison view explains when references are incomplete or unavailable. Existing saved documents remain readable and need rescanning to add original screenshots.

v2.4.1 preserves inline SVG colors, strokes, arrow markers and local definitions when exporting diagrams. Hidden heading links and screen-reader labels stay out of the print copy. The drag-select button is now **Chọn vùng copy full**. Reload the extension and rescan the source page to apply these fixes to previously saved content.

1. Open Chrome, go to `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** -> pick the `extension` folder from this repo (the one with `manifest.json`)
4. Pin **Ali · Web to PDF** so you can click it

No `npm install` needed for the extension. Don't delete or move that folder after, Chrome reads straight from it. After you edit code, hit reload in `chrome://extensions` and F5 the lesson page.

You can also double-click `Install-Chrome-Extension.cmd` on Windows, it opens the help page and `chrome://extensions` for you.

## Usage

1. Log in normally, open the lesson you want.
2. Click the Ali icon -> **Drag select**, draw around the content column. The orange box is what gets scanned, including the part below the screen, not just what you see.
3. Hit **Use this area**. If the site shows one question at a time when you click numbers, switch to per-question mode and select the number bar too.
4. Hit **Scan this lesson**, stay on that tab and let it auto-scroll and wait for images.
5. Hit **Make print version / Save PDF** -> in the preview tab hit **Print / Save PDF** -> **Save as PDF**, A4, check **Background graphics** -> Save.

For multiple lessons, go to the **Batch** tab and paste URLs, one per line. Only rule: they have to share the same layout as the sample you selected. Different layout, different result. That's on you.

Saved files live under **Saved**, stored locally in the extension. Important stuff? Download the PDF/HTML out. Uninstall the extension or wipe Chrome data and it's gone.

## Troubleshooting

**1. Site blocks copy / disables right-click?**
Don't care. I read the DOM directly, copy-block scripts do nothing.

**2. Images show on the site but vanish in the save?**
Classic one. 99% of the time the images live on another domain (CDN, `*.fbcdn.net`...) and Chrome won't let me touch them.

Fix in order:

- When the panel asks to **Allow image / font sources**, allow exactly the domains it lists. Then rescan.
- Too lazy to rescan? Keep the original lesson tab open, open the preview and hit **Print from original page to get images**. That prints through your logged-in session so stubborn images usually show up.
- Old file already full of empty boxes? Just rescan from scratch, faster than trying to rescue it.

Since v2.4.0 if byte download fails it tries to grab the already-rendered image at natural size and saves PNG. Check `.report.json` to see how each image was grabbed.

**3. Lazy-load, scroll-to-load, Facebook-like feeds?**
It auto-scrolls and waits, but nobody can promise a full infinite feed. Hit **Stop** and it keeps what it got so far and marks it as partial. Don't bring me a partial file and call it a bug.

**4. Iframe / canvas / text inside images?**
- Text in images stays images. No OCR.
- Canvas kept as image if readable.
- Iframes: open the frame URL in its own tab and scan that. I don't crawl into iframes for you.

**5. Got Ruler or some measuring extension?**
Turn off its Ruler mode before dragging. It eats your mouse events and the drag won't work.

More detail is in `extension/help.html`, just open it in Chrome.

## Command Line Interface

Rarely used, but still works. Needs Node.js + Chrome.

```powershell
.\Install.cmd
.\Run.cmd
```

Run a URL list:

```powershell
node src/cli.mjs --urls lesson-urls.txt
```

Copy `lesson-urls.example.txt` to `lesson-urls.txt`, one URL per line. For auto runs add `--selector "YOUR_CONTENT_CSS"`.

Each run makes its own `output/pdf/run-...` folder, each lesson gets `.pdf`, `.html`, `.report.json`. Missing questions / broken images stop the run unless you pass `--allow-incomplete`.

## Customization

Shared logic lives in `src/dom.mjs`. Want it tuned for your own site? Fork and adjust selectors, scrolling, and image waiting to match that site.

After editing:

```powershell
npm run build:extension
```

then reload the extension.

## Testing

Tests all run on localhost, no real account needed:

```powershell
npm test
npm run test:all
```

Separate ones for area select (`test:selection`), mid-run stop (`test:regression`), image permissions (`test:resources`). Names say it all.

## Limitations

- You need internet while scanning to load lessons / images / fonts. After saving, PDF / offline HTML read fine without it.
- It only grabs what you can already see logged in. If a site has hardcore bot protection, it can still fail. I don't bypass that for you.
- Printing goes through Chrome so images may get recompressed. Want original bytes? Open the offline HTML.
- It doesn't do your homework, submit answers, or unlock lessons. It just saves docs.
