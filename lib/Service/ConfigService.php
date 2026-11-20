<?php

declare(strict_types=1);

namespace OCA\MemoriesVideoRedirect\Service;

use OCA\MemoriesVideoRedirect\AppInfo\Application;
use OCP\App\IAppManager;
use OCP\IConfig;
use OCP\IDBConnection;

class ConfigService {
	public const KEY_REDIRECT_VIDEOS = 'redirect_videos';
	public const KEY_REDIRECT_PHOTOS = 'redirect_photos';
	public const KEY_CUSTOM_EXTENSIONS = 'custom_extensions';
	public const KEY_EXCLUDED_EXTENSIONS = 'excluded_extensions';
	public const KEY_INTERCEPT_DEFAULT_CLICK = 'intercept_default_click';
	public const KEY_BLOCK_DEFAULT_VIEWER = 'block_default_viewer';
	public const KEY_ON_THE_FLY_INDEXING = 'on_the_fly_indexing';
	public const KEY_ENABLE_SINGLE_ITEM_FALLBACK = 'enable_single_item_fallback';
	public const KEY_EXCLUDED_PATHS = 'excluded_paths';
	public const KEY_CUSTOM_ACTION_LABEL = 'custom_action_label';

	public const ALL_KEYS = [
		self::KEY_REDIRECT_VIDEOS,
		self::KEY_REDIRECT_PHOTOS,
		self::KEY_CUSTOM_EXTENSIONS,
		self::KEY_EXCLUDED_EXTENSIONS,
		self::KEY_INTERCEPT_DEFAULT_CLICK,
		self::KEY_BLOCK_DEFAULT_VIEWER,
		self::KEY_ON_THE_FLY_INDEXING,
		self::KEY_ENABLE_SINGLE_ITEM_FALLBACK,
		self::KEY_EXCLUDED_PATHS,
		self::KEY_CUSTOM_ACTION_LABEL,
	];

	public const DEFAULT_EXCLUDED_EXTENSIONS = 'svg, svgz';

	/**
	 * Domyślne rozszerzenia wideo używane m.in. przy rozpoznawaniu typu w backendzie.
	 *
	 * @var string[]
	 */
	public const DEFAULT_VIDEO_EXTENSIONS = [
		'mp4', 'mkv', 'mov', 'webm', 'avi', 'ts', 'm2ts', 'mts',
		'm4v', '3gp', '3g2', 'ogv', 'ogg', 'flv', 'wmv', 'mpg',
		'mpeg', 'vob', 'divx', 'asf', 'rmvb', 'f4v',
	];

	/**
	 * Domyślne rozszerzenia zdjęć używane informacyjnie i w podglądzie panelu admina.
	 *
	 * @var string[]
	 */
	public const DEFAULT_IMAGE_EXTENSIONS = [
		'jpg', 'jpeg', 'jpe', 'jfif', 'png', 'gif', 'webp',
		'heic', 'heif', 'avif', 'jxl', 'bmp', 'dib',
		'tif', 'tiff', 'ico', 'cur',
		'dng', 'raw', 'cr2', 'cr3', 'nef', 'nrw', 'arw', 'srf', 'sr2',
		'orf', 'rw2', 'raf', 'pef', 'srw', 'x3f', '3fr', 'erf', 'kdc', 'mrw',
		'svg', 'svgz',
	];

	public function __construct(
		private IConfig $config,
		private IAppManager $appManager,
		private IDBConnection $db,
	) {
	}

	public function isRedirectVideosEnabled(): bool {
		return $this->getBool(self::KEY_REDIRECT_VIDEOS, true);
	}

	public function isRedirectPhotosEnabled(): bool {
		return $this->getBool(self::KEY_REDIRECT_PHOTOS, true);
	}

	public function isInterceptDefaultClickEnabled(): bool {
		return $this->getBool(self::KEY_INTERCEPT_DEFAULT_CLICK, true);
	}

	public function isBlockDefaultViewerEnabled(): bool {
		return $this->getBool(self::KEY_BLOCK_DEFAULT_VIEWER, true);
	}

	public function isOnTheFlyIndexingEnabled(): bool {
		return $this->getBool(self::KEY_ON_THE_FLY_INDEXING, true);
	}

	public function isSingleItemFallbackEnabled(): bool {
		return $this->getBool(self::KEY_ENABLE_SINGLE_ITEM_FALLBACK, true);
	}

	/**
	 * @return string[]
	 */
	public function getCustomExtensions(): array {
		$raw = $this->config->getAppValue(Application::APP_ID, self::KEY_CUSTOM_EXTENSIONS, '');
		return $this->parseExtensionList($raw);
	}

	public function getCustomExtensionsRaw(): string {
		return implode(', ', $this->getCustomExtensions());
	}

	/**
	 * @return string[]
	 */
	public function getExcludedExtensions(): array {
		$raw = $this->config->getAppValue(
			Application::APP_ID,
			self::KEY_EXCLUDED_EXTENSIONS,
			self::DEFAULT_EXCLUDED_EXTENSIONS
		);
		return $this->parseExtensionList($raw);
	}

