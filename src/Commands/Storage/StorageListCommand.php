<?php

declare(strict_types=1);

namespace Native\Agent\Commands\Storage;

use Illuminate\Support\Facades\Storage;
use Native\Agent\Commands\BaseCommand;
use Throwable;

class StorageListCommand extends BaseCommand
{
    public static function getCommandName(): string
    {
        return 'storage:list';
    }

    public function __invoke(array $params): array
    {
        $disk = $params['disk'] ?? config('filesystems.default');
        $path = $params['path'] ?? '';
        $fetchMeta = $params['fetchMeta'] ?? null; // null = auto-detect

        try {
            $storage = Storage::disk($disk);
            $diskConfig = config("filesystems.disks.{$disk}", []);
            $driver = $diskConfig['driver'] ?? 'local';

            $shouldFetchMeta = $fetchMeta ?? ($driver === 'local');

            $items = [];

            foreach ($storage->directories($path) as $dir) {
                $items[] = [
                    'id' => $dir,
                    'name' => basename($dir),
                    'path' => $dir,
                    'type' => 'folder',
                ];
            }

            foreach ($storage->files($path) as $file) {
                $item = [
                    'id' => $file,
                    'name' => basename($file),
                    'path' => $file,
                    'type' => 'file',
                    'extension' => pathinfo($file, PATHINFO_EXTENSION),
                ];

                // Only fetch per-file metadata for local disks
                if ($shouldFetchMeta) {
                    try {
                        $item['size'] = $storage->size($file);
                        $item['lastModified'] = $storage->lastModified($file);
                    } catch (Throwable $e) {
                    }
                }

                $items[] = $item;
            }

            usort($items, fn ($a, $b) => ($a['type'] === $b['type'])
                    ? strcasecmp($a['name'], $b['name'])
                    : ($a['type'] === 'folder' ? -1 : 1)
            );

            return $this->success([
                'disk' => $disk,
                'driver' => $driver,
                'path' => $path,
                'items' => $items,
                'metaIncluded' => $shouldFetchMeta,
            ]);
        } catch (Throwable $e) {
            return $this->error($e->getMessage());
        }
    }
}
