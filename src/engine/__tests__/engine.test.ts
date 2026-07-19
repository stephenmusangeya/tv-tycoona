import { describe, expect, it } from 'vitest';

import { AUDIENCE_SEGMENTS, SEGMENTS_BY_ID } from '../../data/segments';
import { appealProfile, audienceOverlap, blendedAdPremium, segmentMatch } from '../audience';
import { brandSafety, budgetScoreProbe, licenseFee, syndicationValue } from './helpers';
import { ECONOMY, RERUN_MINIMUM_EPISODES, rightsSaleValue } from '../economy';
import { createRng } from '../rng';
import { simulateSlot } from '../ratings';
import { newGame } from '../setup';
import { advanceWeek, playerCash } from '../tick';
import {
  acceptOffer,
  developOriginal,
  greenlightPitch,
  licenseReruns,
  passOnPitch,
  rerunBidsFor,
  sellRights,
} from '../actions';
import { SHOW_ARCHETYPES, conceptOf } from '../../data';
import type { Attributes, GameState } from '../types';

const attrs = (overrides: Partial<Attributes> = {}): Attributes => ({
  entertainment: 50,
  prestige: 50,
  violence: 50,
  wholesomeness: 50,
  edginess: 50,
  humor: 50,
  heart: 50,
  complexity: 50,
  ...overrides,
});

describe('rng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng(1234);
    const b = createRng(1234);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different streams for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('respects integer bounds', () => {
    const rng = createRng(7);
    for (let i = 0; i < 500; i++) {
      const value = rng.int(3, 6);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(6);
    }
  });

  it('weighted() never returns undefined when all weights are zero', () => {
    const rng = createRng(9);
    const picked = rng.weighted(['a', 'b', 'c'], () => 0);
    expect(['a', 'b', 'c']).toContain(picked);
  });
});

describe('audience model', () => {
  it('scores a show at its segment ideal near 1', () => {
    const kids = SEGMENTS_BY_ID.kids;
    expect(segmentMatch(kids.ideal, kids)).toBeCloseTo(1, 5);
  });

  it('punishes a show that sits between every taste', () => {
    // The "appeals to nobody" show: dead centre on every axis. It should not be the
    // favourite of any segment — stated relative to a targeted show, since the
    // absolute value moves whenever APPEAL_EXPONENT is tuned.
    const bland = appealProfile(attrs());
    const bestBland = Math.max(...Object.values(bland));
    const targeted = appealProfile(SEGMENTS_BY_ID.families.ideal).families;
    expect(bestBland).toBeLessThan(targeted * 0.5);
  });

  it('rewards a show precisely targeted at one segment over a broad one', () => {
    const families = SEGMENTS_BY_ID.families;
    const targeted = appealProfile(families.ideal).families;
    const broad = appealProfile(attrs()).families;
    expect(targeted).toBeGreaterThan(broad * 3);
  });

  it('treats violence and wholesomeness as genuinely opposed', () => {
    const violent = appealProfile(
      attrs({ violence: 95, edginess: 90, wholesomeness: 5, complexity: 80 }),
    );
    expect(violent.families).toBeLessThan(violent.youngAdults);
    expect(violent.kids).toBeLessThan(0.05);
  });

  it('rates opposed shows as far less overlapping than similar ones', () => {
    const kidsShow = appealProfile(SEGMENTS_BY_ID.kids.ideal);
    const youngAdultShow = appealProfile(SEGMENTS_BY_ID.youngAdults.ideal);
    const similarToKids = appealProfile(
      attrs({ ...SEGMENTS_BY_ID.kids.ideal, entertainment: 80 }),
    );

    const opposed = audienceOverlap(kidsShow, youngAdultShow);
    const similar = audienceOverlap(kidsShow, similarToKids);

    expect(similar).toBeGreaterThan(0.8);
    expect(opposed).toBeLessThan(similar * 0.6);
  });

  it('prices a young-adult audience above a senior one', () => {
    const young = blendedAdPremium({
      kids: 0, teens: 0, youngAdults: 10, families: 0, adults: 0, seniors: 0,
    });
    const old = blendedAdPremium({
      kids: 0, teens: 0, youngAdults: 0, families: 0, adults: 0, seniors: 10,
    });
    expect(young).toBeGreaterThan(old * 2);
  });
});

