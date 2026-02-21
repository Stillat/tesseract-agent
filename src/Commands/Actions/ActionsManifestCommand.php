<?php

declare(strict_types=1);

namespace Native\Agent\Commands\Actions;

use Native\Agent\Actions\ActionManager;
use Native\Agent\Commands\BaseCommand;

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
