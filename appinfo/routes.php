<?php

declare(strict_types=1);

return [
	'routes' => [
		[
			'name' => 'redirect#resolve',
			'url' => '/api/resolve/{fileId}',
			'verb' => 'GET',
			'requirements' => [
				'fileId' => '\d+',
			],
		],
		[
			'name' => 'redirect#open',
			'url' => '/open/{fileId}',
			'verb' => 'GET',
			'requirements' => [
				'fileId' => '\d+',
			],
		],
	],
];
