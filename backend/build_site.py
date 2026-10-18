"""Build the static public website into /app/docs for GitHub Pages (custom domain thelookcraft.com).

Run:  python3 build_site.py
Pages are rendered from the same templates the backend serves at /api/site, so content never drifts.
The account-deletion page works without a backend (email request) and, when docs/config.js sets
BACKEND_URL, also offers the self-service code flow against the deployed API.
"""
import shutil
from pathlib import Path

import website
from website import APP, DOMAIN, SUPPORT_EMAIL, render

OUT = Path(__file__).resolve().parent.parent / "docs"

LINKS = {
    '"/api/site/privacy"': '"privacy.html"',
    '"/api/site/features"': '"features.html"',
    '"/api/site/faq"': '"faq.html"',
    '"/api/site/img/': '"img/',
    '"/api/site/terms"': '"terms.html"',
    '"/api/site/support"': '"support.html"',
    '"/api/site/delete-account"': '"delete-account.html"',
    '"/api/site/icon.png"': '"icon.png"',
    '"/api/site/"': '"index.html"',
    '"/api/site"': '"index.html"',
}

DELETE_STATIC = f"""
  <div class="kicker">ACCOUNT</div>
  <h1>Delete or disable your account</h1>
  <p class="lead">You can remove your {APP} account and all of its data at any time — inside the app, or from this page without the app.</p>

  <h2>OPTION 1 · IN THE APP (INSTANT)</h2>
  <ol>
    <li>Open {APP} and go to <b>Profile</b>.</li>
    <li>Scroll to <b>Privacy &amp; Data</b>.</li>
    <li>Choose <b>Delete Account &amp; Data</b> (permanent) or <b>Disable Account</b> (reversible — sign in again to reactivate).</li>
    <li>Confirm. Your profile, closet photos, looks, feedback and sessions are removed immediately and you are signed out.</li>
  </ol>

  <h2>OPTION 2 · SELF-SERVICE WITH AN EMAIL CODE</h2>
  <div id="self-service">
    <p class="fine">Loading…</p>
  </div>

  <h2>OPTION 3 · EMAIL US</h2>
  <p>Send a request from the email address on your account and we will delete it within 30 days and confirm by email.</p>
  <form id="mail-form">
    <label for="m-email">YOUR ACCOUNT EMAIL</label>
    <input id="m-email" type="email" required autocomplete="email" placeholder="you@example.com">
    <label>REQUEST</label>
    <label class="opt"><input type="radio" name="m-mode" value="delete" checked><span><b>Delete my account permanently</b><br><small>Removes profile, photos, looks, feedback and sessions. Cannot be undone.</small></span></label>
    <label class="opt"><input type="radio" name="m-mode" value="disable"><span><b>Disable my account</b><br><small>Hidden and signed out everywhere; reactivate by signing in.</small></span></label>
    <button type="submit">EMAIL THE REQUEST</button>
  </form>
  <p class="fine">Or write to <a href="mailto:{SUPPORT_EMAIL}?subject={APP}%20account%20deletion">{SUPPORT_EMAIL}</a> directly.</p>

  <h2>WHAT IS DELETED</h2>
  <p>Account (name, email, password hash or Google identity), styling profile and personal photo, every wardrobe photo and its
  AI tags, saved looks and visualisations, wear history, feedback and all sessions. We keep nothing except anonymised server
  logs for up to 30 days for security. See the <a href="privacy.html">Privacy Policy</a>.</p>

<script src="config.js"></script>
<script>
(function () {{
  var box = document.getElementById("self-service");
  var api = (window.THELOOKCRAFT_CONFIG && window.THELOOKCRAFT_CONFIG.BACKEND_URL || "").replace(/\\/$/, "");
  if (api) {{
    box.innerHTML = '<p>We will email you a 6-digit code to confirm it is you, then you choose disable or permanent delete.</p>' +
      '<form method="post" action="' + api + '/api/account/delete-request">' +
      '<label for="email">EMAIL</label><input id="email" name="email" type="email" required autocomplete="email" placeholder="you@example.com">' +
      '<button type="submit">SEND CODE</button></form>';
  }} else {{
    box.innerHTML = '<p class="fine">Self-service deletion is available inside the app (Option 1). To delete without the app, use Option 3 below.</p>';
  }}
  document.getElementById("mail-form").addEventListener("submit", function (e) {{
    e.preventDefault();
    var email = document.getElementById("m-email").value.trim();
    var mode = document.querySelector('input[name="m-mode"]:checked').value;
    var subject = encodeURIComponent("{APP} account " + (mode === "delete" ? "deletion" : "deactivation") + " request");
    var body = encodeURIComponent("Please " + (mode === "delete" ? "permanently delete" : "disable") + " the {APP} account registered to: " + email + "\\n\\nI understand " + (mode === "delete" ? "this removes all my photos, looks and data and cannot be undone." : "I can reactivate by signing in again."));
    window.location.href = "mailto:{SUPPORT_EMAIL}?subject=" + subject + "&body=" + body;
  }});
}})();
</script>
"""


