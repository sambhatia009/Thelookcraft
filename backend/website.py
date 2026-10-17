"""Public website for TheLookCraft, served by the backend under /api/site (thelookcraft.com forwards here).
Landing, Privacy Policy, Terms, Support and the account-deletion entry point share one layout."""
from html import escape
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse

APP = "TheLookCraft"
DOMAIN = "thelookcraft.com"
SUPPORT_EMAIL = f"support@{DOMAIN}"
EFFECTIVE = "1 June 2026"
STATIC = Path(__file__).with_name("static")

NAV = [("", "HOME"), ("features", "FEATURES"), ("faq", "FAQ"), ("support", "SUPPORT"), ("privacy", "PRIVACY"), ("terms", "TERMS")]


def render(title: str, body: str, *, active: str = "", description: str = "", status: int = 200, wide: bool = False) -> HTMLResponse:
    nav = "".join(
        f'<a href="/api/site/{slug}" class="{"on" if slug == active else ""}">{label}</a>' for slug, label in NAV
    )
    desc = escape(description or f"{APP} — your closet, styled by AI. Snap your clothes, get outfits built from what you own.")
    html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{escape(title)} · {APP}</title><meta name="description" content="{desc}">
<link rel="icon" href="/api/site/icon.png"><link rel="apple-touch-icon" href="/api/site/icon.png">
<meta property="og:title" content="{escape(title)} · {APP}"><meta property="og:description" content="{desc}">
<meta property="og:image" content="/api/site/icon.png">
<style>
  *{{box-sizing:border-box}}
  body{{margin:0;background:#000;color:#fff;font-family:Helvetica Neue,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.5}}
  a{{color:#fff}}
  header{{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 24px;border-bottom:1px solid #222;max-width:1100px;margin:0 auto;flex-wrap:wrap}}
  .logo{{display:flex;align-items:center;gap:12px;text-decoration:none}}
  .logo img{{width:36px;height:36px;border:1px solid #333}}
  .logo span{{font-size:13px;letter-spacing:3px;font-weight:700}}
  nav{{display:flex;gap:4px 18px;flex-wrap:wrap}}
  nav a{{font-size:11px;letter-spacing:2px;text-decoration:none;color:#aaa;padding:6px 0}}
  nav a.on,nav a:hover{{color:#fff;border-bottom:1px solid #fff}}
  main{{max-width:{'1100px' if wide else '680px'};margin:0 auto;padding:48px 24px 80px}}
  h1{{font-size:clamp(32px,6vw,56px);font-weight:900;letter-spacing:-.5px;line-height:1.05;margin:0 0 20px}}
  h2{{font-size:13px;letter-spacing:3px;font-weight:700;margin:40px 0 12px;color:#fff}}
  h3{{font-size:18px;font-weight:800;margin:0 0 8px}}
  p,li{{font-size:16px;color:#cfcfcf}} .lead{{font-size:19px;color:#fff}} .fine{{font-size:13px;color:#888}}
  .kicker{{font-size:12px;letter-spacing:3px;color:#888;margin-bottom:16px}}
  .grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1px;background:#222;border:1px solid #222;margin-top:24px}}
  .cell{{background:#000;padding:28px 24px}} .cell .n{{font-size:12px;letter-spacing:2px;color:#888;margin-bottom:12px}}
  .hero{{display:grid;grid-template-columns:1.2fr .8fr;gap:48px;align-items:center;padding:40px 0 56px;border-bottom:1px solid #222}}
  .hero .mark{{width:100%;max-width:360px;justify-self:center;border:1px solid #333}}
  .hero > *{{min-width:0}} body{{overflow-x:hidden}}
  @media (max-width:760px){{.hero{{grid-template-columns:1fr;gap:32px}}.hero .mark{{max-width:220px}}.hero .phone{{width:140px}}.hero .phone.lg{{width:170px}}}}
  .badges{{display:flex;gap:12px;flex-wrap:wrap;margin-top:28px}}
  .badge{{display:inline-flex;flex-direction:column;border:1px solid #fff;padding:10px 18px;min-width:170px;text-decoration:none;opacity:.9}}
  .badge small{{font-size:10px;letter-spacing:2px;color:#aaa}} .badge b{{font-size:16px}}
  .badge.soon{{border-color:#444;color:#aaa;cursor:default}} .badge.soon b{{color:#ddd}}
  .cta{{display:inline-block;background:#fff;color:#000;text-decoration:none;font-weight:700;letter-spacing:2px;font-size:13px;padding:16px 24px;margin-top:8px}}
  label{{display:block;font-size:12px;letter-spacing:2px;margin:20px 0 8px}}
  input[type=email],input[type=text],input:not([type]),textarea{{width:100%;background:#000;color:#fff;border:1px solid #fff;padding:14px;font-size:16px;font-family:inherit}}
  input#code{{width:100%;background:#000;color:#fff;border:1px solid #fff;padding:14px;font-size:22px;letter-spacing:8px}}
  .opt{{display:flex;gap:12px;align-items:flex-start;border:1px solid #333;padding:14px;margin:8px 0;letter-spacing:0;font-size:15px;cursor:pointer}}
  .opt small{{color:#aaa}} .opt input{{margin-top:4px}}
  button{{width:100%;margin-top:24px;background:#fff;color:#000;border:0;padding:16px;font-size:14px;font-weight:700;letter-spacing:2px;cursor:pointer}}
  .phones{{display:flex;gap:16px;justify-content:center;align-items:flex-end;flex-wrap:nowrap}}
  .hero .phone{{width:170px}} .hero .phone.lg{{width:210px}}
  .phone{{width:220px;border:6px solid #1a1a1a;border-radius:34px;overflow:hidden;background:#000;box-shadow:0 30px 60px rgba(0,0,0,.6)}}
  .phone img{{display:block;width:100%;height:auto}}
  .phone.lg{{width:260px}}
  .caption{{text-align:center;font-size:11px;letter-spacing:2px;color:#888;margin-top:12px}}
  .feature{{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center;padding:48px 0;border-bottom:1px solid #222}}
  .feature:nth-child(even) .phone-wrap{{order:-1}}
  .feature .phone-wrap{{display:flex;justify-content:center}}
  @media (max-width:760px){{.feature{{grid-template-columns:1fr}}.feature:nth-child(even) .phone-wrap{{order:0}}}}
  details{{border-top:1px solid #222;padding:18px 0}} details:last-of-type{{border-bottom:1px solid #222}}
  summary{{cursor:pointer;font-size:17px;font-weight:700;list-style:none;display:flex;justify-content:space-between;gap:16px}}
  summary::after{{content:"+";color:#888}} details[open] summary::after{{content:"–"}}
  details p{{margin:12px 0 0}}
  .stats{{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1px;background:#222;border:1px solid #222;margin:40px 0}}
  .stat{{background:#000;padding:24px;text-align:center}} .stat b{{display:block;font-size:34px;font-weight:900}} .stat span{{font-size:11px;letter-spacing:2px;color:#888}}
  footer{{border-top:1px solid #222;max-width:1100px;margin:0 auto;padding:28px 24px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:12px;color:#777}}
  footer a{{color:#aaa;text-decoration:none;margin-right:16px;letter-spacing:1px}}
</style></head><body>
<header><a class="logo" href="/api/site/"><img src="/api/site/icon.png" alt="{APP}"><span>THELOOKCRAFT</span></a><nav>{nav}</nav></header>
<main>{body}</main>
<footer><div>© {APP} · {DOMAIN}</div><div><a href="/api/site/features">Features</a><a href="/api/site/faq">FAQ</a><a href="/api/site/support">Support</a><a href="/api/site/privacy">Privacy</a><a href="/api/site/terms">Terms</a><a href="/api/site/delete-account">Delete account</a></div></footer>
</body></html>"""
    return HTMLResponse(html, status_code=status)


LANDING = f"""
<section class="hero">
  <div>
    <div class="kicker">AI PERSONAL STYLIST · VIRTUAL WARDROBE</div>
    <h1>Your closet,<br>styled by AI.</h1>
    <p class="lead">Snap the clothes you own. {APP} tags them, removes the background and builds outfits from your real
    wardrobe — for the day, the weather and the occasion. See each look on you before you get dressed.</p>
    <div class="badges">
      <span class="badge soon"><small>COMING SOON ON THE</small><b>App Store</b></span>
      <span class="badge soon"><small>COMING SOON ON</small><b>Google Play</b></span>
    </div>
    <p class="fine" style="margin-top:20px">Free to start · No ads · Your photos stay private</p>
  </div>
  <div class="phones">
    <div class="phone"><img src="/api/site/img/shot-stylist.jpg" alt="{APP} stylist screen"></div>
    <div class="phone lg"><img src="/api/site/img/shot-lookbook.jpg" alt="{APP} lookbook with a look visualised on you"></div>
  </div>
</section>

<div class="stats">
  <div class="stat"><b>5</b><span>PIECES TO START</span></div>
  <div class="stat"><b>~5s</b><span>PER PHOTO, TAGGED &amp; CUT OUT</span></div>
  <div class="stat"><b>100%</b><span>LOOKS FROM CLOTHES YOU OWN</span></div>
  <div class="stat"><b>0</b><span>ADS OR DATA SELLING</span></div>
</div>

<h2>WHAT IT DOES</h2>
<div class="grid">
  <div class="cell"><div class="n">01</div><h3>Snap your closet</h3><p>Photograph pieces one at a time. AI names them, picks category, colour and style, and cuts out the background.</p></div>
  <div class="cell"><div class="n">02</div><h3>Get real outfits</h3><p>Ask for a look in plain words — “dinner, drizzle, smart casual”. Every suggestion uses only what you own.</p></div>
  <div class="cell"><div class="n">03</div><h3>Visualise on you</h3><p>Add one photo of yourself and see a look rendered on you before you decide.</p></div>
  <div class="cell"><div class="n">04</div><h3>Lookbook &amp; share</h3><p>Save looks, mark what you wore, and share editorial cards with friends.</p></div>
  <div class="cell"><div class="n">05</div><h3>Weather-aware</h3><p>Optional weather sync so layers and fabrics match the forecast.</p></div>
  <div class="cell"><div class="n">06</div><h3>Wear less, better</h3><p>Insights show what you actually wear, what you never touch and where a single piece would unlock more looks.</p></div>
</div>
<p style="margin-top:20px"><a class="cta" href="/api/site/features">EXPLORE ALL FEATURES →</a></p>

<h2>HOW IT WORKS</h2>
<div class="grid">
  <div class="cell"><div class="n">STEP 1</div><h3>Add five pieces</h3><p>A top, bottoms, shoes, a layer and an accessory are enough to start.</p></div>
  <div class="cell"><div class="n">STEP 2</div><h3>Tell the stylist the moment</h3><p>Occasion, mood, weather — or just “surprise me”.</p></div>
  <div class="cell"><div class="n">STEP 3</div><h3>Swap, save, wear</h3><p>Swap a piece, thumbs-up what works, and the stylist learns your taste.</p></div>
</div>

<h2>YOUR DATA, YOUR CALL</h2>
<p>Photos stay private to your account. Delete any piece, your personal photo, or your whole account at any time — in the app or
<a href="/api/site/delete-account">right here</a>. Read the <a href="/api/site/privacy">Privacy Policy</a>.</p>
"""

FEATURES = f"""
<div class="kicker">EVERYTHING INSIDE {APP.upper()}</div>
<h1>Features</h1>
<p class="lead">A stylist that knows your closet, not a shop that wants to sell you another one.</p>

<section class="feature">
  <div><h3>Snap &amp; auto-tag your closet</h3><p>Shoot a piece with the camera or pick from your gallery — one at a time or ten at once. In a few seconds AI names it, assigns category, colour, material and style, and removes the background for clean editorial cutouts. Edit anything before saving; add notes like “runs small”.</p></div>
  <div class="phone-wrap"><div class="phone"><img src="/api/site/img/shot-login.jpg" alt="{APP} sign-in screen"></div></div>
</section>
<section class="feature">
  <div><h3>An AI stylist that only uses what you own</h3><p>Describe the moment in plain words — “client lunch, 14°C, drizzle”, “date night in autumn”, “casual weekend”. The stylist composes complete looks from your pieces, explains the why, and lets you swap, remove or add a piece, or style around a favourite item.</p></div>
  <div class="phone-wrap"><div class="phone"><img src="/api/site/img/shot-stylist.jpg" alt="Stylist chat"></div></div>
</section>
<section class="feature">
  <div><h3>Visualise on you</h3><p>Add one full-body photo in Profile and any look — from the stylist or your Lookbook — can be rendered on you. Save the render with the look and include it in your share card.</p></div>
  <div class="phone-wrap"><div class="phone"><img src="/api/site/img/shot-lookbook.jpg" alt="Lookbook with visualised outfit"></div></div>
</section>
<section class="feature">
  <div><h3>Lookbook, wear log &amp; sharing</h3><p>Save looks with occasion tags (Office, Date, Weekend or your own), mark “wore it today”, and export a black-and-white editorial share card to Photos or any app.</p></div>
  <div class="phone-wrap"><img class="mark" src="/api/site/icon.png" alt="{APP} mark" style="max-width:220px;border:1px solid #333"></div>
</section>

<h2>AND MORE</h2>
<div class="grid">
  <div class="cell"><h3>Weather sync</h3><p>Optional, one tap: looks adapt to today's forecast where you are. Location is never stored.</p></div>
  <div class="cell"><h3>Learns your taste</h3><p>Thumbs-up or down any look, mark pieces “don't suggest in looks”, and suggestions stop repeating.</p></div>
  <div class="cell"><h3>Never-worn nudges</h3><p>The stylist surfaces pieces you haven't touched and builds looks that finally use them.</p></div>
  <div class="cell"><h3>Wardrobe insights</h3><p>Most-worn pieces, colour balance, category gaps — and shop-the-gap suggestions when one piece would unlock many looks.</p></div>
  <div class="cell"><h3>Fast, reliable uploads</h3><p>Photos are compressed on your phone, acknowledged in a second and processed in the background — retry never duplicates an item.</p></div>
  <div class="cell"><h3>Private by design</h3><p>Email or Google sign-in, photos served only to you, disable or delete your account whenever you like.</p></div>
</div>
<p style="margin-top:28px"><a class="cta" href="/api/site/">BACK TO HOME</a></p>
"""

FAQ = f"""
<div class="kicker">QUESTIONS</div>
<h1>FAQ</h1>
<details open><summary>Is {APP} free?</summary><p>Yes — getting started is free, and there are no ads. If we add premium features later they will be clearly optional.</p></details>
<details><summary>Which phones does it support?</summary><p>iPhone (iOS 16+) and Android (Android 8+). Store listings are coming soon; the website will link to them the day they go live.</p></details>
<details><summary>How many clothes do I need to add?</summary><p>Five pieces — a top, bottoms, shoes, a layer and an accessory — are enough for the stylist to start building real outfits. More pieces means more variety.</p></details>
<details><summary>How should I photograph my clothes?</summary><p>One piece at a time, laid flat or on a hanger, on a plain background with even light. The app compresses the photo on your phone and removes the background for you.</p></details>
<details><summary>Does the stylist suggest things I don't own?</summary><p>No. Every look is composed only from pieces in your closet. The optional “shop the gap” insight shows where one new piece would unlock many more looks — nothing more.</p></details>
<details><summary>How does “Visualise on me” work?</summary><p>You add one full-body photo in Profile. When you ask, AI renders a chosen look on that photo. The render is an approximation for deciding, not a product photo; you can save it with the look or discard it.</p></details>
<details><summary>Who can see my photos?</summary><p>Only you. Photos are stored in private storage and served solely to your signed-in account. Looks you share are shared by you, through your phone's share sheet.</p></details>
<details><summary>Are my photos used to train AI?</summary><p>No. Photos are sent to AI processors only to deliver the feature you requested (tagging, styling, rendering) and are not used to train our models.</p></details>
<details><summary>Can I delete my data?</summary><p>Yes — any piece, your personal photo, or your whole account, instantly, from Profile → Privacy &amp; Data. You can also <a href="/api/site/delete-account">request deletion here</a> without the app, or disable your account and come back later.</p></details>
<details><summary>I didn't get the password-reset email.</summary><p>Check Spam or Promotions — new senders often land there. The email comes from “{APP}” with a 6-digit code valid for 15 minutes.</p></details>
<p style="margin-top:28px">Still stuck? <a href="/api/site/support">Contact support</a>.</p>
"""

PRIVACY = f"""
<div class="kicker">EFFECTIVE {EFFECTIVE.upper()}</div>
<h1>Privacy Policy</h1>
<p class="lead">{APP} ("we", "us") is a personal wardrobe and AI styling app operated at {DOMAIN}. This policy explains what we collect, why, and the control you have over it.</p>
<h2>WHAT WE COLLECT</h2>
<ul>
  <li><b>Account:</b> name, email address and a salted password hash — or your Google account identity if you sign in with Google.</li>
  <li><b>Wardrobe photos:</b> pictures of clothing you upload, the AI-generated tags (category, colour, style) and optional notes.</li>
  <li><b>Profile &amp; styling preferences:</b> dress code, fit, colour palette, climate, optional gender and age range, and an optional personal photo used only to visualise outfits on you.</li>
  <li><b>Activity in the app:</b> saved looks, wear history, thumbs-up/down feedback on suggestions, and upload diagnostics (device platform, OS version, error messages) used to keep uploads reliable.</li>
  <li><b>Location (optional):</b> approximate location only while weather-aware styling is on. It is sent to a weather service and not stored.</li>
</ul>
<h2>HOW WE USE IT</h2>
<ul>
  <li>To store your closet and build outfit suggestions and visualisations from it.</li>
  <li>To process photos with AI services (clothing recognition, styling, image generation). Photos are sent to these processors solely to deliver the feature you asked for and are not used to train our models.</li>
  <li>To send transactional emails you request (password reset, account confirmation codes). We send no marketing email.</li>
</ul>
<h2>SHARING</h2>
<p>We do not sell personal data. Data is shared only with the providers that run the service — cloud hosting, database, object storage, AI text/image processing, email delivery and weather data — each processing it on our behalf. Looks you choose to share are shared by you through your device's share sheet.</p>
<h2>RETENTION &amp; YOUR CHOICES</h2>
<ul>
  <li>Data is kept while your account is active.</li>
  <li><b>Disable</b> your account to hide it and sign out everywhere; sign in again to reactivate.</li>
  <li><b>Delete</b> your account at any time from Profile → Privacy &amp; Data in the app, or without the app at <a href="/api/site/delete-account">{DOMAIN}/delete-account</a>. Deletion permanently removes your profile, photos, looks, feedback and sessions.</li>
  <li>Delete individual photos, looks and your personal photo inside the app at any time.</li>
</ul>
<h2>SECURITY</h2>
<p>Data is encrypted in transit. Passwords are stored only as salted hashes. Photos live in private object storage and are served only to the signed-in owner.</p>
<h2>CHILDREN</h2>
<p>{APP} is not directed at children under 13 and we do not knowingly collect their data.</p>
<h2>CHANGES &amp; CONTACT</h2>
<p>We may update this policy; material changes are announced in the app. Questions or requests: <a href="mailto:{SUPPORT_EMAIL}">{SUPPORT_EMAIL}</a>.</p>
"""

TERMS = f"""
<div class="kicker">EFFECTIVE {EFFECTIVE.upper()}</div>
<h1>Terms of Service</h1>
<p class="lead">These terms govern your use of the {APP} app and website. By creating an account you agree to them.</p>
<h2>THE SERVICE</h2>
<p>{APP} lets you photograph and organise your wardrobe and receive AI-generated outfit suggestions and visualisations. Suggestions are creative assistance, not professional advice; you decide what to wear.</p>
<h2>YOUR ACCOUNT</h2>
<ul>
  <li>You must be 13 or older. Keep your sign-in details confidential; you are responsible for activity on your account.</li>
  <li>Provide accurate information and keep it current.</li>
</ul>
<h2>YOUR CONTENT</h2>
<ul>
  <li>You keep ownership of the photos and content you upload. You grant us a limited licence to store and process them solely to operate the service for you (including AI tagging, background removal and visualisation).</li>
  <li>Only upload photos you have the right to use. Do not upload unlawful, hateful or sexually explicit content, or images of other people without their consent.</li>
  <li>AI-generated visualisations are approximations and may contain errors.</li>
</ul>
<h2>ACCEPTABLE USE</h2>
<p>Do not misuse the service: no reverse engineering, scraping, automated bulk access, attempts to bypass security, or use that burdens the service or violates the law.</p>
<h2>AVAILABILITY &amp; CHANGES</h2>
<p>We may add, change or remove features, and may suspend accounts that violate these terms. We aim for high availability but the service is provided "as is" without warranties of uninterrupted operation.</p>
<h2>LIABILITY</h2>
<p>To the extent permitted by law, {APP} is not liable for indirect or consequential losses arising from use of the service. Nothing in these terms limits liability that cannot be limited by law.</p>
<h2>ENDING YOUR ACCOUNT</h2>
<p>You can disable or permanently delete your account at any time in the app (Profile → Privacy &amp; Data) or at <a href="/api/site/delete-account">{DOMAIN}/delete-account</a>. Deletion removes your data as described in the <a href="/api/site/privacy">Privacy Policy</a>.</p>
<h2>CONTACT</h2>
<p><a href="mailto:{SUPPORT_EMAIL}">{SUPPORT_EMAIL}</a></p>
"""

SUPPORT = f"""
<div class="kicker">WE'RE HERE TO HELP</div>
<h1>Support</h1>
<p class="lead">Questions, bugs, feature ideas or privacy requests — email us and a human will reply.</p>
<p><a class="cta" href="mailto:{SUPPORT_EMAIL}?subject={APP}%20support">EMAIL {SUPPORT_EMAIL.upper()}</a></p>
<h2>QUICK ANSWERS</h2>
<div class="grid">
  <div class="cell"><h3>My photo upload is slow</h3><p>Shoot one piece at a time on a plain background. Photos are compressed on your phone and processed in a few seconds; you can keep using the app while it finishes.</p></div>
  <div class="cell"><h3>Forgot my password</h3><p>Tap “Forgot password?” on the sign-in screen. We email a 6-digit code you use to set a new password.</p></div>
  <div class="cell"><h3>Suggestions repeat</h3><p>Thumbs-down a look or mark a piece “don't suggest in looks” from its detail page — the stylist adapts.</p></div>
  <div class="cell"><h3>Delete or disable my account</h3><p>In the app: Profile → Privacy &amp; Data. Without the app: <a href="/api/site/delete-account">delete-account</a>.</p></div>
</div>
"""


def build_router(delete_request_form: str) -> APIRouter:
    router = APIRouter(prefix="/site")

    @router.get("", response_class=HTMLResponse, include_in_schema=False)
    @router.get("/", response_class=HTMLResponse, include_in_schema=False)
    async def landing():
        return render(f"{APP} — Your closet, styled by AI", LANDING, active="", wide=True)

    @router.get("/privacy", response_class=HTMLResponse, include_in_schema=False)
    async def privacy():
        return render("Privacy Policy", PRIVACY, active="privacy", description=f"How {APP} collects, uses and protects your data.")

    @router.get("/terms", response_class=HTMLResponse, include_in_schema=False)
    async def terms():
        return render("Terms of Service", TERMS, active="terms", description=f"Terms for using the {APP} app and website.")

    @router.get("/features", response_class=HTMLResponse, include_in_schema=False)
    async def features():
        return render("Features", FEATURES, active="features", description=f"Everything inside {APP}: AI tagging, outfit generation, visualise on you, lookbook and more.", wide=True)

    @router.get("/faq", response_class=HTMLResponse, include_in_schema=False)
    async def faq():
        return render("FAQ", FAQ, active="faq", description=f"Answers to common questions about {APP}.")

    @router.get("/img/{name}", include_in_schema=False)
    async def image(name: str):
        path = STATIC / "img" / Path(name).name
        if path.suffix != ".jpg" or not path.is_file():
            raise HTTPException(status_code=404, detail="Not found")
        return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})

    @router.get("/support", response_class=HTMLResponse, include_in_schema=False)
    async def support():
        return render("Support", SUPPORT, active="support", description=f"Get help with {APP}.", wide=True)

    @router.get("/delete-account", response_class=HTMLResponse, include_in_schema=False)
    async def delete_account():
        return render("Delete or disable your account", delete_request_form, active="delete-account",
                      description=f"Request deletion or deactivation of your {APP} account.")

    @router.get("/icon.png", include_in_schema=False)
    async def icon():
        return FileResponse(STATIC / "icon-256.png", media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})

    @router.get("/robots.txt", include_in_schema=False)
    async def robots():
        return HTMLResponse("User-agent: *\nAllow: /api/site/\n", media_type="text/plain")

    return router


def redirect(slug: str) -> RedirectResponse:
    return RedirectResponse(f"/api/site/{slug}", status_code=308)
