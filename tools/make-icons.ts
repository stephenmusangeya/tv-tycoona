/**
 * Generate the app icons.
 *
 * The project shipped Expo's stock blue placeholders, which is the single most
 * obvious "unfinished" signal an app can send on a home screen. These are drawn from
 * the same clapperboard path the game uses for its own brand mark, so the icon, the
 * nav rail and the title screen are demonstrably the same piece of artwork rather
 * than three things that merely resemble each other.
 *
 * Rendered by driving a real browser rather than by adding an image library: the repo
 * already depends on Playwright for screenshots, and an SVG rasterised by a browser is
 * exactly what the design is authored as.
 *
 *   npx tsx tools/make-icons.ts
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'assets';

/** The brand palette, kept in step with src/ui/theme.ts. */
const OXBLOOD = '#B0342A';
const OXBLOOD_DEEP = '#7E211A';
const CREAM = '#F6F1E6';
const GOLD = '#C08A1E';

/**
 * The clapperboard, copied from src/ui/icons.tsx.
 *
 * Duplicated deliberately: this script runs in plain Node with no React, and importing
 * a .tsx component to read a string out of it would drag the whole UI stack in. The
 * comment is the contract — if the mark changes there, change it here.
 */
const SLATE =
  'M2.6 6.1 L20.9 2.2 L21.9 6.6 L3.6 10.5 Z M6.4 5.3 L5.0 8.0 L7.3 7.5 L8.7 4.8 Z M11.0 4.3 L9.6 7.0 L11.9 6.5 L13.3 3.8 Z M15.6 3.3 L14.2 6.0 L16.5 5.5 L17.9 2.8 Z';
const BODY =
  'M3.2 11.4 H21.4 A0.9 0.9 0 0 1 22.3 12.3 V20.6 A1.2 1.2 0 0 1 21.1 21.8 H3.5 A1.2 1.2 0 0 1 2.3 20.6 V12.3 A0.9 0.9 0 0 1 3.2 11.4 Z';

interface IconSpec {
  file: string;
  size: number;
  /** Background: a colour, or null for transparency. */
  background: string | null;
  markColor: string;
  /** Fraction of the canvas the mark occupies. */
  scale: number;
  /** Rounded corners, for the marketing icon. */
  radius?: number;
  /** A gold underline, dropped at small sizes where it turns to mush. */
  rule?: boolean;
}

const SPECS: IconSpec[] = [
  // iOS / marketing icon. Square — the platform applies its own mask.
  { file: 'icon.png', size: 1024, background: OXBLOOD, markColor: CREAM, scale: 0.68, rule: true },
  { file: 'splash-icon.png', size: 1024, background: null, markColor: CREAM, scale: 0.52, rule: true },

  // Android adaptive icon: foreground must sit inside the 66% safe zone, because the
  // launcher may crop anything outside it to a circle, squircle or rounded square.
  {
    file: 'android-icon-foreground.png',
    size: 512,
    background: null,
    markColor: CREAM,
    scale: 0.42,
  },
  { file: 'android-icon-background.png', size: 512, background: OXBLOOD, markColor: OXBLOOD, scale: 0 },
  // Monochrome (themed icons): a solid silhouette, tinted by the system.
  {
    file: 'android-icon-monochrome.png',
    size: 432,
    background: null,
    markColor: '#000000',
    scale: 0.42,
  },

  // Splash: the mark alone on transparency, over the splash background colour.

  // Favicon: no rule, no gradient — at 48px only the silhouette survives.
  { file: 'favicon.png', size: 48, background: OXBLOOD, markColor: CREAM, scale: 0.62 },
];

function page(spec: IconSpec): string {
  const { size, background, markColor, scale, radius, rule } = spec;
  const markSize = size * scale;
  const offset = (size - markSize) / 2;

  // The mark sits fractionally high when a rule is present, so the pair reads as
  // optically centred rather than mathematically centred.
  const lift = rule ? size * 0.035 : 0;

  return `<!doctype html>
<html><head><style>
  html, body { margin: 0; padding: 0; background: transparent; }
  #canvas {
    width: ${size}px; height: ${size}px; position: relative;
    ${radius ? `border-radius: ${radius}px; overflow: hidden;` : ''}
  }
</style></head>
<body><div id="canvas">
  <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${OXBLOOD}"/>
        <stop offset="100%" stop-color="${OXBLOOD_DEEP}"/>
      </linearGradient>
    </defs>
    ${background ? `<rect width="${size}" height="${size}" fill="url(#bg)"/>` : ''}
    ${
      scale > 0
        ? `<g transform="translate(${offset}, ${offset - lift}) scale(${markSize / 24})">
             <path d="${SLATE}" fill="${markColor}" fill-rule="evenodd"/>
             <path d="${BODY}" fill="${markColor}" fill-rule="evenodd"/>
           </g>`
        : ''
    }
    ${
      rule
        ? // The ruled lines a real slate carries (PROD / SCENE / TAKE). Without them
          // the board's face is a blank slab and the mark reads as a television with a
          // lid rather than a clapperboard. Dropped below ~192px, where they silt up.
          `<g transform="translate(${offset}, ${offset - lift}) scale(${markSize / 24})">
             <rect x="4.6" y="14.6" width="15.4" height="0.5" rx="0.25" fill="${OXBLOOD}" opacity="0.55"/>
             <rect x="4.6" y="17.2" width="15.4" height="0.5" rx="0.25" fill="${OXBLOOD}" opacity="0.55"/>
             <rect x="4.6" y="19.8" width="9.2" height="0.5" rx="0.25" fill="${GOLD}" opacity="0.85"/>
           </g>`
        : ''
    }
  </svg>
</div></body></html>`;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  try {
    for (const spec of SPECS) {
      const tab = await browser.newPage({
        viewport: { width: spec.size, height: spec.size },
        deviceScaleFactor: 1,
      });
      await tab.setContent(page(spec));
      const element = await tab.$('#canvas');
      if (!element) throw new Error('icon canvas missing');
      await element.screenshot({
        path: `${OUT}/${spec.file}`,
        omitBackground: spec.background === null,
      });
      await tab.close();
      console.log(`  wrote ${OUT}/${spec.file} (${spec.size}px)`);
    }
  } finally {
    await browser.close();
  }

  console.log('\nicons regenerated\n');
}

void main();
