/**
 * memories_video_redirect — Frontend Interceptor (Poziom 1 + Poziom 2)
 *
 * Przechwytuje otwieranie plików wideo (video/*) w aplikacji Pliki (apps/files)
 * i przekierowuje je bezpośrednio do odtwarzacza HLS/DASH (go-vod / ffmpeg) w Memories,
 * blokując domyślny Nextcloud Viewer przed pobieraniem surowego pliku przez WebDAV.
 *
 * Skrypt nie wymaga bundlera (Webpack/Vite) — działa natychmiast po `occ app:enable`.
 */
(function () {
	'use strict';

	if (window.__memoriesVideoRedirectInitialized) {
		return;
	}
	window.__memoriesVideoRedirectInitialized = true;

	const APP_ID = 'memories_video_redirect';
	const ACTION_ID = 'memories-video-redirect';

	/** Rozszerzenia plików wideo rozpoznawane niezależnie od zadeklarowanego typu MIME */
	const VIDEO_EXTENSIONS = new Set([
		'mp4', 'mkv', 'mov', 'webm', 'avi', 'ts', 'm2ts', 'mts',
		'm4v', '3gp', '3g2', 'ogv', 'ogg', 'flv', 'wmv', 'mpg',
		'mpeg', 'vob', 'divx', 'asf', 'rmvb', 'f4v'
	]);

	/** Dodatkowe typy MIME kontenerów wideo */
	const EXTRA_VIDEO_MIMES = new Set([
		'application/mp4',
		'application/x-matroska',
		'application/vnd.apple.mpegurl',
		'application/x-mpegurl',
		'video/mp2t',
		'video/x-matroska',
		'video/quicktime',
		'video/x-msvideo',
		'video/x-ms-wmv',
		'video/x-flv',
		'video/webm',
		'video/mp4',
		'video/ogg',
		'video/3gpp',
		'video/3gpp2'
	]);

	/** Ikona SVG przycisku "Odtwórz w Memories" */
	const PLAY_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>';

	/** Stan blokady zapobiegający wielokrotnemu wyzwoleniu przekierowania dla tego samego kliknięcia */
	let redirectInFlight = false;
	let lastRedirectFileId = null;
	let lastRedirectTimestamp = 0;

	/** Zachowaj oryginalne metody History API przed nałożeniem interceptora */
	const originalPushState = window.history.pushState.bind(window.history);
	const originalReplaceState = window.history.replaceState.bind(window.history);

	/**
	 * Zwraca przetłumaczoną etykietę akcji w zależności od języka interfejsu Nextcloud.
	 */
	function getActionLabel() {
		try {
			if (typeof window.t === 'function') {
				const translated = window.t(APP_ID, 'Odtwórz w Memories');
				if (translated) {
					return translated;
				}
			}
			const lang = (document.documentElement.lang || navigator.language || 'pl').toLowerCase();
			if (lang.startsWith('pl')) {
				return 'Odtwórz w Memories';
			}
		} catch (_) {
			// Ignoruj błędy lokalizacji
		}
		return 'Odtwórz w Memories';
	}

	/**
	 * Pobiera bazowy prefiks URL Nextclouda (obsługuje instalacje w podkatalogu oraz z/bez index.php).
	 */
	function getWebRootUrl(appPath) {
		try {
			if (window.OC && typeof window.OC.generateUrl === 'function') {
				return window.OC.generateUrl(appPath);
			}
		} catch (_) {
			// Kontynuuj do fallbacku
		}
		const cleanPath = appPath.startsWith('/') ? appPath : '/' + appPath;
		const pathname = window.location.pathname || '';
		const idxMatch = pathname.match(/^(.*\/index\.php)\//);
		if (idxMatch) {
			return idxMatch[1] + cleanPath;
		}
		const appsMatch = pathname.match(/^(.*)\/apps\//);
		if (appsMatch) {
			return (appsMatch[1] || '') + '/index.php' + cleanPath;
		}
		return '/index.php' + cleanPath;
	}

	/**
	 * Wyciąga rozszerzenie z nazwy pliku lub ścieżki.
	 */
	function getFileExtension(nameOrPath) {
		if (!nameOrPath || typeof nameOrPath !== 'string') {
			return '';
		}
		const clean = nameOrPath.split('?')[0].split('#')[0];
		const base = clean.substring(clean.lastIndexOf('/') + 1);
		const dotIdx = base.lastIndexOf('.');
		if (dotIdx <= 0 || dotIdx === base.length - 1) {
			return '';
		}
		return base.substring(dotIdx + 1).toLowerCase();
	}

	/**
	 * Sprawdza, czy podany typ MIME lub nazwa pliku oznacza plik wideo.
	 */
	function isVideoByMimeOrName(mime, nameOrPath) {
		if (mime && typeof mime === 'string') {
			const lowerMime = mime.trim().toLowerCase();
			if (lowerMime.startsWith('video/') || EXTRA_VIDEO_MIMES.has(lowerMime)) {
				return true;
			}
			// Jeśli to folder, nigdy nie traktuj jako wideo
			if (lowerMime === 'httpd/unix-directory' || lowerMime === 'inode/directory') {
				return false;
			}
		}
		const ext = getFileExtension(nameOrPath);
		return ext !== '' && VIDEO_EXTENSIONS.has(ext);
	}

	/**
	 * Sprawdza, czy obiekt Node z `@nextcloud/files` (lub `OCA.Files`) reprezentuje plik wideo.
	 */
	function isVideoNode(node) {
		if (!node || typeof node !== 'object') {
			return false;
		}
		// Wyklucz katalogi
		if (node.type === 'folder' || node.type === 'dir') {
			return false;
		}
		const mime = node.mime || node.mimetype || (node.attributes && node.attributes['content-type']) || '';
		if (mime === 'httpd/unix-directory' || mime === 'inode/directory') {
			return false;
		}
		const name = node.basename || node.name || node.path || node.filename || '';
		return isVideoByMimeOrName(mime, name);
	}

	/**
	 * Wyciąga ID pliku (liczba > 0) z obiektu Node lub wiersza DOM.
	 */
	function extractFileIdFromNode(node) {
		if (!node || typeof node !== 'object') {
			return null;
		}
		const rawId = node.fileid ?? node.id ?? (node.attributes && (node.attributes.fileid || node.attributes['oc:fileid']));
		const parsed = parseInt(String(rawId), 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
	}

	/**
	 * Wyciąga bieżący katalog `dir` z routera Nextcloud Files, obiektu Node lub parametrów URL.
	 */
	function extractCurrentDir(node, explicitDir) {
		if (typeof explicitDir === 'string' && explicitDir.trim() !== '') {
			return explicitDir.trim();
		}
		if (node && typeof node === 'object') {
			if (typeof node.dirname === 'string' && node.dirname !== '') {
				return node.dirname;
			}
			if (typeof node.path === 'string' && node.path.includes('/')) {
				const lastSlash = node.path.lastIndexOf('/');
				return lastSlash <= 0 ? '/' : node.path.substring(0, lastSlash);
			}
		}
		try {
			const routerDir = window.OCP && window.OCP.Files && window.OCP.Files.Router && window.OCP.Files.Router.query && window.OCP.Files.Router.query.dir;
			if (typeof routerDir === 'string' && routerDir !== '') {
				return routerDir;
			}
		} catch (_) {
			// Kontynuuj
		}
		try {
			const params = new URLSearchParams(window.location.search);
			const urlDir = params.get('dir');
			if (urlDir) {
				return urlDir;
			}
		} catch (_) {
			// Kontynuuj
		}
		return '/';
	}

	/**
	 * Natychmiast zatrzymuje domyślny odtwarzacz `OCA.Viewer` oraz przerywa ewentualne
	 * pobieranie strumienia WebDAV przez element `<video>`, zanim zdąży pobrać plik w tle.
	 */
	function abortDefaultViewerAndVideoDownload() {
		try {
			// 1. Zatrzymaj wszystkie elementy <video> wewnątrz modala #viewer
			const viewerVideos = document.querySelectorAll('#viewer video, .viewer video, .plyr video');
			viewerVideos.forEach(function (videoEl) {
				try {
					videoEl.pause();
					videoEl.removeAttribute('src');
					while (videoEl.firstChild) {
						videoEl.removeChild(videoEl.firstChild);
					}
					videoEl.load();
				} catch (_) {
					// Ignoruj
				}
			});

			// 2. Zamknij OCA.Viewer jeśli zdążył zmienić swój stan
			if (window.OCA && window.OCA.Viewer && typeof window.OCA.Viewer.close === 'function') {
				if (window.OCA.Viewer.file || window.OCA.Viewer.fileInfo) {
					window.OCA.Viewer.close();
				}
			}
		} catch (_) {
			// Ignoruj
		}
	}

	/**
	 * Czyści bieżący wpis w `window.history`, usuwając parametr `?openfile=...` (oraz `?editing=...`)
	 * i ewentualny sufiks `/<fileid>` ze ścieżki `/apps/files/<view>/<fileid>`.
	 *
	 * Dzięki temu po kliknięciu przycisku "Wstecz" w przeglądarce (lub zamknięciu odtwarzacza w Memories)
	 * użytkownik wraca do czystego widoku katalogu w Plikach bez ponownego wyzwalania przekierowania!
	 */
	function ensureCleanFilesHistoryState(preferredDir) {
		try {
			const currentUrl = new URL(window.location.href);
			let modified = false;

			if (currentUrl.searchParams.has('openfile')) {
				currentUrl.searchParams.delete('openfile');
				modified = true;
			}
			if (currentUrl.searchParams.has('editing')) {
				currentUrl.searchParams.delete('editing');
				modified = true;
			}
			if (preferredDir && !currentUrl.searchParams.has('dir') && currentUrl.pathname.includes('/apps/files')) {
				currentUrl.searchParams.set('dir', preferredDir);
				modified = true;
			}

			// Usuń ID pliku z końca ścieżki `/apps/files/<view>/<fileid>` -> `/apps/files/<view>`
			const cleanedPath = currentUrl.pathname.replace(/(\/apps\/files\/[^/]+)\/\d+\/?$/, '$1');
			if (cleanedPath !== currentUrl.pathname) {
				currentUrl.pathname = cleanedPath;
				modified = true;
			}

			if (modified) {
				originalReplaceState(window.history.state, document.title, currentUrl.toString());
			}
		} catch (_) {
			// Ignoruj błędy URL
		}
	}

	/**
	 * Oblicza przybliżony `dayid` (liczba dni od 1970-01-01 UTC) jako lokalny fallback,
	 * używany wyłącznie gdyby endpoint PHP nie odpowiedział.
	 */
	function computeFallbackDayId(mtimeMsOrSec) {
		if (mtimeMsOrSec && Number.isFinite(Number(mtimeMsOrSec))) {
			const num = Number(mtimeMsOrSec);
			const seconds = num > 1e11 ? Math.floor(num / 1000) : num;
			if (seconds > 0) {
				return Math.floor(seconds / 86400);
			}
		}
		return Math.floor(Date.now() / 86400000);
	}

	/**
	 * Główna funkcja przekierowująca wybrany plik wideo do odtwarzacza w Memories.
	 *
	 * 1. Blokuje `OCA.Viewer` przed pobraniem pliku w tle.
	 * 2. Czyści aktualny URL w `window.history` (usuwa `?openfile=true`), aby przycisk "Wstecz" działał poprawnie.
	 * 3. Odpytuje `GET /apps/memories_video_redirect/api/resolve/{fileId}` (który weryfikuje indeks w `oc_memories`
	 *    i w razie potrzeby indeksuje świeżo wgrany film w locie) i przechodzi pod zwrócony URL Memories.
	 */
	async function redirectToMemories(options) {
		const fileId = options && options.fileId ? parseInt(String(options.fileId), 10) : null;
		if (!fileId || !Number.isFinite(fileId) || fileId <= 0) {
			return false;
		}

		const now = Date.now();
		if (redirectInFlight && lastRedirectFileId === fileId && (now - lastRedirectTimestamp) < 2500) {
			return true;
		}
		redirectInFlight = true;
		lastRedirectFileId = fileId;
		lastRedirectTimestamp = now;

		const dir = options.dir || '/';
		const name = options.name || '';
		const mtime = options.mtime || null;

		// 1. Natychmiast zablokuj domyślny Viewer i wyczyść URL w historii przeglądarki
		abortDefaultViewerAndVideoDownload();
		ensureCleanFilesHistoryState(dir);

		// 2. Pobierz docelowy URL z backendu (zapewnia indeksację w locie w oc_memories)
		const queryParams = new URLSearchParams();
		if (dir) {
			queryParams.set('dir', dir);
		}
		if (name) {
			queryParams.set('name', name);
		}

		const resolveUrl = getWebRootUrl('/apps/' + APP_ID + '/api/resolve/' + encodeURIComponent(String(fileId)))
			+ (queryParams.toString() ? '?' + queryParams.toString() : '');

		try {
			const headers = {
				'Accept': 'application/json',
				'X-Requested-With': 'XMLHttpRequest'
			};
			if (window.OC && window.OC.requestToken) {
				headers['requesttoken'] = window.OC.requestToken;
			}

			const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
			const timeoutId = controller ? setTimeout(function () { controller.abort(); }, 6000) : null;

			const response = await fetch(resolveUrl, {
				method: 'GET',
				headers: headers,
				credentials: 'same-origin',
				signal: controller ? controller.signal : undefined
			});

			if (timeoutId) {
				clearTimeout(timeoutId);
			}

			if (response && response.ok) {
				const data = await response.json();
				if (data && typeof data.url === 'string' && data.url !== '') {
					ensureCleanFilesHistoryState(dir);
					window.location.assign(data.url);
					return true;
				}
			}
		} catch (_) {
			// W razie błędu sieciowego przejdź do bezpośredniego endpointu przekierowującego
		}

		// 3. Fallback: bezpośredni endpoint HTTP 302 `/apps/memories_video_redirect/open/{fileId}`
		// lub bezpośredni URL do widoku katalogu w Memories
		try {
			const directOpenUrl = getWebRootUrl('/apps/' + APP_ID + '/open/' + encodeURIComponent(String(fileId)))
				+ (queryParams.toString() ? '?' + queryParams.toString() : '');
			ensureCleanFilesHistoryState(dir);
			window.location.assign(directOpenUrl);
			return true;
		} catch (_) {
			const dayId = computeFallbackDayId(mtime);
			const cleanRelDir = String(dir || '/').replace(/^\/+|\/+$/g, '');
			const encodedDir = cleanRelDir
				? cleanRelDir.split('/').map(encodeURIComponent).join('/')
				: '';
			const fallbackMemoriesUrl = getWebRootUrl('/apps/memories/folders/' + encodedDir)
				+ '?sort=timeline&noinit=1#v/' + dayId + '/' + fileId;
			window.location.assign(fallbackMemoriesUrl);
			return true;
		}
	}

	// =========================================================================
	// POZIOM 1: Rejestr akcji `@nextcloud/files` (v3 i v4), `OCA.Files.fileActions`
	//           oraz blokada `OCA.Viewer` dla plików wideo
	// =========================================================================

	/**
	 * Normalizuje argumenty wywołania `enabled(...)` pomiędzy `@nextcloud/files` v3 `(nodes, view)`
	 * a `@nextcloud/files` v4 `({ nodes, view, folder, contents })`.
	 */
	function extractNodesFromActionArgs(arg1) {
		if (Array.isArray(arg1)) {
			return arg1;
		}
		if (arg1 && typeof arg1 === 'object') {
			if (Array.isArray(arg1.nodes)) {
				return arg1.nodes;
			}
			if ('fileid' in arg1 || 'mime' in arg1 || 'basename' in arg1) {
				return [arg1];
			}
		}
		return [];
	}

	/**
	 * Normalizuje argumenty wywołania `exec(...)` pomiędzy `@nextcloud/files` v3 `(node, view, dir)`
	 * a `@nextcloud/files` v4 `({ nodes, view, folder, contents })`.
	 */
	function extractSingleNodeAndDirFromExecArgs(arg1, arg2, arg3) {
		if (arg1 && typeof arg1 === 'object' && Array.isArray(arg1.nodes)) {
			const node = arg1.nodes[0] || null;
			const folderPath = (arg1.folder && arg1.folder.path) || arg3 || null;
			return { node: node, dir: extractCurrentDir(node, folderPath) };
		}
		if (Array.isArray(arg1)) {
			const node = arg1[0] || null;
			return { node: node, dir: extractCurrentDir(node, arg3) };
		}
		return { node: arg1 || null, dir: extractCurrentDir(arg1, arg3) };
	}

	/**
	 * Tworzy obiekt akcji kompatybilny zarówno z `@nextcloud/files` v3 (`FileAction`),
	 * jak i `@nextcloud/files` v4 (`IFileAction`).
	 */
	function createMemoriesFileActionObject() {
		const actionConfig = {
			id: ACTION_ID,
			displayName: function () {
				return getActionLabel();
			},
			title: function () {
				return getActionLabel();
			},
			iconSvgInline: function () {
				return PLAY_ICON_SVG;
			},
			default: 'default',
			order: -1000,
			enabled: function (arg1) {
				const nodes = extractNodesFromActionArgs(arg1);
				if (!nodes || nodes.length !== 1) {
					return false;
				}
				return isVideoNode(nodes[0]);
			},
			exec: async function (arg1, arg2, arg3) {
				const extracted = extractSingleNodeAndDirFromExecArgs(arg1, arg2, arg3);
				const node = extracted.node;
				if (!node) {
					return false;
				}
				const fileId = extractFileIdFromNode(node);
				if (!fileId) {
					return false;
				}
				await redirectToMemories({
					fileId: fileId,
					dir: extracted.dir,
					name: node.basename || node.name || '',
					mtime: node.mtime
				});
				return null;
			}
		};

		// Dodaj pole `_action`, z którego korzystają gettery klasy `FileAction` w @nextcloud/files v3
		actionConfig._action = actionConfig;
		return actionConfig;
	}

	/**
	 * Modyfikuje istniejącą akcję `view` / `viewer` z aplikacji `viewer`, tak aby:
	 * 1. Nie była aktywna (`enabled` -> `false`) dla pojedynczych plików wideo (dzięki czemu
	 *    nasza akcja `memories-video-redirect` jest jedyną domyślną akcją dla wideo).
	 * 2. Nawet gdyby została wywołana bezpośrednio na pliku wideo, przekierowała do Memories
	 *    zamiast otwierać `OCA.Viewer.open`.
	 */
	function patchExistingViewerFileAction(actionObj) {
		if (!actionObj || actionObj.__memoriesPatched) {
			return;
		}
		const target = actionObj._action && typeof actionObj._action === 'object' ? actionObj._action : actionObj;
		const origEnabled = typeof target.enabled === 'function' ? target.enabled.bind(target) : null;
		const origExec = typeof target.exec === 'function' ? target.exec.bind(target) : null;

		const wrappedEnabled = function (arg1, arg2) {
			const nodes = extractNodesFromActionArgs(arg1);
			if (nodes.length > 0 && nodes.every(isVideoNode)) {
				return false;
			}
			return origEnabled ? origEnabled(arg1, arg2) : true;
		};

		const wrappedExec = async function (arg1, arg2, arg3) {
			const extracted = extractSingleNodeAndDirFromExecArgs(arg1, arg2, arg3);
			if (extracted.node && isVideoNode(extracted.node)) {
				const fileId = extractFileIdFromNode(extracted.node);
				if (fileId) {
					await redirectToMemories({
						fileId: fileId,
						dir: extracted.dir,
						name: extracted.node.basename || extracted.node.name || '',
						mtime: extracted.node.mtime
					});
					return null;
				}
			}
			return origExec ? origExec(arg1, arg2, arg3) : null;
		};

		try {
			target.enabled = wrappedEnabled;
			target.exec = wrappedExec;
		} catch (_) {
			// Jeśli właściwości są tylko do odczytu (getter), nadpisz na instancji
		}

		try {
			Object.defineProperty(actionObj, 'enabled', {
				configurable: true,
				enumerable: true,
				get: function () { return wrappedEnabled; }
			});
			Object.defineProperty(actionObj, 'exec', {
				configurable: true,
				enumerable: true,
				get: function () { return wrappedExec; }
			});
		} catch (_) {
			// Ignoruj
		}

		actionObj.__memoriesPatched = true;
	}

	/**
	 * Rejestruje akcję w globalnym rejestrze `@nextcloud/files` (zarówno v4 `window._nc_files_scope`,
	 * jak i v3 `window._nc_fileactions`) oraz w klasycznym `window.OCA.Files.fileActions`.
	 */
	function registerAndPatchFileActions() {
		const memoriesAction = createMemoriesFileActionObject();

		// 1. Obsługa @nextcloud/files v4+ (`window._nc_files_scope`)
		if (window._nc_files_scope && typeof window._nc_files_scope === 'object') {
			Object.values(window._nc_files_scope).forEach(function (scope) {
				if (!scope || typeof scope !== 'object' || !(scope.fileActions instanceof Map)) {
					return;
				}

				// Zpatchuj domyślną akcję `view` / `viewer` jeśli jest już zarejestrowana
				['view', 'viewer'].forEach(function (viewerId) {
					if (scope.fileActions.has(viewerId)) {
						patchExistingViewerFileAction(scope.fileActions.get(viewerId));
					}
				});

				// Zarejestruj naszą akcję jako domyślną (z order: -1000)
				if (!scope.fileActions.has(ACTION_ID)) {
					scope.fileActions.set(ACTION_ID, memoriesAction);
					if (scope.registry && typeof scope.registry.dispatchEvent === 'function') {
						try {
							scope.registry.dispatchEvent(new CustomEvent('register:action', { detail: memoriesAction }));
						} catch (_) {
							// Ignoruj
						}
					}
				}
			});
		}

		// 2. Obsługa @nextcloud/files v3 (`window._nc_fileactions`)
		if (!Array.isArray(window._nc_fileactions)) {
			window._nc_fileactions = [];
		}
		window._nc_fileactions.forEach(function (existing) {
			if (existing && (existing.id === 'view' || existing.id === 'viewer')) {
				patchExistingViewerFileAction(existing);
			}
		});
		if (!window._nc_fileactions.some(function (a) { return a && a.id === ACTION_ID; })) {
			window._nc_fileactions.unshift(memoriesAction);
		}

		// 3. Obsługa klasycznego `window.OCA.Files.fileActions` (starsze widoki / wtyczki)
		try {
			const legacyActions = window.OCA && window.OCA.Files && window.OCA.Files.fileActions;
			if (legacyActions && typeof legacyActions.registerAction === 'function' && !legacyActions.__memoriesVideoRegistered) {
				legacyActions.registerAction({
					name: ACTION_ID,
					displayName: getActionLabel(),
					mime: 'video',
					permissions: (window.OC && window.OC.PERMISSION_READ) ? window.OC.PERMISSION_READ : 1,
					iconClass: 'icon-play',
					actionHandler: function (fileName, context) {
						let fileId = null;
						let dir = '/';
						if (context) {
							if (context.$file && typeof context.$file.attr === 'function') {
								fileId = parseInt(context.$file.attr('data-id') || context.$file.attr('data-cy-files-list-row-fileid') || '0', 10);
							}
							if (context.fileActions && typeof context.fileActions.getCurrentDirectory === 'function') {
								dir = context.fileActions.getCurrentDirectory();
							} else if (typeof context.dir === 'string') {
								dir = context.dir;
							}
						}
						if (fileId) {
							redirectToMemories({ fileId: fileId, dir: dir, name: fileName });
						}
					}
				});
				if (typeof legacyActions.setDefault === 'function') {
					legacyActions.setDefault('video', ACTION_ID);
				}
				legacyActions.__memoriesVideoRegistered = true;
			}
		} catch (_) {
			// Ignoruj błędy legacy API
		}
	}

	/**
	 * Blokuje obsługę plików `video/*` bezpośrednio w serwisie `window.OCA.Viewer`:
	 * 1. Usuwa typy `video/*` z `OCA.Viewer._mimetypes` oraz handler `'videos'` z `OCA.Viewer._state.handlers`
	 *    (dzięki czemu `viewerAction` sam uznaje pliki wideo za nieobsługiwane i nie ładuje ich też przy
	 *    przewijaniu zdjęć Prawo/Lewo w podglądzie obrazów!).
	 * 2. Opakowuje `OCA.Viewer.open`, aby każda bezpośrednia próba otwarcia wideo w Viewerze została
	 *    natychmiast przerwana przed utworzeniem tagu `<video>` i przekierowana do Memories.
	 */
	function patchOCAViewerService() {
		const viewer = window.OCA && window.OCA.Viewer;
		if (!viewer) {
			return;
		}

		// 1. Usuń typy MIME wideo z listy obsługiwanych przez OCA.Viewer
		try {
			if (Array.isArray(viewer._mimetypes)) {
				for (let i = viewer._mimetypes.length - 1; i >= 0; i--) {
					const m = String(viewer._mimetypes[i] || '').toLowerCase();
					if (m.startsWith('video/') || EXTRA_VIDEO_MIMES.has(m)) {
						viewer._mimetypes.splice(i, 1);
					}
				}
			}
			if (viewer._state && Array.isArray(viewer._state.handlers)) {
				for (let i = viewer._state.handlers.length - 1; i >= 0; i--) {
					const h = viewer._state.handlers[i];
					if (h && h.id === 'videos') {
						viewer._state.handlers.splice(i, 1);
					}
				}
			}
		} catch (_) {
			// Ignoruj
		}

		// 2. Opakuj metodę `OCA.Viewer.open`
		if (typeof viewer.open === 'function' && !viewer.open.__memoriesWrapped) {
			const origOpen = viewer.open.bind(viewer);
			const wrappedOpen = function (options) {
				try {
					const path = (options && options.path) || (typeof options === 'string' ? options : '');
					const fileInfo = options && options.fileInfo;
					const mime = (fileInfo && fileInfo.mime) || '';
					const name = (fileInfo && (fileInfo.basename || fileInfo.filename)) || path || '';

					if (isVideoByMimeOrName(mime, name)) {
						const infoFromDom = findVideoRowInfoByPathOrName(path, name, fileInfo && fileInfo.fileid);
						if (infoFromDom && infoFromDom.fileId) {
							redirectToMemories(infoFromDom);
							return;
						}
					}
				} catch (_) {
					// Kontynuuj do origOpen tylko jeśli to nie wideo
				}
				return origOpen.apply(this, arguments);
			};
			wrappedOpen.__memoriesWrapped = true;
			viewer.open = wrappedOpen;
		}
	}

	// =========================================================================
	// POZIOM 2: Interceptor DOM (kliknięcie w wiersz tabeli) oraz History API
	// =========================================================================

	/**
	 * Wyciąga metadane pliku (`fileId`, `name`, `mime`, `dir`, `isVideo`) z wiersza tabeli DOM
	 * (`tr[data-cy-files-list-row]`, `.files-list__row` lub `.files-grid__item`).
	 */
	function extractRowFileInfo(rowEl) {
		if (!rowEl || !(rowEl instanceof Element)) {
			return null;
		}

		// 1. Sprawdź instancję komponentu Vue (Vue 2 `__vue__` lub Vue 3 `__vueParentComponent`)
		try {
			const vueSource = (rowEl.__vue__ && rowEl.__vue__.source)
				|| (rowEl.__vueParentComponent && rowEl.__vueParentComponent.props && rowEl.__vueParentComponent.props.source)
				|| (rowEl.__vueParentComponent && rowEl.__vueParentComponent.ctx && rowEl.__vueParentComponent.ctx.source);
			if (vueSource && typeof vueSource === 'object') {
				const vueFileId = extractFileIdFromNode(vueSource);
				if (vueFileId) {
					return {
						fileId: vueFileId,
						name: vueSource.basename || vueSource.name || '',
						mime: vueSource.mime || vueSource.mimetype || '',
						dir: extractCurrentDir(vueSource),
						mtime: vueSource.mtime || null,
						isVideo: isVideoNode(vueSource)
					};
				}
			}
		} catch (_) {
			// Kontynuuj do atrybutów DOM
		}

		// 2. Odczytaj z atrybutów `data-*` wiersza tabeli w nowym Nextcloud Files (Vue) oraz starszym widoku
		const rawId = rowEl.getAttribute('data-cy-files-list-row-fileid')
			|| rowEl.getAttribute('data-id')
			|| rowEl.getAttribute('data-fileid')
			|| (rowEl.dataset && (rowEl.dataset.cyFilesListRowFileid || rowEl.dataset.id));
		const fileId = rawId ? parseInt(rawId, 10) : null;
		if (!fileId || !Number.isFinite(fileId) || fileId <= 0) {
			return null;
		}

		let name = rowEl.getAttribute('data-cy-files-list-row-name')
			|| rowEl.getAttribute('data-file')
			|| '';
		if (!name) {
			const nameEl = rowEl.querySelector('[data-cy-files-list-row-name], .files-list__row-name-text, .nametext');
			if (nameEl) {
				const extEl = rowEl.querySelector('.files-list__row-name-ext, .extension');
				name = (nameEl.textContent || '').trim() + (extEl ? (extEl.textContent || '').trim() : '');
			}
		}

		let mime = rowEl.getAttribute('data-mime') || '';
		if (!mime) {
			const mimeCell = rowEl.querySelector('[data-cy-files-list-row-mime], td.files-list__row-mime');
			if (mimeCell) {
				mime = (mimeCell.textContent || '').trim();
			}
		}

		const rowType = rowEl.getAttribute('data-type') || '';
		const isFolder = rowType === 'dir'
			|| rowType === 'folder'
			|| rowEl.classList.contains('files-list__row--folder')
			|| mime === 'httpd/unix-directory';

		return {
			fileId: fileId,
			name: name,
			mime: mime,
			dir: extractCurrentDir(null),
			mtime: null,
			isVideo: !isFolder && isVideoByMimeOrName(mime, name)
		};
	}

	/**
	 * Wyszukuje informacje o pliku wideo w aktualnie wyrenderowanym DOM po `fileId` lub ścieżce/nazwie.
	 */
	function findVideoRowInfoByPathOrName(path, name, explicitFileId) {
		if (explicitFileId) {
			const byId = findRowInfoByFileId(explicitFileId);
			if (byId) {
				return byId;
			}
		}

		const targetBase = (name || path || '').split('/').pop();
		const rows = document.querySelectorAll('tr[data-cy-files-list-row], tr[data-id], .files-list__row');
		for (let i = 0; i < rows.length; i++) {
			const info = extractRowFileInfo(rows[i]);
			if (info && info.isVideo && (!targetBase || info.name === targetBase)) {
				return info;
			}
		}
		return null;
	}

	/**
	 * Wyszukuje informacje o wierszu pliku w DOM na podstawie `fileId`.
	 */
	function findRowInfoByFileId(fileId) {
		const idStr = String(fileId);
		const selector = 'tr[data-cy-files-list-row-fileid="' + idStr + '"], '
			+ '[data-cy-files-list-row][data-cy-files-list-row-fileid="' + idStr + '"], '
			+ 'tr[data-id="' + idStr + '"]';
		const rowEl = document.querySelector(selector);
		if (rowEl) {
			return extractRowFileInfo(rowEl);
		}
		return null;
	}

	/**
	 * Sprawdza, czy kliknięty element wewnątrz wiersza pliku powinien otworzyć plik,
	 * czy jest to np. checkbox zaznaczania, menu akcji `...`, przycisk ulubionych lub udostępniania.
	 */
	function isInteractiveControlClick(targetEl, rowEl) {
		if (!targetEl || !(targetEl instanceof Element)) {
			return true;
		}
		const ignoredSelectors = [
			'.files-list__row-checkbox',
			'td.files-list__row-checkbox',
			'input[type="checkbox"]',
			'label',
			'[data-cy-files-list-row-actions]',
			'.files-list__row-actions',
			'.action-menu',
			'.v-popper__popper',
			'.files-list__row-action-favorite',
			'.files-list__row-action-details',
			'button:not(.files-list__row-name-link)'
		].join(',');

		const matchedControl = targetEl.closest(ignoredSelectors);
		if (matchedControl && rowEl.contains(matchedControl)) {
			// Pozwól na kliknięcie w sam główny link nazwy pliku (<a class="files-list__row-name-link"> lub <button>)
			if (
				matchedControl.classList.contains('files-list__row-name')
				|| matchedControl.hasAttribute('data-cy-files-list-row-name')
				|| matchedControl.closest('[data-cy-files-list-row-name], .files-list__row-name, .files-list__row-icon')
			) {
				// Sprawdź, czy to nie jest przycisk wewnątrz sekcji akcji (np. "...")
				if (!targetEl.closest('[data-cy-files-list-row-actions], .files-list__row-actions')) {
					return false;
				}
			}
			return true;
		}
		return false;
	}

	/**
	 * Nasłuchiwanie kliknięć w fazie `capture` (zanim zdarzenie dotrze do komponentu Vue `FileEntry.vue` lub `viewer`).
	 */
	function onDocumentClickCapture(event) {
		// Ignoruj kliknięcia z klawiszami modyfikującymi (zaznaczanie wielu plików) oraz kliknięcia inne niż lewy przycisk myszy
		if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
			return;
		}

		const target = event.target;
		if (!(target instanceof Element)) {
			return;
		}

		// Ignoruj kliknięcia wewnątrz otwartego menu kontekstowego (tam działa nasza jawna akcja "Odtwórz w Memories")
		if (target.closest('.v-popper__popper, .open-menu, #aca-menu')) {
			return;
		}

		const rowEl = target.closest('tr[data-cy-files-list-row], tr[data-id], .files-list__row, .files-grid__item');
		if (!rowEl) {
			return;
		}

		if (isInteractiveControlClick(target, rowEl)) {
			return;
		}

		// Upewnij się, że kliknięto w komórkę nazwy, ikony/miniatury lub główny obszar wiersza
		const clickedOpenArea = target.closest(
			'[data-cy-files-list-row-name], .files-list__row-name, .files-list__row-icon, .nametext, .thumbnail, .files-grid__item'
		);
		if (!clickedOpenArea) {
			return;
		}

		const info = extractRowFileInfo(rowEl);
		if (!info || !info.isVideo || !info.fileId) {
			return;
		}

		// Zablokuj natychmiast otwarcie domyślnego Viewera i pobieranie pliku przez WebDAV!
		event.preventDefault();
		event.stopPropagation();
		if (typeof event.stopImmediatePropagation === 'function') {
			event.stopImmediatePropagation();
		}

		redirectToMemories(info);
	}

	/**
	 * Analizuje URL przekazywany do `history.pushState` / `history.replaceState` lub obecny w `window.location`.
	 * Jeśli zawiera parametr `openfile` dla pliku wideo:
	 * - zwraca informacje o pliku wideo oraz czysty adres URL katalogu (bez `openfile` i bez `/<fileid>`).
	 */
	function inspectUrlForVideoOpenFile(rawUrl) {
		if (!rawUrl) {
			return null;
		}
		try {
			const parsed = new URL(String(rawUrl), window.location.origin);
			if (!parsed.pathname.includes('/apps/files')) {
				return null;
			}
			if (!parsed.searchParams.has('openfile')) {
				return null;
			}

			const openfileParam = parsed.searchParams.get('openfile') || '';
			if (openfileParam.toLowerCase() === 'false') {
				return null;
			}

			// Wyciągnij fileId ze ścieżki `/apps/files/<view>/<fileid>` lub z `?openfile=<fileid>`
			let fileId = null;
			const pathMatch = parsed.pathname.match(/\/apps\/files\/[^/]+\/(\d+)\/?$/);
			if (pathMatch && pathMatch[1]) {
				fileId = parseInt(pathMatch[1], 10);
			} else if (/^\d+$/.test(openfileParam)) {
				fileId = parseInt(openfileParam, 10);
			} else {
				const routerFileId = window.OCP && window.OCP.Files && window.OCP.Files.Router
					&& window.OCP.Files.Router.params && window.OCP.Files.Router.params.fileid;
				if (routerFileId && /^\d+$/.test(String(routerFileId))) {
					fileId = parseInt(String(routerFileId), 10);
				}
			}

			if (!fileId || !Number.isFinite(fileId) || fileId <= 0) {
				return null;
			}

			const rowInfo = findRowInfoByFileId(fileId);
			if (!rowInfo || !rowInfo.isVideo) {
				return null;
			}

			// Zbuduj czysty URL katalogu (bez `openfile`, bez `editing` i bez `/<fileid>` w ścieżce)
			const cleanUrl = new URL(parsed.toString());
			cleanUrl.searchParams.delete('openfile');
			cleanUrl.searchParams.delete('editing');
			cleanUrl.pathname = cleanUrl.pathname.replace(/(\/apps\/files\/[^/]+)\/\d+\/?$/, '$1');

			return {
				fileId: fileId,
				dir: parsed.searchParams.get('dir') || rowInfo.dir || '/',
				name: rowInfo.name || '',
				mtime: rowInfo.mtime || null,
				cleanUrl: cleanUrl.toString()
			};
		} catch (_) {
			return null;
		}
	}

	/**
	 * Instaluje interceptor na `window.history.pushState` oraz `window.history.replaceState`.
	 */
	function installHistoryInterceptors() {
		window.history.pushState = function (state, title, url) {
			const match = inspectUrlForVideoOpenFile(url);
			if (match) {
				// Zamiast odkładać wpis z `?openfile=true`, zachowaj czysty URL katalogu w bieżącym wpisie historii
				originalReplaceState(state, title, match.cleanUrl);
				abortDefaultViewerAndVideoDownload();
				redirectToMemories(match);
				return;
			}
			return originalPushState(state, title, url);
		};

		window.history.replaceState = function (state, title, url) {
			const match = inspectUrlForVideoOpenFile(url);
			if (match) {
				originalReplaceState(state, title, match.cleanUrl);
				abortDefaultViewerAndVideoDownload();
				redirectToMemories(match);
				return;
			}
			return originalReplaceState(state, title, url);
		};
	}

	/**
	 * Obsługa sytuacji, w której użytkownik otworzył bezpośrednio link z `?openfile=true`
	 * wskazujący na plik wideo (np. z wyszukiwarki Nextcloud lub zakładki).
	 */
	function checkInitialUrlForVideoOpenFile() {
		if (!window.location.search.includes('openfile')) {
			return;
		}
		const match = inspectUrlForVideoOpenFile(window.location.href);
		if (match) {
			originalReplaceState(window.history.state, document.title, match.cleanUrl);
			abortDefaultViewerAndVideoDownload();
			redirectToMemories(match);
		}
	}

	/**
	 * Inicjalizacja wszystkich warstw przechwytywania oraz obserwatora zmian (gdy `viewer`
	 * lub `@nextcloud/files` doładują swoje skrypty asynchronicznie po naszym skrypcie).
	 */
	function init() {
		registerAndPatchFileActions();
		patchOCAViewerService();
		installHistoryInterceptors();

		document.addEventListener('click', onDocumentClickCapture, true);
		document.addEventListener('dblclick', onDocumentClickCapture, true);

		// Powtórz rejestrację i patchowanie po załadowaniu DOM oraz krótkim opóźnieniu,
		// na wypadek gdyby aplikacja `viewer` zarejestrowała swoją akcję `view` po naszym skrypcie.
		const syncHooks = function () {
			registerAndPatchFileActions();
			patchOCAViewerService();
			checkInitialUrlForVideoOpenFile();
		};

		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', syncHooks);
		} else {
			syncHooks();
		}

		window.addEventListener('load', syncHooks);
		setTimeout(syncHooks, 300);
		setTimeout(syncHooks, 1200);

		// Obserwuj pojawienie się wierszy tabeli w przypadku leniwego renderowania listy plików
		if (typeof MutationObserver !== 'undefined') {
			let debounceTimer = null;
			const observer = new MutationObserver(function () {
				if (debounceTimer) {
					return;
				}
				debounceTimer = setTimeout(function () {
					debounceTimer = null;
					registerAndPatchFileActions();
					patchOCAViewerService();
					if (window.location.search.includes('openfile')) {
						checkInitialUrlForVideoOpenFile();
					}
				}, 150);
			});

			const startObserving = function () {
				if (document.body) {
					observer.observe(document.body, { childList: true, subtree: true });
				}
			};
			if (document.body) {
				startObserving();
			} else {
				document.addEventListener('DOMContentLoaded', startObserving);
			}
		}
	}

	init();
})();
