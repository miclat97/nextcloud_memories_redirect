<?php

declare(strict_types=1);

namespace OCA\MemoriesVideoRedirect\Listener;

use OCA\Files\Event\LoadAdditionalScriptsEvent;
use OCA\MemoriesVideoRedirect\AppInfo\Application;
use OCA\MemoriesVideoRedirect\Controller\RedirectController;
use OCA\MemoriesVideoRedirect\Service\ConfigService;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\IInitialStateService;
use OCP\IRequest;
use OCP\Util;

/**
 * @template-implements IEventListener<Event>
 */
class LoadScriptsListener implements IEventListener {
	private static bool $scriptAdded = false;
	private static bool $configStateAdded = false;

	public function __construct(
		private IRequest $request,
		private IInitialStateService $initialState,
		private RedirectController $redirectController,
		private ConfigService $configService,
	) {
	}

	public function handle(Event $event): void {
		if ($event instanceof LoadAdditionalScriptsEvent) {
			$this->addRedirectScript();
			return;
		}

		if ($event instanceof BeforeTemplateRenderedEvent) {
			if (!$event->isLoggedIn()) {
				return;
			}

			$pathInfo = (string) ($this->request->getPathInfo() ?? '');
			$requestUri = (string) ($this->request->getRequestUri() ?? '');

			// 1. Dodatkowe zabezpieczenie: załaduj skrypt również gdy widok Plików nie wyemituje LoadAdditionalScriptsEvent
			if (
				str_contains($pathInfo, '/apps/files')
				|| str_contains($requestUri, '/apps/files')
			) {
				$this->addRedirectScript();
			}

			// 2. Tryb awaryjny (fallback) dla plików spoza skonfigurowanego foldersPath w Memories
			// lub plików, których exiftool nie zdołał zapisać w oc_memories:
			// wstrzykujemy stan początkowy `single_item` bezpośrednio do widoku Memories.
			$rawFileId = $this->request->getParam('memories_redirect_fileid')
				?? $this->request->getParam('memories_video_fileid');
			if (
				$rawFileId !== null
				&& ctype_digit((string) $rawFileId)
				&& $this->configService->isSingleItemFallbackEnabled()
			) {
				$fileId = (int) $rawFileId;
				if ($fileId > 0) {
					$singleItem = $this->redirectController->buildSingleItemPayload($fileId);
					if ($singleItem !== null) {
						try {
							$this->initialState->provideInitialState('memories', 'single_item', $singleItem);
						} catch (\Throwable $e) {
							// Ignoruj błędy stanu początkowego
						}
					}
					$this->addRedirectScript();
				}
			}
		}
	}

	private function addRedirectScript(): void {
		if (!self::$configStateAdded) {
			self::$configStateAdded = true;
			try {
				$this->initialState->provideInitialState(
					Application::APP_ID,
					'config',
					$this->configService->getFrontendConfig()
				);
			} catch (\Throwable $e) {
				// Ignoruj błędy stanu początkowego — frontend użyje domyślnej konfiguracji
			}
		}
		if (self::$scriptAdded) {
			return;
		}
		self::$scriptAdded = true;
		Util::addScript(Application::APP_ID, 'redirect');
	}
}
