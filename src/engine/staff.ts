import { buildPitch } from './pitches';
import { clamp } from './rng';
import type { Rng } from './rng';
import type {
  Axis,
  GameEvent,
  GameEventKind,
  GameState,
  Pitch,
  Production,
  TalentRole,
  TalentState,
} from './types';
import { AXES } from './types';

/**
 * Talent as a company. See docs/DESIGN.md §8.
 *
 * A studio that only books people per-project is a booking agency: it has no memory,
 * no taste and nothing to lose. Payroll is what turns it into a company. Staff cost
 * money every week whether or not anything is shooting — the first genuinely fixed
 * cost the player carries — and in exchange they write in their own voice, get better
 * when their shows land, and grow loyal and expensive at the same rate.
 *
 * The tension this module exists to create: your best people become your most
 * expensive problem, and letting them go is the cheapest thing you will ever regret.
 *
 * Everything here is driven by the seeded RNG carried in GameState. No Math.random().
 */

// ---------------------------------------------------------------------------
// Result — mirrors actions.ts so these can be re-exported as player actions.
// ---------------------------------------------------------------------------

export type Result<T = void> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (reason: string): Result<never> => ({ ok: false, reason });

// ---------------------------------------------------------------------------
// Tunables — every number in the staff model lives here, so balancing is one block.
// ---------------------------------------------------------------------------

export const STAFF = {
  /**
   * Weekly retainer floor by role, before ability multiplies it.
   *
   * Sized against a $10M bank and $120K/week of studio overhead: two journeyman
   * writers land around $26K/week combined, roughly a fifth of overhead. That is a
   * commitment the player feels every single week without it being a trap — which is
   * the only setting at which a fixed cost teaches anything.
   */
  baseRetainerPerWeek: {
    writer: 9_000,
    showrunner: 22_000,
    producer: 14_000,
    director: 14_000,
    host: 16_000,
    actor: 18_000,
  } as Record<TalentRole, number>,

  /** A year's staff deal. Long enough to matter, short enough to renegotiate in play. */
  contractWeeks: 52,

  /**
   * Tenure hardens the asking price: +10% a year, capped at four years.
   *
   * Deliberately set to outrun the loyalty discount rather than cancel it. At 6% the
   * two effects were within a percent of each other and a staffer's actual retainer sat
   * flat for four years — loyalty silently paid for every rise, which made both
   * mechanics invisible. At 10% the bill still climbs while the discount grows into
   * real money, so the player can see they are being rewarded *and* squeezed.
   */
  tenurePremiumPerYear: 0.1,
  tenurePremiumYearCap: 4,

  /** Every credited hit hardens it further: +9%, capped at six hits. */
  hitPremium: 0.09,
  hitPremiumCap: 6,

  /**
   * What loyalty is actually worth: ±18% on the retainer.
   *
   * Someone who loves working for you signs for less than the market says, and someone
   * who does not asks for a premium to put up with you. Without a real discount,
   * relationship is decoration; with it, the years you invested in a person show up on
   * the ledger as money you are no longer spending.
   */
  loyaltySwing: 0.18,

  /** Weekly drift of a staffer's retainer toward their current asking price. */
  repriceRate: 0.06,

  /** Relationship earned per week on staff — proximity, slowly. */
  loyaltyPerWeek: 0.25,
  /** Morale a retainer buys: enough to offset the idle-talent decay in the tick. */
  moralePerWeek: 0.35,

  /** Average viewers (millions) that count as a hit, and as merely solid. */
  hitViewers: 5,
  solidViewers: 2.5,
  flopViewers: 1.2,

  /** Craft ceiling reachable through experience. Nobody studies their way to 100. */
  craftCeiling: 96,

  /** How much of a staffer's remaining headroom one hit converts into craft. */
  craftGainRate: 0.055,
  /** Each prior hit shrinks the next one's lesson by this much. */
  craftGainHitDamping: 0.12,
  /** Being in the building beats being hired for the job — staff learn faster. */
  staffLearningBonus: 1.25,

  /** Per-week odds a given free staffer brings you something, and the ceiling. */
  pitchChancePerStaffer: 0.22,
  maxStaffPitchChance: 0.6,
  /** Odds a staff pitch is co-developed, when two or more staff are free. */
  coDevelopChance: 0.35,
  /** Staff fees are already covered by the retainer, so their shows quote cheaper. */
  staffPitchCostDiscount: 0.92,
} as const;