describe('economy', () => {
  it('discounts advertising against violent, edgy shows', () => {
    expect(brandSafety(attrs({ violence: 95, edginess: 95 }))).toBeLessThan(
      brandSafety(attrs({ violence: 5, edginess: 5 })),
    );
  });

  it('never discounts brand safety below the floor', () => {
    expect(brandSafety(attrs({ violence: 100, edginess: 100 }))).toBeGreaterThanOrEqual(0.6);
  });

  it('licenses a new show below its cost — deficit financing', () => {
    const archetype = SHOW_ARCHETYPES.find((a) => a.format === 'sitcom')!;
    const fee = licenseFee(archetype, 0.5, 0);
    expect(fee).toBeLessThan(archetype.baseCostPerEpisode);
  });

  it('lets a proven show negotiate past its cost', () => {
    const archetype = SHOW_ARCHETYPES.find((a) => a.format === 'sitcom')!;
    const rookie = licenseFee(archetype, 0.9, 0);
    const proven = licenseFee(archetype, 0.9, 5);
    expect(proven).toBeGreaterThan(rookie);
    expect(proven).toBeGreaterThan(archetype.baseCostPerEpisode);
  });

  it('punishes starving a show far more than it rewards overfunding it', () => {
    const starved = budgetScoreProbe(0.5);
    const adequate = budgetScoreProbe(1);
    const lavish = budgetScoreProbe(2);
    expect(adequate - starved).toBeGreaterThan(lavish - adequate);
  });
});

describe('slot competition', () => {
  const baseState = () => newGame({ seed: 5 });

  it('splits an audience between two similar shows', () => {
    const state = baseState();
    const airing = Object.values(state.productions).filter((p) => p.status === 'airing');
    const [a, b] = airing;

    const network = state.companies[a.deal!.networkId];
    // A show on air belongs to *this save's* catalogue, not the authored pool — see
    // GameState.concepts. Resolving through the static array only worked while every
    // world was handed the same 120 shows.
    const archetypeOf = (id: string) => conceptOf(state.concepts, id);

    const solo = simulateSlot(
      [{ production: a, archetype: archetypeOf(a.archetypeId), network }],
      state.talent,
      { hour: 21 },
    );

    // Same show, twice, head to head — each copy must take less than the solo run.
    const contested = simulateSlot(
      [
        { production: a, archetype: archetypeOf(a.archetypeId), network },
        { production: { ...b, attributes: a.attributes, id: 'clone' }, archetype: archetypeOf(a.archetypeId), network },
      ],
      state.talent,
      { hour: 21 },
    );

    expect(contested[0].viewers).toBeLessThan(solo[0].viewers);
  });

  it('lets counter-programming keep its audience', () => {
    const state = baseState();
    const production = Object.values(state.productions).find((p) => p.status === 'airing')!;
    const network = state.companies[production.deal!.networkId];
    const archetype = conceptOf(state.concepts, production.archetypeId);

    const familyShow = {
      ...production,
      id: 'family',
      attributes: SEGMENTS_BY_ID.families.ideal,
    };
    const youngShow = {
      ...production,
      id: 'young',
      attributes: SEGMENTS_BY_ID.youngAdults.ideal,
    };
    const rivalFamilyShow = { ...familyShow, id: 'family2' };

    const vsOpposite = simulateSlot(
      [
        { production: familyShow, archetype, network },
        { production: youngShow, archetype, network },
      ],
      state.talent,
      { hour: 20 },
    );

    const vsIdentical = simulateSlot(
      [
        { production: familyShow, archetype, network },
        { production: rivalFamilyShow, archetype, network },
      ],
      state.talent,
      { hour: 20 },
    );

    // The crisp claim: a direct competitor guts the family show's core segment,
    // while a counter-programmed rival barely touches it.
    const coreVsOpposite = vsOpposite[0].viewersBySegment.families;
    const coreVsIdentical = vsIdentical[0].viewersBySegment.families;
    expect(coreVsOpposite).toBeGreaterThan(coreVsIdentical * 1.25);

    // And that shows up in the headline number too, if less dramatically, because
    // the two shows still overlap a little in the middle-aged segments.
    expect(vsOpposite[0].viewers).toBeGreaterThan(vsIdentical[0].viewers * 1.1);
  });

  it('gives kids almost no audience at 10pm', () => {
    const state = baseState();
    const production = Object.values(state.productions).find((p) => p.status === 'airing')!;
    const network = state.companies[production.deal!.networkId];
    const archetype = conceptOf(state.concepts, production.archetypeId);
    const kidsShow = { ...production, attributes: SEGMENTS_BY_ID.kids.ideal };

    const early = simulateSlot([{ production: kidsShow, archetype, network }], state.talent, { hour: 20 });
    const late = simulateSlot([{ production: kidsShow, archetype, network }], state.talent, { hour: 22 });

    expect(late[0].viewersBySegment.kids).toBeLessThan(early[0].viewersBySegment.kids * 0.2);
  });
});

