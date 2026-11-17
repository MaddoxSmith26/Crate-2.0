"""
End-to-end check of Crate in a real browser.

Drives the built web app against the local backend (tools/local-backend),
with MusicBrainz, the Cover Art Archive and Wikipedia replaced by canned
responses shaped like the real ones. Two people (Maddox and Sam) use the app
in separate browser sessions.

    npm run build:web   (with EXPO_PUBLIC_SUPABASE_URL=http://localhost:54321)
    node tools/local-backend/server.mjs &
    npx serve dist -l 4173 -s &
    python3 tools/e2e/run.py

Needs Python with Playwright and a Chrome install. Screenshots go to the
folder in SHOTS (default /tmp/shots).
"""
import json, os, re, sys, time
from playwright.sync_api import sync_playwright, expect

APP = os.environ.get("APP", "http://localhost:4173")
SHOTS = os.environ.get("SHOTS", "/tmp/shots")
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")
RUN = str(int(time.time()))

RG = "416bb5e5-c7d1-3977-8fd7-7c9daf6c2be6"
REL = "081ea37e-db59-4332-8cd2-ad020cb93af6"
AC = [{"name": "Fleetwood Mac", "artist": {"id": "a1", "name": "Fleetwood Mac"}}]
SEARCH = {"release-groups": [
    {"id": "rg-live", "score": 100, "title": "Rumours Live", "primary-type": "Album", "secondary-types": ["Live"], "first-release-date": "2023-09-08", "artist-credit": AC},
    {"id": RG, "score": 100, "title": "Rumours", "primary-type": "Album", "first-release-date": "1977-02-04", "artist-credit": AC},
    {"id": "rg-comp", "score": 85, "title": "Fleetwood Mac / Rumours", "primary-type": "Album", "secondary-types": ["Compilation"], "first-release-date": "1981", "artist-credit": AC},
]}
EDITIONS = {"releases": [
    {"id": "rel-deluxe", "title": "Rumours", "status": "Official", "date": "2013-01-29", "country": "XE", "disambiguation": "deluxe edition", "media": [{"format": "CD", "track-count": 4}]},
    {"id": REL, "title": "Rumours", "status": "Official", "date": "1977-02-04", "country": "US", "disambiguation": "", "media": [{"format": "12\" Vinyl", "track-count": 3}]},
]}
def tracks(n):
    names = ["Second Hand News", "Dreams", "Never Going Back Again", "Silver Springs"]
    return {"media": [{"position": 1, "format": "12\" Vinyl", "tracks": [
        {"id": f"t{i}", "number": f"A{i+1}", "position": i + 1, "title": names[i], "length": 163000 + i * 1000, "recording": {"id": f"rec-{i}", "length": 163000}} for i in range(n)]}]}
GENRES = {"genres": [{"name": "soft rock", "count": 11}, {"name": "pop rock", "count": 10}]}
CREDITS = {"relations": [
    {"type": "producer", "target-type": "artist", "attributes": [], "artist": {"name": "Ken Caillat"}},
    {"type": "instrument", "target-type": "artist", "attributes": ["drums (drum set)"], "artist": {"name": "Mick Fleetwood"}},
    {"type": "performance", "target-type": "work", "work": {"id": "w", "title": "Dreams", "relations": [{"type": "writer", "artist": {"name": "Stevie Nicks"}}]}},
]}
WIKI = {"query": {"pages": {"1": {"title": "Dreams (Fleetwood Mac song)", "extract": "\"Dreams\" is a song by Fleetwood Mac from their album Rumours.", "fullurl": "https://en.wikipedia.org/wiki/Dreams_(Fleetwood_Mac_song)", "index": 1}}}}