	public function getExcludedExtensionsRaw(): string {
		return implode(', ', $this->getExcludedExtensions());
	}

	/**
	 * @return string[]
	 */
	public function getExcludedPaths(): array {
		$raw = $this->config->getAppValue(Application::APP_ID, self::KEY_EXCLUDED_PATHS, '');
		return $this->parsePathList($raw);
	}

	public function getExcludedPathsRaw(): string {
		return implode("\n", $this->getExcludedPaths());
	}

	public function getCustomActionLabel(): string {
		return trim($this->config->getAppValue(Application::APP_ID, self::KEY_CUSTOM_ACTION_LABEL, ''));
	}

	/**
	 * Zwraca konfigurację przekazywaną do skryptu frontendowego (IInitialState).
	 *
	 * @return array<string, mixed>
	 */
	public function getFrontendConfig(): array {
		return [
			'redirectVideos' => $this->isRedirectVideosEnabled(),
			'redirectPhotos' => $this->isRedirectPhotosEnabled(),
			'customExtensions' => $this->getCustomExtensions(),
			'excludedExtensions' => $this->getExcludedExtensions(),
			'interceptDefaultClick' => $this->isInterceptDefaultClickEnabled(),
			'blockDefaultViewer' => $this->isBlockDefaultViewerEnabled(),
			'onTheFlyIndexing' => $this->isOnTheFlyIndexingEnabled(),
			'enableSingleItemFallback' => $this->isSingleItemFallbackEnabled(),
			'excludedPaths' => $this->getExcludedPaths(),
			'customActionLabel' => $this->getCustomActionLabel(),
		];
	}

	/**
	 * Zwraca bieżące wartości formularza administratora.
	 *
	 * @return array<string, mixed>
	 */
	public function getAdminSettings(): array {
		return [
			'redirectVideos' => $this->isRedirectVideosEnabled(),
			'redirectPhotos' => $this->isRedirectPhotosEnabled(),
			'customExtensions' => $this->getCustomExtensionsRaw(),
			'excludedExtensions' => $this->getExcludedExtensionsRaw(),
			'interceptDefaultClick' => $this->isInterceptDefaultClickEnabled(),
			'blockDefaultViewer' => $this->isBlockDefaultViewerEnabled(),
			'onTheFlyIndexing' => $this->isOnTheFlyIndexingEnabled(),
			'enableSingleItemFallback' => $this->isSingleItemFallbackEnabled(),
			'excludedPaths' => $this->getExcludedPathsRaw(),
			'customActionLabel' => $this->getCustomActionLabel(),
		];
	}

	/**
	 * Zapisuje ustawienia przesłane z panelu administratora.
	 *
	 * @param array<string, mixed> $input
	 * @return array<string, mixed>
	 */
	public function saveAdminSettings(array $input): array {
		if (array_key_exists('redirectVideos', $input)) {
			$this->setBool(self::KEY_REDIRECT_VIDEOS, $this->normalizeBool($input['redirectVideos'], true));
		}
		if (array_key_exists('redirectPhotos', $input)) {
			$this->setBool(self::KEY_REDIRECT_PHOTOS, $this->normalizeBool($input['redirectPhotos'], true));
		}
		if (array_key_exists('customExtensions', $input)) {
			$extensions = $this->parseExtensionList((string) $input['customExtensions']);
			$this->config->setAppValue(Application::APP_ID, self::KEY_CUSTOM_EXTENSIONS, implode(', ', $extensions));
		}
		if (array_key_exists('excludedExtensions', $input)) {
			$excluded = $this->parseExtensionList((string) $input['excludedExtensions']);
			$this->config->setAppValue(Application::APP_ID, self::KEY_EXCLUDED_EXTENSIONS, implode(', ', $excluded));
		}
		if (array_key_exists('interceptDefaultClick', $input)) {
			$this->setBool(self::KEY_INTERCEPT_DEFAULT_CLICK, $this->normalizeBool($input['interceptDefaultClick'], true));
		}
		if (array_key_exists('blockDefaultViewer', $input)) {
			$this->setBool(self::KEY_BLOCK_DEFAULT_VIEWER, $this->normalizeBool($input['blockDefaultViewer'], true));
		}
		if (array_key_exists('onTheFlyIndexing', $input)) {
			$this->setBool(self::KEY_ON_THE_FLY_INDEXING, $this->normalizeBool($input['onTheFlyIndexing'], true));
		}
		if (array_key_exists('enableSingleItemFallback', $input)) {
			$this->setBool(self::KEY_ENABLE_SINGLE_ITEM_FALLBACK, $this->normalizeBool($input['enableSingleItemFallback'], true));
		}
		if (array_key_exists('excludedPaths', $input)) {
			$paths = $this->parsePathList((string) $input['excludedPaths']);
			$this->config->setAppValue(Application::APP_ID, self::KEY_EXCLUDED_PATHS, implode("\n", $paths));
		}
		if (array_key_exists('customActionLabel', $input)) {
			$label = mb_substr(trim((string) $input['customActionLabel']), 0, 80);
			$this->config->setAppValue(Application::APP_ID, self::KEY_CUSTOM_ACTION_LABEL, $label);
		}

		return $this->getAdminSettings();
	}

