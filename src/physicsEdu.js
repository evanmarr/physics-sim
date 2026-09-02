// Lightweight, optional "show the math" content for the property panel.
// Values are computed from the same numbers the simulation actually uses,
// so this is never just flavor text — it's what's really driving the sim.
import { materialOf } from "./materials.js";

const G = 9.8; // used only for the pedagogical "weight" line, in made-up sim units

function areaOf(spec) {
  if (spec.type === "board" || spec.type === "button" || spec.type === "fan" || spec.type === "springPad") {
    return spec.width * spec.height;
  }
  if (spec.type === "triangle") return (Math.sqrt(3) / 4) * (spec.size ?? 130) ** 2;
  return Math.PI * (spec.radius ?? 20) ** 2; // ball, bomb, ballBearing, peg, magnet
}

function fmt(n, digits = 2) {
  return Number(n.toFixed(digits)).toString();
}

// Returns an array of { formula, note } lines, or null if there's nothing
// meaningful to show for this object.
export function physicsMath(spec) {
  const mat = materialOf(spec.material);
  const lines = [];

  if (mat.isFluid) {
    lines.push({
      formula: "F_buoyancy = ρ_fluid · V_submerged · g",
      note: `Archimedes' principle: this pushes up on anything submerged in it, regardless of the object's own material.`,
    });
    lines.push({
      formula: `ρ_water = ${mat.density}`,
      note: `An object floats if its own density is less than this, and sinks if it's greater — try comparing to the balls' densities below.`,
    });
    return lines;
  }

  const area = areaOf(spec);
  const mass = mat.density * area * 1e-3; // same 0.001 scale physics.js uses
  lines.push({
    formula: `m = ρ · A = ${mat.density} × ${fmt(area, 0)} ≈ ${fmt(mass, 2)}`,
    note: `Mass comes from density × area (this sim is 2D, so "volume" is area). Denser or bigger objects need more force to move.`,
  });

  if (!spec.fixed) {
    lines.push({
      formula: `W = m · g ≈ ${fmt(mass, 2)} × ${G} ≈ ${fmt(mass * G, 1)}`,
      note: `Weight is what gravity pulls it down with — heavier objects need more upward force (a bounce, a fan, a spring) to counter it.`,
    });
  }

  lines.push({
    formula: `μ (friction) = ${mat.friction}`,
    note: mat.friction < 0.1
      ? "Near zero — this barely resists sliding at all, so anything on it will glide."
      : mat.friction > 0.7
        ? "High friction — things resting on this grip rather than slide."
        : "Moderate friction — some resistance to sliding, but not sticky.",
  });

  lines.push({
    formula: `e (restitution) = ${mat.restitution}`,
    note: `On impact, the rebound speed is roughly e × the impact speed. e=0 means no bounce at all; e=1 would be a perfectly elastic bounce that loses no energy.`,
  });

  if (mat.shatters) {
    lines.push({
      formula: `shatters if impact speed ≥ ${mat.shatterImpactThreshold}`,
      note: `A soft tap just bounces off; hit it hard enough and it breaks instead.`,
    });
  }

  if (spec.type === "cannon") {
    const rad = (spec.launchRotation ?? 0) * (Math.PI / 180);
    const vx = spec.power * Math.cos(rad);
    const vy = spec.power * Math.sin(rad);
    lines.push({
      formula: `v = (P·cos θ, P·sin θ) = (${fmt(vx, 1)}, ${fmt(vy, 1)})`,
      note: `Power P is the launch speed; θ is the Fire Angle. This is the same vector decomposition used for any projectile's launch velocity.`,
    });
  }

  if (spec.type === "bomb") {
    lines.push({
      formula: `F(d) = power · (1 − d / radius)`,
      note: `The push falls off linearly with distance d from the blast center — nothing right at the edge of the radius, full strength at the center.`,
    });
  }

  if (spec.type === "fan") {
    lines.push({
      formula: `F(d) = power · (1 − d / range), applied every tick`,
      note: `Unlike a bomb's one-time push, a fan applies this continuously — so a body sitting in the wind keeps accelerating as long as it stays in range.`,
    });
  }

  if (spec.type === "magnet") {
    lines.push({
      formula: `F(d) = power · (1 − d / range), toward/away from center`,
      note: `Only pulls on metal objects. Positive power attracts, negative repels — like the field around a real magnet, but simplified to fall off linearly with distance instead of by the inverse square.`,
    });
  }

  if (spec.type === "springPad") {
    lines.push({
      formula: `v = power, directed straight off the pad's face`,
      note: `On contact, this instantly sets the object's velocity — an idealized spring that always launches at the same speed, regardless of how fast it landed.`,
    });
  }

  return lines;
}
