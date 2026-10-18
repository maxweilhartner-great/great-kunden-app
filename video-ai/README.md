# GR·EAT Video AI

Social-Media-Fabrik für tägliche Reels von **GR·EAT Betriebsverpflegung**.
Fahrer, Techniker und Mitarbeiter laden Handyvideos und Fotos hoch (Automatenbefüllung, Kundentermine,
Produktion, Lager …). Die App macht daraus automatisch ein fertiges Hochformat-Reel, schreibt Texte
für jede Plattform und postet nach einer Freigabe per Knopfdruck auf **Instagram, Facebook, LinkedIn,
YouTube und TikTok**.

```
Handy-Upload → Spracherkennung (Whisper) → bester 15–30-s-Ausschnitt → Reel 1080×1920
             → Untertitel + Logo + Musik (FFmpeg) → Textvorschläge pro Plattform
             → Freigabe-Liste ✓ / Änderungen verlangen → automatisches Posten über die offiziellen APIs
```

Alles für Schnitt und Untertitel läuft **lokal mit Open-Source-Werkzeugen** (FFmpeg, Whisper) –
keine kostenpflichtigen Kredit-Dienste.

## Was die App kann

**Hochladen** (für alle im Team, handytauglich)
- Video direkt aufnehmen oder aus der Galerie wählen; mehrere Videos = mehrere Reels, mehrere Fotos = ein Foto-Reel
- Kategorie, kurze Beschreibung, Kunde/Ort, optionale Überschrift im Video, Zielplattformen

**Automatischer Schnitt**
- Whisper erkennt die Sprache (Deutsch) → Untertitel in kurzen Reel-typischen Häppchen
- Auswahl des besten Ausschnitts (15–30 s): möglichst viel Gesprochenes, keine angeschnittenen Sätze,
  keine lange Stille am Anfang/Ende, wacklige erste Sekunde übersprungen
- Kurze Clips (< 15 s) werden geloopt; Querformat bekommt einen unscharfen Hintergrund statt Balken
- Offizielles GR·EAT-Logo oben links, optionale Überschrift in Mango-Box für die ersten Sekunden
- Abspann: in den letzten 2,5 s blendet das Logo mit Slogan „Immer gut versorgt“ ein
- Hintergrundmusik aus `brand/music/`, wird automatisch leiser, wenn jemand spricht
- Fotos werden zu einem Reel mit sanftem Zoom (Ken-Burns-Effekt)
- Ausgabe: H.264/AAC, 1080×1920, 30 fps – passt für alle fünf Plattformen

**Texte** – pro Plattform eigener Ton: Instagram (locker, Emojis, Hashtags), Facebook (warm, lokal,
Frage an die Community), LinkedIn (bodenständig-professionell, Arbeitgeber-Blick), YouTube Shorts
(Titel + Beschreibung), TikTok (kurz, locker). Zitate aus dem Gesprochenen werden eingebaut.
„↻ Neuer Vorschlag“ würfelt neu. Läuft lokal über Vorlagen in `src/captions.js` – ohne KI-Kosten.

**Freigabe-Liste** (Admin)
- Reel ansehen, Texte direkt bearbeiten, Plattformen an-/abhaken
- **✓ Freigeben & posten** – ein Knopf, danach wird automatisch veröffentlicht
- **Änderungen verlangen** – Kommentar, optional direkt korrigieren: Start, Länge, Überschrift, Musik,
  Untertitel an/aus, Untertitel-Text verbessern → Video wird automatisch neu geschnitten und landet wieder in der Liste
- Status je Plattform mit Link zum Beitrag; Fehlgeschlagenes kann erneut gepostet werden

**Konten** (Admin) – Verknüpfung per OAuth mit den offiziellen Schnittstellen:

| Plattform | API | Was gepostet wird |
|---|---|---|
| Instagram | Instagram Graph API (Content Publishing, resumable Upload) | Reel |
| Facebook | Graph API `video_reels` | Reel auf der Unternehmensseite |
| LinkedIn | Videos API + Posts API | Video-Beitrag (Person oder Unternehmensseite) |
| YouTube | YouTube Data API v3 (resumable Upload) | Short |
| TikTok | Content Posting API (Direct Post, Datei-Upload) | Video |

## Schnellstart (lokal)

Voraussetzungen: Node.js ≥ 20, FFmpeg (mit libass), Python 3.

```bash
cd video-ai
npm install
pip install faster-whisper pillow pillow-heif   # Spracherkennung + Foto-Aufbereitung
cp .env.example .env                             # Passwörter setzen
npm start                                        # → http://localhost:3000
```

Ohne `TEAM_PASSWORD`/`ADMIN_PASSWORD` läuft die App offen (nur zum lokalen Testen).
Beim ersten Video lädt Whisper das Modell einmalig aus dem Internet (`small` ≈ 500 MB).

### Mit Docker (empfohlen für den Server)

```bash
cd video-ai
docker build -t great-video-ai .
docker run -d --name great-video-ai -p 3000:3000 --env-file .env -v great-video-data:/data great-video-ai
```

Davor einen Reverse-Proxy mit HTTPS (z. B. Caddy oder nginx) – Meta, LinkedIn und TikTok verlangen
`https`-Weiterleitungsadressen. `PUBLIC_BASE_URL` auf diese Adresse setzen.

## Plattformen einrichten (einmalig)

