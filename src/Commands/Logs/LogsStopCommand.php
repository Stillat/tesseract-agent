<?php

declare(strict_types=1);

namespace Native\Agent\Commands\Logs;

use Native\Agent\Commands\BaseCommand;

class LogsStopCommand extends BaseCommand
{
    public static function getCommandName(): string
    {
        return 'logs:stop';
    }

    public function __invoke(array $params): array
    {
        return ['stopped' => true];
    }
}
