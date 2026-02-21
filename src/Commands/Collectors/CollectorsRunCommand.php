<?php

declare(strict_types=1);

namespace Native\src\Commands\Collectors;

use Native\src\Collectors\CollectorManager;
use Native\src\Commands\BaseCommand;

class CollectorsRunCommand extends BaseCommand
{
    public function __construct(
        protected ?CollectorManager $manager = null
    ) {}

    public static function getCommandName(): string
    {
        return 'collectors:run';
    }

    public function __invoke(array $params): array
    {
        $name = $params['collector'] ?? null;

        if (! $name) {
            return $this->error('No collector name provided');
        }

        if (! $this->manager) {
            return $this->error('CollectorManager not available');
        }

        $result = $this->manager->runCollector($name);

        if ($result === null) {
            return $this->error("Collector '{$name}' not found");
        }

        return $result;
    }
}