In jeder Entwicklerkonsole eine App anlegen, die **Weiterleitungs-URL** eintragen (wird in der App
unter „Konten“ angezeigt) und Client-ID/Secret in die `.env` schreiben. Dann in der App auf
„Verbinden“ klicken.

1. **Instagram + Facebook** (eine Meta-App für beide) – [developers.facebook.com](https://developers.facebook.com/apps)
   - App-Typ „Business“, Produkte „Facebook Login for Business“ und „Instagram Graph API“
   - Weiterleitung: `<PUBLIC_BASE_URL>/auth/meta/callback`
   - Berechtigungen: `pages_show_list, pages_read_engagement, pages_manage_posts, publish_video,
     business_management, instagram_basic, instagram_content_publish`
   - Das Instagram-Konto muss ein **Business-/Creator-Konto** sein und mit der Facebook-Seite verbunden.
   - Für den Livebetrieb: App-Review bei Meta für diese Berechtigungen (solange die App im
     Entwicklungsmodus ist, funktioniert sie für App-Admins/Tester – für den Eigenbedarf reicht das oft).
2. **LinkedIn** – [linkedin.com/developers](https://www.linkedin.com/developers/apps)
   - Produkte „Sign In with LinkedIn using OpenID Connect“ und „Share on LinkedIn“
   - Weiterleitung: `<PUBLIC_BASE_URL>/auth/linkedin/callback`
   - Posten auf der **Unternehmensseite** braucht zusätzlich die „Community Management API“
     (Antrag bei LinkedIn) und `LINKEDIN_ORGANIZATION_ID`. Ohne das wird im Namen der verknüpften Person gepostet.
   - LinkedIn-Zugänge laufen nach 60 Tagen ab → dann in der App „Neu verbinden“.
3. **YouTube** – [Google Cloud Console](https://console.cloud.google.com)
   - „YouTube Data API v3“ aktivieren, OAuth-Client vom Typ „Webanwendung“
   - Weiterleitung: `<PUBLIC_BASE_URL>/auth/youtube/callback`
   - Hinweis: Bis Google das Projekt geprüft hat (API-Audit), sind hochgeladene Videos auf „privat“ gesperrt.
4. **TikTok** – [developers.tiktok.com](https://developers.tiktok.com)
   - Produkte „Login Kit“ und „Content Posting API“ (Direct Post aktivieren), Scopes `user.info.basic, video.publish`
   - Weiterleitung: `<PUBLIC_BASE_URL>/auth/tiktok/callback`
   - Bis TikTok die App geprüft hat, landen Beiträge nur **privat** (`TIKTOK_PRIVACY=SELF_ONLY`).

## Eigenes Logo, Schrift und Musik

- **Logo**: Das offizielle Logo liegt als `brand/GREAT-Logo-Slogan-PAN-364C.pdf` bei. `npm run logo`
  (braucht `pdftocairo` aus poppler-utils + Pillow) erzeugt daraus alle Varianten: `brand/logo.png`
  (Wortmarke auf hellem Schild, oben links im Reel), `brand/logo-outro.png` (Logo mit Slogan, Abspann),
  `brand/logo-full.png`/`logo-mark.png` (transparent) und `public/logo-white.png` (Kopfzeile der Web-App).
  Bei einem neuen Logo einfach die Datei austauschen und `npm run logo` erneut ausführen.
- **Abspann**: Dauer über `OUTRO_SECONDS` (Standard 2,5; `0` = kein Abspann).
- **Musik**: lizenzfreie Stücke nach `brand/music/` (siehe README dort).
- **Untertitel-Schrift**: `SUBTITLE_FONT` (muss auf dem Server installiert sein; Standard: Inter).

## Aufbau

```
video-ai/
├── server.js               Webserver, API, Anmeldung, OAuth
├── src/
│   ├── pipeline.js         FFmpeg/Whisper: Ausschnitt wählen, Untertitel, Logo, Musik, Rendern
│   ├── captions.js         Textvorschläge pro Plattform
│   ├── jobs.js             Warteschlangen für Rendern und Posten
│   ├── store.js            Datenhaltung (JSON-Datei in data/)
│   └── platforms/          Instagram, Facebook (meta.js), LinkedIn, YouTube, TikTok
├── scripts/                transcribe.py (Whisper), normalize_photo.py, prepare_logo.py
├── public/                 Weboberfläche (ohne Build-Schritt)
├── brand/                  Logo und Musik
└── test/                   npm test
```

Daten (Uploads, fertige Reels, `db.json` mit den Zugangs-Tokens) liegen in `data/` – **nicht ins Git**,
regelmäßig sichern.

## Stand & nächste Schritte

Fertig und getestet: Upload, Schnitt (Hochformat, Loop, Querformat, Fotos), Untertitel, Logo, Musik mit
Ducking, Textvorschläge, Freigabe/Änderungen/Neu-Schnitt, Konto-Verwaltung, Fehleranzeige.
Die Posting-Module folgen den offiziellen API-Dokumentationen, sind aber mangels echter Plattform-Apps
**noch nicht gegen die Live-APIs getestet** – beim ersten Verbinden je Plattform einmal mit einem
Testbeitrag prüfen.

Ideen für danach:
- Zeitplan („jeden Tag um 11:30 posten“) statt sofort nach Freigabe
- Mehrere Clips zu einem Reel zusammenschneiden
- Texte optional mit einem Sprachmodell verfeinern
- Benachrichtigung (E-Mail/Teams), wenn etwas auf Freigabe wartet
