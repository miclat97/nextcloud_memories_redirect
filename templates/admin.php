<?php

/** @var array $_ */
/** @var \OCP\IL10N $l */

$settings = $_['settings'] ?? [];
$diagnostics = $_['diagnostics'] ?? [];
$defaultVideoExtensions = $_['defaultVideoExtensions'] ?? [];
$defaultImageExtensions = $_['defaultImageExtensions'] ?? [];
$defaultExcludedExtensions = (string) ($_['defaultExcludedExtensions'] ?? 'svg, svgz');

$esc = static function (mixed $value): string {
	return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
};

$memoriesReady = !empty($diagnostics['memoriesInstalled']) && !empty($diagnostics['memoriesEnabled']);
$tableExists = !empty($diagnostics['memoriesTableExists']);
$indexedCount = $diagnostics['indexedCount'] ?? null;
$indexServiceAvailable = !empty($diagnostics['indexServiceAvailable']);
$timelineQueryAvailable = !empty($diagnostics['timelineQueryAvailable']);
?>
<div id="memories-redirect-settings" class="section memories-redirect-settings">
	<h2 class="memories-redirect-settings__title">
		<?php echo $esc($l->t('Memories Redirect — przekierowania z Plików do Memories')); ?>
	</h2>
	<p class="settings-hint">
		<?php echo $esc($l->t('Konfiguracja automatycznego przekierowywania filmów, zdjęć oraz wybranych rozszerzeń plików z aplikacji Pliki (Files) bezpośrednio do odtwarzacza i przeglądarki aplikacji Wspomnienia (Memories).')); ?>
	</p>

	<!-- Status integracji z Memories -->
	<div class="memories-redirect-card">
		<h3 class="memories-redirect-card__heading"><?php echo $esc($l->t('Status integracji z Memories')); ?></h3>
		<div class="memories-redirect-diagnostics">
			<div class="memories-redirect-badge <?php echo $memoriesReady ? 'is-ok' : 'is-error'; ?>">
				<span class="memories-redirect-badge__dot" aria-hidden="true"></span>
				<span>
					<?php if ($memoriesReady): ?>
						<?php echo $esc($l->t('Aplikacja Memories: aktywna')); ?>
					<?php else: ?>
						<?php echo $esc($l->t('Aplikacja Memories: nieaktywna lub niezainstalowana')); ?>
					<?php endif; ?>
				</span>
			</div>

			<div class="memories-redirect-badge <?php echo $tableExists ? 'is-ok' : 'is-warn'; ?>">
				<span class="memories-redirect-badge__dot" aria-hidden="true"></span>
				<span>
					<?php if ($tableExists): ?>
						<?php echo $esc($l->t('Indeks oc_memories: %s plików', [$indexedCount !== null ? (string) $indexedCount : '?'])); ?>
					<?php else: ?>
						<?php echo $esc($l->t('Indeks oc_memories: niedostępny')); ?>
					<?php endif; ?>
				</span>
			</div>

			<div class="memories-redirect-badge <?php echo $indexServiceAvailable ? 'is-ok' : 'is-warn'; ?>">
				<span class="memories-redirect-badge__dot" aria-hidden="true"></span>
				<span>
					<?php echo $esc($indexServiceAvailable
						? $l->t('Indeksacja w locie (Index): dostępna')
						: $l->t('Indeksacja w locie (Index): niedostępna')); ?>
				</span>
			</div>

			<div class="memories-redirect-badge <?php echo $timelineQueryAvailable ? 'is-ok' : 'is-warn'; ?>">
				<span class="memories-redirect-badge__dot" aria-hidden="true"></span>
				<span>
					<?php echo $esc($timelineQueryAvailable
						? $l->t('Tryb single_item (TimelineQuery): dostępny')
						: $l->t('Tryb single_item (TimelineQuery): fallback z File')); ?>
				</span>
			</div>
		</div>
	</div>

	<form id="memories-redirect-settings-form" class="memories-redirect-form">
		<!-- Sekcja 1: Obsługiwane typy plików -->
		<div class="memories-redirect-card">
			<h3 class="memories-redirect-card__heading"><?php echo $esc($l->t('Obsługiwane typy plików i rozszerzenia')); ?></h3>

			<div class="memories-redirect-option">
				<input
					type="checkbox"
					id="mr-redirect-videos"
					name="redirectVideos"
					class="checkbox"
					<?php echo !empty($settings['redirectVideos']) ? 'checked="checked"' : ''; ?>
				/>
				<label for="mr-redirect-videos">
					<strong><?php echo $esc($l->t('Przekierowuj filmy (video/*)')); ?></strong>
					<span class="memories-redirect-option__desc">
						<?php echo $esc($l->t('Otwiera pliki wideo bezpośrednio w odtwarzaczu HLS/DASH Memories (go-vod / ffmpeg) zamiast w domyślnym Nextcloud Viewerze.')); ?>
					</span>
				</label>
			</div>

			<div class="memories-redirect-option">
				<input
					type="checkbox"
					id="mr-redirect-photos"
					name="redirectPhotos"
					class="checkbox"
					<?php echo !empty($settings['redirectPhotos']) ? 'checked="checked"' : ''; ?>
				/>
				<label for="mr-redirect-photos">
					<strong><?php echo $esc($l->t('Przekierowuj zdjęcia (image/*)')); ?></strong>
					<span class="memories-redirect-option__desc">
						<?php echo $esc($l->t('Otwiera zdjęcia (JPG, PNG, HEIC, AVIF, WebP, RAW itp.) bezpośrednio w przeglądarce Memories z osią czasu, EXIF i obsługą zdjęć Live/360°.')); ?>
					</span>
				</label>
			</div>

			<div class="memories-redirect-field">
				<label for="mr-custom-extensions" class="memories-redirect-field__label">
					<?php echo $esc($l->t('Dodatkowe własne rozszerzenia plików')); ?>
				</label>
				<input
					type="text"
					id="mr-custom-extensions"
					name="customExtensions"
					class="memories-redirect-input"
					value="<?php echo $esc($settings['customExtensions'] ?? ''); ?>"
					placeholder="<?php echo $esc($l->t('np. psd, xcf, insv, insp, lrv')); ?>"
				/>
				<p class="memories-redirect-field__hint">
					<?php echo $esc($l->t('Lista dodatkowych rozszerzeń (oddzielonych przecinkami lub spacjami, bez kropek), które zawsze mają być przekierowywane do Memories niezależnie od rozpoznanego typu MIME.')); ?>
				</p>
			</div>

			<div class="memories-redirect-field">
				<label for="mr-excluded-extensions" class="memories-redirect-field__label">
					<?php echo $esc($l->t('Wykluczone rozszerzenia')); ?>
				</label>
				<input
					type="text"
					id="mr-excluded-extensions"
					name="excludedExtensions"
					class="memories-redirect-input"
					value="<?php echo $esc($settings['excludedExtensions'] ?? $defaultExcludedExtensions); ?>"
					placeholder="<?php echo $esc($defaultExcludedExtensions); ?>"
				/>
				<p class="memories-redirect-field__hint">
					<?php echo $esc($l->t('Rozszerzenia pomijane przez przekierowanie (domyślnie: %s). Takie pliki nadal będą otwierane w domyślnym Nextcloud Viewerze.', [$defaultExcludedExtensions])); ?>
				</p>
			</div>

			<details class="memories-redirect-details">
				<summary><?php echo $esc($l->t('Pokaż listę domyślnie rozpoznawanych rozszerzeń')); ?></summary>
				<div class="memories-redirect-details__body">
					<p>
						<strong><?php echo $esc($l->t('Filmy:')); ?></strong>
						<code><?php echo $esc(implode(', ', $defaultVideoExtensions)); ?></code>
					</p>
					<p>
						<strong><?php echo $esc($l->t('Zdjęcia:')); ?></strong>
						<code><?php echo $esc(implode(', ', $defaultImageExtensions)); ?></code>
					</p>
				</div>
			</details>
		</div>

		<!-- Sekcja 2: Zachowanie i zaawansowane opcje -->
		<div class="memories-redirect-card">
			<h3 class="memories-redirect-card__heading"><?php echo $esc($l->t('Zachowanie i opcje zaawansowane')); ?></h3>

			<div class="memories-redirect-option">
				<input
					type="checkbox"
					id="mr-intercept-default-click"
					name="interceptDefaultClick"
					class="checkbox"
					<?php echo !empty($settings['interceptDefaultClick']) ? 'checked="checked"' : ''; ?>
				/>
				<label for="mr-intercept-default-click">
					<strong><?php echo $esc($l->t('Przechwytuj domyślne kliknięcie pliku')); ?></strong>
					<span class="memories-redirect-option__desc">
						<?php echo $esc($l->t('Gdy włączone, kliknięcie pliku od razu przenosi do Memories. Gdy wyłączone, kliknięcie otwiera zwykły Viewer, a Memories jest dostępne jako opcja w menu kontekstowym (... / PPM).')); ?>
					</span>
				</label>
			</div>

			<div class="memories-redirect-option">
				<input
					type="checkbox"
					id="mr-block-default-viewer"
					name="blockDefaultViewer"
					class="checkbox"
					<?php echo !empty($settings['blockDefaultViewer']) ? 'checked="checked"' : ''; ?>
				/>
				<label for="mr-block-default-viewer">
					<strong><?php echo $esc($l->t('Blokuj domyślny Nextcloud Viewer w tle')); ?></strong>
					<span class="memories-redirect-option__desc">
						<?php echo $esc($l->t('Wyrejestrowuje obsługiwane typy MIME z OCA.Viewer i zatrzymuje pobieranie surowych plików przez WebDAV oraz ich pre-ładowanie podczas przewijania.')); ?>
					</span>
				</label>
			</div>

			<div class="memories-redirect-option">
				<input
					type="checkbox"
					id="mr-on-the-fly-indexing"
					name="onTheFlyIndexing"
					class="checkbox"
					<?php echo !empty($settings['onTheFlyIndexing']) ? 'checked="checked"' : ''; ?>
				/>
				<label for="mr-on-the-fly-indexing">
					<strong><?php echo $esc($l->t('Indeksacja w locie (on-the-fly) w bazie Memories')); ?></strong>
					<span class="memories-redirect-option__desc">
						<?php echo $esc($l->t('Automatycznie indeksuje nowo wgrane lub zmodyfikowane pliki przed otwarciem w Memories, eliminując błędy 404.')); ?>
					</span>
				</label>
			</div>

			<div class="memories-redirect-option">
				<input
					type="checkbox"
					id="mr-single-item-fallback"
					name="enableSingleItemFallback"
					class="checkbox"
					<?php echo !empty($settings['enableSingleItemFallback']) ? 'checked="checked"' : ''; ?>
				/>
				<label for="mr-single-item-fallback">
					<strong><?php echo $esc($l->t('Tryb single_item dla plików spoza foldersPath')); ?></strong>
					<span class="memories-redirect-option__desc">
						<?php echo $esc($l->t('Pozwala otwierać w Memories również pliki leżące poza głównym katalogiem skonfigurowanym w ustawieniach Memories (foldersPath).')); ?>
					</span>
				</label>
			</div>

			<div class="memories-redirect-field">
				<label for="mr-excluded-paths" class="memories-redirect-field__label">
					<?php echo $esc($l->t('Wykluczone katalogi (tylko automatyczne przekierowanie)')); ?>
				</label>
				<textarea
					id="mr-excluded-paths"
					name="excludedPaths"
					rows="3"
					class="memories-redirect-textarea"
					placeholder="<?php echo $esc($l->t("/Dokumenty/Skany\n/Praca/Zrzuty ekranu")); ?>"
				><?php echo $esc($settings['excludedPaths'] ?? ''); ?></textarea>
				<p class="memories-redirect-field__hint">
					<?php echo $esc($l->t('Ścieżki katalogów (po jednej w linii lub oddzielone przecinkami), w których zwykłe kliknięcie nie będzie przekierowywane do Memories. Nadal można użyć akcji z menu kontekstowego.')); ?>
				</p>
			</div>

			<div class="memories-redirect-field">
				<label for="mr-custom-action-label" class="memories-redirect-field__label">
					<?php echo $esc($l->t('Własna nazwa akcji w menu kontekstowym (opcjonalnie)')); ?>
				</label>
				<input
					type="text"
					id="mr-custom-action-label"
					name="customActionLabel"
					maxlength="80"
					class="memories-redirect-input"
					value="<?php echo $esc($settings['customActionLabel'] ?? ''); ?>"
					placeholder="<?php echo $esc($l->t('Domyślnie: Odtwórz w Memories (wideo) / Otwórz w Memories (zdjęcia)')); ?>"
				/>
				<p class="memories-redirect-field__hint">
					<?php echo $esc($l->t('Pozostaw puste, aby używać automatycznych etykiet zależnych od typu pliku.')); ?>
				</p>
			</div>
		</div>

		<div class="memories-redirect-actions">
			<button type="submit" id="mr-save-btn" class="button primary">
				<?php echo $esc($l->t('Zapisz ustawienia')); ?>
			</button>
			<button type="button" id="mr-reset-btn" class="button">
				<?php echo $esc($l->t('Przywróć domyślne')); ?>
			</button>
			<span id="mr-status-msg" class="memories-redirect-status" role="status" aria-live="polite"></span>
		</div>
	</form>
</div>
