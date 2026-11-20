<?php

declare(strict_types=1);

namespace OCA\MemoriesVideoRedirect\Controller;

use OCA\MemoriesVideoRedirect\AppInfo\Application;
use OCA\MemoriesVideoRedirect\Service\ConfigService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;

class SettingsController extends Controller {
	public function __construct(
		IRequest $request,
		private ConfigService $configService,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	public function save(): JSONResponse {
		$params = $this->request->getParams();
		if (!is_array($params) || count($params) === 0) {
			$rawBody = @file_get_contents('php://input');
			if (is_string($rawBody) && $rawBody !== '') {
				$decoded = json_decode($rawBody, true);
				if (is_array($decoded)) {
					$params = $decoded;
				}
			}
		}

		$allowedKeys = [
			'redirectVideos',
			'redirectPhotos',
			'customExtensions',
			'excludedExtensions',
			'interceptDefaultClick',
			'blockDefaultViewer',
			'onTheFlyIndexing',
			'enableSingleItemFallback',
			'excludedPaths',
			'customActionLabel',
		];

		$payload = [];
		foreach ($allowedKeys as $key) {
			if (array_key_exists($key, $params)) {
				$payload[$key] = $params[$key];
			}
		}

		$saved = $this->configService->saveAdminSettings($payload);

		return new JSONResponse([
			'status' => 'ok',
			'settings' => $saved,
		], Http::STATUS_OK);
	}

	public function reset(): JSONResponse {
		$defaults = $this->configService->resetToDefaults();

		return new JSONResponse([
			'status' => 'ok',
			'settings' => $defaults,
		], Http::STATUS_OK);
	}
}
