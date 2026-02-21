<?php

declare(strict_types=1);

namespace Native\Agent\Commands\Collectors;

use Native\Agent\Collectors\CollectorManager;
use Native\Agent\Commands\BaseCommand;

class CollectorsCollectCommand extends BaseCommand
{
    public function __construct(
        protected ?CollectorManager $manager = null
    ) {}

    public static function getCommandName(): string
    {
        return 'collectors:collect';
    }

    public function __invoke(array $params): array
    {
        if (! $this->manager) {
            return $this->error('CollectorManager not available');
        }

        return $this->success([
            'data' => $this->manager->collectAll(),
        ]);
    }
}
