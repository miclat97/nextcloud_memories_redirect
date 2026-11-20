# `memories_video_redirect` — Nextcloud Memories Redirect (Video & Photos)

Lekka, dedykowana wtyczka do Nextcloud, która przechwytuje otwieranie **filmów (`video/*`)**, **zdjęć (`image/*`)** oraz **dowolnych własnych rozszerzeń plików** w domyślnej aplikacji **Pliki (`files`)** i natychmiast otwiera je w aplikacji **Memories (`Wspomnienia`)** (z obsługą adaptacyjnego strumieniowania HLS/DASH `go-vod` / `ffmpeg`, EXIF, Live Photos i 360°), zamiast w domyślnym odtwarzaczu Nextcloud `viewer`.

---

## Kluczowe funkcje

1. **Natychmiastowe przekierowanie filmów (`video/*`) oraz zdjęć (`image/*`) do Memories (domyślnie włączone):**
   - Kliknięcie pliku wideo lub zdjęcia w aplikacji `Pliki` otwiera go bezpośrednio w `Memories` pod adresem:
     ```text
     /apps/memories/folders/<sciezka_wzgledem_foldersPath>?sort=timeline&noinit=1#v/<dayId>/<fileId>
     ```
2. **Panel konfiguracyjny administratora (`Ustawienia administracyjne → Memories Redirect`):**
   - Niezależne włączanie/wyłączanie przekierowań dla **filmów** oraz **zdjęć** (oba domyślnie włączone).
   - **Dodatkowe własne rozszerzenia plików** (np. `psd, xcf, insv, insp, lrv`) — przekierowywane niezależnie od zadeklarowanego typu MIME.
   - **Wykluczone rozszerzenia** (domyślnie `svg, svgz`) — nadal otwierane w domyślnym Nextcloud Viewerze.
   - **Wykluczone katalogi** — ścieżki (np. `/Dokumenty/Skany`), dla których automatyczne kliknięcie pozostaje w domyślnym Viewerze (akcja w menu kontekstowym nadal działa).
   - **Opcje zaawansowane:** przejmowanie domyślnego kliknięcia vs tryb tylko w menu kontekstowym, blokowanie `OCA.Viewer` w tle, indeksacja w locie (`on-the-fly`), tryb `single_item` poza `foldersPath`, własna etykieta akcji oraz wbudowany **podgląd statusu integracji z Memories**.
3. **Blokada pobierania surowego pliku przez `viewer` (WebDAV):**
   - Wtyczka wyrejestrowuje obsługiwane typy MIME z `window.OCA.Viewer` oraz blokuje otwarcie modala `viewer` zanim elementy `<video>` lub `<img>` zdążą rozpocząć pobieranie pełnego pliku w tle (zapobiega też pre-ładowaniu wideo przy przewijaniu Prawo/Lewo w `viewer`).
4. **Jawna akcja w menu kontekstowym (`...` / prawy przycisk myszy):**
   - Dodaje akcję **„Odtwórz w Memories”** (dla filmów) / **„Otwórz w Memories”** (dla zdjęć i innych plików), kompatybilną z `@nextcloud/files` v3 (Nextcloud 28–33), `@nextcloud/files` v4 (Nextcloud 34+) oraz klasycznym `OCA.Files.fileActions`.
5. **Indeksacja w locie (`on-the-fly`) dla świeżo wgranych plików:**
   - Endpoint `RedirectController` sprawdza obecność pliku w tabeli `oc_memories`. Jeśli plik został dopiero wgrany i nie ma go jeszcze w indeksie Memories, wywołuje wewnętrzny serwis `\OCA\Memories\Service\Index::indexFile($file, false, true)` przed przekierowaniem (eliminując błąd 404).
   - Jeśli plik leży poza skonfigurowanym w Memories katalogiem `foldersPath`, wtyczka automatycznie przełącza się na tryb `single_item` (`IInitialState::provideInitialState('memories', 'single_item', ...)`), ustawiając odpowiednio flagę `isvideo` (`1` dla filmów, `0` dla zdjęć).
6. **Czysta historia przeglądarki (obsługa przycisku „Wstecz” bez pętli):**
   - Przed przekierowaniem do `Memories` skrypt usuwa parametr `?openfile=true` oraz `/<fileId>` z bieżącego wpisu w `window.history`. Kliknięcie przycisku **„Wstecz”** w przeglądarce (lub zamknięcie podglądu `←` / `X` w Memories) cofa użytkownika bezpośrednio do katalogu w aplikacji `Pliki`.

---

## Struktura plików

```text
memories_video_redirect/
├── appinfo/
│   ├── info.xml                         # Manifest aplikacji Nextcloud (NC 27–36) + sekcja ustawień
│   └── routes.php                       # Trasy /api/resolve/{fileId}, /open/{fileId}, /api/settings*
├── css/
│   └── admin-settings.css               # Style panelu konfiguracyjnego administratora
├── img/
│   └── app.svg                          # Ikona aplikacji i sekcji ustawień
├── js/
│   ├── admin-settings.js                # Obsługa zapisu i resetu ustawień w panelu administratora
│   └── redirect.js                      # Dwupoziomowy interceptor frontendowy (bez kroku budowania)
├── lib/
│   ├── AppInfo/
│   │   └── Application.php              # Klasa startowa IBootstrap rejestrująca listenery
│   ├── Controller/
│   │   ├── RedirectController.php       # Weryfikacja i indeksacja w locie w oc_memories + budowa URL
│   │   └── SettingsController.php       # Endpointy zapisu/resetu ustawień administratora
│   ├── Listener/
│   │   └── LoadScriptsListener.php      # Ładowanie js/redirect.js, konfiguracji oraz single_item
│   ├── Service/
│   │   └── ConfigService.php            # Zarządzanie konfiguracją (IConfig) oraz diagnostyką Memories
│   └── Settings/
│       ├── Admin.php                    # Formularz ustawień administratora (ISettings)
│       └── AdminSection.php             # Sekcja w menu bocznym Ustawień administracyjnych
├── templates/
│   └── admin.php                        # Szablon HTML panelu konfiguracyjnego administratora
└── README.md
```

---

## Instalacja i aktualizacja na serwerze Nextcloud

### Nowa instalacja
1. Umieść katalog wtyczki w `custom_apps/memories_video_redirect`:
   ```bash
   git clone https://github.com/miclat97/nextcloud_memories_redirect.git /var/www/nextcloud/custom_apps/memories_video_redirect
   ```
2. Nadaj odpowiednie uprawnienia użytkownikowi serwera WWW (np. `www-data`):
   ```bash
   chown -R www-data:www-data /var/www/nextcloud/custom_apps/memories_video_redirect
   chmod -R 755 /var/www/nextcloud/custom_apps/memories_video_redirect
   ```
3. Włącz aplikację za pomocą `occ`:
   ```bash
   sudo -u www-data php /var/www/nextcloud/occ app:enable memories_video_redirect
   ```

### Aktualizacja z wersji `1.0.0` do `1.1.0`
Po pobraniu zmian (`git pull`) wykonaj aktualizację aplikacji w Nextcloud (oraz upewnij się, że wtyczka jest włączona):
```bash
git -C /var/www/nextcloud/custom_apps/memories_video_redirect pull
sudo -u www-data php /var/www/nextcloud/occ upgrade
sudo -u www-data php /var/www/nextcloud/occ app:enable memories_video_redirect
```
*(Następnie wyczyść pamięć podręczną przeglądarki przez `Ctrl+F5` i przejdź do **Ustawienia administracyjne → Memories Redirect**).*
