// Preset scenarios the player can load. Completing the win condition during
// a play session awards coins once (tracked in state.completedChallenges).

function box(id, x, y, rotation, width = 160) {
  return { id, type: "board", x, y, rotation, width, height: 24, material: "rubber", fixed: true };
}

export const CHALLENGES = [
  {
    id: "triple_bounce",
    name: "Triple Bounce",
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
    description: "Turn up the fan's wind force until it blows the ball up and over the wall beside it.",
    reward: 45,
    // Position-based goal: the ball must be simultaneously past the wall's
    // far edge (x) and above its top edge (lower y) — proving the fan swept
    // it clear over the wall, not that it worked its way around at ground
    // level. Verified solvable: power >= ~18 clears it, the default of 10
    // does not.
    goalX: 190,
    goalY: 1090,
    ballId: "chal_fl_ball",
    build() {
      return [
        { id: "chal_fl_ground", type: "board", x: 0, y: 1400, rotation: 0, width: 3200, height: 60, material: "wood", fixed: true },
        { id: "chal_fl_wall", type: "board", x: 150, y: 1250, rotation: 0, width: 24, height: 300, material: "metal", fixed: true },
        { id: "chal_fl_fan", type: "fan", x: 0, y: 1350, rotation: -60, width: 50, height: 60, material: "metal", power: 10, range: 350 },
        { id: "chal_fl_ball", type: "ball", x: 0, y: 1250, rotation: 0, radius: 24, material: "wood", fixed: false },
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

  // returns true exactly once, the frame a position-based goal is met
  onFrame(items) {
    if (this.completed || !this.challenge || !this.challenge.ballId) return false;
    const ball = items.find((it) => it.id === this.challenge.ballId);
    if (!ball) return false;
    if (ball.x >= this.challenge.goalX && ball.y <= this.challenge.goalY) {
      this.completed = true;
      return true;
    }
    return false;
  }
}