def mock_network(context):
    def mb(route):
        url = route.request.url
        if "/release-group?query" in url: body = SEARCH
        elif "/release?release-group" in url: body = EDITIONS
        elif "/release/rel-deluxe" in url: body = tracks(4)
        elif "/release/" in url: body = tracks(3)
        elif "/release-group/" in url: body = GENRES
        elif "/recording/" in url: body = CREDITS
        else: return route.fulfill(status=404, body="{}")
        route.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"}, body=json.dumps(body))
    context.route("**/musicbrainz.org/**", mb)
    context.route("**/coverartarchive.org/**", lambda r: r.fulfill(status=404, body=""))
    context.route("**/en.wikipedia.org/**", lambda r: r.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"}, body=json.dumps(WIKI)))

step_no = 0
def step(page, name):
    global step_no
    step_no += 1
    page.wait_for_timeout(350)
    page.screenshot(path=f"{SHOTS}/{step_no:02d}-{name}.png", full_page=True)
    print(f"ok  {step_no:02d} {name}", flush=True)

def btn(page, name, exact=True):
    return page.get_by_role("button", name=name, exact=exact).locator("visible=true").first
def tab(page, name):
    page.get_by_role("tab", name=name).click()
def sees(page, text, timeout=8000):
    # Earlier screens stay mounted but hidden in the navigation stack, so only count visible text.
    expect(page.get_by_text(text, exact=False).locator("visible=true").first).to_be_visible(timeout=timeout)
def gone(page, text):
    expect(page.get_by_text(text, exact=False).locator("visible=true")).to_have_count(0)

def sign_up(page, name):
    page.goto(APP)
    btn(page, "Create an account").click()
    page.get_by_label("Your name").fill(name)
    page.get_by_label("Email").fill(f"{name.lower()}-{RUN}@example.test")
    page.get_by_label("Password").fill("crate-test-1")
    btn(page, "Create account").click()
    expect(page.get_by_role("tab", name="Collection")).to_be_visible(timeout=10000)

def add_manual(page, artist, title, lines, target="collection"):
    page.goto(f"{APP}/add-manual?to={target}")
    page.get_by_label("Artist").fill(artist)
    page.get_by_label("Album title").fill(title)
    page.get_by_label("Tracks, one per line").fill(lines)
    btn(page, "Review before saving").click()

def rate(page, track_label, whole, decimal=None):
    page.get_by_role("button", name=re.compile(f"^Track \\d+, {track_label}")).click()
    btn(page, str(whole)).click()
    if decimal is not None:
        page.wait_for_timeout(250)
        btn(page, f".{decimal}").click()
    page.wait_for_timeout(250)
    page.get_by_role("button", name=re.compile(f"^Track \\d+, {track_label}")).click()

def main():
    os.makedirs(SHOTS, exist_ok=True)
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
        def person():
            ctx = browser.new_context(viewport={"width": 1100, "height": 900})
            mock_network(ctx)
            page = ctx.new_page()
            page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
            page.on("console", lambda m: errors.append(f"console: {m.text}") if m.type == "error" and "coverartarchive" not in m.text and "404" not in m.text else None)
            return page
        m, s = person(), person()

        # ---- accounts
        m.goto(APP); sees(m, "Sign in to flip through your records"); step(m, "sign-in")
        sign_up(m, "Maddox"); sees(m, "Your crate is empty"); step(m, "empty-collection")

        # ---- add a record by search
        btn(m, "Add your first record").click()
        m.get_by_label("Artist").fill("Fleetwood Mac"); m.get_by_label("Album title").fill("Rumours")
        btn(m, "Search").click()
        sees(m, "Pick the right one"); sees(m, "Original album"); sees(m, "Live"); sees(m, "Compilation")
        first = m.get_by_role("button", name=re.compile("^Rumours by Fleetwood Mac, 1977, Original album"))
        box_orig = first.bounding_box(); box_live = m.get_by_role("button", name=re.compile("^Rumours Live")).bounding_box()
        assert box_orig["y"] < box_live["y"], "original album should be listed first"
        step(m, "search-results")
        first.click()
        sees(m, "About to add to your collection", 15000); sees(m, "Second Hand News"); sees(m, "Never Going Back Again"); gone(m, "Silver Springs")
        sees(m, "1977 · 3 tracks"); step(m, "confirm-before-saving")
        btn(m, "2013 · XE · CD · 4 tracks · deluxe edition").click(); sees(m, "Silver Springs")   # edition switch
        btn(m, "1977 · US · 12\" Vinyl · 3 tracks").click(); m.wait_for_timeout(1500); gone(m, "Silver Springs")
        btn(m, "Add to my collection").click()
        sees(m, "Tracks and my ratings", 15000); sees(m, "Not rated yet"); step(m, "album-page-unrated")

        # ---- ratings: in progress -> complete, with an interlude
        rate(m, "Second Hand News", 9, 5)
        sees(m, "In progress"); sees(m, "1 of 3 tracks rated"); step(m, "in-progress")
        tab_check = m.goto(f"{APP}/ranking"); sees(m, "Nothing ranked yet"); sees(m, "In progress, not ranked yet"); step(m, "ranking-in-progress")
        m.go_back(); sees(m, "Tracks and my ratings")
        m.get_by_role("button", name=re.compile("^Track 2, Dreams")).click(); btn(m, "Mark as interlude").click()
        sees(m, "Interlude, not counted"); m.get_by_role("button", name=re.compile("^Track 2, Dreams")).click()
        rate(m, "Never Going Back Again", 8)
        sees(m, "Complete"); sees(m, "8.75"); sees(m, "2 of 2 tracks rated · 1 interlude"); step(m, "complete-with-interlude")
        m.goto(f"{APP}/ranking"); sees(m, "8.75"); gone(m, "Nothing ranked yet"); step(m, "ranking")

        # ---- duplicates
        m.goto(f"{APP}/add"); m.get_by_label("Album title").fill("Rumours"); btn(m, "Search").click()
        m.get_by_role("button", name=re.compile("^Rumours by Fleetwood Mac, 1977")).click()
        sees(m, "You already own this album", 15000); sees(m, "Already in Crate's catalog"); step(m, "duplicate-from-search")
        btn(m, "I have another pressing").click(); expect(btn(m, "Add second copy")).to_be_disabled()
        add_manual(m, "Pink Floyd", "The Dark Side of the Moon", "Speak to Me 1:05\nBreathe 2:49")
        sees(m, "About to add to your collection"); sees(m, "1:05"); btn(m, "Add to my collection").click(); sees(m, "Tracks and my ratings", 15000)
        add_manual(m, "Pink Floyd", "Dark Side of the Moon", "Speak to Me")
        sees(m, "You already own this album"); gone(m, "Add to my collection"); step(m, "duplicate-dark-side")
        m.goto(f"{APP}/collection"); sees(m, "2 albums"); step(m, "collection-grid")

        # ---- family group
        tab(m, "Family"); m.get_by_label("Group name").fill("The Smiths"); btn(m, "Create family group").click()
        code_el = m.get_by_label(re.compile("^Join code [A-Z0-9 ]+$")); expect(code_el).to_be_visible(timeout=8000)
        code = code_el.inner_text().strip(); assert re.fullmatch(r"[A-Z2-9]{6}", code), code
        step(m, "family-created")
        sign_up(s, "Sam"); tab(s, "Family"); s.get_by_label("Join code").fill(code.lower()); btn(s, "Join family group").click()
        sees(s, "The Smiths"); sees(s, "Maddox"); step(s, "sam-joined")
        tab(s, "Collection"); btn(s, "Whole family").click(); sees(s, "Maddox's"); step(s, "shared-collection")

        # ---- borrowing
        s.get_by_role("link", name=re.compile("^Rumours by Fleetwood Mac")).click()
        sees(s, "You can rate an album while you have it"); btn(s, "Ask to borrow").click(); sees(s, "Asked, waiting"); step(s, "borrow-asked")
        m.goto(f"{APP}/collection"); expect(m.get_by_role("link", name=re.compile("^Notifications, 1 unread"))).to_be_visible(timeout=8000)
        m.get_by_role("link", name=re.compile("^Notifications")).click(); sees(m, "Sam wants to borrow Rumours"); step(m, "notification")
        m.get_by_role("button", name=re.compile("Sam wants to borrow Rumours")).click(); sees(m, "Borrow requests for you")
        btn(m, "Approve").click(); sees(m, "Lent out"); sees(m, "With Sam since today"); step(m, "lent-out")
        tab(m, "Collection"); sees(m, "With Sam"); step(m, "greyed-out-in-collection")
        m.goto(f"{APP}/play"); gone(m, "Rumours")          # lent out: not on my shelf, so never suggested
        sees(m, "The Dark Side of the Moon")
        s.goto(f"{APP}/collection"); sees(s, "Borrowing right now"); sees(s, "From Maddox"); step(s, "sam-borrowing")
        s.get_by_role("link", name=re.compile("^Rumours by Fleetwood Mac")).first.click(); sees(s, "You are borrowing this from Maddox")
        rate(s, "Second Hand News", 6); rate(s, "Dreams", 7); rate(s, "Never Going Back Again", 8, 3)
        sees(s, "Complete"); sees(s, "7.10"); sees(s, "Family scores"); step(s, "sam-rated-borrowed")
        btn(s, "Play now").click(); sees(s, "Probably playing"); sees(s, "Second Hand News"); step(s, "now-playing")
        s.go_back(); btn(s, "I gave it back").click(); sees(s, "Marked as returned")
        s.goto(f"{APP}/ranking"); sees(s, "7.10"); sees(s, "Rumours"); step(s, "sam-ranking-after-return")
        s.goto(f"{APP}/collection"); gone(s, "Borrowing right now")
        # Sam's rating and listen never touched Maddox's numbers.
        m.goto(f"{APP}/ranking"); sees(m, "8.75"); gone(m, "7.10")
        m.goto(f"{APP}/play"); sees(m, "No listens logged yet"); sees(m, "Rumours")   # back on the shelf

        # ---- compare and member page
        m.goto(f"{APP}/ranking"); btn(m, "Sam").click(); sees(m, "Compare rankings"); sees(m, "1 album ranked by both"); step(m, "compare")
        m.goto(f"{APP}/family"); m.get_by_role("link", name=re.compile("^Sam\\.")).click(); sees(m, "Sam's ranking"); sees(m, "Sam's listening, all time"); step(m, "member-page")

        # ---- wishlist and hidden gift claims
        add_manual(m, "Steely Dan", "Aja", "Black Cow\nAja\nDeacon Blues", target="wishlist")
        sees(m, "About to add to your wishlist"); btn(m, "Add to my wishlist").click(); sees(m, "My wishlist"); sees(m, "Aja"); step(m, "wishlist")
        s.goto(f"{APP}/wishlist"); sees(s, "Maddox's wishlist"); btn(s, "I'm getting this").click(); sees(s, "You're getting this"); step(s, "sam-claimed")
        m.goto(f"{APP}/wishlist"); sees(m, "Aja"); gone(m, "getting this"); gone(m, "Taken"); gone(m, "Sam"); step(m, "maddox-cannot-see-claim")
        m.goto(f"{APP}/notifications"); gone(m, "Aja")
        btn_back = m.goto(f"{APP}/wishlist"); btn(m, "I got it").click(); sees(m, "Nothing on your wishlist")
        m.goto(f"{APP}/collection"); sees(m, "3 albums")
        s.goto(f"{APP}/notifications"); sees(s, "Maddox now has Aja"); step(s, "claim-cleared-notice")

        # ---- listening
        m.get_by_role("link", name=re.compile("^Rumours by Fleetwood Mac")).first.click(); btn(m, "Play now").click()
        sees(m, "Probably playing"); sees(m, "Track 1 of 3"); step(m, "maddox-now-playing")
        btn(m, "Stop").click(); sees(m, "Nothing on the turntable")
        sees(m, "Most-listened record"); sees(m, "in review"); step(m, "stats")
        m.goto(f"{APP}/collection"); m.get_by_role("link", name=re.compile("^Rumours by Fleetwood Mac")).first.click()
        btn(m, "Log a past listen").click(); m.get_by_label("When did you listen?").fill("2025-06-01"); btn(m, "Save listen").click()
        sees(m, "You have listened 2 times"); step(m, "logged-past-listen")
        m.goto(f"{APP}/play"); btn(m, "2025").click(); sees(m, "2025 in review"); btn(m, "Heavy").click(); sees(m, "Nothing on your shelf fits this mood")
        btn(m, "Mellow").click(); sees(m, "soft rock"); step(m, "moods")

        # ---- remove keeps history; song details
        m.goto(f"{APP}/collection"); m.get_by_role("link", name=re.compile("^Rumours by Fleetwood Mac")).first.click()
        m.get_by_role("button", name=re.compile("^Track 2, Dreams")).click(); btn(m, "Song details").click()
        sees(m, "Stevie Nicks", 15000); sees(m, "Mick Fleetwood: drums"); sees(m, "is a song by Fleetwood Mac"); sees(m, "Crate does not show or store lyrics"); step(m, "song-details")
        m.go_back(); btn(m, "Remove").click(); btn(m, "Yes, remove").click(); sees(m, "Your ratings and listens are kept"); sees(m, "8.75"); step(m, "removed-keeps-history")
        m.goto(f"{APP}/collection"); sees(m, "2 albums"); m.goto(f"{APP}/ranking"); sees(m, "8.75")

        # ---- phone width, sign out
        m.set_viewport_size({"width": 390, "height": 800}); m.goto(f"{APP}/collection"); sees(m, "2 albums"); step(m, "phone-collection")
        tab(m, "Family"); btn(m, "Sign out").click(); sees(m, "Sign in to flip through your records"); step(m, "signed-out")
        browser.close()
    if errors:
        print("\nBrowser errors:"); [print("  ", e) for e in dict.fromkeys(errors)]
        sys.exit(1)
    print("\nAll end-to-end checks passed.")

main()