/** How much of a season's outcome each role is credited with. */
const ROLE_CREDIT: Record<TalentRole, number> = {
  showrunner: 1,
  host: 1,
  writer: 0.8,
  producer: 0.8,
  director: 0.7,
  actor: 0.6,
};

/** Roles that bring projects in. Mirrors pitches.ts — actors pitch, but rarely. */
const PITCHING_ROLES: Record<string, number> = {
  showrunner: 1,
  writer: 0.8,
  producer: 0.6,
  director: 0.4,
  actor: 0.25,
  host: 0.3,
};

// ---------------------------------------------------------------------------
// Price
// ---------------------------------------------------------------------------

/**
 * What a person is worth on the open market, per week, ignoring who is asking.
 *
 * Craft and star power price differently on purpose: craft is what you get, star power
 * is what you pay for. Heat is the froth on top — it decays, which is why signing
 * someone the week after a hit is the expensive way to do it.
 */
export function marketRetainerFor(person: TalentState): number {
  const base = STAFF.baseRetainerPerWeek[person.role] ?? 12_000;

  const ability =
    0.45 +
    (person.craft / 100) * 0.9 +
    (person.starPower / 100) * 1.1 +
    (person.heat / 100) * 0.4;

  // Experience is not free. The people you made good are the people you now overpay.
  const years = Math.min(
    (person.weeksEmployed ?? 0) / 52,
    STAFF.tenurePremiumYearCap,
  );
  const tenure = 1 + years * STAFF.tenurePremiumPerYear;
  const track =
    1 + Math.min(person.hits ?? 0, STAFF.hitPremiumCap) * STAFF.hitPremium;

  return Math.round(base * ability * tenure * track);
}

/**
 * What they would actually sign with you for, given how they feel about you.
 *
 * `relationship` is the 0–100 figure from `talent.relationships[yourCompanyId]`;
 * 50 is neutral and returns the market rate exactly.
 */
export function retainerFor(person: TalentState, relationship = 50): number {
  const loyalty = 1 - ((clamp(relationship) - 50) / 50) * STAFF.loyaltySwing;
  return Math.round(marketRetainerFor(person) * loyalty);
}

/** The player-facing price: market rate adjusted by how they feel about your studio. */
export function askingRetainerFor(state: GameState, talentId: string): number {
  const person = state.talent[talentId];
  if (!person) return 0;
  return retainerFor(person, relationshipWith(person, state.player.studioId));
}

/** What loyalty is saving you on this person each week. Negative means it is costing you. */
export function loyaltyDiscountFor(state: GameState, talentId: string): number {
  const person = state.talent[talentId];
  if (!person) return 0;
  return marketRetainerFor(person) - askingRetainerFor(state, talentId);
}

function relationshipWith(person: TalentState, companyId: string): number {
  return person.relationships[companyId] ?? 40;
}

// ---------------------------------------------------------------------------
// Roster queries
// ---------------------------------------------------------------------------

/** Everyone on a company's payroll, in a stable order so the UI does not shuffle. */
export function staffOf(state: GameState, companyId: string): TalentState[] {
  return Object.values(state.talent)
    .filter((p) => p.onPayroll && p.employerId === companyId && !p.retired)
    .sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
}

export function isOnStaff(state: GameState, talentId: string): boolean {
  const person = state.talent[talentId];
  return Boolean(
    person?.onPayroll && person.employerId === state.player.studioId && !person.retired,
  );
}

/** The weekly bill for a company's payroll. Defaults to the player's studio. */
export function weeklyPayrollCost(state: GameState, companyId?: string): number {
  const target = companyId ?? state.player.studioId;
  return staffOf(state, target).reduce(
    (sum, person) => sum + (person.retainerPerWeek ?? retainerFor(person, relationshipWith(person, target))),
    0,
  );
}

/**
 * How many weeks of payroll the studio's cash covers.
 *
 * The number the player should be watching. Infinity when nobody is on staff.
 */
export function payrollRunwayWeeks(state: GameState): number {
  const cost = weeklyPayrollCost(state);
  if (cost <= 0) return Infinity;
  const studio = state.companies[state.player.studioId];
  return (studio?.cash ?? 0) / cost;
}

