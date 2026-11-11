# `memories_video_redirect` — Nextcloud Memories Video Redirect

Lekka, dedykowana wtyczka do Nextcloud, która przechwytuje otwieranie plików wideo (`video/*`) w domyślnej aplikacji **Pliki (`files`)** i natychmiast otwiera je w odtwarzaczu aplikacji **Memories (`Wspomnienia`)** z obsługą adaptacyjnego strumieniowania HLS/DASH (`go-vod` / `ffmpeg`), zamiast w domyślnym odtwarzaczu Nextcloud `viewer`.

---

## Kluczowe funkcje

1. **Natychmiastowe przekierowanie `video/*` do odtwarzacza Memories (`go-vod` / HLS):**
   - Kliknięcie dowolnego pliku wideo w aplikacji `Pliki` otwiera go bezpośrednio w odtwarzaczu `Memories` pod adresem:
     ```text
     /apps/memories/folders/<sciezka_wzgledem_foldersPath>?sort=timeline&noinit=1#v/<dayId>/<fileId>
     ```
2. **Blokada pobierania surowego pliku przez `viewer` (WebDAV):**
   - Wtyczka wyrejestrowuje obsługę `video/*` z `window.OCA.Viewer` oraz blokuje otwarcie modala `viewer` zanim element `<video>` zdąży rozpocząć pobieranie pełnego pliku w tle (dodatkowo zapobiega pre-ładowaniu plików wideo przy przewijaniu zdjęć Prawo/Lewo w `viewer`).
3. **Jawna akcja w menu kontekstowym (`...` / prawy przycisk myszy):**
   - Dodaje na samej górze menu kontekstowego pliku wideo akcję **„Odtwórz w Memories”** (`order: -1000`, `default: 'default'`), kompatybilną z `@nextcloud/files` v3 (Nextcloud 28–33), `@nextcloud/files` v4 (Nextcloud 34+) oraz klasycznym `OCA.Files.fileActions`.
4. **Indeksacja w locie (`on-the-fly`) dla świeżo wgranych filmów:**
   - Endpoint `RedirectController` sprawdza obecność pliku w tabeli `oc_memories`. Jeśli film został dopiero wgrany i nie ma go jeszcze w indeksie Memories, wywołuje wewnętrzny serwis `\OCA\Memories\Service\Index::indexFile($file, false, true)` przed przekierowaniem (eliminując błąd 404).
   - Jeśli plik leży poza skonfigurowanym w Memories katalogiem `foldersPath`, wtyczka automatycznie przełącza się na tryb `single_item` (`IInitialState::provideInitialState('memories', 'single_item', ...)`), dzięki czemu odtwarzacz HLS uruchomi się dla każdego pliku wideo.
5. **Czysta historia przeglądarki (obsługa przycisku „Wstecz” bez pętli):**
   - Przed przekierowaniem do `Memories` skrypt usuwa parametr `?openfile=true` oraz `/<fileId>` z bieżącego wpisu w `window.history`. Kliknięcie przycisku **„Wstecz”** w przeglądarce (lub przycisku zamknięcia `←` / `X` w odtwarzaczu Memories) cofa użytkownika bezpośrednio do katalogu w aplikacji `Pliki`.

---

## Struktura plików

```text
memories_video_redirect/
├── appinfo/
│   ├── info.xml                         # Manifest aplikacji Nextcloud (NC 27–36)
│   └── routes.php                       # Definicja tras /api/resolve/{fileId} oraz /open/{fileId}
├── js/
│   └── redirect.js                      # Dwupoziomowy interceptor frontendowy (bez kroku budowania)
├── lib/
│   ├── AppInfo/
│   │   └── Application.php              # Klasa startowa IBootstrap rejestrująca listenery
│   ├── Controller/
│   │   └── RedirectController.php       # Weryfikacja i indeksacja w locie w oc_memories + budowa URL
│   └── Listener/
│       └── LoadScriptsListener.php      # Ładowanie js/redirect.js oraz wstrzykiwanie single_item
└── README.md
```

---

## Instalacja i włączenie na serwerze Nextcloud

1. Umieść katalog wtyczki w `custom_apps/memories_video_redirect` (np. klonując repozytorium):
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

---

## Wyłączenie lub modyfikacja w przyszłości

- **Wyłączenie wtyczki (natychmiastowy powrót do domyślnego `viewer`):**
  ```bash
  sudo -u www-data php /var/www/nextcloud/occ app:disable memories_video_redirect
  ```
- **Modyfikacja obsługiwanych rozszerzeń / typów MIME:**
  Edytuj zbiory `VIDEO_EXTENSIONS` oraz `EXTRA_VIDEO_MIMES` na początku pliku `js/redirect.js` (plik nie wymaga kompilacji ani bundlera — zmiany działają od razu po odświeżeniu karty przeglądarki z `Ctrl+F5`).