def html(title, body, **kw):
    out = render(title, body, **kw).body.decode()
    for src, dst in LINKS.items():
        out = out.replace(src, dst)
    return out


def main():
    OUT.mkdir(exist_ok=True)
    pages = {
        "index.html": html(f"{APP} — Your closet, styled by AI", website.LANDING, active="", wide=True),
        "features.html": html("Features", website.FEATURES, active="features", wide=True),
        "faq.html": html("FAQ", website.FAQ, active="faq"),
        "privacy.html": html("Privacy Policy", website.PRIVACY, active="privacy"),
        "terms.html": html("Terms of Service", website.TERMS, active="terms"),
        "support.html": html("Support", website.SUPPORT, active="support", wide=True),
        "delete-account.html": html("Delete or disable your account", DELETE_STATIC, active="delete-account"),
        "404.html": html("Page not found", '<h1>Page not found</h1><p class="lead">Try the <a href="index.html">home page</a>.</p>'),
    }
    for name, content in pages.items():
        (OUT / name).write_text(content)
    # Clean URLs on GitHub Pages: /privacy → privacy/index.html
    for slug in ("features", "faq", "privacy", "terms", "support", "delete-account"):
        d = OUT / slug
        d.mkdir(exist_ok=True)
        (d / "index.html").write_text(pages[f"{slug}.html"].replace('href="', 'href="../').replace('src="', 'src="../')
                                      .replace('href="../mailto:', 'href="mailto:').replace('href="../http', 'href="http')
                                      .replace('href="../#', 'href="#'))
    shutil.copy(website.STATIC / "icon-256.png", OUT / "icon.png")
    (OUT / "img").mkdir(exist_ok=True)
    for shot in (website.STATIC / "img").glob("*.jpg"):
        shutil.copy(shot, OUT / "img" / shot.name)
    (OUT / "CNAME").write_text(f"{DOMAIN}\n")
    (OUT / ".nojekyll").write_text("")
    (OUT / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: https://{DOMAIN}/sitemap.xml\n")
    today = __import__("datetime").date.today().isoformat()
    entries = [("", "weekly", "1.0"), ("features", "monthly", "0.8"), ("faq", "monthly", "0.7"), ("support", "monthly", "0.5"),
               ("privacy", "yearly", "0.3"), ("terms", "yearly", "0.3"), ("delete-account", "yearly", "0.3")]
    urls = "".join(
        f"  <url>\n    <loc>https://{DOMAIN}/{slug}</loc>\n    <lastmod>{today}</lastmod>\n"
        f"    <changefreq>{freq}</changefreq>\n    <priority>{prio}</priority>\n  </url>\n" for slug, freq, prio in entries)
    (OUT / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + "</urlset>\n")
    config = OUT / "config.js"
    if not config.exists():
        config.write_text('// Set to your DEPLOYED backend origin (no trailing slash) to enable the self-service code flow,\n'
                          '// e.g. window.THELOOKCRAFT_CONFIG = { BACKEND_URL: "https://your-app.emergent.host" };\n'
                          'window.THELOOKCRAFT_CONFIG = { BACKEND_URL: "" };\n')
    print("built", sorted(p.name for p in OUT.iterdir()))


if __name__ == "__main__":
    main()