/**
 * Who the studio could plausibly sign, cheapest-relative-to-craft first.
 *
 * Filtered to people who would actually say yes, because a hiring screen full of
 * names that refuse you is a worse screen than a short one.
 */
export function payrollCandidates(
  state: GameState,
  role?: TalentRole,
  limit = 24,
): TalentState[] {
  const studioId = state.player.studioId;

  return Object.values(state.talent)
    .filter(
      (p) =>
        !p.retired &&
        !p.onPayroll &&
        (role === undefined || p.role === role) &&
        wouldJoin(state, p),
    )
    .sort((a, b) => {
      // Value for money: craft bought per dollar of retainer.
      const va = a.craft / Math.max(1, retainerFor(a, relationshipWith(a, studioId)));
      const vb = b.craft / Math.max(1, retainerFor(b, relationshipWith(b, studioId)));
      return vb - va;
    })
    .slice(0, limit);
}

/**
 * Whether a person would take a staff job at the player's studio at all.
 *
 * Standing is what buys access to names: an unknown studio can staff up with
 * journeymen and unknowns, and has to earn its way to anyone the public has heard of.
 * This is deliberately the same lesson as `acquireNetwork` — you climb, you do not buy.
 */
export function wouldJoin(state: GameState, person: TalentState): boolean {
  const studio = state.companies[state.player.studioId];
  if (!studio) return false;
  if (person.retired) return false;

  const standing = (studio.criticalStanding + studio.popularStanding) / 2;
  const appeal = relationshipWith(person, studio.id) * 0.6 + standing * 0.4;
  const required = 16 + person.starPower * 0.45;

  return appeal >= required;
}

// ---------------------------------------------------------------------------
// Hiring and firing
// ---------------------------------------------------------------------------

/**
 * Put somebody on the payroll.
 *
 * Charges nothing up front — the whole point is the weekly bill. The runway gate is
 * the one piece of paternalism here: signing someone you cannot pay for a month is
 * never the decision the player meant to make, and the overdraft mechanic would hide
 * the mistake for a year before presenting it as debt.
 */
export function hireToPayroll(state: GameState, talentId: string): Result<TalentState> {
  const person = state.talent[talentId];
  const studio = state.companies[state.player.studioId];

  if (!studio) return fail('No studio.');
  if (!person) return fail('We cannot find that person.');
  if (person.retired) return fail(`${person.name} has retired.`);
  if (person.onPayroll && person.employerId === studio.id) {
    return fail(`${person.name} is already on your staff.`);
  }
  if (person.onPayroll) {
    const rival = state.companies[person.employerId ?? ''];
    return fail(`${person.name} is under contract to ${rival?.name ?? 'another studio'}.`);
  }
  if (!wouldJoin(state, person)) {
    return fail(`${person.name} will not take a staff job at a studio this size.`);
  }

  const retainer = askingRetainerFor(state, talentId);
  if (studio.cash < retainer * 4) {
    return fail(
      `You cannot cover a month of ${person.name}'s wages. They want ${formatWeekly(retainer)}.`,
    );
  }

  person.onPayroll = true;
  person.retainerPerWeek = retainer;
  person.employerId = studio.id;
  person.contractWeeksRemaining = STAFF.contractWeeks;
  // Tenure is not reset on a re-hire: coming back to a studio you already know is a
  // different thing from arriving, and the price should remember that.
  person.weeksEmployed ??= 0;
  person.hits ??= 0;
  person.morale = clamp(person.morale + 8);
  person.relationships[studio.id] = clamp(relationshipWith(person, studio.id) + 6);

  return ok(person);
}

/**
 * Take somebody off the payroll.
 *
 * They keep any show they are attached to — you hired them for it and the season is
 * already shot. What you lose is the relationship, which is exactly the cost that
 * makes firing a decision rather than a slider.
 */
export function releaseFromPayroll(state: GameState, talentId: string): Result<TalentState> {
  const person = state.talent[talentId];
  const studioId = state.player.studioId;

  if (!person) return fail('We cannot find that person.');
  if (!person.onPayroll || person.employerId !== studioId) {
    return fail(`${person.name} is not on your staff.`);
  }

  person.onPayroll = false;
  person.retainerPerWeek = undefined;
  person.contractWeeksRemaining = undefined;
  if (!person.productionId) person.employerId = undefined;
  person.morale = clamp(person.morale - 14);
  person.relationships[studioId] = clamp(relationshipWith(person, studioId) - 12);

  return ok(person);
}

