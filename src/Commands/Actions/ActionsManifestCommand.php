<?php

declare(strict_types=1);

namespace Native\src\Commands\Actions;

use Native\src\Actions\ActionManager;
use Native\src\Commands\BaseCommand;

class ActionsManifestCommand extends BaseCommand
{
    public function __construct(
        protected ?ActionManager $manager = null
    ) {}

    public static function getCommandName(): string
    {
        return 'actions:manifest';
    }

    public function __invoke(array $params): array
    {
        if (! $this->manager) {
            return $this->error('ActionManager not available');
        }

        return $this->success([
            'actions' => $this->manager->getManifest(),
            'environment' => app()->environment(),
        ]);
    }
}
