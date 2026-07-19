/**
 * Contact sheets for the procedural artwork.
 *
 * Posters and portraits are generated from a seed, so the only question that matters
 * is how the whole *space* looks, not how one draw came out. Gameplay screenshots
 * show five posters at a time and whichever faces happen to be on screen, which is a
 * hopeless way to judge whether 120 shows and 180 people are actually distinguishable
 * from each other. This lays the range out in a grid so a bad palette, a repeated
 * composition or a face that only works at one size is obvious in one look.
 *
 * Renders the components through the same react-dom/server + stub path `render-check`
 * uses, then rasterises the result in a real browser. It draws the SVG the components
 * actually emit — not a mock-up of it.
 *
 *   npx tsx --tsconfig tsconfig.render.json tools/art-sheet.tsx
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRegistry } from 'react-native';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { Poster } from '../src/ui/Poster';
import { SHOW_ARCHETYPES } from '../src/data';
import { newGame } from '../src/engine/setup';
import { FORMATS } from '../src/engine/types';
import type { Format } from '../src/engine/types';

const OUT = 'tools/shots';
const CREAM = '#DCD4C4';

/**
 * Portrait is being written in parallel with this tool, so it is pulled in lazily and
 * the sheet degrades to posters-only if it is not there yet. A review tool that
 * crashes because half the artwork has not landed is a tool nobody runs.
 */
async function loadPortrait(): Promise<React.ComponentType<any> | null> {
  try {
    // Built from a variable so TypeScript does not try to resolve the path at compile
    // time — the module may legitimately not exist yet, and a typecheck error would
    // block the very build this tool exists to inspect.
    const path = ['..', 'src', 'ui', 'Portrait'].join('/');
    const mod = await import(/* @vite-ignore */ path);
    return (mod as any).Portrait ?? (mod as any).default ?? null;
  } catch {
    return null;
  }
}

/**
 * Render a react-native tree to markup *with its stylesheet*.
 *
 * `renderToStaticMarkup` alone is not enough: react-native-web emits class names and
 * injects the matching CSS at runtime, so static markup renders completely unstyled —
 * the first version of this sheet showed the genre icons floating on bare paper with
 * every poster background missing. `AppRegistry.getApplication` is RN-web's own SSR
 * entry point and hands back the CSS that goes with the markup.
 */
function collectedStyles(): string {
  AppRegistry.registerComponent('ArtSheet', () => () => null);
  const { getStyleElement } = (AppRegistry as any).getApplication('ArtSheet', {});
  return renderToStaticMarkup(getStyleElement());
}

function page(title: string, body: string, columns: number, cell: number, css = ''): string {
  return `<!doctype html>
<html><head><meta charset="utf-8">${css}<style>
  body {
    margin: 0; padding: 28px; background: ${CREAM};
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  h1 { font-size: 15px; letter-spacing: 2px; text-transform: uppercase; color: #6B5F52; margin: 0 0 18px; }
  .grid { display: grid; grid-template-columns: repeat(${columns}, ${cell}px); gap: 16px; }
  .cell { display: flex; flex-direction: column; align-items: center; gap: 5px; }
  .cap { font-size: 9px; color: #6B5F52; text-align: center; line-height: 1.25; max-width: ${cell}px; }
  .art { display: flex; align-items: center; justify-content: center; }
  svg { display: block; }
</style></head><body><h1>${title}</h1><div class="grid">${body}</div></body></html>`;
}

function cell(art: string, caption: string): string {
  return `<div class="cell"><div class="art">${art}</div><div class="cap">${caption}</div></div>`;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const shoot = async (html: string, name: string, width: number) => {
    const tab = await browser.newPage({ viewport: { width, height: 900 } });
    await tab.setContent(html);
    await tab.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
    await tab.close();
    console.log(`  ${name}.png`);
  };

  console.log('\nart sheets:');

  // --- One poster per format, at the size they are actually browsed at ----
  const perFormat = FORMATS.map((format: Format) => {
    const arch = SHOW_ARCHETYPES.find((a) => a.format === format);
    if (!arch) return '';
    const art = renderToStaticMarkup(
      <Poster seed={arch.id} format={arch.format} title={arch.title} size="lg" />,
    );
    return cell(art, `${format}<br>${arch.title}`);
  }).join('');
  await shoot(page('Posters — one per format (lg)', perFormat, 7, 140, collectedStyles()), 'art-01-formats', 1180);

  // --- A broad sweep, to expose repetition across the whole catalogue ----
  const sweep = SHOW_ARCHETYPES.slice(0, 60)
    .map((a) => {
      const art = renderToStaticMarkup(
        <Poster seed={a.id} format={a.format} title={a.title} size="md" />,
      );
      return cell(art, a.title);
    })
    .join('');
  await shoot(page('Posters — 60 of the catalogue (md)', sweep, 10, 100, collectedStyles()), 'art-02-sweep', 1240);

  // --- The same shows as thumbnails: does anything survive at 40px? ------
  const thumbs = SHOW_ARCHETYPES.slice(0, 60)
    .map((a) => cell(renderToStaticMarkup(<Poster seed={a.id} format={a.format} size="sm" />), ''))
    .join('');
  await shoot(page('Posters — thumbnail legibility (sm, 40px)', thumbs, 15, 46, collectedStyles()), 'art-03-thumbs', 1000);

  // --- Faces --------------------------------------------------------------
  const Portrait = await loadPortrait();
  if (!Portrait) {
    console.log('  (no Portrait.tsx yet — skipping face sheets)');
  } else {
    // Real people from a real world, so the sheet reflects the actual name pool and
    // role mix rather than invented seeds that flatter the generator.
    const state = newGame({ seed: 3, studioName: 'Sheet Pictures' });
    const people = Object.values(state.talent).slice(0, 72);

    const faces = people
      .map((p: any) =>
        cell(
          renderToStaticMarkup(<Portrait seed={p.id} name={p.name} size={84} person={p} />),
          `${p.name}<br>${p.role}`,
        ),
      )
      .join('');
    await shoot(page('Faces — 72 of the pool (84px)', faces, 9, 96, collectedStyles()), 'art-04-faces', 1080);

    // The size that actually appears in lists. If they blur together here, they are
    // not doing their job — this is where most of them are seen.
    const small = people
      .slice(0, 60)
      .map((p: any) =>
        cell(renderToStaticMarkup(<Portrait seed={p.id} name={p.name} size={34} person={p} />), ''),
      )
      .join('');
    await shoot(page('Faces — list size (34px)', small, 15, 40, collectedStyles()), 'art-05-faces-small', 920);
  }

  await browser.close();
  console.log('');
}

void main();
