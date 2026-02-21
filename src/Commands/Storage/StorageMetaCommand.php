<?php

declare(strict_types=1);

namespace Native\src\Commands\Storage;

use Illuminate\Support\Facades\Storage;
use Native\src\Commands\BaseCommand;
use Throwable;

class StorageMetaCommand extends BaseCommand
{
    public static function getCommandName(): string
    {
        return 'storage:meta';
    }

    public function __invoke(array $params): array
    {
        $disk = $params['disk'] ?? config('filesystems.default');
        $path = $params['path'] ?? null;

        if (! $path) {
            return $this->error('No path provided');
        }

        try {
            $storage = Storage::disk($disk);

            if (! $storage->exists($path)) {
                return $this->error('File not found');
            }

            $isFile = ! in_array($path, $storage->directories(dirname($path) ?: '.'), true);

            $meta = [
                'success' => true,
                'path' => $path,
                'isFile' => $isFile,
                'isDirectory' => ! $isFile,
                'lastModified' => $storage->lastModified($path),
            ];

            if ($isFile) {
                $meta['size'] = $storage->size($path);
                $meta['mimeType'] = $storage->mimeType($path);
                $meta['visibility'] = $storage->getVisibility($path);
                try {
                    $meta['url'] = $storage->url($path);
                } catch (\Throwable $e) {
                    $meta['url'] = null;
                }
            }

            return $meta;
        } catch (Throwable $e) {
            return $this->error($e->getMessage());
        }
    }
}