// ---------------------------------------------------------------------------
// The weekly hook
// ---------------------------------------------------------------------------

/**
 * One week of being an employer.
 *
 * Pays the bill, ages every contract, drifts loyalty and price apart, and settles
 * expiries. Call this once per week from the tick, *before* company overheads are
 * applied, so a payroll the studio cannot cover is converted into debt in the same
 * week rather than leaving cash visibly negative until the next one.
 */
export function tickStaff(
  state: GameState,
  rng: Rng,
  emit: (kind: GameEventKind, headline: string, extra?: Partial<GameEvent>) => GameEvent,
): void {
  const studioId = state.player.studioId;
  const studio = state.companies[studioId];
  if (!studio) return;

  const roster = staffOf(state, studioId);
  if (roster.length === 0) return;

  let paid = 0;

  for (const person of roster) {
    const asking = retainerFor(person, relationshipWith(person, studioId));
    person.retainerPerWeek ??= asking;

    paid += person.retainerPerWeek;
    person.weeksEmployed = (person.weeksEmployed ?? 0) + 1;

    // Proximity buys loyalty, and a retainer buys enough contentment to offset the
    // idle-talent decay the main tick applies — a paid person waiting for a project is
    // not the same as an unemployed one.
    person.relationships[studioId] = clamp(
      relationshipWith(person, studioId) + STAFF.loyaltyPerWeek,
    );
    person.morale = clamp(person.morale + STAFF.moralePerWeek);

    // The squeeze. Every week they are worth a little more than they are paid, and the
    // gap closes on its own — you do not get to keep a bargain by not looking at it.
    person.retainerPerWeek = Math.round(
      person.retainerPerWeek + (asking - person.retainerPerWeek) * STAFF.repriceRate,
    );
  }

  studio.cash -= paid;

  // Contracts run out. Loyalty is what decides whether that is a formality.
  for (const person of roster) {
    if ((person.contractWeeksRemaining ?? 1) > 0) continue;
    settleContractExpiry(state, person, rng, emit);
  }

  // A weekly payroll line would drown the feed, so it reports monthly — often enough
  // to be a running cost the player watches, rare enough to still read as news.
  if (paid > 0 && state.week % 4 === 0) {
    emit('money', `Payroll: ${formatWeekly(paid)}`, {
      body: `${roster.length} on staff. ${Math.round(payrollRunwayWeeks(state))} weeks of cover in the bank.`,
      playerRelevant: true,
      companyId: studioId,
    });
  }
}

/**
 * A staff contract has run out: they re-sign at the new price, or they walk.
 *
 * The re-signing roll is where the years pay off. Somebody who likes you and is happy
 * almost never leaves; somebody you have kept idle and underpaid takes the first call.
 */
function settleContractExpiry(
  state: GameState,
  person: TalentState,
  rng: Rng,
  emit: (kind: GameEventKind, headline: string, extra?: Partial<GameEvent>) => GameEvent,
): void {
  const studioId = state.player.studioId;
  const relationship = relationshipWith(person, studioId);

  const stayChance = clamp(
    0.2 + (relationship / 100) * 0.6 + (person.morale / 100) * 0.2,
    0.05,
    0.97,
  );

  if (rng.chance(stayChance)) {
    // Re-signing is where the accumulated tenure and hit premiums finally land in full.
    const renewed = retainerFor(person, relationship);
    const rise = renewed - (person.retainerPerWeek ?? renewed);

    person.contractWeeksRemaining = STAFF.contractWeeks;
    person.retainerPerWeek = renewed;

    if (rise > 0) {
      emit('talent', `${person.name} re-signs for ${formatWeekly(renewed)}`, {
        body: `Up ${formatWeekly(rise)} a week. ${person.hits ?? 0} hits to their name.`,
        playerRelevant: true,
        talentId: person.id,
        companyId: studioId,
      });
    }
    return;
  }

  person.onPayroll = false;
  person.retainerPerWeek = undefined;
  person.contractWeeksRemaining = undefined;
  if (!person.productionId) person.employerId = undefined;
  person.relationships[studioId] = clamp(relationship - 5);

  emit('talent', `${person.name} leaves the studio`, {
    body: 'Their contract lapsed and they did not renew.',
    playerRelevant: true,
    talentId: person.id,
    companyId: studioId,
  });
}

