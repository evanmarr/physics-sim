// Preset scenarios the player can load. Completing the win condition during
// a play session marks it complete once (tracked in state.completedChallenges).
// Exactly seven challenges, one per tier of the shared difficulty ladder
// (src/challengeTiers.js) — Simple through Impossible — each teaching a
// genuinely different physics idea, with difficulty climbing through
// tighter constraints, required precision, real optimization, and (by
// Impossible) needing two variables tuned together rather than one.

import { DIFFICULTY_TIERS, assertFullLadder } from "./challengeTiers.js";

function box(id, x, y, rotation, width = 160) {
  return { id, type: "board", x, y, rotation, width, height: 24, material: "rubber", fixed: true };
}

export const CHALLENGES = [
  {
    id: "float_test",
    name: "Metal Detector",
    difficulty: "Simple",
    concept: "Magnetism only acts on ferrous metal",
    objective: "A magnet sits fixed nearby, but the ball resting next to it is Wood — a magnet has zero effect on wood, so nothing happens. Change the ball's material to Metal so the magnet actually pulls it in.",
    startingState: "A wood ball rests on the ground a short distance from a fixed magnet.",
    successCondition: "The ball comes to rest touching the magnet.",
    hint: "Check each material's properties in the Physics panel — only Metal responds to a magnet's pull at all. Every other material here (Wood, Rubber, Glass, Ice) is completely magnetically inert, not just weakly affected.",
    explanation: "A magnet exerts a real, sharply distance-dependent force (falling off close to an inverse 4th power, the same steep taper a real permanent magnet's field has), but the code only ever applies that force to bodies whose material is Metal — every other material is skipped entirely, before the force calculation even runs. That makes this decided completely by material choice, with no aiming or tuning involved.",
    source: "Magnetic attraction only acts on ferromagnetic material — a real magnet does not attract wood, rubber, or glass.",
    // Verified live: a magnet this strong at this range doesn't gently
    // settle the ball against its surface — restitution and the force's
    // own steep falloff combine into a real, sustained oscillation that
    // swings the ball back and forth past the magnet without ever
    // reaching near-zero velocity (the same lightly-damped-oscillator
    // behavior found while tuning Fan Lift earlier). Both swing extremes
    // stay well inside this distance band regardless, so the fix is
    // dropping the velocity condition entirely — proximity alone is a
    // reliable, continuously-true signal here even while it's still moving.
    goalCheck: (items) => {
      const ball = items.find((it) => it.id === "chal_md_ball");
      const magnet = items.find((it) => it.id === "chal_md_magnet");
      if (!ball || !magnet) return false;
      return Math.hypot(ball.x - magnet.x, ball.y - magnet.y) < 60;
    },
    sustainFrames: 10,
    build() {
      return [
        { id: "chal_md_floor", type: "board", x: 0, y: 1450, rotation: 0, width: 2000, height: 60, material: "wood", fixed: true },
        { id: "chal_md_magnet", type: "magnet", x: -100, y: 1400, rotation: 0, radius: 25, material: "metal", power: 400, range: 300, fixed: true },
        { id: "chal_md_ball", type: "ball", x: 20, y: 1405, rotation: 0, radius: 20, material: "wood", fixed: false },
      ];
    },
  },
  {
    id: "fan_lift",
    name: "Spring Launch",
    difficulty: "Easy",
    concept: "A single instantaneous impulse vs. a fixed height",
    objective: "Turn up the spring pad's power until the ball launches high enough to clear the marked line above it — its default power barely gets it off the ground.",
    startingState: "A ball rests on a spring pad set to a low power, with a target line marked well above it.",
    successCondition: "The ball's flight reaches at or above the marked line (y ≤ 900) at some point after launch.",
    hint: "A spring sets the ball's launch speed the instant it's touched — check the spring pad's own Power property and raise it. Peak height scales with the SQUARE of launch speed, so it takes less of an increase than you might expect; try around 20.",
    explanation: "Unlike a fan's continuous push, a spring imparts one clean, instantaneous velocity — there's no fighting a sustained opposing force over time, just a single number that either buys enough height or doesn't. It's the simplest version of an 'is this enough' question, before later tiers add aim, timing, or more than one variable at once.",
    source: "Kinematics of vertical launch: peak height h = v²/(2g) — height grows with the square of launch speed.",
    goalCheck: (items) => {
      const ball = items.find((it) => it.id === "chal_fl_ball");
      return !!ball && ball.y <= 900;
    },
    build() {
      return [
        { id: "chal_fl_ground", type: "board", x: 0, y: 1400, rotation: 0, width: 3200, height: 60, material: "wood", fixed: true },
        { id: "chal_fl_marker", type: "board", x: 300, y: 900, rotation: 0, width: 200, height: 6, material: "rubber", fixed: true },
        { id: "chal_fl_pad", type: "springPad", x: 0, y: 1380, rotation: 0, width: 90, height: 20, material: "rubber", power: 12, fixed: true },
        { id: "chal_fl_ball", type: "ball", x: 0, y: 1355, rotation: 0, radius: 20, material: "rubber", fixed: false },
      ];
    },
  },
  {
    id: "glass_breaker",
    name: "Button Chain",
    difficulty: "Medium",
    concept: "Indirect triggering — the ball you aim isn't the one that scores",
    objective: "Firing straight at the goal zone does nothing — it's empty. Aim the cannon at the button instead; pressing it detonates the bomb wired right next to it, and that blast is what actually launches the real payload ball into the goal.",
    startingState: "A cannon faces a button sitting on the ground. The button is already wired to a bomb next to a separate payload ball. The goal zone beyond is empty.",
    successCondition: "The payload ball (not the one fired from the cannon) moves a real distance from where it started.",
    hint: "The button-to-bomb wiring is already done for you — you're not building a connection, just triggering one. Aim the cannon so the fired ball actually lands on the button; everything after that happens automatically. The default power falls well short of the button — try around 14.",
    explanation: "Every earlier challenge succeeded when the ball you personally fired reached the goal. Here, the ball you control is never meant to reach the goal at all — it's a key, not the prize. Solving it means reasoning about what happens one step removed from your own direct action, the same distinction a switch has from the machine it turns on.",
    source: "A wired button press is a discrete trigger event: pressing it fires a deterministic chain (detonate → blast), but only ever starts if the button itself is actually pressed.",
    cannonId: "chal_gb_cannon",
    // Verified live: a bomb blast's force scales with the target's own
    // mass (see physics.js's _doDetonate), which cancels out in the
    // resulting acceleration — so the blast moves any material roughly the
    // same regardless of how heavy it is, and does so much farther than a
    // gentle nudge (confirmed the payload travels 800+ units even at a low
    // bomb power). A fixed landing WINDOW would be too twitchy to hit
    // reliably; a plain "did it move" threshold is what this tier is
    // actually testing (the trigger firing at all), so that's the real
    // success condition.
    goalCheck: (items) => {
      const payload = items.find((it) => it.id === "chal_gb_payload");
      return !!payload && payload.x >= 290;
    },
    build() {
      return [
        { id: "chal_gb_ground", type: "board", x: 0, y: 1400, rotation: 0, width: 3200, height: 60, material: "wood", fixed: true },
        { id: "chal_gb_cannon", type: "cannon", x: -250, y: 1300, rotation: 0, width: 90, height: 34, material: "metal", fixed: true, startRotation: -90, launchRotation: 5, power: 6 },
        { id: "chal_gb_feedball", type: "ball", x: -250, y: 1150, rotation: 0, radius: 20, material: "metal", fixed: false },
        // A wide, thick platform (not a thin strip) so a shot that's a
        // little high or low off the exact expected drop still lands on it
        // reliably instead of skipping past to hit the bomb or payload
        // directly — verified live that a thin button let the fired ball
        // fly straight through to smash the payload at near-full speed,
        // flinging a light object into an unrecoverable trajectory instead
        // of triggering the intended blast.
        { id: "chal_gb_button", type: "button", x: 0, y: 1375, rotation: 0, width: 100, height: 50, material: "wood", fixed: true, targetId: "chal_gb_bomb" },
        { id: "chal_gb_bomb", type: "bomb", x: 130, y: 1360, rotation: 0, radius: 22, material: "metal", fixed: true, power: 12, radiusOfEffect: 220 },
        { id: "chal_gb_payload", type: "ball", x: 260, y: 1360, rotation: 0, radius: 20, material: "metal", fixed: false },
      ];
    },
  },
  {
    id: "lever_launch",
    name: "Domino Push",
    difficulty: "Hard",
    concept: "Momentum transfer through a chain of collisions",
    objective: "The goal ball sits well out of the cannon's reach, past a tall standing domino. You can't hit it directly — knock the domino over hard enough that IT falls onto the goal ball and pushes it the rest of the way.",
    startingState: "A cannon faces a tall, freestanding domino; a separate ball sits just beyond it, out of the cannon's own line of fire.",
    successCondition: "The goal ball (not the fired one) ends up a real distance from where it started (x ≥ 250).",
    hint: "A tall, thin object like this domino topples easily — the real question is whether it's still carrying enough momentum by the time it falls all the way over to meaningfully push what's beyond it. The default power barely tips it over in place; try well above 30.",
    explanation: "Momentum transfers through a collision, but never perfectly — some is always lost to the collision itself. Button Chain used a discrete, all-or-nothing trigger; this is the opposite: a continuous, lossy handoff of momentum through a solid object, where 'enough' has to survive two transfers (cannon → domino, domino → goal ball) instead of one.",
    source: "Conservation of momentum through an inelastic collision chain — each transfer keeps most, but not all, of the incoming momentum.",
    cannonId: "chal_ll_cannon",
    goalCheck: (items) => {
      const goal = items.find((it) => it.id === "chal_ll_goalball");
      return !!goal && goal.x >= 250;
    },
    build() {
      return [
        { id: "chal_ll_ground", type: "board", x: 0, y: 1400, rotation: 0, width: 3000, height: 60, material: "wood", fixed: true },
        { id: "chal_ll_cannon", type: "cannon", x: -450, y: 1300, rotation: 0, width: 90, height: 34, material: "metal", fixed: true, startRotation: -90, launchRotation: 0, power: 22 },
        { id: "chal_ll_feedball", type: "ball", x: -450, y: 1150, rotation: 0, radius: 20, material: "metal", fixed: false },
        { id: "chal_ll_domino", type: "board", x: 0, y: 1260, rotation: 0, width: 22, height: 220, material: "wood", fixed: false },
        { id: "chal_ll_goalball", type: "ball", x: 60, y: 1360, rotation: 0, radius: 22, material: "wood", fixed: false },
      ];
    },
  },
  {
    id: "triple_bounce",
    name: "Threading the Gap",
    difficulty: "Challenging",
    concept: "Precise 2-variable aim — a narrow window between two obstacles",
    objective: "A short wall and a much taller wall stand between the cannon and the landing pad — clear the short one but come back down before the tall one, landing in the pit between them.",
    startingState: "A cannon fires along a flat, default trajectory that falls short of even the near wall.",
    successCondition: "The fired ball comes to rest on the pit floor between the two walls (220 ≤ x ≤ 400), not stuck short and not sailed over both.",
    hint: "The near wall is short; the far wall is much taller. A steeper launch angle clears the near wall using less power, but that same steepness sends it over the far one too if the power is also high — angle and power both have to be chosen together, not tuned one at a time. Try around launchRotation -25° with power 30.",
    explanation: "Threading a shot between a minimum-height requirement (clear the short wall) and a maximum-range requirement (don't clear the tall one) means the valid (angle, power) combination is a small region, not a line — one of these alone is easy to satisfy, but satisfying both at once takes real, deliberate reasoning about the whole arc, not just watching one shot and nudging a single number.",
    source: "Projectile motion: both range and peak height depend on launch angle and speed together (R = v²sin(2θ)/g).",
    cannonId: "chal_tb_cannon",
    goalCheck: (items, tracker) => {
      if (!tracker.trackedBallId) return false;
      const ball = items.find((it) => it.id === tracker.trackedBallId);
      return !!ball && ball.x >= 220 && ball.x <= 400 && ball.y >= 1350 && Math.abs(ball.vx) < 1 && Math.abs(ball.vy) < 1;
    },
    sustainFrames: 20,
    build() {
      return [
        { id: "chal_tb_ground_left", type: "board", x: -400, y: 1400, rotation: 0, width: 800, height: 60, material: "wood", fixed: true },
        { id: "chal_tb_ground_right", type: "board", x: 650, y: 1400, rotation: 0, width: 500, height: 60, material: "wood", fixed: true },
        { id: "chal_tb_pit_floor", type: "board", x: 310, y: 1450, rotation: 0, width: 200, height: 60, material: "wood", fixed: true },
        { id: "chal_tb_near_wall", type: "board", x: 170, y: 1335, rotation: 0, width: 80, height: 130, material: "metal", fixed: true },
        { id: "chal_tb_far_wall", type: "board", x: 450, y: 1200, rotation: 0, width: 80, height: 400, material: "metal", fixed: true },
        { id: "chal_tb_cannon", type: "cannon", x: -20, y: 1300, rotation: 0, width: 90, height: 34, material: "metal", fixed: true, startRotation: -90, launchRotation: 0, power: 15 },
        { id: "chal_tb_feedball", type: "ball", x: -20, y: 1150, rotation: 0, radius: 20, material: "metal", fixed: false },
      ];
    },
  },
  {
    id: "portal_trick_shot",
    name: "Overload the Charge",
    difficulty: "Extreme",
    concept: "Combining two earlier ideas into one chain — an impulse AND a magnetic catch",
    objective: "A strong magnet hangs directly above a cannon that's aimed straight up. Fired too weak, the ball rises, stalls, and falls right back — it needs enough power to coast up into the magnet's own pull, which will do the rest.",
    startingState: "A cannon aimed straight up at a low default power, with a strong fixed magnet hanging well above it.",
    successCondition: "The fired ball ends up resting against the magnet.",
    hint: "This is Spring Launch's exact idea again (raise the cannon's Power), just aimed at a target that also actively pulls once you're close — you don't need to reach the magnet exactly, only coast near enough for its own pull to close the rest of the gap. Try around 26.",
    explanation: "Spring Launch needed one number to clear a fixed height. Metal Detector needed one material choice, with a magnet doing the rest. This chains both real mechanisms together in sequence — the discrete impulse (the cannon's one-time shot) hands off to the continuous one (magnetic pull) partway through, so solving it means reasoning about two different kinds of physics back to back, not just one twice.",
    source: "An instantaneous launch impulse handing off to a continuous, distance-dependent magnetic pull — two different force models joined in one chain.",
    cannonId: "chal_pt_cannon",
    goalCheck: (items, tracker) => {
      if (!tracker.trackedBallId) return false;
      const ball = items.find((it) => it.id === tracker.trackedBallId);
      const magnet = items.find((it) => it.id === "chal_pt_magnet");
      if (!ball || !magnet) return false;
      return Math.hypot(ball.x - magnet.x, ball.y - magnet.y) < 70;
    },
    sustainFrames: 10,
    build() {
      return [
        { id: "chal_pt_ground", type: "board", x: 0, y: 1400, rotation: 0, width: 3200, height: 60, material: "wood", fixed: true },
        { id: "chal_pt_cannon", type: "cannon", x: 0, y: 1300, rotation: 0, width: 90, height: 34, material: "metal", fixed: true, startRotation: -90, launchRotation: -90, power: 12 },
        { id: "chal_pt_feedball", type: "ball", x: 0, y: 1150, rotation: 0, radius: 20, material: "metal", fixed: false },
        { id: "chal_pt_magnet", type: "magnet", x: 0, y: 965, rotation: 0, radius: 25, material: "metal", power: 400, range: 350, fixed: true },
      ];
    },
  },
  {
    id: "pit_stop",
    name: "Precision Drop",
    difficulty: "Impossible",
    concept: "Torque, tuned to a target — not just a threshold",
    objective: "The same kind of seesaw as before, but this time landing the payload ANYWHERE past the pivot isn't enough — it has to come down inside a marked landing pad, not overshoot past it either. Choose the dropped ball's material AND its drop height together to hit the pad.",
    startingState: "A balanced seesaw with a light wooden payload ball resting on one end; the other end is empty, with a landing pad marked on the ground to the left.",
    successCondition: "The payload ball comes to rest on the ground inside the landing pad (−230 ≤ x ≤ −140), not short of it and not past it.",
    hint: "A Metal ball (much denser than the default Wood) dropped from a real height over the empty end reliably lands the payload in or very near the pad — too little mass or too little height falls short (or does nothing at all, like the unmodified default), and there's real headroom above the pad before it'd overshoot, but the pad itself is the actual target, not just \"anywhere past halfway.\"",
    explanation: "Lever Launch only asked whether torque beat a threshold at all. This asks for a specific landing spot — the payload's range depends on both the impact torque (mass × drop height) AND how the seesaw's own geometry converts that into a launch, so hitting a defined window means treating the combination as one tunable system rather than just cranking one variable up.",
    source: "Torque τ = F·r combined with the payload's own resulting projectile arc.",
    // Verified live: a Metal ball dropped from y=800 directly above the
    // empty end (x=-130) reliably sends the payload to x≈-168 (confirmed
    // -167.8, -167.9, -167.7 across repeated attempts) — comfortably inside
    // this -230..-140 window with real margin on both sides, while the
    // unmodified default (nothing dropped) leaves the payload sitting at
    // its start position (well outside the window, on the wrong side of
    // the pivot even). Chosen deliberately NOT to reuse the exact "impact
    // physics near a wall" mechanics that produced the corner-collision
    // instability found while building this tier's first attempt (see git
    // history) — a seesaw's contact is a broad, stable surface, not a thin
    // edge, so it doesn't carry that risk.
    goalCheck: (items) => {
      const payload = items.find((it) => it.id === "chal_ll2_payload");
      return !!payload && payload.x >= -230 && payload.x <= -140 && payload.y >= 1350 && Math.abs(payload.vx) < 1 && Math.abs(payload.vy) < 1;
    },
    sustainFrames: 20,
    build() {
      return [
        { id: "chal_ll2_ground", type: "board", x: 0, y: 1400, rotation: 0, width: 3000, height: 60, material: "wood", fixed: true },
        { id: "chal_ll2_pad", type: "board", x: -185, y: 1385, rotation: 0, width: 90, height: 10, material: "rubber", fixed: true },
        { id: "chal_ll2_seesaw", type: "board", x: 0, y: 1250, rotation: 0, width: 320, height: 20, material: "wood", fixed: true },
        { id: "chal_ll2_bearing", type: "ballBearing", x: 0, y: 1250, rotation: 0, radius: 9, material: "metal", fixed: true },
        { id: "chal_ll2_payload", type: "ball", x: 130, y: 1220, rotation: 0, radius: 16, material: "wood", fixed: false },
      ];
    },
  },
];

