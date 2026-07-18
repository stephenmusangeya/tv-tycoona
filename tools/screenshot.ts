/**
 * Look at the game.
 *
 * Builds the web bundle, drives it in a real browser and writes screenshots.
 *
 * The render-check harness asserts that components produce the right markup, which is
 * necessary but tells you nothing about whether a screen is cramped, empty or ugly.
 * This exists so those judgements get made by looking rather than by imagining.
 *
 *   npx tsx tools/screenshot.ts
 */
import { chromium, type Browser, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PORT = 4173;
const DIR = 'dist-web';
const OUT = 'tools/shots';

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

async function run(cmd: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

async function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server never came up at ${url}`);
}

/**
 * Click a control by its test id.
 *
 * Text lookups are not safe here: an earlier version clicked by visible text and
 * `getByText('Start')` matched the paragraph "You start small…" before the button, so
 * the harness never left the title screen and every screenshot silently showed the
 * same page. Test ids are unambiguous.
 */
async function tap(page: Page, testId: string, waitMs = 600): Promise<boolean> {
  try {
    await page.getByTestId(testId).first().click({ timeout: 6000 });
    await page.waitForTimeout(waitMs);
    return true;
  } catch {
    console.log(`    !! could not tap "${testId}"`);
    return false;
  }
}

/** Fail loudly rather than screenshotting the wrong screen. */
async function mustTap(page: Page, testId: string, waitMs = 600): Promise<void> {
  const ok = await tap(page, testId, waitMs);
  if (!ok) throw new Error(`harness could not click "${testId}" — screenshots would be wrong`);
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  ${name}.png`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  console.log('building web bundle…');
  await run('npx', ['expo', 'export', '--platform', 'web', '--output-dir', DIR]);

  console.log('serving…');
  const server: ChildProcess = spawn('npx', ['serve', DIR, '-l', String(PORT)], {
    stdio: 'ignore',
  });

  let browser: Browser | undefined;
  try {
    await waitForServer(`http://localhost:${PORT}`);

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: DESKTOP });
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(`PAGE ERROR: ${e.message}`));

    await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    console.log('\nscreenshots:');
    await shoot(page, '01-title');

    // World generation builds ~900 talent and ~60 shows; give it room.
    await mustTap(page, 'new-game', 600);
    await shoot(page, '01b-title-naming');
    await mustTap(page, 'start-game', 4000);

    // A first run opens with the introduction over the desk. Shoot it — it is the
    // first thing a new player sees and deserves the same scrutiny as a room — then
    // dismiss it, because it is a modal scrim and every later tap lands on it instead
    // of the control underneath.
    await shoot(page, '02a-onboarding');
    await mustTap(page, 'onboarding-skip', 700);

    await shoot(page, '02-desk-empty');

    await mustTap(page, 'make-show', 900);
    await shoot(page, '03-new-shows');

    await mustTap(page, 'see-details', 700);
    await shoot(page, '04-show-details');

    await mustTap(page, 'commission-show', 2000);
    await shoot(page, '05-show-page');

    await mustTap(page, 'close-show', 600);
    await mustTap(page, 'nav-dashboard', 600);
    // Play until a channel bids, then take the deal — the loop a real player runs.
    let accepted = false;
    for (let i = 0; i < 16; i++) {
      await tap(page, 'skip-four', 320);
      if (!accepted && (await page.getByTestId('accept-offer').count()) > 0) {
        await shoot(page, '06a-decision');
        await tap(page, 'accept-offer', 600);
        accepted = true;
      }
    }
    await page.waitForTimeout(1200);
    console.log(accepted ? '    (took a channel offer)' : '    !! no offer ever appeared');

    // Play single weeks until an episode actually airs, then catch the overnights.
    let sawResults = false;
    for (let i = 0; i < 45 && !sawResults; i++) {
      await tap(page, 'advance-week', 260);
      // The overnights now play on the set, so look for the reel's kicker text.
      if ((await page.getByText('THE OVERNIGHTS').count()) > 0) {
        await shoot(page, '06b-overnights');
        sawResults = true;
        await page.waitForTimeout(2000);
      }
    }
    console.log(sawResults ? '    (saw the overnights)' : '    !! overnights never fired');
    await shoot(page, '06-desk-playing');

    await mustTap(page, 'nav-slate');
    await shoot(page, '07-my-shows');

    await mustTap(page, 'nav-inbox');
    await shoot(page, '08-inbox');

    await mustTap(page, 'nav-talent');
    await shoot(page, '09-talent');

    await mustTap(page, 'nav-industry');
    // Industry plays the chart as a countdown, so arriving and shooting immediately
    // catches it mid-reveal — most placings still empty rules. Skip to the finished
    // chart, then let the figures finish rolling up before the shutter.
    await mustTap(page, 'chart-skip', 1200);
    await shoot(page, '10-industry');

    await mustTap(page, 'open-menu', 900);
    await shoot(page, '12-menu');
    await mustTap(page, 'close-menu', 500);

    await page.setViewportSize(PHONE);
    await mustTap(page, 'nav-dashboard', 900);
    await shoot(page, '11-phone-desk');

    console.log(`\nconsole errors: ${errors.length}`);
    errors.slice(0, 8).forEach((e) => console.log(`  ${e.slice(0, 200)}`));
  } finally {
    await browser?.close();
    server.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
