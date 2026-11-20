<?php

declare(strict_types=1);

namespace OCA\MemoriesVideoRedirect\Settings;

use OCA\MemoriesVideoRedirect\AppInfo\Application;
use OCA\MemoriesVideoRedirect\Service\ConfigService;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\Settings\ISettings;
use OCP\Util;

class Admin implements ISettings {
	public function __construct(
		private ConfigService $configService,
	) {
	}

	public function getForm(): TemplateResponse {
		Util::addScript(Application::APP_ID, 'admin-settings');
		Util::addStyle(Application::APP_ID, 'admin-settings');

		$params = [
			'settings' => $this->configService->getAdminSettings(),
			'diagnostics' => $this->configService->getDiagnostics(),
			'defaultVideoExtensions' => ConfigService::DEFAULT_VIDEO_EXTENSIONS,
			'defaultImageExtensions' => ConfigService::DEFAULT_IMAGE_EXTENSIONS,
			'defaultExcludedExtensions' => ConfigService::DEFAULT_EXCLUDED_EXTENSIONS,
		];

		return new TemplateResponse(Application::APP_ID, 'admin', $params, '');
	}

	public function getSection(): string {
		return Application::APP_ID;
	}

	public function getPriority(): int {
		return 10;
	}
}