	/**
	 * Przywraca wszystkie ustawienia do wartości domyślnych.
	 *
	 * @return array<string, mixed>
	 */
	public function resetToDefaults(): array {
		foreach (self::ALL_KEYS as $key) {
			$this->config->deleteAppValue(Application::APP_ID, $key);
		}
		return $this->getAdminSettings();
	}

	/**
	 * Zwraca informacje diagnostyczne o integracji z aplikacją Memories.
	 *
	 * @return array<string, mixed>
	 */
	public function getDiagnostics(): array {
		$memoriesInstalled = false;
		$memoriesEnabled = false;
		try {
			$memoriesInstalled = $this->appManager->isInstalled('memories');
			$memoriesEnabled = $this->appManager->isEnabledForUser('memories');
		} catch (\Throwable $e) {
			$memoriesInstalled = class_exists(\OCA\Memories\AppInfo\Application::class);
			$memoriesEnabled = $memoriesInstalled;
		}

		$indexServiceAvailable = class_exists(\OCA\Memories\Service\Index::class);
		$timelineQueryAvailable = class_exists(\OCA\Memories\Db\TimelineQuery::class);

		$tableExists = false;
		$indexedCount = null;
		try {
			$qb = $this->db->getQueryBuilder();
			$qb->select($qb->func()->count('*', 'cnt'))
				->from('memories')
				->where($qb->expr()->eq('orphan', $qb->createNamedParameter(0)));
			$result = $qb->executeQuery();
			$countRow = $result->fetchAssociative();
			$result->closeCursor();
			$tableExists = true;
			$indexedCount = isset($countRow['cnt']) ? (int) $countRow['cnt'] : 0;
		} catch (\Throwable $e) {
			$tableExists = false;
			$indexedCount = null;
		}

		return [
			'memoriesInstalled' => $memoriesInstalled,
			'memoriesEnabled' => $memoriesEnabled,
			'indexServiceAvailable' => $indexServiceAvailable,
			'timelineQueryAvailable' => $timelineQueryAvailable,
			'memoriesTableExists' => $tableExists,
			'indexedCount' => $indexedCount,
		];
	}

	private function getBool(string $key, bool $default): bool {
		$raw = $this->config->getAppValue(Application::APP_ID, $key, $default ? '1' : '0');
		return $this->normalizeBool($raw, $default);
	}

	private function setBool(string $key, bool $value): void {
		$this->config->setAppValue(Application::APP_ID, $key, $value ? '1' : '0');
	}

	private function normalizeBool(mixed $value, bool $default): bool {
		if (is_bool($value)) {
			return $value;
		}
		if (is_int($value) || is_float($value)) {
			return ((int) $value) !== 0;
		}
		if (is_string($value)) {
			$parsed = filter_var(trim($value), FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
			if ($parsed !== null) {
				return $parsed;
			}
		}
		return $default;
	}

	/**
	 * Parsuje listę rozszerzeń z tekstu (oddzielonych przecinkiem, średnikiem, spacją lub nową linią).
	 *
	 * @return string[]
	 */
	private function parseExtensionList(string $raw): array {
		$parts = preg_split('/[\s,;]+/', strtolower($raw), -1, PREG_SPLIT_NO_EMPTY);
		if (!is_array($parts)) {
			return [];
		}

		$result = [];
		$seen = [];
		foreach ($parts as $part) {
			$clean = ltrim(trim($part), '.');
			$clean = preg_replace('/[^a-z0-9_+.-]/', '', $clean) ?? '';
			$clean = trim($clean, '.');
			if ($clean !== '' && !isset($seen[$clean])) {
				$seen[$clean] = true;
				$result[] = $clean;
			}
		}

		return $result;
	}

	/**
	 * Parsuje listę wykluczonych ścieżek katalogów.
	 *
	 * @return string[]
	 */
	private function parsePathList(string $raw): array {
		$lines = preg_split('/[\r\n,;]+/', $raw, -1, PREG_SPLIT_NO_EMPTY);
		if (!is_array($lines)) {
			return [];
		}

		$result = [];
		$seen = [];
		foreach ($lines as $line) {
			$trimmed = trim($line);
			if ($trimmed === '') {
				continue;
			}
			$normalized = preg_replace('#/+#', '/', '/' . trim($trimmed, '/')) ?? '/';
			if ($normalized === '') {
				$normalized = '/';
			}
			if (!isset($seen[$normalized])) {
				$seen[$normalized] = true;
				$result[] = $normalized;
			}
		}

		return $result;
	}
}