// ---------------------------------------------------------------------------
// Experience — getting better by making things that worked
// ---------------------------------------------------------------------------

/**
 * Credit everyone attached to a show with the season that just wrapped.
 *
 * Call this once, at the end of `wrapSeason`, after the SeasonRecord has been pushed
 * into `history` — that is the only moment the simulation knows how a season went.
 *
 * Success is judged on viewers against the post-rebalance scale: 5M is a hit, 2.5M is
 * respectable, under 1.2M is a failure people remember. Craft gains scale with what is
 * left of a person's headroom and shrink with every hit already on the CV, so a
 * journeyman improves visibly across two seasons and a veteran barely moves. Nobody
 * grinds their way to 100.
 */
export function creditSeason(
  state: GameState,
  production: Production,
  rng: Rng,
  emit: (kind: GameEventKind, headline: string, extra?: Partial<GameEvent>) => GameEvent,
): void {
  const record = production.history[production.history.length - 1];
  if (!record) return;

  const viewers = record.averageViewers;
  const isHit = viewers >= STAFF.hitViewers;
  const isSolid = !isHit && (viewers >= STAFF.solidViewers || record.averageQuality >= 70);
  const isFlop = viewers < STAFF.flopViewers;

  if (!isHit && !isSolid && !isFlop) return;

  const ownerId = production.ownerId;

  for (const person of attachedPeople(state, production)) {
    const credit = ROLE_CREDIT[person.role] ?? 0.6;
    const learning = person.onPayroll && person.employerId === ownerId
      ? STAFF.staffLearningBonus
      : 1;

    if (isHit) {
      person.hits = (person.hits ?? 0) + 1;
      person.craft = clamp(
        person.craft + craftGain(person) * credit * learning * rng.range(0.75, 1.3),
        0,
        STAFF.craftCeiling,
      );
      person.heat = clamp(person.heat + rng.range(8, 14) * credit);
      person.morale = clamp(person.morale + 6);
      person.relationships[ownerId] = clamp(relationshipWith(person, ownerId) + 5);
      continue;
    }

    if (isSolid) {
      person.craft = clamp(
        person.craft + craftGain(person) * 0.4 * credit * learning * rng.range(0.6, 1.2),
        0,
        STAFF.craftCeiling,
      );
      person.heat = clamp(person.heat + rng.range(3, 6) * credit);
      person.morale = clamp(person.morale + 3);
      person.relationships[ownerId] = clamp(relationshipWith(person, ownerId) + 2);
      continue;
    }

    // A flop costs confidence and attention, but never craft — you do not unlearn how
    // to make television because nobody watched.
    person.morale = clamp(person.morale - rng.range(3, 8) * credit);
    person.heat = clamp(person.heat - rng.range(1, 4) * credit);
    person.relationships[ownerId] = clamp(relationshipWith(person, ownerId) - 2);
  }

  const showrunner = production.showrunnerId ? state.talent[production.showrunnerId] : undefined;
  if (isHit && showrunner && showrunner.onPayroll && showrunner.employerId === ownerId) {
    emit('talent', `${showrunner.name} has a hit on their hands`, {
      body: `${production.title} averaged ${viewers.toFixed(1)}M. That is ${showrunner.hits} for them, and their price knows it.`,
      playerRelevant: true,
      talentId: showrunner.id,
      productionId: production.id,
      companyId: ownerId,
    });
  }
}

/** Headroom-scaled, hit-damped craft improvement from one successful season. */
function craftGain(person: TalentState): number {
  const headroom = Math.max(0, STAFF.craftCeiling - person.craft);
  return (
    (headroom * STAFF.craftGainRate) /
    (1 + (person.hits ?? 0) * STAFF.craftGainHitDamping)
  );
}

function attachedPeople(state: GameState, production: Production): TalentState[] {
  const ids = [
    production.showrunnerId,
    production.directorId,
    production.hostId,
    ...production.writerIds,
    ...production.cast,
  ].filter((id): id is string => Boolean(id));

  const seen = new Set<string>();
  const people: TalentState[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const person = state.talent[id];
    if (person && !person.retired) people.push(person);
  }
  return people;
}

// ---------------------------------------------------------------------------
// House style — staff write shows
// ---------------------------------------------------------------------------

