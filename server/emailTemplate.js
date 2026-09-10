// A shared, real HTML wrapper for every email this project sends (or, for
// now, stubs into server/outbox/) — verification codes, and everything
// physics-sim-admin sends. Plain inline styles only (no <style> block,
// no external assets) since email clients strip or mangle both.
export function wrapEmailHtml(bodyHtml) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; background: #ffffff;">
      <div style="padding: 24px 28px 20px; border-bottom: 3px solid #3b6fe0;">
        <div style="font-size: 20px; font-weight: 700; color: #1c1f26; letter-spacing: -0.01em;">
          <span style="color: #3b6fe0;">&#9679;</span> Continuum
        </div>
      </div>
      <div style="padding: 28px; color: #1c1f26; font-size: 14.5px; line-height: 1.6;">
        ${bodyHtml}
      </div>
      <div style="padding: 16px 28px; border-top: 1px solid #e2e5ea; color: #8a90a0; font-size: 11.5px;">
        Continuum — real simulations, not animations.
      </div>
    </div>
  `;
}