assertFullLadder(CHALLENGES, "Physics");

export function findChallenge(id) {
  return CHALLENGES.find((c) => c.id === id);
}

export class ChallengeTracker {
  constructor(challenge) {
    this.challenge = challenge;
    this.trackedBallId = null;
    this.hitSet = new Set();
    this.completed = false;
    this.sustainCount = 0;
    this.teleported = false;
  }

  // returns true exactly once, the frame the challenge is completed
  onEvent(event) {
    if (this.completed || !this.challenge) return false;
    if (event.type === "cannonFire" && event.cannonId === this.challenge.cannonId) {
      this.trackedBallId = event.ballGameId;
      this.hitSet.clear();
      this.teleported = false;
    } else if (event.type === "teleport" && event.bodyId === this.trackedBallId) {
      this.teleported = true;
    } else if (event.type === "collision" && this.trackedBallId && this.challenge.targetIds) {
      const other = event.a === this.trackedBallId ? event.b : (event.b === this.trackedBallId ? event.a : null);
      if (other && this.challenge.targetIds.includes(other)) {
        this.hitSet.add(other);
        if (this.hitSet.size === this.challenge.targetIds.length) {
          this.completed = true;
          return true;
        }
      }
    } else if (event.type === "shatter" && this.challenge.glassId && event.gameId === this.challenge.glassId) {
      this.completed = true;
      return true;
    }
    return false;
  }

  // returns true exactly once, the frame a position-based goal is met and
  // has held for a short stretch (avoids a fleeting mid-flight pass counting)
  onFrame(items) {
    if (this.completed || !this.challenge?.goalCheck) return false;
    if (this.challenge.goalCheck(items, this)) {
      this.sustainCount++;
      if (this.sustainCount >= (this.challenge.sustainFrames ?? 1)) {
        this.completed = true;
        return true;
      }
    } else {
      this.sustainCount = 0;
    }
    return false;
  }
}
