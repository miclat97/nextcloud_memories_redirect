<?php

declare(strict_types=1);

namespace OCA\MemoriesVideoRedirect\Controller;

use OCA\MemoriesVideoRedirect\AppInfo\Application;
use OCA\MemoriesVideoRedirect\Service\ConfigService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\RedirectResponse;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\Files\NotFoundException;
use OCP\IConfig;
use OCP\IDBConnection;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUserSession;
use Psr\Log\LoggerInterface;

class RedirectController extends Controller {
	public function __construct(
		IRequest $request,
		private IUserSession $userSession,
		private IRootFolder $rootFolder,
		private IDBConnection $db,
		private IConfig $config,
		private IURLGenerator $urlGenerator,
		private LoggerInterface $logger,
		private ConfigService $configService,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	/**
	 * Endpoint JSON: weryfikuje indeksację pliku w Memories (w razie potrzeby
	 * wywołuje wewnętrzny indekser Memories w locie) i zwraca docelowy URL w Memories.
	 *
	 * @NoAdminRequired
	 * @NoCSRFRequired
	 */
	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function resolve(int $fileId, ?string $dir = null, ?string $name = null): JSONResponse {
		try {
			$result = $this->resolveTarget($fileId, $dir, $name);
			return new JSONResponse($result, Http::STATUS_OK);
		} catch (NotFoundException $e) {
			return new JSONResponse([
				'error' => 'Nie znaleziono pliku.',
				'fileId' => $fileId,
			], Http::STATUS_NOT_FOUND);
		} catch (\Throwable $e) {
			$this->logger->error('Błąd podczas przygotowywania przekierowania do Memories dla fileId=' . $fileId . ': ' . $e->getMessage(), [
				'app' => Application::APP_ID,
				'exception' => $e,
			]);
			// Nawet w przypadku nieoczekiwanego błędu zwracamy bezpieczny URL awaryjny do Memories
			$fallbackDayId = (int) floor(time() / 86400);
			$fallbackUrl = $this->buildMemoriesFallbackUrl($fileId, $fallbackDayId);
			return new JSONResponse([
				'url' => $fallbackUrl,
				'fileId' => $fileId,
				'dayId' => $fallbackDayId,
				'indexed' => false,
				'mode' => 'fallback',
			], Http::STATUS_OK);
		}
	}

	/**
	 * Endpoint bezpośredniego przekierowania HTTP 302: indeksuje plik w locie (jeśli trzeba)
	 * i od razu przekierowuje przeglądarkę do Memories.
	 *
	 * @NoAdminRequired
	 * @NoCSRFRequired
	 */
	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function open(int $fileId, ?string $dir = null, ?string $name = null): RedirectResponse {
		try {
			$result = $this->resolveTarget($fileId, $dir, $name);
			return new RedirectResponse($result['url']);
		} catch (\Throwable $e) {
			$this->logger->warning('Przekierowanie awaryjne do Memories dla fileId=' . $fileId . ': ' . $e->getMessage(), [
				'app' => Application::APP_ID,
			]);
			$fallbackDayId = (int) floor(time() / 86400);
			return new RedirectResponse($this->buildMemoriesFallbackUrl($fileId, $fallbackDayId));
		}
	}

	/**
	 * Buduje strukturę `single_item` dla stanu początkowego Memories (używane, gdy plik
	 * znajduje się poza `foldersPath` użytkownika lub gdy exiftool nie dodał rekordu do `oc_memories`).
	 *
	 * @return array<string, mixed>|null
	 */
	public function buildSingleItemPayload(int $fileId): ?array {
		$user = $this->userSession->getUser();
		if ($user === null) {
			return null;
		}

		// 1. Jeśli dostępny jest serwis TimelineQuery z Memories i plik jest w oc_memories, użyj go bezpośrednio
		if (class_exists(\OCA\Memories\Db\TimelineQuery::class)) {
			try {
				/** @var \OCA\Memories\Db\TimelineQuery $timelineQuery */
				$timelineQuery = \OCP\Server::get(\OCA\Memories\Db\TimelineQuery::class);
				if (method_exists($timelineQuery, 'getSingleItem')) {
					$item = $timelineQuery->getSingleItem($fileId);
					if (is_array($item) && isset($item['fileid'])) {
						return $item;
					}
				}
			} catch (\Throwable $e) {
				// Kontynuuj do ręcznego zbudowania metadanych z obiektu File
			}
		}

		// 2. Pobierz plik z systemu plików Nextcloud i zbuduj payload kompatybilny z IPhoto w Memories
		try {
			$userFolder = $this->rootFolder->getUserFolder($user->getUID());
			$file = $this->findUserFile($userFolder, $fileId, null, null);
		} catch (\Throwable $e) {
			return null;
		}

		if ($file === null) {
			return null;
		}

		$row = $this->queryMemoriesRow($fileId);
		if (
			$this->configService->isOnTheFlyIndexingEnabled()
			&& ($row === null || (int) ($row['orphan'] ?? 0) !== 0)
		) {
			$this->indexFileInMemoriesOnTheFly($file);
			$row = $this->queryMemoriesRow($fileId);
		}

		$mtime = (int) $file->getMTime();
		$dayId = (isset($row['dayid']) && (int) $row['dayid'] > 0)
			? (int) $row['dayid']
			: (int) floor(($mtime > 0 ? $mtime : time()) / 86400);

		$isVideo = $this->detectIsVideo($file, $row);

		return [
			'fileid' => $fileId,
			'dayid' => $dayId,
			'w' => isset($row['w']) && (int) $row['w'] > 0 ? (int) $row['w'] : 1920,
			'h' => isset($row['h']) && (int) $row['h'] > 0 ? (int) $row['h'] : 1080,
			'Simple.LivePhotoFileId' => null,
			'isvideo' => $isVideo ? 1 : 0,
			'video_duration' => ($isVideo && isset($row['video_duration'])) ? (int) $row['video_duration'] : null,
			'flag' => 0,
			'pano' => 0,
			'etag' => $file->getEtag(),
			'basename' => $file->getName(),
			'size' => $file->getSize(),
			'epoch' => $mtime,
			'mimetype' => $file->getMimeType(),
			'auid' => $user->getUID(),
			'permissions' => $file->isUpdateable() ? 'RGDNVW' : 'RGD',
		];
	}

	/**
	 * Główna logika: znajduje plik, sprawdza obecność w `oc_memories`, w razie potrzeby
	 * indeksuje go w locie i wyznacza dokładny URL do Memories.
	 *
	 * @return array{url: string, fileId: int, dayId: int, indexed: bool, mode: string, path: string}
	 * @throws NotFoundException
	 */
	private function resolveTarget(int $fileId, ?string $dir, ?string $name): array {
		$user = $this->userSession->getUser();
		if ($user === null) {
			throw new NotFoundException('Brak zalogowanego użytkownika.');
		}

		$uid = $user->getUID();
		$userFolder = $this->rootFolder->getUserFolder($uid);
		$file = $this->findUserFile($userFolder, $fileId, $dir, $name);

		if ($file === null) {
			throw new NotFoundException('Nie znaleziono pliku o ID ' . $fileId);
		}

		$actualFileId = (int) $file->getId();
		$mtime = (int) $file->getMTime();

		// 1. Sprawdź czy plik jest już zaindeksowany i aktualny w tabeli oc_memories
		$row = $this->queryMemoriesRow($actualFileId);
		$needsIndexing = (
			$row === null
			|| (int) ($row['orphan'] ?? 0) !== 0
			|| (isset($row['mtime']) && (int) $row['mtime'] > 0 && (int) $row['mtime'] !== $mtime)
		);

		if ($needsIndexing && $this->configService->isOnTheFlyIndexingEnabled()) {
			$this->indexFileInMemoriesOnTheFly($file);
			$row = $this->queryMemoriesRow($actualFileId);
		}

		$isIndexed = ($row !== null && (int) ($row['orphan'] ?? 0) === 0 && (int) ($row['dayid'] ?? 0) > 0);
		$dayId = $isIndexed
			? (int) $row['dayid']
			: (int) floor(($mtime > 0 ? $mtime : time()) / 86400);

		// 2. Wyznacz ścieżkę katalogu pliku względem katalogu głównego użytkownika (/uid/files)
		$userRootPath = rtrim($userFolder->getPath(), '/');
		$parentPath = $file->getParent()->getPath();
		$relFolder = '/';
		if (str_starts_with($parentPath, $userRootPath)) {
			$relFolder = substr($parentPath, strlen($userRootPath));
		}
		$relFolder = $this->normalizeSlashPath($relFolder);

		// 3. Sprawdź skonfigurowany w Memories katalog bazowy dla widoku Folderów (`foldersPath`, domyślnie `/`)
		$foldersPathRaw = $this->config->getUserValue($uid, 'memories', 'foldersPath', '/');
		$foldersPath = $this->normalizeSlashPath($foldersPathRaw !== '' ? $foldersPathRaw : '/');

		// 4. Jeśli plik jest zaindeksowany i mieści się w `foldersPath`, kierujemy do widoku katalogu w Memories
		//    z fragmentem `#v/<dayId>/<fileId>` oraz `?sort=timeline&noinit=1`
		if ($isIndexed && str_starts_with($relFolder, $foldersPath)) {
			$subPath = ltrim(substr($relFolder, strlen($foldersPath)), '/');
			$subPath = rtrim($subPath, '/');
			$url = $this->buildMemoriesFolderUrl($subPath, $dayId, $actualFileId);
			return [
				'url' => $url,
				'fileId' => $actualFileId,
				'dayId' => $dayId,
				'indexed' => true,
				'mode' => 'folders',
				'path' => rtrim($relFolder, '/') . '/' . $file->getName(),
			];
		}

		// 5. Fallback: jeśli plik leży poza `foldersPath` lub exiftool nie zapisał go w `oc_memories`
		if ($this->configService->isSingleItemFallbackEnabled()) {
			$url = $this->buildMemoriesFallbackUrl($actualFileId, $dayId);
			return [
				'url' => $url,
				'fileId' => $actualFileId,
				'dayId' => $dayId,
				'indexed' => $isIndexed,
				'mode' => 'single_item',
				'path' => rtrim($relFolder, '/') . '/' . $file->getName(),
			];
		}

		if (str_starts_with($relFolder, $foldersPath)) {
			$subPath = ltrim(substr($relFolder, strlen($foldersPath)), '/');
			$subPath = rtrim($subPath, '/');
			return [
				'url' => $this->buildMemoriesFolderUrl($subPath, $dayId, $actualFileId),
				'fileId' => $actualFileId,
				'dayId' => $dayId,
				'indexed' => $isIndexed,
				'mode' => 'folders',
				'path' => rtrim($relFolder, '/') . '/' . $file->getName(),
			];
		}

		return [
			'url' => $this->buildMemoriesBaseIndexUrl() . '?sort=timeline&noinit=1#v/' . $dayId . '/' . $actualFileId,
			'fileId' => $actualFileId,
			'dayId' => $dayId,
			'indexed' => $isIndexed,
			'mode' => 'timeline',
			'path' => rtrim($relFolder, '/') . '/' . $file->getName(),
		];
	}

	/**
	 * Ustala, czy plik jest wideo (na podstawie rekordu oc_memories, typu MIME lub rozszerzenia).
	 *
	 * @param array<string, mixed>|null $row
	 */
	private function detectIsVideo(File $file, ?array $row): bool {
		if ($row !== null && isset($row['isvideo'])) {
			return (int) $row['isvideo'] === 1;
		}
		$mime = strtolower((string) $file->getMimeType());
		if (str_starts_with($mime, 'video/')) {
			return true;
		}
		$ext = strtolower(pathinfo($file->getName(), PATHINFO_EXTENSION));
		return $ext !== '' && in_array($ext, ConfigService::DEFAULT_VIDEO_EXTENSIONS, true);
	}

	/**
	 * Wyszukuje obiekt File użytkownika po fileId (lub opcjonalnie po ścieżce dir + name).
	 */
	private function findUserFile(Folder $userFolder, int $fileId, ?string $dir, ?string $name): ?File {
		try {
			$nodes = $userFolder->getById($fileId);
			if (count($nodes) > 0) {
				// Jeśli przekazano katalog $dir, preferuj węzeł znajdujący się w tym katalogu
				if ($dir !== null && $dir !== '') {
					$normalizedDir = '/' . trim($dir, '/');
					foreach ($nodes as $node) {
						if ($node instanceof File) {
							$rel = $userFolder->getRelativePath($node->getParent()->getPath());
							if ($rel !== null && rtrim($rel, '/') === rtrim($normalizedDir, '/')) {
								return $node;
							}
						}
					}
				}
				foreach ($nodes as $node) {
					if ($node instanceof File) {
						return $node;
					}
				}
			}
		} catch (\Throwable $e) {
			// Kontynuuj do wyszukiwania po ścieżce
		}

		if ($dir !== null && $name !== null && $name !== '') {
			$cleanPath = trim($dir, '/') . '/' . ltrim($name, '/');
			try {
				$node = $userFolder->get('/' . ltrim($cleanPath, '/'));
				if ($node instanceof File) {
					return $node;
				}
			} catch (\Throwable $e) {
				return null;
			}
		}

		return null;
	}

	/**
	 * Pobiera wiersz metadanych z tabeli `oc_memories` dla podanego `fileId`.
	 *
	 * @return array<string, mixed>|null
	 */
	private function queryMemoriesRow(int $fileId): ?array {
		try {
			$qb = $this->db->getQueryBuilder();
			$qb->select('fileid', 'dayid', 'mtime', 'orphan', 'isvideo', 'video_duration', 'w', 'h')
				->from('memories')
				->where($qb->expr()->eq('fileid', $qb->createNamedParameter($fileId, IQueryBuilder::PARAM_INT)))
				->setMaxResults(1);

			$result = $qb->executeQuery();
			$row = $result->fetchAssociative();
			$result->closeCursor();

			return is_array($row) ? $row : null;
		} catch (\Throwable $e) {
			// Tabela oc_memories może nie istnieć, jeśli Memories nie zostało jeszcze zainstalowane
			return null;
		}
	}

	/**
	 * Wywołuje wewnętrzny serwis indeksowania `OCA\Memories\Service\Index::indexFile()` w locie.
	 * Przekazanie `$force = true` wymusza indeksację nawet wtedy, gdy użytkownik wyłączył
	 * `live_index` lub w katalogu znajduje się plik `.nomedia`.
	 */
	private function indexFileInMemoriesOnTheFly(File $file): void {
		if (!class_exists(\OCA\Memories\Service\Index::class)) {
			return;
		}

		try {
			/** @var \OCA\Memories\Service\Index $indexer */
			$indexer = \OCP\Server::get(\OCA\Memories\Service\Index::class);
			if (method_exists($indexer, 'indexFile')) {
				$indexer->indexFile($file, false, true);
			}
		} catch (\Throwable $e) {
			$this->logger->debug('Indeksacja w locie w Memories nie powiodła się dla fileId=' . $file->getId() . ': ' . $e->getMessage(), [
				'app' => Application::APP_ID,
			]);
		}
	}

	/**
	 * Buduje docelowy adres URL widoku katalogu w Memories:
	 * `/apps/memories/folders/<relPath>?sort=timeline&noinit=1#v/<dayId>/<fileId>`
	 */
	private function buildMemoriesFolderUrl(string $subPath, int $dayId, int $fileId): string {
		$encodedSegments = [];
		if ($subPath !== '') {
			foreach (explode('/', $subPath) as $segment) {
				if ($segment !== '') {
					$encodedSegments[] = rawurlencode($segment);
				}
			}
		}
		$encodedPath = implode('/', $encodedSegments);

		try {
			$baseFoldersUrl = $this->urlGenerator->linkToRoute('memories.Page.folder', ['path' => '']);
			// Usuń ewentualny query string z bazowego URL-a
			$qPos = strpos($baseFoldersUrl, '?');
			if ($qPos !== false) {
				$baseFoldersUrl = substr($baseFoldersUrl, 0, $qPos);
			}
			$baseFoldersUrl = rtrim($baseFoldersUrl, '/') . '/';
		} catch (\Throwable $e) {
			$baseFoldersUrl = $this->urlGenerator->linkToRoute('files.view.index');
			$baseFoldersUrl = preg_replace('#/apps/files/.*$#', '/apps/memories/folders/', $baseFoldersUrl)
				?: '/index.php/apps/memories/folders/';
		}

		return $baseFoldersUrl . $encodedPath . '?sort=timeline&noinit=1#v/' . $dayId . '/' . $fileId;
	}

	private function buildMemoriesBaseIndexUrl(): string {
		try {
			$baseIndexUrl = $this->urlGenerator->linkToRoute('memories.Page.index');
			$qPos = strpos($baseIndexUrl, '?');
			if ($qPos !== false) {
				$baseIndexUrl = substr($baseIndexUrl, 0, $qPos);
			}
			return rtrim($baseIndexUrl, '/') . '/';
		} catch (\Throwable $e) {
			return '/index.php/apps/memories/';
		}
	}

	/**
	 * Buduje awaryjny adres URL do Memories wykorzystujący mechanizm `single_item`:
	 * `/apps/memories/?sort=timeline&noinit=1&memories_redirect_fileid=<fileId>#v/<dayId>/<fileId>`
	 */
	private function buildMemoriesFallbackUrl(int $fileId, int $dayId): string {
		return $this->buildMemoriesBaseIndexUrl()
			. '?sort=timeline&noinit=1&memories_redirect_fileid=' . $fileId
			. '#v/' . $dayId . '/' . $fileId;
	}

	/**
	 * Normalizuje ścieżkę tak, aby zaczynała się i kończyła pojedynczym znakiem `/`.
	 */
	private function normalizeSlashPath(string $path): string {
		$clean = preg_replace('#/+#', '/', '/' . trim($path, '/') . '/') ?? '/';
		return $clean === '//' ? '/' : $clean;
	}
}
