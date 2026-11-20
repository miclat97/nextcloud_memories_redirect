<?php

declare(strict_types=1);

namespace OCA\MemoriesVideoRedirect\AppInfo;

use OCA\Files\Event\LoadAdditionalScriptsEvent;
use OCA\MemoriesVideoRedirect\Listener\LoadScriptsListener;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;

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
	}
}