describe('world simulation', () => {
  it('creates a populated world', () => {
    const state = newGame({ seed: 3 });
    expect(Object.keys(state.companies).length).toBeGreaterThan(10);
    expect(Object.keys(state.productions).length).toBeGreaterThan(40);
    expect(Object.keys(state.talent).length).toBeGreaterThan(700);
  });

  it('is fully deterministic across a long run', () => {
    const run = (): GameState => {
      const state = newGame({ seed: 99 });
      for (let i = 0; i < 120; i++) advanceWeek(state);
      return state;
    };

    const a = run();
    const b = run();

    expect(a.rngState).toBe(b.rngState);
    expect(playerCash(a)).toBe(playerCash(b));
    expect(Object.keys(a.productions).length).toBe(Object.keys(b.productions).length);
    expect(a.events.map((e) => e.headline)).toEqual(b.events.map((e) => e.headline));
  });

  it('rolls the calendar correctly across a year boundary', () => {
    const state = newGame({ seed: 11 });
    for (let i = 0; i < 52; i++) advanceWeek(state);
    expect(state.year).toBe(2);
    expect(state.week).toBe(1);
    expect(state.absoluteWeek).toBe(52);
  });

  it('keeps shows airing and retiring them in believable numbers', () => {
    const state = newGame({ seed: 21 });
    for (let i = 0; i < 260; i++) advanceWeek(state);

    const live = Object.values(state.productions).filter(
      (p) => p.status === 'airing' || p.status === 'hiatus',
    );
    const cancelled = Object.values(state.productions).filter((p) => p.status === 'cancelled');

    expect(live.length).toBeGreaterThan(20);
    expect(cancelled.length).toBeGreaterThan(5);
  });

  it('never lets a season record more episodes than the season allows', () => {
    const state = newGame({ seed: 31 });
    for (let i = 0; i < 200; i++) advanceWeek(state);

    for (const production of Object.values(state.productions)) {
      for (const season of production.history) {
        expect(season.episodes).toBeLessThanOrEqual(production.episodesPerSeason);
        expect(season.averageViewers).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(season.averageViewers)).toBe(true);
      }
    }
  });

  it('pays out syndication only past the episode threshold', () => {
    const state = newGame({ seed: 41 });
    for (let i = 0; i < 300; i++) advanceWeek(state);

    for (const production of Object.values(state.productions)) {
      if (production.syndicated) {
        expect(production.totalEpisodes).toBeGreaterThanOrEqual(65);
      }
    }
  });

  it('keeps every company balance finite', () => {
    const state = newGame({ seed: 51 });
    for (let i = 0; i < 300; i++) advanceWeek(state);

    for (const company of Object.values(state.companies)) {
      expect(Number.isFinite(company.cash)).toBe(true);
      expect(Number.isFinite(company.debt)).toBe(true);
      expect(company.cash).toBeGreaterThanOrEqual(0); // shortfalls become debt
    }
  });
});

