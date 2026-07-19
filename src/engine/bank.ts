import { libraryValue } from './economy';
import type { GameEvent, GameEventKind, GameState } from './types';

/**
 * The bank.
 *
 * A studio game without a lender is a studio game without stakes: you could run at a
 * loss for twenty years and nothing ever came to collect, which made every financial
 * decision weightless. The bank is what turns the deficit-financing premise into a
 * gamble — it will fund a slate you cannot yet pay for, and it will eventually stop.
 *
 * Two rules govern everything here:
 *
 *  1. **The ceiling is earned, not fixed.** A studio with a library has collateral and
 *     gets more rope; one with nothing to sell and no reputation gets less.
 *  2. **Nobody is ever closed down by surprise.** Foreclosure is only ever reachable
 *     through letters the player has already read in the in-tray, and there is always
 *     a grace period between the final demand and the axe.
 *
 * Everything in this module is a pure function of GameState — no RNG at all — so it
 * cannot disturb the deterministic replay the rest of the engine depends on.
 */

export const BANK = {
  /**
   * The overdraft any studio gets on its name alone, before collateral.
   *
   * Sized against a $10M opening balance and $120K/week of overhead: enough that
   * deficit-financing a first show is genuinely possible, tight enough that a second
   * expensive commission before the first pays back is a decision rather than a
   * formality.
   */
  floor: 12_000_000,

  /** The most a spotless reputation adds on top of the floor. */
  reputationFacility: 22_000_000,

  /**
   * Share of the library the bank will lend against.
   *
   * A library is the one asset a studio has that a lender can actually value, which is
   * why building one buys you room to build more. Below 1 because a forced sale never
   * fetches the shelf price.
   */
  libraryAdvanceRate: 0.75,

  /**
   * How fast the facility can be withdrawn, as a share of the current ceiling per week.
   *
   * A facility is reviewed, not yanked. Without this, cancelling a show could shrink
   * the ceiling below the debt in a single tick and put a solvent studio straight into
   * breach for a decision it made in good faith.
   */
  maxWeeklyContraction: 0.04,

  /** Debt as a share of the ceiling at which the bank first writes. */
  concernRatio: 0.7,
  /** Where the letter stops being friendly. */
  formalRatio: 0.88,

  /** Weeks before the same tier of letter is sent again. Nagging is not a mechanic. */
  reminderWeeks: 10,

  /** Weeks between the final demand and foreclosure. The player's last chance. */
  graceWeeks: 6,

  /** Back under this and the breach is considered cured — the grace clock resets. */
  curedRatio: 0.8,
  /** Back under this and the file is closed entirely. */
  clearedRatio: 0.5,
} as const;

/** How worried the bank is, from nothing at all to a final demand. */
export type BankTier = 0 | 1 | 2 | 3;

export interface BankPosition {
  debt: number;
  limit: number;
  /** What is left to borrow. Negative means the studio is already in breach. */
  headroom: number;
  /** Debt as a share of the ceiling. 1 or more is a breach. */
  ratio: number;
  tier: BankTier;
  warnings: number;
  /** Weeks left before foreclosure, once a final demand is outstanding. */
  weeksToForeclosure?: number;
  closed: boolean;
  closedReason?: string;
}

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

function playerCompanyIds(state: GameState): string[] {
  const { studioId, networkId, streamerId } = state.player;
  return [studioId, networkId, streamerId].filter((id): id is string => Boolean(id));
}

export function playerDebt(state: GameState): number {
  return playerCompanyIds(state).reduce(
    (sum, id) => sum + (state.companies[id]?.debt ?? 0),
    0,
  );
}

function playerLibraryWorth(state: GameState): number {
  const productions = Object.values(state.productions);
  return playerCompanyIds(state).reduce(
    (sum, id) => sum + libraryValue(productions, id),
    0,
  );
}

/**
 * What the bank thinks the studio is good for today.
 *
 * Reputation is treated as collateral of a sort — it is what gets the next show
 * financed — but it is deliberately worth less than an actual library, because the
 * game's argument is that owning your shows is what makes you solvent.
 */
export function assessCreditLimit(state: GameState): number {
  const studio = state.companies[state.player.studioId];
  const standing = studio
    ? (studio.criticalStanding + studio.popularStanding) / 200
    : 0;

  return Math.round(
    BANK.floor +
      BANK.reputationFacility * Math.max(0, Math.min(1, standing)) +
      BANK.libraryAdvanceRate * playerLibraryWorth(state),
  );
}

export function bankPosition(state: GameState): BankPosition {
  const bank = state.bank;
  const debt = playerDebt(state);
  const limit = Math.max(1, bank?.creditLimit ?? 0);
  const ratio = debt / limit;

  const warnings = bank?.warnings ?? 0;
  const outstanding =
    warnings >= 3 && ratio >= 1 && bank?.lastWarningWeek !== undefined;

  return {
    debt,
    limit,
    headroom: limit - debt,
    ratio,
    tier: tierFor(ratio),
    warnings,
    weeksToForeclosure: outstanding
      ? Math.max(0, BANK.graceWeeks - (state.absoluteWeek - bank!.lastWarningWeek!))
      : undefined,
    closed: isClosedDown(state),
    closedReason: bank?.closedDownReason,
  };
}

export function isClosedDown(state: GameState): boolean {
  return state.bank?.closedDownWeek !== undefined;
}

