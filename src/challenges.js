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
    } else if (event.type === "collision" && this.trackedBallId) {
      const other = event.a === this.trackedBallId ? event.b : (event.b === this.trackedBallId ? event.a : null);
      if (other && this.challenge.targetIds.includes(other)) {
        this.hitSet.add(other);
        if (this.hitSet.size === this.challenge.targetIds.length) {
          this.completed = true;
          return true;
        }
      }
    }
    return false;
  }
}