describe('player actions', () => {
  it('develops an original show into the slate', () => {
    const state = newGame({ seed: 61 });
    const archetype = SHOW_ARCHETYPES.find(
      (a) => !Object.values(state.productions).some((p) => p.archetypeId === a.id),
    )!;

    const result = developOriginal(state, archetype.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.ownerId).toBe(state.player.studioId);
    expect(result.value.status).toBe('development');
    expect(result.value.quality).toBeGreaterThan(0);
  });

  it('refuses to develop a show someone is already making', () => {
    const state = newGame({ seed: 62 });
    const taken = Object.values(state.productions)[0];
    const result = developOriginal(state, taken.archetypeId);
    expect(result.ok).toBe(false);
  });

  it('green-lights a pitch and attaches the pitcher', () => {
    const state = newGame({ seed: 63 });

    // Run until a pitch turns up.
    let guard = 0;
    while (state.pitches.length === 0 && guard++ < 3000) advanceWeek(state);
    expect(state.pitches.length).toBeGreaterThan(0);

    const pitch = state.pitches[0];
    const result = greenlightPitch(state, pitch.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const attached = [
      result.value.showrunnerId,
      result.value.directorId,
      result.value.hostId,
      ...result.value.cast,
      ...result.value.writerIds,
    ];
    expect(attached).toContain(pitch.pitcherId);
    expect(state.pitches.find((p) => p.id === pitch.id)).toBeUndefined();
  });

  it('costs a relationship to pass on a pitch', () => {
    const state = newGame({ seed: 64 });
    let guard = 0;
    while (state.pitches.length === 0 && guard++ < 3000) advanceWeek(state);

    const pitch = state.pitches[0];
    const studioId = state.player.studioId;
    const before = state.talent[pitch.pitcherId].relationships[studioId] ?? 40;

    passOnPitch(state, pitch.id);

    const after = state.talent[pitch.pitcherId].relationships[studioId] ?? 40;
    expect(after).toBeLessThan(before);
  });

  it('blocks buying a network before the studio has earned it', async () => {
    const { acquireNetwork } = await import('../actions');
    const state = newGame({ seed: 65 });
    const network = Object.values(state.companies).find((c) => c.type === 'network')!;

    const result = acquireNetwork(state, network.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/established|standing/i);
  });
});

describe('owning your shows', () => {
  /** Run a game far enough that the player has a show with plenty of episodes. */
  function studioWithLibrary() {
    const state = newGame({ seed: 77 });
    const taken = new Set(Object.values(state.productions).map((p) => p.archetypeId));
    const target = SHOW_ARCHETYPES.find(
      (a) => !taken.has(a.id) && a.format === 'sitcom' && a.baseCostPerEpisode < 2_500_000,
    )!;
    const made = developOriginal(state, target.id);
    if (!made.ok) throw new Error(made.reason);

    for (let i = 0; i < 400; i++) {
      advanceWeek(state);
      const offer = state.offers.find((o) => o.productionId === made.value.id);
      if (offer) acceptOffer(state, offer.id);
      if (made.value.totalEpisodes >= 30) break;
    }
    return { state, show: made.value };
  }

  it('gives the player the rights to shows they make', () => {
    const state = newGame({ seed: 71 });
    const taken = new Set(Object.values(state.productions).map((p) => p.archetypeId));
    const target = SHOW_ARCHETYPES.find((a) => !taken.has(a.id))!;
    const made = developOriginal(state, target.id);

    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.value.rightsOwnerId).toBe(state.player.studioId);
  });

  it('refuses to sell repeats before there are enough episodes', () => {
    const state = newGame({ seed: 72 });
    const taken = new Set(Object.values(state.productions).map((p) => p.archetypeId));
    const target = SHOW_ARCHETYPES.find((a) => !taken.has(a.id))!;
    const made = developOriginal(state, target.id);
    if (!made.ok) return;

    const bids = rerunBidsFor(state, made.value.id);
    expect(bids).toHaveLength(0);

    const result = licenseReruns(state, made.value.id, 'anyone');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/more episodes/i);
  });

  it('pays weekly once repeats are licensed, without losing the show', () => {
    const { state, show } = studioWithLibrary();
    // Assert against the live threshold, not a number copied from an older build.
    expect(show.totalEpisodes).toBeGreaterThanOrEqual(RERUN_MINIMUM_EPISODES);

    const bids = rerunBidsFor(state, show.id);
    expect(bids.length).toBeGreaterThan(0);

    const deal = licenseReruns(state, show.id, bids[0].buyerId);
    expect(deal.ok).toBe(true);
    if (!deal.ok) return;

    // `deal.value` is the same object the production holds, so snapshot the number
    // rather than comparing against a field the tick will have already changed.
    const weeksBefore = deal.value.weeksRemaining;
    const payment = deal.value.weeklyPayment;
    expect(payment).toBeGreaterThan(0);

    advanceWeek(state);

    expect(show.rerunDeals[0].weeksRemaining).toBe(weeksBefore - 1);
    expect(show.rightsOwnerId).toBe(state.player.studioId);
  });

  it('actually pays the money into the studio', () => {
    const { state, show } = studioWithLibrary();
    const bids = rerunBidsFor(state, show.id);
    const deal = licenseReruns(state, show.id, bids[0].buyerId);
    if (!deal.ok) return;

    // Isolate the payment from every other weekly flow by comparing two identical
    // worlds: this one, and the same state with the deal's payment zeroed out.
    //
    // Measured on cash *minus debt*, not cash. A studio deficit-financing a show is
    // usually overdrawn, and income against an overdraft pays the debt down rather
    // than landing in the bank — so a cash-only reading showed zero and looked like
    // the repeat money had vanished. It had not; it was servicing the loan.
    const payment = deal.value.weeklyPayment;
    const studio = state.companies[state.player.studioId];
    const position = () => studio.cash - studio.debt;

    const before = position();
    advanceWeek(state);
    const withDeal = position() - before;

    deal.value.weeklyPayment = 0;
    const before2 = position();
    advanceWeek(state);
    const withoutDeal = position() - before2;

    // The week with the deal should be better off by roughly the payment.
    expect(withDeal - withoutDeal).toBeGreaterThan(payment * 0.5);
  });

  it('will not license the same buyer twice', () => {
    const { state, show } = studioWithLibrary();
    const bids = rerunBidsFor(state, show.id);
    licenseReruns(state, show.id, bids[0].buyerId);

    const again = rerunBidsFor(state, show.id).map((b) => b.buyerId);
    expect(again).not.toContain(bids[0].buyerId);
  });

  it('hands over the show and its income when sold outright', () => {
    const { state, show } = studioWithLibrary();
    const bids = rerunBidsFor(state, show.id);
    licenseReruns(state, show.id, bids[0].buyerId);

    const studio = state.companies[state.player.studioId];
    const cashBefore = studio.cash;

    const sale = sellRights(state, show.id);
    expect(sale.ok).toBe(true);
    if (!sale.ok) return;

    expect(studio.cash).toBe(cashBefore + sale.value);
    expect(show.rightsOwnerId).not.toBe(state.player.studioId);
    // Future income goes with the show.
    expect(show.rerunDeals).toHaveLength(0);
  });

  it('refuses to sell a show twice', () => {
    const { state, show } = studioWithLibrary();
    sellRights(state, show.id);
    const second = sellRights(state, show.id);
    expect(second.ok).toBe(false);
  });

  it('values a long-running show above a short one', () => {
    const { state, show } = studioWithLibrary();
    const long = rightsSaleValue(show);

    // Derive the short version from the real one so it is always genuinely shorter.
    const short = {
      ...show,
      totalEpisodes: Math.max(1, Math.floor(show.totalEpisodes / 3)),
      history: show.history.slice(0, 1),
    };
    expect(long).toBeGreaterThan(rightsSaleValue(short));
    void state;
  });
});

