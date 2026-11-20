(function () {
	'use strict';

	const APP_ID = 'memories_video_redirect';

	function getWebRootUrl(appPath) {
		try {
			if (window.OC && typeof window.OC.generateUrl === 'function') {
				return window.OC.generateUrl(appPath);
			}
		} catch (_) {
			// Kontynuuj do fallbacku
		}
		const cleanPath = appPath.startsWith('/') ? appPath : '/' + appPath;
		return '/index.php' + cleanPath;
	}

	function getRequestToken() {
		if (window.OC && window.OC.requestToken) {
			return window.OC.requestToken;
		}
		const headToken = document.head ? document.head.getAttribute('data-requesttoken') : null;
		return headToken || '';
	}

	function showTemporaryNotification(message) {
		try {
			if (window.OC && window.OC.Notification && typeof window.OC.Notification.showTemporary === 'function') {
				window.OC.Notification.showTemporary(message);
			}
		} catch (_) {
			// Ignoruj
		}
	}

	function initSettingsForm() {
		const form = document.getElementById('memories-redirect-settings-form');
		if (!form || form.__mrInitialized) {
			return;
		}
		form.__mrInitialized = true;

		const saveBtn = document.getElementById('mr-save-btn');
		const resetBtn = document.getElementById('mr-reset-btn');
		const statusEl = document.getElementById('mr-status-msg');

		const fields = {
			redirectVideos: document.getElementById('mr-redirect-videos'),
			redirectPhotos: document.getElementById('mr-redirect-photos'),
			customExtensions: document.getElementById('mr-custom-extensions'),
			excludedExtensions: document.getElementById('mr-excluded-extensions'),
			interceptDefaultClick: document.getElementById('mr-intercept-default-click'),
			blockDefaultViewer: document.getElementById('mr-block-default-viewer'),
			onTheFlyIndexing: document.getElementById('mr-on-the-fly-indexing'),
			enableSingleItemFallback: document.getElementById('mr-single-item-fallback'),
			excludedPaths: document.getElementById('mr-excluded-paths'),
			customActionLabel: document.getElementById('mr-custom-action-label')
		};

		function setStatus(message, type) {
			if (!statusEl) {
				return;
			}
			statusEl.textContent = message || '';
			statusEl.classList.remove('is-success', 'is-error');
			if (type === 'success') {
				statusEl.classList.add('is-success');
			} else if (type === 'error') {
				statusEl.classList.add('is-error');
			}
		}

		function setBusy(busy) {
			if (saveBtn) {
				saveBtn.disabled = busy;
			}
			if (resetBtn) {
				resetBtn.disabled = busy;
			}
		}

		function applySettingsToForm(settings) {
			if (!settings || typeof settings !== 'object') {
				return;
			}
			if (fields.redirectVideos) {
				fields.redirectVideos.checked = Boolean(settings.redirectVideos);
			}
			if (fields.redirectPhotos) {
				fields.redirectPhotos.checked = Boolean(settings.redirectPhotos);
			}
			if (fields.customExtensions && typeof settings.customExtensions === 'string') {
				fields.customExtensions.value = settings.customExtensions;
			}
			if (fields.excludedExtensions && typeof settings.excludedExtensions === 'string') {
				fields.excludedExtensions.value = settings.excludedExtensions;
			}
			if (fields.interceptDefaultClick) {
				fields.interceptDefaultClick.checked = Boolean(settings.interceptDefaultClick);
			}
			if (fields.blockDefaultViewer) {
				fields.blockDefaultViewer.checked = Boolean(settings.blockDefaultViewer);
			}
			if (fields.onTheFlyIndexing) {
				fields.onTheFlyIndexing.checked = Boolean(settings.onTheFlyIndexing);
			}
			if (fields.enableSingleItemFallback) {
				fields.enableSingleItemFallback.checked = Boolean(settings.enableSingleItemFallback);
			}
			if (fields.excludedPaths && typeof settings.excludedPaths === 'string') {
				fields.excludedPaths.value = settings.excludedPaths;
			}
			if (fields.customActionLabel && typeof settings.customActionLabel === 'string') {
				fields.customActionLabel.value = settings.customActionLabel;
			}
		}

		function readFormPayload() {
			return {
				redirectVideos: fields.redirectVideos ? fields.redirectVideos.checked : true,
				redirectPhotos: fields.redirectPhotos ? fields.redirectPhotos.checked : true,
				customExtensions: fields.customExtensions ? fields.customExtensions.value : '',
				excludedExtensions: fields.excludedExtensions ? fields.excludedExtensions.value : '',
				interceptDefaultClick: fields.interceptDefaultClick ? fields.interceptDefaultClick.checked : true,
				blockDefaultViewer: fields.blockDefaultViewer ? fields.blockDefaultViewer.checked : true,
				onTheFlyIndexing: fields.onTheFlyIndexing ? fields.onTheFlyIndexing.checked : true,
				enableSingleItemFallback: fields.enableSingleItemFallback ? fields.enableSingleItemFallback.checked : true,
				excludedPaths: fields.excludedPaths ? fields.excludedPaths.value : '',
				customActionLabel: fields.customActionLabel ? fields.customActionLabel.value : ''
			};
		}

		form.addEventListener('submit', async function (event) {
			event.preventDefault();
			setBusy(true);
			setStatus('Zapisywanie...', '');

			try {
				const response = await fetch(getWebRootUrl('/apps/' + APP_ID + '/api/settings'), {
					method: 'POST',
					credentials: 'same-origin',
					headers: {
						'Content-Type': 'application/json',
						'Accept': 'application/json',
						'requesttoken': getRequestToken(),
						'X-Requested-With': 'XMLHttpRequest'
					},
					body: JSON.stringify(readFormPayload())
				});

				if (!response.ok) {
					throw new Error('HTTP ' + response.status);
				}

				const data = await response.json();
				if (data && data.settings) {
					applySettingsToForm(data.settings);
				}
				setStatus('Ustawienia zostały zapisane.', 'success');
				showTemporaryNotification('Zapisano ustawienia Memories Redirect.');
			} catch (err) {
				setStatus('Nie udało się zapisać ustawień (' + (err && err.message ? err.message : 'błąd') + ').', 'error');
			} finally {
				setBusy(false);
			}
		});

		if (resetBtn) {
			resetBtn.addEventListener('click', async function () {
				setBusy(true);
				setStatus('Przywracanie wartości domyślnych...', '');

				try {
					const response = await fetch(getWebRootUrl('/apps/' + APP_ID + '/api/settings/reset'), {
						method: 'POST',
						credentials: 'same-origin',
						headers: {
							'Content-Type': 'application/json',
							'Accept': 'application/json',
							'requesttoken': getRequestToken(),
							'X-Requested-With': 'XMLHttpRequest'
						},
						body: '{}'
					});

					if (!response.ok) {
						throw new Error('HTTP ' + response.status);
					}

					const data = await response.json();
					if (data && data.settings) {
						applySettingsToForm(data.settings);
					}
					setStatus('Przywrócono ustawienia domyślne.', 'success');
					showTemporaryNotification('Przywrócono domyślne ustawienia Memories Redirect.');
				} catch (err) {
					setStatus('Nie udało się przywrócić ustawień (' + (err && err.message ? err.message : 'błąd') + ').', 'error');
				} finally {
					setBusy(false);
				}
			});
		}
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initSettingsForm);
	} else {
		initSettingsForm();
	}
})();
