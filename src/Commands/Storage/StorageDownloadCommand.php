<?php

declare(strict_types=1);

namespace Native\src\Commands\Storage;

use Illuminate\Support\Facades\Storage;
use Native\src\Commands\BaseCommand;
use Throwable;

class StorageDownloadCommand extends BaseCommand
{
    public static function getCommandName(): string
    {
        return 'storage:download';
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

            $fileSize = $storage->size($path);

            $maxDownloadSize = 50 * 1024 * 1024;
            if ($fileSize > $maxDownloadSize) {
                return $this->error('File too large to download (max 50MB)', [
                    'size' => $fileSize,
                ]);
            }

            $content = $storage->get($path);
            if ($content === false || $content === null) {
                return $this->error('Cannot read file content');
            }

            $mimeType = $storage->mimeType($path) ?: 'application/octet-stream';
            $fileName = basename($path);

            return $this->success([
                'content' => base64_encode($content),
                'mimeType' => $mimeType,
                'fileName' => $fileName,
                'size' => $fileSize,
            ]);
        } catch (Throwable $e) {
            return $this->error($e->getMessage());
        }
    }
}
