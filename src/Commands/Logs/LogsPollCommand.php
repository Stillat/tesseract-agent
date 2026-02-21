<?php

declare(strict_types=1);

namespace Native\src\Commands\Logs;

use Native\src\Commands\BaseCommand;
use Throwable;

class LogsPollCommand extends BaseCommand
{
    use LogReaderTrait;

    public static function getCommandName(): string
    {
        return 'logs:poll';
    }

    public function __invoke(array $params): array
    {
        $path = storage_path('logs/laravel.log');
        $offset = (int) ($params['offset'] ?? 0);

        try {
            // skipPartial=false because offset is from previous ftell() (already at line boundary)
            return $this->readLogLines($path, $offset, self::MAX_CHUNK_BYTES, skipPartial: false);
        } catch (Throwable $e) {
            return $this->error($e->getMessage());
        }
    }
}
