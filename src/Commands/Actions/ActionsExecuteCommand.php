<?php

declare(strict_types=1);

namespace Native\src\Commands\Actions;

use Native\src\Actions\ActionManager;
use Native\src\Commands\BaseCommand;

class ActionsExecuteCommand extends BaseCommand
{
    public function __construct(
        protected ?ActionManager $manager = null
    ) {}

    public static function getCommandName(): string
    {
        return 'actions:execute';
    }

    public function __invoke(array $params): array
    {
        $name = $params['action'] ?? null;

        if (! $name) {
            return $this->error('No action name provided');
        }

        if (! $this->manager) {
            return $this->error('ActionManager not available');
        }

        $actionParams = $params['params'] ?? [];

        return $this->manager->executeAction($name, $actionParams);
    }
}
