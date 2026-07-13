# GR·EAT Kunden-App — Capacitor-Projekt für Cloud-Build

Dieses Projekt verpackt den Kunden-App-Prototyp (Standorte, Sortiment, Bonus, Konto)
als installierbare native App für Android (Play Store) und iOS (App Store),
mit Hilfe von [Capacitor](https://capacitorjs.com).

## Inhalt

- `www/index.html` — die App selbst (aktueller Prototyp-Stand)
- `android/` — fertig generiertes Android-Studio-Projekt inkl. App-Icon & Splash-Screen
- `capacitor.config.json` — App-ID, Name, Farben
- `codemagic.yaml` — fertige Cloud-Build-Konfiguration für [codemagic.io](https://codemagic.io)
- `assets/` — Quell-Icon (1024×1024) und Splash-Screen-Grafik

App-ID: `at.greatbetriebsverpflegung.kundenapp`
App-Name: **GR·EAT**

## So kommt die App in die Stores (über Codemagic, ohne eigenen Mac)

### 1. Repository bei Codemagic anbinden
1. Dieses Projekt in ein (privates) GitHub-Repository hochladen.
2. Auf [codemagic.io](https://codemagic.io) mit dem GitHub-Account anmelden (kostenloses Kontingent reicht für den Start, danach nutzungsbasiert).
3. Repository verbinden — Codemagic erkennt automatisch die `codemagic.yaml` in diesem Projekt.

### 2. Android-Build (einfacher Einstieg, kein Apple-Account nötig)
1. Workflow **„android-release“** in Codemagic starten.
2. Ergebnis: eine `.aab`-Datei (für den Play Store) und eine `.apk`-Datei (zum direkten Testen auf einem Android-Handy).
3. Für die Veröffentlichung im Play Store: einmalig ein Google-Play-Console-Konto anlegen (25 $ einmalig) und die App dort anlegen, dann die `.aab`-Datei hochladen.

### 3. iOS-Build (benötigt Apple Developer Account, 99 $/Jahr)
1. Bei [Apple Developer](https://developer.apple.com) registrieren, falls noch nicht geschehen.
2. In Codemagic unter **Team → Code signing identities** das Apple-Zertifikat + Provisioning Profile hinterlegen (Codemagic kann das auch automatisch generieren, wenn der Apple-Account verbunden ist — „Automatic code signing“).
3. Workflow **„ios-release“** starten. Codemagic baut dabei einmalig auch die native iOS-Projektstruktur (`ios/`), die aktuell noch fehlt, weil sie ein Mac-Tool (Xcode/CocoaPods) braucht.
4. Ergebnis: eine `.ipa`-Datei, die direkt an TestFlight/App Store Connect hochgeladen werden kann (optional automatisch, siehe auskommentierten Abschnitt in `codemagic.yaml`).

## Wichtig, bevor die App eingereicht wird

- **Bundle-ID/App-ID** (`at.greatbetriebsverpflegung.kundenapp`) muss in App Store Connect und Play Console jeweils **exakt so** neu angelegt werden.
- **App-Icon & Splash-Screen** sind bereits fertig generiert — bei Bedarf kann das Motiv (aktuell: Ring/Coil in Waldgrün + Mango, Anlehnung an die Spirale im Automaten) noch angepasst werden.
- Der App-Inhalt selbst (`www/index.html`) ist aktuell noch der **Prototyp mit Demo-Daten** — bevor die App live geht, müssen echte Standort-/Automaten-/Sortimentsdaten angebunden werden (über Supabase, siehe Chatverlauf zur BetriebsApp-Architektur).
- Beide Stores prüfen Einreichungen manuell (Apple ca. 1–3 Tage, Google meist wenige Stunden bis 1 Tag) — das sollte zeitlich eingeplant werden.

## Lokal testen (falls doch mal Zugriff auf einen Rechner mit Android Studio vorhanden ist)

```bash
npm install
npx cap sync android
npx cap open android
```
Android Studio öffnet sich, dort direkt „Run“ auf einem Emulator oder angeschlossenen Handy.
