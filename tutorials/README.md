# Tutorial templates

Two HTML templates for building instructional pages around Unitor.

## Templates

### `template-tutorial.html` — Scrolling tutorial

Single-column page with prose, screenshots, and inline calculator
embeds at natural breakpoints. Each embed is a self-contained iframe
pre-loaded with a worked example. Good for "read then interact"
lessons where you want multiple small examples.

### `template-workbench.html` — Side-by-side workbench

Two-column layout: scrollable instructions on the left, a persistent
full-height calculator on the right. The calculator stays visible as
the student works through numbered steps. Collapses to stacked on
mobile. Good for "follow along, build it yourself" exercises.

## How to use

1. Copy a template and rename it (e.g. `speed-conversion.html`).
2. Edit the title, subtitle, and content sections.
3. For each calculator embed, open Unitor, set up the example you
   want, and click "Copy share link." Paste the `?d=...` portion
   into the iframe's `src` attribute:
   ```html
   <iframe src="../?d=PASTE_HERE" ...></iframe>
   ```
   If embedding from Canvas or another domain, use the full URL:
   ```html
   <iframe src="https://itmeson.github.io/unitor-web/?d=PASTE_HERE" ...></iframe>
   ```
4. Add screenshots to a `screenshots/` subfolder and reference them
   with `<img src="screenshots/filename.png">`.

## Hosting

These pages are static HTML — no build step. They work when:

- **Co-hosted** (served from the same GitHub Pages site as Unitor):
  iframe `src` uses a relative path like `../?d=...`.
- **Embedded in Canvas / LMS**: use the full `https://...` URL for
  the iframe src. The calculator's `execCommand` clipboard fallback
  handles the restricted Permissions Policy in Canvas iframes.

## Customization

Both templates use CSS custom properties at the top of their
`<style>` block for colors, fonts, and sizing. Adjust these to
match your course site's look if needed. Dark mode is handled
automatically via `prefers-color-scheme`.
