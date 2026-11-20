<?php

declare(strict_types=1);

namespace OCA\MemoriesVideoRedirect\Settings;

use OCA\MemoriesVideoRedirect\AppInfo\Application;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\Settings\IIconSection;

class AdminSection implements IIconSection {
	public function __construct(
		private IL10N $l10n,
		private IURLGenerator $urlGenerator,
	) {
	}

	public function getIcon(): string {
		return $this->urlGenerator->imagePath(Application::APP_ID, 'app.svg');
	}

	public function getID(): string {
		return Application::APP_ID;
	}

	public function getName(): string {
		return $this->l10n->t('Memories Redirect');
	}

	public function getPriority(): int {
		return 85;
	}
}
