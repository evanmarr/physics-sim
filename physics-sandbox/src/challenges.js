// Preset scenarios the player can load. Completing the win condition during
// a play session awards coins once (tracked in state.completedChallenges).
// Each challenge is tagged with the one physics idea it's built to teach.

function box(id, x, y, rotation, width = 160) {
  return { id, type: "board", x, y, rotation, width, height: 24, material: "rubber", fixed: true };
}

export const CHALLENGES = [
  {
    id: "triple_bounce",
    name: "Triple Bounce",
    concept: "Elastic collisions & reflection",
    description: "Aim the cannon's launch angle and power so a single ball bounces off all three rubber boxes.",
    reward: 60,
    cannonId: "chal_tb_cannon",
    targetIds: ["chal_tb_box1", "chal_tb_box2", "chal_tb_box3"],
    // Verified solvable: launchRotation around -35 to -38 with power around
    // 32-38 lands the ball in the funnel and it bounces off all three walls.
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
    id: "glass_breaker",
    name: "Glass Breaker",
    concept: "Impact force & material strength",
    description: "Tune the cannon's power so the ball hits hard enough to shatter the glass box — too soft and it just bounces off.",
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
    id: "fan_lift",
    name: "Fan Lift",
    concept: "Continuous force vs. weight",
    description: "Turn up the fan's wind force until it blows the ball up and over the wall beside it.",
    reward: 45,
    // Verified solvable: power >= ~18 clears it, the default of 10 does not.
    goalCheck: (items) => {
      const ball = items.find((it) => it.id === "chal_fl_ball");
      return !!ball && ball.x >= 190 && ball.y <= 1090;
    },
    build() {
      return [
        { id: "chal_fl_ground", type: "board", x: 0, y: 1400, rotation: 0, width: 3200, height: 60, material: "wood", fixed: true },
        { id: "chal_fl_wall", type: "board", x: 150, y: 1250, rotation: 0, width: 24, height: 300, material: "metal", fixed: true },
        { id: "chal_fl_fan", type: "fan", x: 0, y: 1350, rotation: -60, width: 50, height: 60, material: "metal", power: 10, range: 350 },
        { id: "chal_fl_ball", type: "ball", x: 0, y: 1250, rotation: 0, radius: 24, material: "wood", fixed: false },
      ];
    },
  },
  {
    id: "float_test",
    name: "Float Test",
    concept: "Buoyancy & density (Archimedes)",
    description: "The plank sinks straight to the bottom as Metal. Change its material to something less dense than water so it floats instead.",
    reward: 35,
    // Verified: wood/ice settle at y=750-763 with vy=0 and stay there. A
    // sinking material (metal, glass) also drifts through this y-band
    // (buoyancy drag slows the sink, it doesn't stop it) but at a nonzero
    // terminal velocity (~1.4) that never reads as "at rest" — the velocity
    // check is what actually separates floating from just-slowly-sinking.
    goalCheck: (items) => {
      const plank = items.find((it) => it.id === "chal_ft_plank");
      return !!plank && plank.y >= 700 && plank.y <= 900 && Math.abs(plank.vy) < 0.3;
    },
    sustainFrames: 30, // must actually settle there, not just pass through while falling
    build() {
      return [
        { id: "chal_ft_floor", type: "board", x: 0, y: 1500, rotation: 0, width: 2000, height: 60, material: "wood", fixed: true },
        { id: "chal_ft_pool", type: "board", x: 0, y: 1000, rotation: 0, width: 500, height: 500, material: "water", fixed: true },
        { id: "chal_ft_plank", type: "board", x: 0, y: 400, rotation: 0, width: 140, height: 30, material: "metal", fixed: false },
      ];
    },
  },
  {
    id: "lever_launch",
    name: "Lever Launch",
    concept: "Torque & levers",
    description: "The seesaw is balanced and going nowhere. Add a ball to the empty end — a heavier ball, or one dropped from higher up, creates more torque — to fling the payload ball off the other end.",
    reward: 50,
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
];

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
  }

  // returns true exactly once, the frame the challenge is completed
  onEvent(event) {
    if (this.completed || !this.challenge) return false;
    if (event.type === "cannonFire" && event.cannonId === this.challenge.cannonId) {
      this.trackedBallId = event.ballGameId;
      this.hitSet.clear();
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
    if (this.challenge.goalCheck(items)) {
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
