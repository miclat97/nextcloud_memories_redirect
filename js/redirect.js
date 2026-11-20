/**
 * memories_video_redirect — Frontend Interceptor (Poziom 1 + Poziom 2)
 *
 * Przechwytuje otwieranie plików wideo (video/*), zdjęć (image/*) oraz wybranych
 * własnych rozszerzeń w aplikacji Pliki (apps/files) i przekierowuje je bezpośrednio
 * do aplikacji Memories, blokując domyślny Nextcloud Viewer przed pobieraniem surowych plików.
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
	const LEGACY_IMAGE_ACTION_ID = 'memories-image-redirect';

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

	/** Rozszerzenia plików zdjęć rozpoznawane niezależnie od zadeklarowanego typu MIME */
	const IMAGE_EXTENSIONS = new Set([
		'jpg', 'jpeg', 'jpe', 'jfif', 'png', 'gif', 'webp',
		'heic', 'heif', 'avif', 'jxl', 'bmp', 'dib',
		'tif', 'tiff', 'ico', 'cur',
		'dng', 'raw', 'cr2', 'cr3', 'nef', 'nrw', 'arw', 'srf', 'sr2',
		'orf', 'rw2', 'raf', 'pef', 'srw', 'x3f', '3fr', 'erf', 'kdc', 'mrw',
		'svg', 'svgz'
	]);

	/** Dodatkowe typy MIME zdjęć */
	const EXTRA_IMAGE_MIMES = new Set([
		'image/jpeg',
		'image/jpg',
		'image/png',
		'image/gif',
		'image/webp',
		'image/heic',
		'image/heif',
		'image/heic-sequence',
		'image/heif-sequence',
		'image/avif',
		'image/jxl',
		'image/bmp',
		'image/x-ms-bmp',
		'image/tiff',
		'image/x-tiff',
		'image/x-adobe-dng',
		'image/x-canon-cr2',
		'image/x-canon-cr3',
		'image/x-nikon-nef',
		'image/x-sony-arw',
		'image/x-olympus-orf',
		'image/x-panasonic-rw2',
		'image/x-fuji-raf',
		'image/svg+xml'
	]);

	/** Mapowanie wybranych typów MIME na rozszerzenia dla wykluczeń w OCA.Viewer */
	const MIME_TO_EXTENSIONS = {
		'image/svg+xml': ['svg', 'svgz'],
		'image/gif': ['gif'],
		'image/tiff': ['tif', 'tiff'],
		'image/x-tiff': ['tif', 'tiff'],
		'image/webp': ['webp'],
		'image/png': ['png'],
		'image/jpeg': ['jpg', 'jpeg'],
		'image/heic': ['heic'],
		'image/heif': ['heif'],
		'image/avif': ['avif'],
		'image/bmp': ['bmp'],
		'video/mp4': ['mp4', 'm4v'],
		'video/webm': ['webm'],
		'video/quicktime': ['mov'],
		'video/x-matroska': ['mkv'],
		'video/ogg': ['ogv', 'ogg']
	};

	/** Ikona SVG przycisku "Otwórz w Memories" */
	const PLAY_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>';

	/** Domyślna konfiguracja (nadpisywana z panelu administratora przez IInitialState) */
	let runtimeConfig = {
		redirectVideos: true,
		redirectPhotos: true,
		customExtensions: new Set(),
		excludedExtensions: new Set(['svg', 'svgz']),
		interceptDefaultClick: true,
		blockDefaultViewer: true,
		onTheFlyIndexing: true,
		enableSingleItemFallback: true,
		excludedPaths: [],
		customActionLabel: ''
	};
	let configLoadedFromInitialState = false;

	/** Stan blokady zapobiegający wielokrotnemu wyzwoleniu przekierowania dla tego samego kliknięcia */
	let redirectInFlight = false;
	let lastRedirectFileId = null;
	let lastRedirectTimestamp = 0;

	/** Zachowaj oryginalne metody History API przed nałożeniem interceptora */
	const originalPushState = window.history.pushState.bind(window.history);
	const originalReplaceState = window.history.replaceState.bind(window.history);

	/**
	 * Bezpiecznie dekoduje ciąg Base64 (UTF-8) używany przez Nextcloud IInitialState.
	 */
	function decodeBase64Utf8(base64Str) {
		const binary = window.atob(base64Str);
		if (typeof TextDecoder !== 'undefined') {
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) {
				bytes[i] = binary.charCodeAt(i);
			}
			return new TextDecoder('utf-8').decode(bytes);
		}
		return decodeURIComponent(escape(binary));
	}

	/**
	 * Normalizuje listę rozszerzeń do zbioru małych liter bez wiodących kropek.
	 */
	function toExtensionSet(list) {
		const result = new Set();
		if (!Array.isArray(list)) {
			return result;
		}
		list.forEach(function (item) {
			if (typeof item !== 'string') {
				return;
			}
			const clean = item.trim().replace(/^\.+/, '').toLowerCase();
			if (clean) {
				result.add(clean);
			}
		});
		return result;
	}

	/**
	 * Normalizuje ścieżkę katalogu do postaci `/foo/bar` (lub `/`).
	 */
	function normalizeDirPath(path) {
		if (!path || typeof path !== 'string') {
			return '/';
		}
		let clean = path.trim().replace(/\/+/g, '/');
		if (!clean.startsWith('/')) {
			clean = '/' + clean;
		}
		if (clean.length > 1 && clean.endsWith('/')) {
			clean = clean.slice(0, -1);
		}
		return clean || '/';
	}

	/**
	 * Odczytuje konfigurację przekazaną z PHP (`LoadScriptsListener` -> `IInitialState`).
	 */
	function refreshRuntimeConfigFromInitialState() {
		if (configLoadedFromInitialState) {
			return;
		}
		let parsed = null;
		try {
			if (window.OCP && window.OCP.InitialState && typeof window.OCP.InitialState.loadState === 'function') {
				parsed = window.OCP.InitialState.loadState(APP_ID, 'config', null);
			}
		} catch (_) {
			parsed = null;
		}

		if (!parsed || typeof parsed !== 'object') {
			try {
				const el = document.getElementById('initial-state-' + APP_ID + '-config');
				if (el && el.value) {
					parsed = JSON.parse(decodeBase64Utf8(el.value));
				}
			} catch (_) {
				parsed = null;
			}
		}

		if (!parsed || typeof parsed !== 'object') {
			return;
		}

		configLoadedFromInitialState = true;
		runtimeConfig = {
			redirectVideos: parsed.redirectVideos !== undefined ? Boolean(parsed.redirectVideos) : true,
			redirectPhotos: parsed.redirectPhotos !== undefined ? Boolean(parsed.redirectPhotos) : true,
			customExtensions: toExtensionSet(parsed.customExtensions),
			excludedExtensions: parsed.excludedExtensions !== undefined
				? toExtensionSet(parsed.excludedExtensions)
				: new Set(['svg', 'svgz']),
			interceptDefaultClick: parsed.interceptDefaultClick !== undefined ? Boolean(parsed.interceptDefaultClick) : true,
			blockDefaultViewer: parsed.blockDefaultViewer !== undefined ? Boolean(parsed.blockDefaultViewer) : true,
			onTheFlyIndexing: parsed.onTheFlyIndexing !== undefined ? Boolean(parsed.onTheFlyIndexing) : true,
			enableSingleItemFallback: parsed.enableSingleItemFallback !== undefined ? Boolean(parsed.enableSingleItemFallback) : true,
			excludedPaths: Array.isArray(parsed.excludedPaths)
				? parsed.excludedPaths.map(normalizeDirPath)
				: [],
			customActionLabel: typeof parsed.customActionLabel === 'string' ? parsed.customActionLabel.trim() : ''
		};
	}

	/**
	 * Sprawdza, czy podany katalog należy do wykluczonych ścieżek.
	 */
	function isPathExcluded(dir) {
		if (!runtimeConfig.excludedPaths || runtimeConfig.excludedPaths.length === 0) {
			return false;
		}
		const normDir = normalizeDirPath(dir);
		for (let i = 0; i < runtimeConfig.excludedPaths.length; i++) {
			const excluded = runtimeConfig.excludedPaths[i];
			if (excluded === '/' || normDir === excluded || normDir.startsWith(excluded + '/')) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Zwraca przetłumaczoną etykietę akcji w menu kontekstowym.
	 */
	function getActionLabel(mediaType) {
		if (runtimeConfig.customActionLabel) {
			return runtimeConfig.customActionLabel;
		}
		const defaultText = mediaType === 'video' ? 'Odtwórz w Memories' : 'Otwórz w Memories';
		try {
			if (typeof window.t === 'function') {
				const translated = window.t(APP_ID, defaultText);
				if (translated) {
					return translated;
				}
			}
		} catch (_) {
			// Ignoruj błędy lokalizacji
		}
		return defaultText;
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
	 * Sprawdza, czy typ MIME odpowiada wykluczonemu rozszerzeniu (np. image/svg+xml dla svg).
	 */
	function isMimeExcluded(lowerMime) {
		if (!lowerMime || runtimeConfig.excludedExtensions.size === 0) {
			return false;
		}
		const mappedExts = MIME_TO_EXTENSIONS[lowerMime];
		if (Array.isArray(mappedExts) && mappedExts.length > 0) {
			return mappedExts.every(function (ext) {
				return runtimeConfig.excludedExtensions.has(ext);
			});
		}
		return false;
	}

	/**
	 * Rozpoznaje kategorię pliku podlegającą przekierowaniu ('video' | 'photo' | 'custom' | null).
	 */
	function classifyFileByMimeOrName(mime, nameOrPath) {
		const lowerMime = typeof mime === 'string' ? mime.trim().toLowerCase() : '';
		if (lowerMime === 'httpd/unix-directory' || lowerMime === 'inode/directory') {
			return null;
		}

		const ext = getFileExtension(nameOrPath);
		if (ext !== '' && runtimeConfig.excludedExtensions.has(ext)) {
			return null;
		}
		if (ext === '' && isMimeExcluded(lowerMime)) {
			return null;
		}

		if (ext !== '' && runtimeConfig.customExtensions.has(ext)) {
			return 'custom';
		}

		if (runtimeConfig.redirectVideos) {
			if (
				(lowerMime && (lowerMime.startsWith('video/') || EXTRA_VIDEO_MIMES.has(lowerMime)))
				|| (ext !== '' && VIDEO_EXTENSIONS.has(ext))
			) {
				return 'video';
			}
		}

		if (runtimeConfig.redirectPhotos) {
			if (
				(lowerMime && (lowerMime.startsWith('image/') || EXTRA_IMAGE_MIMES.has(lowerMime)))
				|| (ext !== '' && IMAGE_EXTENSIONS.has(ext))
			) {
				return 'photo';
			}
		}

		return null;
	}

	/**
	 * Zwraca kategorię obiektu Node z `@nextcloud/files` (lub `OCA.Files`), albo `null`.
	 */
	function classifyNode(node) {
		if (!node || typeof node !== 'object') {
			return null;
		}
		if (node.type === 'folder' || node.type === 'dir') {
			return null;
		}
		const mime = node.mime || node.mimetype || (node.attributes && node.attributes['content-type']) || '';
		if (mime === 'httpd/unix-directory' || mime === 'inode/directory') {
			return null;
		}
		const name = node.basename || node.name || node.path || node.filename || '';
		return classifyFileByMimeOrName(mime, name);
	}

	function isTargetNode(node) {
		return classifyNode(node) !== null;
	}

	function isAutoRedirectNode(node) {
		if (!runtimeConfig.interceptDefaultClick) {
			return false;
		}
		if (!isTargetNode(node)) {
			return false;
		}
		return !isPathExcluded(extractCurrentDir(node));
	}

	/**
	 * Wyciąga ID pliku (liczba > 0) z obiektu Node.
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
	 * pobieranie strumienia WebDAV przez elementy `<video>` lub `<img>` w modalu Viewera.
	 */
	function abortDefaultViewerAndMediaDownload() {
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

			// 2. Zatrzymaj podgląd obrazów w #viewer przed pełnym pobraniem
			const viewerImages = document.querySelectorAll('#viewer img, .viewer img');
			viewerImages.forEach(function (imgEl) {
				try {
					imgEl.removeAttribute('src');
				} catch (_) {
					// Ignoruj
				}
			});

			// 3. Zamknij OCA.Viewer jeśli zdążył zmienić swój stan
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
	 * Oblicza przybliżony `dayid` (liczba dni od 1970-01-01 UTC) jako lokalny fallback.
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
	 * Główna funkcja przekierowująca wybrany plik do Memories.
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

		abortDefaultViewerAndMediaDownload();
		ensureCleanFilesHistoryState(dir);

		const queryParams = new URLSearchParams();
		if (dir) {
			queryParams.set('dir', dir);
		}
		if (name) {
			queryParams.set('name', name);
		}

		const resolveUrl = getWebRootUrl('/apps/' + APP_ID + '/api/resolve/' + encodeURIComponent(String(fileId)))
			+ (queryParams.toString() ? '?' + queryParams.toString() : '');

		let backendReturnedHttpError = false;
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
			} else if (response && response.status >= 400) {
				backendReturnedHttpError = true;
			}
		} catch (_) {
			// Błąd sieciowy lub timeout — spróbuj przekierowania bezpośredniego lub fallbacku Memories
		}

		if (!backendReturnedHttpError) {
			try {
				const directOpenUrl = getWebRootUrl('/apps/' + APP_ID + '/open/' + encodeURIComponent(String(fileId)))
					+ (queryParams.toString() ? '?' + queryParams.toString() : '');
				ensureCleanFilesHistoryState(dir);
				window.location.assign(directOpenUrl);
				return true;
			} catch (_) {
				// Przejdź do bezpośredniego adresu Memories poniżej
			}
		}

		const dayId = computeFallbackDayId(mtime);
		const cleanRelDir = String(dir || '/').replace(/^\/+|\/+$/g, '');
		const encodedDir = cleanRelDir
			? cleanRelDir.split('/').map(encodeURIComponent).join('/')
			: '';
		const fallbackMemoriesUrl = getWebRootUrl('/apps/memories/folders/' + encodedDir)
			+ '?sort=timeline&noinit=1#v/' + dayId + '/' + fileId;
		ensureCleanFilesHistoryState(dir);
		window.location.assign(fallbackMemoriesUrl);
		return true;
	}

	// =========================================================================
	// POZIOM 1: Rejestr akcji `@nextcloud/files` (v3 i v4), `OCA.Files.fileActions`
	//           oraz blokada `OCA.Viewer`
	// =========================================================================

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

	function syncActionPriorityProps(actionConfig) {
		if (!actionConfig) {
			return;
		}
		const target = actionConfig._action && typeof actionConfig._action === 'object' ? actionConfig._action : actionConfig;
		if (runtimeConfig.interceptDefaultClick) {
			target.default = 'default';
			target.order = -1000;
		} else {
			target.default = undefined;
			target.order = 10;
		}
	}

	function createMemoriesFileActionObject() {
		const resolveLabel = function (arg1) {
			const nodes = extractNodesFromActionArgs(arg1);
			const mediaType = nodes.length === 1 ? classifyNode(nodes[0]) : null;
			return getActionLabel(mediaType);
		};

		const actionConfig = {
			id: ACTION_ID,
			displayName: function (arg1) {
				return resolveLabel(arg1);
			},
			title: function (arg1) {
				return resolveLabel(arg1);
			},
			iconSvgInline: function () {
				return PLAY_ICON_SVG;
			},
			default: runtimeConfig.interceptDefaultClick ? 'default' : undefined,
			order: runtimeConfig.interceptDefaultClick ? -1000 : 10,
			enabled: function (arg1) {
				const nodes = extractNodesFromActionArgs(arg1);
				if (!nodes || nodes.length !== 1) {
					return false;
				}
				return isTargetNode(nodes[0]);
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

		actionConfig._action = actionConfig;
		return actionConfig;
	}

	function patchExistingViewerFileAction(actionObj) {
		if (!actionObj || actionObj.__memoriesPatched) {
			return;
		}
		const target = actionObj._action && typeof actionObj._action === 'object' ? actionObj._action : actionObj;
		const origEnabled = typeof target.enabled === 'function' ? target.enabled.bind(target) : null;
		const origExec = typeof target.exec === 'function' ? target.exec.bind(target) : null;

		const wrappedEnabled = function (arg1, arg2) {
			const nodes = extractNodesFromActionArgs(arg1);
			if (nodes.length > 0 && nodes.every(isAutoRedirectNode)) {
				return false;
			}
			return origEnabled ? origEnabled(arg1, arg2) : true;
		};

		const wrappedExec = async function (arg1, arg2, arg3) {
			const extracted = extractSingleNodeAndDirFromExecArgs(arg1, arg2, arg3);
			if (extracted.node && isAutoRedirectNode(extracted.node)) {
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

	function registerLegacyActionForMime(legacyActions, actionId, mimeKey, mediaType) {
		if (!legacyActions || typeof legacyActions.registerAction !== 'function') {
			return;
		}
		legacyActions.registerAction({
			name: actionId,
			displayName: getActionLabel(mediaType),
			mime: mimeKey,
			permissions: (window.OC && window.OC.PERMISSION_READ) ? window.OC.PERMISSION_READ : 1,
			iconClass: mediaType === 'video' ? 'icon-play' : 'icon-picture',
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
		if (runtimeConfig.interceptDefaultClick && typeof legacyActions.setDefault === 'function') {
			legacyActions.setDefault(mimeKey, actionId);
		}
	}

	function registerAndPatchFileActions() {
		const memoriesAction = createMemoriesFileActionObject();

		// 1. Obsługa @nextcloud/files v4+ (`window._nc_files_scope`)
		if (window._nc_files_scope && typeof window._nc_files_scope === 'object') {
			Object.values(window._nc_files_scope).forEach(function (scope) {
				if (!scope || typeof scope !== 'object' || !(scope.fileActions instanceof Map)) {
					return;
				}

				['view', 'viewer'].forEach(function (viewerId) {
					if (scope.fileActions.has(viewerId)) {
						patchExistingViewerFileAction(scope.fileActions.get(viewerId));
					}
				});

				if (!scope.fileActions.has(ACTION_ID)) {
					scope.fileActions.set(ACTION_ID, memoriesAction);
					if (scope.registry && typeof scope.registry.dispatchEvent === 'function') {
						try {
							scope.registry.dispatchEvent(new CustomEvent('register:action', { detail: memoriesAction }));
						} catch (_) {
							// Ignoruj
						}
					}
				} else {
					syncActionPriorityProps(scope.fileActions.get(ACTION_ID));
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
			if (existing && existing.id === ACTION_ID) {
				syncActionPriorityProps(existing);
			}
		});
		if (!window._nc_fileactions.some(function (a) { return a && a.id === ACTION_ID; })) {
			window._nc_fileactions.unshift(memoriesAction);
		}

		// 3. Obsługa klasycznego `window.OCA.Files.fileActions`
		try {
			const legacyActions = window.OCA && window.OCA.Files && window.OCA.Files.fileActions;
			if (legacyActions && typeof legacyActions.registerAction === 'function') {
				if (runtimeConfig.redirectVideos && !legacyActions.__memoriesVideoRegistered) {
					registerLegacyActionForMime(legacyActions, ACTION_ID, 'video', 'video');
					legacyActions.__memoriesVideoRegistered = true;
				}
				if (runtimeConfig.redirectPhotos && !legacyActions.__memoriesImageRegistered) {
					registerLegacyActionForMime(legacyActions, LEGACY_IMAGE_ACTION_ID, 'image', 'photo');
					legacyActions.__memoriesImageRegistered = true;
				}
			}
		} catch (_) {
			// Ignoruj błędy legacy API
		}
	}

	function hasExcludedExtensionIn(extensionSet) {
		if (!runtimeConfig.excludedExtensions || runtimeConfig.excludedExtensions.size === 0) {
			return false;
		}
		for (const ext of runtimeConfig.excludedExtensions) {
			if (extensionSet.has(ext)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Blokuje obsługę przekierowywanych typów mediów bezpośrednio w serwisie `window.OCA.Viewer`.
	 */
	function patchOCAViewerService() {
		const viewer = window.OCA && window.OCA.Viewer;
		if (!viewer) {
			return;
		}

		// 1. Usuń obsługiwane typy MIME z OCA.Viewer (jeśli opcja blockDefaultViewer jest aktywna
		//    i nie zdefiniowano wykluczonych katalogów, które nadal muszą otwierać pliki w Viewerze)
		const hasExcludedPaths = Array.isArray(runtimeConfig.excludedPaths) && runtimeConfig.excludedPaths.length > 0;
		if (runtimeConfig.blockDefaultViewer && runtimeConfig.interceptDefaultClick && !hasExcludedPaths) {
			try {
				if (Array.isArray(viewer._mimetypes)) {
					for (let i = viewer._mimetypes.length - 1; i >= 0; i--) {
						const m = String(viewer._mimetypes[i] || '').toLowerCase();
						if (classifyFileByMimeOrName(m, '') !== null) {
							viewer._mimetypes.splice(i, 1);
						}
					}
				}
				if (viewer._state && Array.isArray(viewer._state.handlers)) {
					const videoExclusions = hasExcludedExtensionIn(VIDEO_EXTENSIONS);
					const imageExclusions = hasExcludedExtensionIn(IMAGE_EXTENSIONS);
					for (let i = viewer._state.handlers.length - 1; i >= 0; i--) {
						const h = viewer._state.handlers[i];
						if (!h) {
							continue;
						}
						if (Array.isArray(h.mimes) && h.mimes.length > 0) {
							for (let j = h.mimes.length - 1; j >= 0; j--) {
								const hm = String(h.mimes[j] || '').toLowerCase();
								if (classifyFileByMimeOrName(hm, '') !== null) {
									h.mimes.splice(j, 1);
								}
							}
							if (h.mimes.length === 0) {
								viewer._state.handlers.splice(i, 1);
							}
						} else if (h.id === 'videos' && runtimeConfig.redirectVideos && !videoExclusions) {
							viewer._state.handlers.splice(i, 1);
						} else if (h.id === 'images' && runtimeConfig.redirectPhotos && !imageExclusions) {
							viewer._state.handlers.splice(i, 1);
						}
					}
				}
			} catch (_) {
				// Ignoruj
			}
		}

		// 2. Opakuj metodę `OCA.Viewer.open`
		if (typeof viewer.open === 'function' && !viewer.open.__memoriesWrapped) {
			const origOpen = viewer.open.bind(viewer);
			const wrappedOpen = function (options) {
				try {
					if (runtimeConfig.interceptDefaultClick) {
						const path = (options && options.path) || (typeof options === 'string' ? options : '');
						const fileInfo = options && options.fileInfo;
						const mime = (fileInfo && fileInfo.mime) || '';
						const name = (fileInfo && (fileInfo.basename || fileInfo.filename)) || path || '';

						if (classifyFileByMimeOrName(mime, name) !== null) {
							const infoFromDom = findTargetRowInfoByPathOrName(path, name, fileInfo && fileInfo.fileid);
							if (infoFromDom && infoFromDom.fileId && infoFromDom.shouldAutoRedirect) {
								redirectToMemories(infoFromDom);
								return;
							}
						}
					}
				} catch (_) {
					// Kontynuuj do origOpen
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
					const dir = extractCurrentDir(vueSource);
					const mediaType = classifyNode(vueSource);
					return {
						fileId: vueFileId,
						name: vueSource.basename || vueSource.name || '',
						mime: vueSource.mime || vueSource.mimetype || '',
						dir: dir,
						mtime: vueSource.mtime || null,
						mediaType: mediaType,
						isTarget: mediaType !== null,
						shouldAutoRedirect: mediaType !== null && runtimeConfig.interceptDefaultClick && !isPathExcluded(dir)
					};
				}
			}
		} catch (_) {
			// Kontynuuj do atrybutów DOM
		}

		// 2. Odczytaj z atrybutów `data-*` wiersza tabeli
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

		const dir = extractCurrentDir(null);
		const mediaType = isFolder ? null : classifyFileByMimeOrName(mime, name);

		return {
			fileId: fileId,
			name: name,
			mime: mime,
			dir: dir,
			mtime: null,
			mediaType: mediaType,
			isTarget: mediaType !== null,
			shouldAutoRedirect: mediaType !== null && runtimeConfig.interceptDefaultClick && !isPathExcluded(dir)
		};
	}

	function findTargetRowInfoByPathOrName(path, name, explicitFileId) {
		if (explicitFileId) {
			const byId = findRowInfoByFileId(explicitFileId);
			if (byId) {
				return byId;
			}
		}

		const targetBase = (name || path || '').split('/').pop();
		const rows = document.querySelectorAll('tr[data-cy-files-list-row], tr[data-id], .files-list__row, .files-grid__item');
		for (let i = 0; i < rows.length; i++) {
			const info = extractRowFileInfo(rows[i]);
			if (info && info.isTarget && (!targetBase || info.name === targetBase)) {
				return info;
			}
		}
		return null;
	}

	function findRowInfoByFileId(fileId) {
		const idStr = String(fileId);
		const selector = 'tr[data-cy-files-list-row-fileid="' + idStr + '"], '
			+ '[data-cy-files-list-row][data-cy-files-list-row-fileid="' + idStr + '"], '
			+ '.files-grid__item[data-cy-files-list-row-fileid="' + idStr + '"], '
			+ 'tr[data-id="' + idStr + '"]';
		const rowEl = document.querySelector(selector);
		if (rowEl) {
			return extractRowFileInfo(rowEl);
		}
		return null;
	}

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
			if (
				matchedControl.classList.contains('files-list__row-name')
				|| matchedControl.hasAttribute('data-cy-files-list-row-name')
				|| matchedControl.closest('[data-cy-files-list-row-name], .files-list__row-name, .files-list__row-icon')
			) {
				if (!targetEl.closest('[data-cy-files-list-row-actions], .files-list__row-actions')) {
					return false;
				}
			}
			return true;
		}
		return false;
	}

	function onDocumentClickCapture(event) {
		if (!runtimeConfig.interceptDefaultClick) {
			return;
		}
		if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
			return;
		}

		const target = event.target;
		if (!(target instanceof Element)) {
			return;
		}

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

		const clickedOpenArea = target.closest(
			'[data-cy-files-list-row-name], .files-list__row-name, .files-list__row-icon, .nametext, .thumbnail, .files-grid__item'
		);
		if (!clickedOpenArea) {
			return;
		}

		const info = extractRowFileInfo(rowEl);
		if (!info || !info.shouldAutoRedirect || !info.fileId) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		if (typeof event.stopImmediatePropagation === 'function') {
			event.stopImmediatePropagation();
		}

		redirectToMemories(info);
	}

	function inspectUrlForTargetOpenFile(rawUrl) {
		if (!rawUrl || !runtimeConfig.interceptDefaultClick) {
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
			if (!rowInfo || !rowInfo.shouldAutoRedirect) {
				return null;
			}

			const dir = parsed.searchParams.get('dir') || rowInfo.dir || '/';
			if (isPathExcluded(dir)) {
				return null;
			}

			const cleanUrl = new URL(parsed.toString());
			cleanUrl.searchParams.delete('openfile');
			cleanUrl.searchParams.delete('editing');
			cleanUrl.pathname = cleanUrl.pathname.replace(/(\/apps\/files\/[^/]+)\/\d+\/?$/, '$1');

			return {
				fileId: fileId,
				dir: dir,
				name: rowInfo.name || '',
				mtime: rowInfo.mtime || null,
				cleanUrl: cleanUrl.toString()
			};
		} catch (_) {
			return null;
		}
	}

	function installHistoryInterceptors() {
		window.history.pushState = function (state, title, url) {
			const match = inspectUrlForTargetOpenFile(url);
			if (match) {
				originalReplaceState(state, title, match.cleanUrl);
				abortDefaultViewerAndMediaDownload();
				redirectToMemories(match);
				return;
			}
			return originalPushState(state, title, url);
		};

		window.history.replaceState = function (state, title, url) {
			const match = inspectUrlForTargetOpenFile(url);
			if (match) {
				originalReplaceState(state, title, match.cleanUrl);
				abortDefaultViewerAndMediaDownload();
				redirectToMemories(match);
				return;
			}
			return originalReplaceState(state, title, url);
		};
	}

	function checkInitialUrlForTargetOpenFile() {
		if (!window.location.search.includes('openfile')) {
			return;
		}
		const match = inspectUrlForTargetOpenFile(window.location.href);
		if (match) {
			originalReplaceState(window.history.state, document.title, match.cleanUrl);
			abortDefaultViewerAndMediaDownload();
			redirectToMemories(match);
		}
	}

	function init() {
		refreshRuntimeConfigFromInitialState();
		registerAndPatchFileActions();
		patchOCAViewerService();
		installHistoryInterceptors();

		document.addEventListener('click', onDocumentClickCapture, true);
		document.addEventListener('dblclick', onDocumentClickCapture, true);

		const syncHooks = function () {
			refreshRuntimeConfigFromInitialState();
			registerAndPatchFileActions();
			patchOCAViewerService();
			checkInitialUrlForTargetOpenFile();
		};

		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', syncHooks);
		} else {
			syncHooks();
		}

		window.addEventListener('load', syncHooks);
		setTimeout(syncHooks, 300);
		setTimeout(syncHooks, 1200);

		if (typeof MutationObserver !== 'undefined') {
			let debounceTimer = null;
			const observer = new MutationObserver(function () {
				if (debounceTimer) {
					return;
				}
				debounceTimer = setTimeout(function () {
					debounceTimer = null;
					refreshRuntimeConfigFromInitialState();
					registerAndPatchFileActions();
					patchOCAViewerService();
					if (window.location.search.includes('openfile')) {
						checkInitialUrlForTargetOpenFile();
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