/**
 * The staff's turn at the pitch tray, run before the open market gets a look in.
 *
 * You are paying these people to bring you things, so they bring you things far more
 * often than a free agent would, and they bring you *their* things — the same two or
 * three formats, bent the same way, week after week. That repetition is the point: a
 * slate starts to look like it came from somewhere, which is what a house style is.
 *
 * Called from generatePitches. Returns the number of pitches added.
 */
export function generateStaffPitches(
  state: GameState,
  rng: Rng,
  mintId: (prefix: string) => string,
  emit: (kind: GameEventKind, headline: string, extra?: Partial<GameEvent>) => GameEvent,
  slotsFree: number,
): number {
  if (slotsFree <= 0) return 0;

  const studioId = state.player.studioId;
  const available = staffOf(state, studioId).filter(
    (p) => !p.productionId && PITCHING_ROLES[p.role] !== undefined,
  );
  if (available.length === 0) return 0;

  const chance = Math.min(
    STAFF.maxStaffPitchChance,
    STAFF.pitchChancePerStaffer * available.length,
  );
  if (!rng.chance(chance)) return 0;

  const lead = rng.weighted(available, (person) => {
    const roleWeight = PITCHING_ROLES[person.role] ?? 0;
    // Staff who are happy and idle are the ones with something written.
    return roleWeight * (person.morale / 100 + 0.4) * (person.craft / 100 + 0.5);
  });

  const pitch = buildPitch(lead, state, rng, mintId);
  if (!pitch) return 0;

  const partners = available.filter((p) => p.id !== lead.id);
  const partner =
    partners.length > 0 && rng.chance(STAFF.coDevelopChance)
      ? rng.weighted(partners, (p) => p.craft + p.starPower * 0.5)
      : undefined;

  applyHouseStyle(pitch, lead, partner, rng);

  state.pitches.push(pitch);

  emit('pitch', `${lead.name} brings you "${pitch.title}"`, {
    body: partner
      ? `Developed with ${partner.name}. ${pitch.logline}`
      : pitch.logline,
    playerRelevant: true,
    talentId: lead.id,
  });

  return 1;
}

/**
 * Bend a staff pitch toward the room that wrote it.
 *
 * `buildPitch` already nudges a show toward its pitcher; this pushes harder, because
 * somebody on your payroll is writing for a studio they know rather than pitching a
 * stranger. A co-developed show additionally inherits whatever the partner is better
 * at than the lead — that is what collaboration is worth here, and it is why two
 * complementary staff are more than two separate ones.
 */
function applyHouseStyle(
  pitch: Pitch,
  lead: TalentState,
  partner: TalentState | undefined,
  rng: Rng,
): void {
  // A voice is a set of things somebody keeps doing. Amplify the pitch's existing
  // deviation from the middle so the staff writer's material reads as theirs.
  const conviction = 0.1 + (lead.craft / 100) * 0.25;
  for (const axis of AXES as readonly Axis[]) {
    const value = pitch.attributes[axis];
    pitch.attributes[axis] = clamp(value + (value - 50) * conviction);
  }

  if (partner) {
    // The partner contributes their strengths, not their average — a funny writer
    // makes it funnier without making it blander.
    if (partner.craft > lead.craft) {
      pitch.attributes.prestige = clamp(
        pitch.attributes.prestige + rng.range(2, 9) * ((partner.craft - lead.craft) / 40),
      );
      pitch.attributes.complexity = clamp(
        pitch.attributes.complexity + rng.range(1, 7) * ((partner.craft - lead.craft) / 40),
      );
    }
    if (partner.starPower > lead.starPower) {
      pitch.attributes.entertainment = clamp(
        pitch.attributes.entertainment + rng.range(2, 8),
      );
    }
    // Two rooms working on one thing costs more to make than one.
    pitch.estimatedCostPerEpisode = Math.round(pitch.estimatedCostPerEpisode * 1.06);
  }

  // Their fee is already on the payroll, so the show quotes cheaper than an outside
  // pitch of the same size. This is the concrete return on the weekly bill.
  pitch.estimatedCostPerEpisode = Math.round(
    pitch.estimatedCostPerEpisode * STAFF.staffPitchCostDiscount,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatWeekly(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M/wk`;
  return `$${Math.round(amount / 1_000)}K/wk`;
}
