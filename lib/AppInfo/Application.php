<?php

declare(strict_types=1);

namespace OCA\MemoriesVideoRedirect\AppInfo;

use OCA\Files\Event\LoadAdditionalScriptsEvent;
use OCA\MemoriesVideoRedirect\Listener\LoadScriptsListener;
use OCA\MemoriesVideoRedirect\Settings\Admin;
use OCA\MemoriesVideoRedirect\Settings\AdminSection;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
use OCP\IRequest;
use OCP\Settings\IManager as ISettingsManager;

class Application extends App implements IBootstrap {
	public const APP_ID = 'memories_video_redirect';

	public function __construct(array $urlParams = []) {
		parent::__construct(self::APP_ID, $urlParams);
	}

	public function register(IRegistrationContext $context): void {
		$context->registerEventListener(
			LoadAdditionalScriptsEvent::class,
			LoadScriptsListener::class
		);

		$context->registerEventListener(
			BeforeTemplateRenderedEvent::class,
			LoadScriptsListener::class
		);
	}

	public function boot(IBootContext $context): void {
		// Zabezpieczenie na wypadek nieaktualnego cache info.xml (APCu/Redis):
		// gwarantuje rejestrację sekcji i formularza ustawień administratora na stronach /settings.
		try {
			$container = $context->getServerContainer();
			/** @var IRequest $request */
			$request = $container->get(IRequest::class);
			$pathInfo = (string) ($request->getPathInfo() ?? '');
			$requestUri = (string) ($request->getRequestUri() ?? '');
			if (
				!str_contains($pathInfo, '/settings')
				&& !str_contains($requestUri, '/settings')
			) {
				return;
			}

			/** @var ISettingsManager $settingsManager */
			$settingsManager = $container->get(ISettingsManager::class);
			if ($settingsManager->getSection('admin', self::APP_ID) === null) {
				$settingsManager->registerSection('admin', AdminSection::class);
			}
			if (empty($settingsManager->getAdminSettings(self::APP_ID))) {
				$settingsManager->registerSetting('admin', Admin::class);
			}
		} catch (\Throwable $e) {
			// Nie blokuj uruchamiania aplikacji w razie błędu podczas bootowania
		}
	}
}
