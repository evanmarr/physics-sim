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
    name: "Bounce Back",
    difficulty: "Simple",
    concept: "Restitution & elastic collisions (coefficient of restitution)",
    objective: "The ball is dropped as Wood and barely leaves the ground on impact. Change its material to one with much higher restitution so it rebounds back up most of the way to where it started.",
    startingState: "A wood ball drops from a fixed height onto a wide floor and thuds to a near-stop on its first bounce.",
    successCondition: "After bouncing off the floor, the ball rises back up to within 60% of its original drop height.",
    hint: "Restitution measures how much of a collision's energy comes back out as rebound speed — check each material's restitution in the Physics panel. Rubber's is dramatically higher than every other material here.",
    explanation: "A material's restitution (coefficient of restitution, e) sets rebound speed as a fraction of impact speed: v_rebound = e·v_impact. Bounce HEIGHT scales with e², so even a moderately higher e produces a much bigger jump in how far the object bounces back — Rubber's e≈0.92 keeps about 85% of the energy, while Wood, Metal, and Ice all lose the vast majority of it on impact.",
    source: "Coefficient of restitution e = v_rebound / v_impact; rebound height scales with e².",
    // e is combined between two touching bodies as Matter.js's documented
    // max(bodyA.restitution, bodyB.restitution), so the floor is Wood
    // (e=0.25) specifically so it never masks a low-restitution ball's true
    // behavior while still not capping Rubber's much higher 0.92. Expected
    // margins: dropped from y=1000 onto a floor surface at y=1400 (a ~370
    // unit fall), Rubber's e≈0.92 predicts a rebound back up to roughly
    // y≈1057 (close to the drop start) — clear of the y≤1150 bar with
    // real room to spare. Every other material's effective e stays ≈0.25,
    // predicting a rebound only to about y≈1347 — nowhere close.
    goalCheck: (items, tracker) => {
      const ball = items.find((it) => it.id === "chal_bb_ball");
      if (!ball) return false;
      if (tracker._bbLastVy === undefined) tracker._bbLastVy = 0;
      if (ball.y >= 1340 && tracker._bbLastVy > 1 && ball.vy < -1) tracker._bbBounced = true;
      tracker._bbLastVy = ball.vy;
      return !!tracker._bbBounced && ball.y <= 1150;
    },
    build() {
      return [
        { id: "chal_bb_floor", type: "board", x: 0, y: 1450, rotation: 0, width: 2000, height: 100, material: "wood", fixed: true },
        { id: "chal_bb_ball", type: "ball", x: 0, y: 1000, rotation: 0, radius: 30, material: "wood", fixed: false },
      ];
    },
  },
  {
    id: "fan_lift",
    name: "Fan Lift",
    difficulty: "Easy",
    concept: "Continuous force vs. weight",
    objective: "Turn up the fan's wind force until it holds the ball up near the ceiling instead of letting it sag back down.",
    startingState: "A fan blows straight up into a ball sitting just above it, set to a power of 10 — too weak to hold it up high for long.",
    successCondition: "The ball holds above y = 900 for a sustained stretch (not just a passing bounce) at some point during the run.",
    hint: "Wind is a continuous force, not a one-time push — it has to overcome the ball's weight (m·g) for as long as it's in range, not just tip it upward for a moment. The default power of 10 only brushes past this height for an instant before sinking back to its own, lower equilibrium; try 13 or so.",
    explanation: "A single number (fan power) has to beat a fixed opposing force (the ball's own weight) sustained over time, rather than a one-off impulse — a gentler introduction to \"does this force win\" than a threshold impact, since you can watch it fail slowly (the ball settles at a lower height instead of missing in an instant).",
    source: "Newton's second law, F = ma; weight = mg.",
    // Verified live: an earlier version of this challenge required the ball
    // to also clear a wall beside the fan — but the ball would drift
    // sideways into the wall's face while still climbing and get pinned
    // there by the wall's own contact/normal force well below the top, so
    // no amount of wind force actually cleared it. A fan's thrust (strong
    // near the fan, falling off with distance) also isn't well-damped here:
    // at power 10 the ball actually overshoots to y≈879 for a single frame
    // before settling into its real equilibrium around y≈992 — a
    // MOMENTARY dip below 900 that a plain "did it ever cross this height"
    // check would wrongly reward. Requiring the height to hold for a real
    // stretch (not an instant) is what actually separates "too weak"
    // (bounces past 900 once, settles back above it) from "enough" (power
    // 13 settles into a real, sustained band around 790-850). Higher
    // powers (verified 20+) overshoot HARDER and enter a wide, undamped
    // oscillation between roughly 600-1280 that never sustains anything —
    // more force is not simply better here, which is itself worth noticing.
    goalCheck: (items) => {
      const ball = items.find((it) => it.id === "chal_fl_ball");
      return !!ball && ball.y <= 900;
    },
    sustainFrames: 15,
    build() {
      return [
        { id: "chal_fl_ground", type: "board", x: 0, y: 1400, rotation: 0, width: 3200, height: 60, material: "wood", fixed: true },
        { id: "chal_fl_fan", type: "fan", x: 0, y: 1350, rotation: -90, width: 50, height: 60, material: "metal", power: 10, range: 500, fixed: true },
        { id: "chal_fl_ball", type: "ball", x: 0, y: 1250, rotation: 0, radius: 24, material: "wood", fixed: false },
      ];
    },
  },
  {
    id: "glass_breaker",
    name: "Glass Breaker",
    difficulty: "Medium",
    concept: "Impact force & material strength",
    objective: "Tune the cannon's power so the ball hits hard enough to shatter the glass box — too soft and it just bounces off.",
    startingState: "A cannon faces a glass panel point-blank, set to a power of 14 — below glass's shatter threshold.",
    successCondition: "The glass panel actually shatters (a real impact event, not just a strong-looking hit).",
    hint: "Glass only shatters past a real impact-speed threshold (check the Physics panel on the glass box for the exact number) — a metal ball is dense enough that a modest power increase from the default goes a long way. Push it up from 14 toward 20+ and try again.",
    explanation: "Every breakable material has a real shatter-impact-speed threshold, not just a \"weak vs strong\" feel — the same cannon that barely dents glass at power 14 shatters it outright once power (and so impact speed) clears that number. This is the same idea as Fan Lift's force-vs-weight comparison, but now the threshold is a sudden break rather than a gradual climb.",
    source: "Kinetic energy at impact vs. a material's fracture toughness.",
    reward: 40,
    cannonId: "chal_gb_cannon",
    glassId: "chal_gb_glass",
    build() {
      return [
        { id: "chal_gb_ground", type: "board", x: 0, y: 1400, rotation: 0, width: 3200, height: 60, material: "wood", fixed: true },
        { id: "chal_gb_cannon", type: "cannon", x: -500, y: 1300, rotation: 0, width: 90, height: 34, material: "metal", fixed: true, startRotation: -90, launchRotation: 0, power: 14 },
        { id: "chal_gb_feedball", type: "ball", x: -500, y: 1150, rotation: 0, radius: 20, material: "metal", fixed: false },
        { id: "chal_gb_glass", type: "board", x: -50, y: 1300, rotation: 0, width: 30, height: 220, material: "glass", fixed: true },
      ];
    },
  },
  {
    id: "lever_launch",
    name: "Lever Launch",
    difficulty: "Hard",
    concept: "Torque & levers (two variables at once)",
    objective: "The seesaw is balanced and going nowhere. Drop a ball on the empty end — a heavier ball, or one dropped from higher up, creates more torque — to fling the payload ball off the other end.",
    startingState: "A balanced seesaw with a light wooden payload ball resting on one end; the other end is empty.",
    successCondition: "The payload ball ends up well past the pivot on the opposite side (x ≤ −150).",
    hint: "Torque is force × distance from the pivot, and impact force scales with how fast the ball is falling when it lands — so a Metal ball (much denser than the default Wood) dropped from well above the seesaw's empty end delivers far more torque than just placing one gently on it.",
    explanation: "Unlike Fan Lift or Glass Breaker, no single number solves this — torque comes from BOTH the dropped ball's mass (via its material) and its impact speed (via drop height), and either one alone is usually not enough. This is the first challenge that needs two variables reasoned about together, not just one turned up.",
    source: "Torque τ = F·r; impact force scales with fall speed via momentum transfer.",
    // Verified: a light default ball barely moves the payload (finalX ~ +99,
    // wrong direction even). A metal ball dropped from a real height reliably
    // sends the payload well past x = -150 in the opposite direction.
    goalCheck: (items) => {
      const payload = items.find((it) => it.id === "chal_ll_payload");
      return !!payload && payload.x <= -150;
    },
    build() {
      return [
        { id: "chal_ll_ground", type: "board", x: 0, y: 1400, rotation: 0, width: 3000, height: 60, material: "wood", fixed: true },
        { id: "chal_ll_seesaw", type: "board", x: 0, y: 1250, rotation: 0, width: 320, height: 20, material: "wood", fixed: true },
        { id: "chal_ll_bearing", type: "ballBearing", x: 0, y: 1250, rotation: 0, radius: 9, material: "metal", fixed: true },
        { id: "chal_ll_payload", type: "ball", x: 130, y: 1220, rotation: 0, radius: 16, material: "wood", fixed: false },
      ];
    },
  },
  {
    id: "triple_bounce",
    name: "Triple Bounce",
    difficulty: "Challenging",
    concept: "Elastic collisions & precise aiming",
    objective: "Aim the cannon's launch angle and power so a single ball bounces off all three rubber boxes.",
    startingState: "A cannon and three angled rubber boxes arranged in a funnel shape, cannon aimed straight up by default.",
    successCondition: "One fired ball registers a real collision against all three target boxes before the run ends.",
    hint: "Rubber has high restitution, so the ball keeps most of its speed through each bounce — the real puzzle is the angle, not the power, and the valid window is narrow (a couple of degrees or a few power units off sends it flying past the funnel entirely, in either direction). Try launchRotation -36° with power 34, and picture the ball dropping into the funnel shape the three boxes make.",
    explanation: "Where Lever Launch needed the right combination of two quantities, this needs the right single TRAJECTORY threaded through three sequential bounces — a much narrower angle window than earlier challenges, since a few degrees off sends the ball skipping past the funnel instead of into it.",
    source: "Conservation of momentum in near-elastic collisions (rubber's high restitution).",
    cannonId: "chal_tb_cannon",
    targetIds: ["chal_tb_box1", "chal_tb_box2", "chal_tb_box3"],
    // Verified live: launchRotation -36°, power 34 lands the ball in the
    // funnel and registers collisions against all three boxes (confirmed
    // via the actual completion checkmark, not just position). The valid
    // window is genuinely narrow and the failure mode is dramatic, not
    // graceful — power 30 at the same angle overshoots ~1100 units the
    // OTHER way (past the cannon), power 33 at launchRotation -35 overshoots
    // ~1200 units past the funnel, and the previous default (-60°/26) lands
    // on the ground well past the funnel on the far side. -36°/35 also lands
    // in the funnel's pocket but doesn't reliably register all three
    // collisions — -36°/34 is the confirmed reliable solution.
    build() {
      return [
        { id: "chal_tb_ground", type: "board", x: 0, y: 1400, rotation: 0, width: 3200, height: 60, material: "wood", fixed: true },
        { id: "chal_tb_cannon", type: "cannon", x: -600, y: 1300, rotation: 0, width: 90, height: 34, material: "metal", fixed: true, startRotation: -90, launchRotation: -60, power: 26 },
        { id: "chal_tb_feedball", type: "ball", x: -600, y: 1150, rotation: 0, radius: 20, material: "rubber", fixed: false },
        box("chal_tb_box1", -20, 850, -60, 160),
        box("chal_tb_box2", 120, 850, 60, 160),
        box("chal_tb_box3", 50, 970, 0, 200),
      ];
    },
  },
  {
    id: "portal_trick_shot",
    name: "Portal Trick Shot",
    difficulty: "Extreme",
    concept: "Portals, velocity transfer & prediction",
    objective: "A solid wall blocks the straight path to the landing zone — there's no way around or over it. Fire the cannon into the entry portal so the ball comes out the exit portal already lined up to clear the wall.",
    startingState: "A wall fully blocks the direct line from cannon to landing zone; an entry portal sits at the muzzle and a linked exit portal sits past the wall.",
    successCondition: "The specific ball that was fired (and actually passed through the portal) ends up past the wall (x ≥ −280) and stays there.",
    hint: "Two portals with the same rotation hand off velocity unchanged — the ball exits moving exactly as it entered, just from a new spot. The entry portal sits right in front of the cannon, almost at the muzzle, so whatever direction and speed you fire at is basically what comes out the other side. The exit is up and to the right, past the wall, with open air below it to fall into.",
    explanation: "This adds genuine PREDICTION on top of everything Triple Bounce required: the ball's trajectory changes location mid-flight (through the portal) without changing velocity, so solving it means mentally relocating the same arc to a new starting point rather than watching it play out and adjusting.",
    source: "Momentum/velocity is conserved through the teleport — only position changes.",
    cannonId: "chal_pt_cannon",
    // A cannon-fired ball gets a brand-new id the instant it's fired (see
    // physics.js's _doCannonFire), so there's no fixed spec id to check a
    // position against — the tracker has to follow the *actual* fired ball
    // by the id it captured from the cannonFire event, and only after it's
    // confirmed that same ball actually went through the portal (the
    // "teleport" event), not just that something eventually rolled far right.
    goalCheck: (items, tracker) => {
      if (!tracker.trackedBallId || !tracker.teleported) return false;
      const ball = items.find((it) => it.id === tracker.trackedBallId);
      return !!ball && ball.x >= -280;
    },
    sustainFrames: 15,
    build() {
      return [
        { id: "chal_pt_ground", type: "board", x: 0, y: 1400, rotation: 0, width: 3200, height: 60, material: "wood", fixed: true },
        { id: "chal_pt_cannon", type: "cannon", x: -700, y: 1300, rotation: 0, width: 90, height: 34, material: "metal", fixed: true, startRotation: 0, launchRotation: 0, power: 24 },
        { id: "chal_pt_feedball", type: "ball", x: -700, y: 1150, rotation: 0, radius: 20, material: "metal", fixed: false },
        { id: "chal_pt_wall", type: "board", x: -450, y: 1200, rotation: 0, width: 30, height: 400, material: "metal", fixed: true },
        { id: "chal_pt_entry", type: "portal", x: -600, y: 1300, rotation: 0, radius: 26, material: "metal", linkedId: "chal_pt_exit" },
        { id: "chal_pt_exit", type: "portal", x: 300, y: 1000, rotation: 0, radius: 26, material: "metal", linkedId: "chal_pt_entry" },
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
