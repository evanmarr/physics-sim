// Renders the monthly newsletter as a self-contained HTML email. Email
// clients strip <style> blocks and external CSS unpredictably, so every
// rule here is inline and the layout is a plain single-column table —
// the one structure virtually every mail client renders consistently.

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Turns plain text (blank-line-separated paragraphs) into <p> tags. Text
// that's already HTML (contains a tag) is passed through as-is, so the
// user-edited news.txt/ads.txt files can hold either.
function textToHtml(text) {
  if (!text || !text.trim()) return "";
  if (/<[a-z][\s\S]*>/i.test(text)) return text;
  return text.trim().split(/\n\s*\n/).map((p) => `<p style="margin:0 0 14px;">${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`).join("");
}

function section(title, bodyHtml, accent) {
  return `
    <tr><td style="padding:28px 32px 4px;">
      <h2 style="margin:0 0 12px;font:700 18px/1.3 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:${accent};">${escapeHtml(title)}</h2>
      <div style="font:400 15px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1f26;">${bodyHtml}</div>
    </td></tr>`;
}

export function renderNewsletterHtml({ monthLabel, scientist, equation, fact, news, ads, unsubscribeUrl }) {
  const scientistBody = [scientist.paragraph, scientist.paragraph2].filter(Boolean).map((p) => `<p style="margin:0 0 14px;">${escapeHtml(p)}</p>`).join("");
  const equationBody = `
    <div style="background:#eef0f3;border-radius:8px;padding:14px 16px;margin:0 0 14px;font:600 15px/1.5 ui-monospace,Menlo,monospace;color:#1c1f26;">${escapeHtml(equation.formula)}</div>
    <p style="margin:0 0 14px;">${escapeHtml(equation.paragraph)}</p>`;
  const factBody = `<p style="margin:0 0 14px;">${escapeHtml(fact.paragraph)}</p>`;
  const newsHtml = textToHtml(news);
  const adsHtml = textToHtml(ads);

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f4f5f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:600px;width:100%;">

<tr><td style="padding:32px 32px 8px;background:linear-gradient(100deg,#38bdf8,#8b5cf6 55%,#10b981);">
  <div style="font:700 22px/1.2 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#ffffff;">Continuum</div>
  <div style="font:500 13px/1.4 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:rgba(255,255,255,0.9);margin-top:2px;">${escapeHtml(monthLabel)} newsletter</div>
</td></tr>

${section(`Scientist: ${scientist.name}`, scientistBody, "#8b5cf6")}
${section(`Equation: ${equation.name}`, equationBody, "#38bdf8")}
${section(`Fact of the Day: ${fact.title}`, factBody, "#10b981")}
${newsHtml ? section("Science News", newsHtml, "#3b6fe0") : ""}
${adsHtml ? section("Advertisements", adsHtml, "#6b7280") : ""}

<tr><td style="padding:24px 32px 32px;border-top:1px solid #e6e8ec;">
  <div style="font:400 12px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#6b7280;">
    You're receiving this because you subscribed to Continuum updates.
    <a href="${escapeHtml(unsubscribeUrl)}" style="color:#6b7280;">Unsubscribe</a>
  </div>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
