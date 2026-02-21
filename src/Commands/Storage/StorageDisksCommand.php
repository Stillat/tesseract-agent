<?php

declare(strict_types=1);

namespace Native\Agent\Commands\Storage;

use Native\Agent\Commands\BaseCommand;
use Throwable;

class StorageDisksCommand extends BaseCommand
{
    public static function getCommandName(): string
    {
        return 'storage:disks';
    }

    public function __invoke(array $params): array
    {
        try {
            $config = config('filesystems.disks', []);
            $disks = [];

            foreach ($config as $name => $diskConfig) {
                $disks[] = [
                    'name' => $name,
                    'driver' => $diskConfig['driver'] ?? 'unknown',
                    'root' => $diskConfig['root'] ?? null,
                    'url' => $diskConfig['url'] ?? null,
                    'isDefault' => $name === config('filesystems.default'),
                ];
            }

            return $this->success(['disks' => $disks]);
        } catch (Throwable $e) {
            return $this->error($e->getMessage());
        }
    }
}