describe('content database', () => {
  it('has a coherent set of archetypes', () => {
    expect(SHOW_ARCHETYPES.length).toBe(120);
    const ids = new Set(SHOW_ARCHETYPES.map((s) => s.id));
    expect(ids.size).toBe(SHOW_ARCHETYPES.length);
  });

  it('keeps every attribute in range', () => {
    for (const show of SHOW_ARCHETYPES) {
      for (const value of Object.values(show.attributes)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
  });

  it('covers every audience segment with at least one strong match', () => {
    // If a segment has nothing made for it, the game has a dead demographic.
    for (const segment of AUDIENCE_SEGMENTS) {
      const best = Math.max(
        ...SHOW_ARCHETYPES.map((show) => segmentMatch(show.attributes, segment)),
      );
      expect(best).toBeGreaterThan(0.3);
    }
  });
});

// ---------------------------------------------------------------------------
// The long tail: second windows, archive sales and revivals
// ---------------------------------------------------------------------------

import {
  canSellSecondWindow,
  lifetimeStudioProfit,
  rerunWeeklyValue,
  revivalCost,
  secondWindowValue,
} from '../economy';
import {
  cancelOwnShow,
  reviveShow,
  secondWindowBidsFor,
  sellSecondWindow,
} from '../actions';

/**
 * Run a show for one full season, then pull it — the ordinary failure the long tail
 * exists to answer. Derived from a real playthrough rather than a hand-built object so
 * the numbers under test are the ones the game actually produces.
 */
function studioWithFinishedShow(seed: number) {
  const state = newGame({ seed });
  const taken = new Set(Object.values(state.productions).map((p) => p.archetypeId));
  const target = SHOW_ARCHETYPES.find(
    (a) => !taken.has(a.id) && a.format === 'sitcom' && a.baseCostPerEpisode < 2_500_000,
  )!;
  const made = developOriginal(state, target.id);
  if (!made.ok) throw new Error(made.reason);

  for (let i = 0; i < 400; i++) {
    advanceWeek(state);
    const offer = state.offers.find((o) => o.productionId === made.value.id);
    if (offer) acceptOffer(state, offer.id);
    if (made.value.history.length >= 1) break;
  }
  cancelOwnShow(state, made.value.id);
  return { state, show: made.value };
}

describe('second-window sales', () => {
  it('refuses a show that is still running', () => {
    const { state, show } = studioWithFinishedShow(101);
    show.status = 'airing';

    const sale = sellSecondWindow(state, show.id);
    expect(sale.ok).toBe(false);
    if (sale.ok) return;
    expect(sale.reason).toMatch(/finished its run/i);
  });

  it('refuses a run too short to package', () => {
    const { state, show } = studioWithFinishedShow(102);
    show.totalEpisodes = 3;

    expect(canSellSecondWindow(show)).toBe(false);
    const sale = sellSecondWindow(state, show.id);
    expect(sale.ok).toBe(false);
    if (sale.ok) return;
    expect(sale.reason).toMatch(/too few/i);
  });

  it('pays an advance into the studio and leaves the show in your hands', () => {
    const { state, show } = studioWithFinishedShow(103);
    expect(canSellSecondWindow(show)).toBe(true);

    const studio = state.companies[state.player.studioId];
    const before = studio.cash;

    const sale = sellSecondWindow(state, show.id);
    expect(sale.ok).toBe(true);
    if (!sale.ok) return;

    expect(sale.value.advance).toBeGreaterThan(0);
    expect(studio.cash).toBe(before + sale.value.advance);
    // A second window is a licence, not a sale — the show is still yours.
    expect(show.rightsOwnerId).toBe(state.player.studioId);
    expect(show.rerunDeals).toHaveLength(1);
  });

  it('is a one-shot — the run cannot be packaged twice', () => {
    const { state, show } = studioWithFinishedShow(104);
    expect(sellSecondWindow(state, show.id).ok).toBe(true);

    const again = sellSecondWindow(state, show.id);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.reason).toMatch(/already showing the repeats/i);
  });

  it('never pays back more than the show actually lost', () => {
    const { show } = studioWithFinishedShow(105);
    const lost = Math.max(0, -lifetimeStudioProfit(show));

    // Both premises are asserted so the test cannot pass by being vacuous: there has to
    // be a real deficit, and a real sale, for the cap to mean anything.
    expect(lost).toBeGreaterThan(0);
    expect(canSellSecondWindow(show)).toBe(true);
    expect(secondWindowValue(show)).toBeGreaterThan(0);

    // The cap is the whole reason this is a lifeline rather than a reason to fail on
    // purpose: failing can never turn a profit.
    expect(secondWindowValue(show)).toBeLessThanOrEqual(lost);
  });

  it('keeps the big networks out of the discount market', () => {
    const { state, show } = studioWithFinishedShow(106);
    const bids = secondWindowBidsFor(state, show.id);
    expect(bids.length).toBeGreaterThan(0);

    for (const bid of bids) {
      const buyer = state.companies[bid.buyerId];
      if (buyer.type !== 'network') continue;
      expect(buyer.reach ?? 1).toBeLessThanOrEqual(ECONOMY.secondWindow.buyerReachCeiling);
    }
  });

  it('offers nothing once a show is big enough to syndicate properly', () => {
    const { state, show } = studioWithFinishedShow(107);
    show.totalEpisodes = ECONOMY.syndicationThreshold + 5;

    expect(secondWindowValue(show)).toBe(0);
    const sale = sellSecondWindow(state, show.id);
    expect(sale.ok).toBe(false);
    if (sale.ok) return;
    expect(sale.reason).toMatch(/syndicate/i);
  });
});

describe('archive sales', () => {
  it('sells repeats out of the archive, not just off the live slate', () => {
    const { state, show } = studioWithFinishedShow(108);
    expect(show.status).toBe('cancelled');

    const bids = rerunBidsFor(state, show.id);
    expect(bids.length).toBeGreaterThan(0);

    const deal = licenseReruns(state, show.id, bids[0].buyerId);
    expect(deal.ok).toBe(true);
    if (!deal.ok) return;
    expect(deal.value.weeklyPayment).toBeGreaterThan(0);
  });

  it('values a finished run above the same show still on air', () => {
    const { show } = studioWithFinishedShow(109);
    const finished = rerunWeeklyValue(show);
    // A closed package with nothing airing against it is the better buy.
    const live = rerunWeeklyValue({ ...show, status: 'airing' });
    expect(finished).toBeGreaterThan(live);
  });
});

describe('revivals', () => {
  it('refuses a revival the studio cannot pay for', () => {
    const { state, show } = studioWithFinishedShow(110);
    const studio = state.companies[state.player.studioId];
    studio.cash = revivalCost(show) - 1;

    const revived = reviveShow(state, show.id);
    expect(revived.ok).toBe(false);
    if (revived.ok) return;
    expect(revived.reason).toMatch(/costs/i);
  });

  it('refuses to revive a show that never finished', () => {
    const { state, show } = studioWithFinishedShow(111);
    show.status = 'airing';

    const revived = reviveShow(state, show.id);
    expect(revived.ok).toBe(false);
  });

  it('brings a show back with its library and episode count intact', () => {
    const { state, show } = studioWithFinishedShow(112);
    const studio = state.companies[state.player.studioId];

    const cost = revivalCost(show);
    studio.cash = cost + 5_000_000;
    const cashBefore = studio.cash;

    const episodesBefore = show.totalEpisodes;
    const seasonsBefore = show.history.length;
    const fatigueBefore = show.fatigue;

    const revived = reviveShow(state, show.id);
    expect(revived.ok).toBe(true);
    if (!revived.ok) return;

    expect(studio.cash).toBe(cashBefore - cost);
    expect(show.revived).toBe(true);
    expect(show.status).toBe('development');
    // The point of a revival is that it does not start from zero.
    expect(show.totalEpisodes).toBe(episodesBefore);
    expect(show.history).toHaveLength(seasonsBefore);
    // Fatigue eases but never clears — a show that ran out of road comes back tired.
    expect(show.fatigue).toBeLessThan(fatigueBefore || 1);
    expect(show.fatigue).toBeGreaterThanOrEqual(fatigueBefore * 0.5);
  });

  it('starts a revival with audience memory rather than a cold launch', () => {
    const { state, show } = studioWithFinishedShow(113);
    state.companies[state.player.studioId].cash = revivalCost(show) * 2;

    const revived = reviveShow(state, show.id);
    expect(revived.ok).toBe(true);
    if (!revived.ok) return;
    expect(revived.value.buzz).toBeGreaterThan(0);
  });

  it('gets back on air and keeps counting toward syndication', () => {
    const { state, show } = studioWithFinishedShow(114);
    // Funded well past the revival itself, deliberately. This test is about whether a
    // revived show reaches air carrying its old episode count — not about solvency.
    // At `revivalCost * 3` the studio went broke partway through the 200 weeks it can
    // take to attract a bid, and the show was cancelled out from under the assertion,
    // which made a passing feature look like a broken one.
    const studio = state.companies[state.player.studioId];
    studio.cash = Math.max(revivalCost(show) * 3, 200_000_000);
    studio.debt = 0;

    const episodesBefore = show.totalEpisodes;
    expect(reviveShow(state, show.id).ok).toBe(true);

    for (let i = 0; i < 200; i++) {
      advanceWeek(state);
      const offer = state.offers.find((o) => o.productionId === show.id);
      if (offer) acceptOffer(state, offer.id);
      if (show.status === 'airing') break;
    }

    expect(show.status).toBe('airing');
    expect(show.totalEpisodes).toBeGreaterThanOrEqual(episodesBefore);
    // The comeback counts as a new season of the same show, not a new show.
    expect(show.revived).toBe(true);
    expect(show.season).toBeGreaterThan(1);
  });

  it('rolls cast attrition from the seeded stream, not Math.random', () => {
    // Two identical worlds must lose exactly the same people, or saves stop replaying.
    const a = studioWithFinishedShow(115);
    const b = studioWithFinishedShow(115);
    a.state.companies[a.state.player.studioId].cash = revivalCost(a.show) * 2;
    b.state.companies[b.state.player.studioId].cash = revivalCost(b.show) * 2;

    const first = reviveShow(a.state, a.show.id);
    const second = reviveShow(b.state, b.show.id);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.value.departed).toEqual(second.value.departed);
    expect(first.value.returning).toEqual(second.value.returning);
    expect(a.state.rngState).toBe(b.state.rngState);
  });
});