function tierFor(ratio: number): BankTier {
  if (ratio >= 1) return 3;
  if (ratio >= BANK.formalRatio) return 2;
  if (ratio >= BANK.concernRatio) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// The weekly review
// ---------------------------------------------------------------------------

type Emit = (
  kind: GameEventKind,
  headline: string,
  extra?: Partial<GameEvent>,
) => GameEvent;

/**
 * Re-assess the facility, write to the player if the position warrants it, and
 * foreclose if the final demand has run out of road.
 *
 * Called once at the end of every tick, after the week's money has settled, so the
 * letter always quotes the figure the player will see on the desk.
 */
export function reviewBank(state: GameState, emit: Emit): void {
  const bank = state.bank;
  if (!bank || isClosedDown(state)) return;

  // Reassess first: a week that sold a show into syndication should be judged against
  // the ceiling that sale just bought, not last week's.
  const assessed = assessCreditLimit(state);
  bank.creditLimit = Math.round(
    assessed >= bank.creditLimit
      ? assessed
      : Math.max(assessed, bank.creditLimit * (1 - BANK.maxWeeklyContraction)),
  );

  const debt = playerDebt(state);
  const limit = Math.max(1, bank.creditLimit);
  const ratio = debt / limit;
  const tier = tierFor(ratio);

  // --- Foreclosure ---------------------------------------------------------
  // Checked before anything else is written, but only ever reachable from a final
  // demand the player has already had in the tray for the full grace period.
  if (
    tier === 3 &&
    bank.warnings >= 3 &&
    bank.lastWarningWeek !== undefined &&
    state.absoluteWeek - bank.lastWarningWeek >= BANK.graceWeeks
  ) {
    closeDown(state, emit, debt, limit);
    return;
  }

  // --- Recovery ------------------------------------------------------------
  if (tier === 0 && bank.warnings > 0 && ratio < BANK.clearedRatio) {
    bank.warnings = 0;
    bank.lastWarningWeek = undefined;
    emit('money', 'The bank closes your file', {
      body: `Debt is down to ${money(debt)} against a ${money(limit)} facility. No further action.`,
      playerRelevant: true,
      companyId: state.player.studioId,
    });
    return;
  }

  // A cured breach steps back to a formal notice rather than clearing outright: the
  // studio is still in trouble, but the grace clock stops and a fresh breach starts a
  // fresh demand rather than foreclosing days later.
  if (bank.warnings >= 3 && ratio < BANK.curedRatio) {
    bank.warnings = 2;
    bank.lastWarningWeek = state.absoluteWeek;
    emit('money', 'The bank withdraws its demand', {
      body: `Debt back inside the ${money(limit)} ceiling at ${money(debt)}. The facility stands.`,
      playerRelevant: true,
      companyId: state.player.studioId,
    });
    return;
  }

  if (tier === 0) return;

  // --- Letters -------------------------------------------------------------
  // A new tier always writes. The same tier only writes again after a cooling-off
  // period, and tier 3 never repeats at all — its letter starts the grace clock, and
  // resending it would keep pushing foreclosure out of reach forever.
  const escalating = tier > bank.warnings;
  const stale =
    bank.lastWarningWeek !== undefined &&
    state.absoluteWeek - bank.lastWarningWeek >= BANK.reminderWeeks;
  if (!escalating && (tier === 3 || !stale)) return;

  bank.warnings = Math.max(bank.warnings, tier);
  bank.lastWarningWeek = state.absoluteWeek;
  writeLetter(state, emit, tier, debt, limit);
}

/**
 * The letter itself.
 *
 * Every tier states the same three things — what you owe, what the ceiling is, and
 * what happens next — because a warning the player has to do arithmetic on is not a
 * warning. The tone escalates; the arithmetic does not move.
 */
function writeLetter(
  state: GameState,
  emit: Emit,
  tier: BankTier,
  debt: number,
  limit: number,
): void {
  const headroom = limit - debt;
  const position = `You owe ${money(debt)} against a ceiling of ${money(limit)}.`;

  const letters: Record<1 | 2 | 3, { headline: string; body: string }> = {
    1: {
      headline: 'Your bank would like a word',
      body: `${position} That leaves ${money(headroom)} to draw on. Sell repeats, package an old run, or trim the slate before it closes.`,
    },
    2: {
      headline: 'Formal notice from the bank',
      body: `${position} Only ${money(headroom)} left. Past the ceiling you have ${BANK.graceWeeks} weeks to get back under it or the bank closes the studio down.`,
    },
    3: {
      headline: 'Final demand from the bank',
      body: `${position} You are ${money(-headroom)} over the ceiling. Get back inside it within ${BANK.graceWeeks} weeks or the studio is closed down.`,
    },
  };

  const letter = letters[tier as 1 | 2 | 3];
  emit('money', letter.headline, {
    body: letter.body,
    playerRelevant: true,
    companyId: state.player.studioId,
  });
}

/**
 * Foreclosure.
 *
 * Deliberately leaves every other field of the save alone: the run is over, but the
 * player should be able to look at the slate, the archive and the library they spent
 * years building rather than being ejected to the title screen.
 */
function closeDown(state: GameState, emit: Emit, debt: number, limit: number): void {
  state.bank.closedDownWeek = state.absoluteWeek;
  state.bank.closedDownReason =
    `Debt of ${money(debt)} against a ceiling of ${money(limit)}, ` +
    `unresolved ${BANK.graceWeeks} weeks after the final demand.`;

  emit('money', 'The bank has closed your studio down', {
    body: state.bank.closedDownReason,
    playerRelevant: true,
    companyId: state.player.studioId,
  });
}

/**
 * Money as the bank would write it.
 *
 * Local rather than shared with tick.ts's formatMoney: importing it the other way
 * would make the engine's money formatting depend on the tick module, and this rounds
 * harder on purpose — a letter says "$21.4M", not "$21,431,908".
 */
function money(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${Math.round(abs)}`;
}
