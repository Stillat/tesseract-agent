<?php

declare(strict_types=1);

namespace Native\src\Commands\Logs;

use Native\src\Commands\BaseCommand;
use Throwable;

class LogsStartCommand extends BaseCommand
{
    use LogReaderTrait;

    public static function getCommandName(): string
    {
        return 'logs:start';
    }

    public function __invoke(array $params): array
    {
        $path = storage_path('logs/laravel.log');

        try {
            return $this->readLogLines($path, 0, self::MAX_CHUNK_BYTES, skipPartial: true);
        } catch (Throwable $e) {
            return $this->error($e->getMessage());
        }
    }

    /**
     * For initial log tailing, start from the end of the file minus maxBytes.
     */
    protected function resolveOffset(int $offset, int $fileSize, int $maxBytes): int
    {
        if ($offset === 0) {
            return max(0, $fileSize - $maxBytes);
        }

        return $offset;
    }
}
