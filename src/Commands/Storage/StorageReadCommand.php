<?php

declare(strict_types=1);

namespace Native\src\Commands\Storage;

use Illuminate\Support\Facades\Storage;
use Native\src\AgentConfig;
use Native\src\Commands\BaseCommand;
use Throwable;

class StorageReadCommand extends BaseCommand
{
    protected const MAX_READ_BYTES = AgentConfig::STORAGE_READ_MAX_BYTES;

    protected const MAX_IMAGE_SIZE = AgentConfig::STORAGE_IMAGE_MAX_SIZE;

    public static function getCommandName(): string
    {
        return 'storage:read';
    }

    public function __invoke(array $params): array
    {
        $disk = $params['disk'] ?? config('filesystems.default');
        $path = $params['path'] ?? null;
        $offset = (int) ($params['offset'] ?? 0);
        $maxBytes = min((int) ($params['maxBytes'] ?? self::MAX_READ_BYTES), self::MAX_READ_BYTES);

        if (! $path) {
            return $this->error('No path provided');
        }

        try {
            $storage = Storage::disk($disk);

            if (! $storage->exists($path)) {
                return $this->error('File not found');
            }

            $fileSize = $storage->size($path);
            $mimeType = $storage->mimeType($path) ?: 'application/octet-stream';
            $extension = strtolower(pathinfo($path, PATHINFO_EXTENSION));

            // Determine the file type (MIME first, then extension fallback)
            $isText = $this->isTextMimeType($mimeType) || $this->isTextExtension($extension);
            $isImage = str_starts_with($mimeType, 'image/');

            // For images, return base64 encoded (up to 5MB)
            if ($isImage) {
                if ($fileSize > self::MAX_IMAGE_SIZE) {
                    return $this->success([
                        'type' => 'image',
                        'tooLarge' => true,
                        'size' => $fileSize,
                        'mimeType' => $mimeType,
                    ]);
                }

                $content = $storage->get($path);

                return $this->success([
                    'type' => 'image',
                    'content' => base64_encode($content),
                    'size' => $fileSize,
                    'mimeType' => $mimeType,
                ]);
            }

            // For binary files, just return metadata
            if (! $isText) {
                return $this->success([
                    'type' => 'binary',
                    'size' => $fileSize,
                    'mimeType' => $mimeType,
                    'extension' => pathinfo($path, PATHINFO_EXTENSION),
                ]);
            }

            // For text files, try streaming with offset first
            $stream = $storage->readStream($path);

            // Fallback to direct read if streaming not supported or fails
            if (! $stream) {
                // Use direct get() as fallback (loads an entire file into memory)
                $content = $storage->get($path);
                if ($content === false || $content === null) {
                    return $this->error('Cannot read file content');
                }

                // Apply offset and maxBytes manually
                if ($offset > 0) {
                    $content = substr($content, $offset);
                }
                $fullLength = strlen($content);
                if ($fullLength > $maxBytes) {
                    $content = substr($content, 0, $maxBytes);
                }

                return $this->success([
                    'type' => 'text',
                    'content' => $content,
                    'offset' => $offset + strlen($content),
                    'size' => $fileSize,
                    'isComplete' => ($offset + strlen($content)) >= $fileSize,
                    'mimeType' => $mimeType,
                    'extension' => $extension,
                ]);
            }

            if ($offset > 0) {
                fseek($stream, $offset);
            }
            $content = fread($stream, $maxBytes);
            $newOffset = ftell($stream);
            $isComplete = feof($stream);
            fclose($stream);

            if ($content === false) {
                return $this->error('Failed to read file stream');
            }

            return $this->success([
                'type' => 'text',
                'content' => $content,
                'offset' => $newOffset,
                'size' => $fileSize,
                'isComplete' => $isComplete,
                'mimeType' => $mimeType,
                'extension' => $extension,
            ]);
        } catch (Throwable $e) {
            return $this->error($e->getMessage());
        }
    }

    /**
     * Check if a MIME type represents a text file.
     */
    protected function isTextMimeType(string $mimeType): bool
    {
        $textTypes = [
            'text/',
            'application/json',
            'application/javascript',
            'application/xml',
            'application/x-httpd-php',
            'application/sql',
            'application/x-sh',
            'application/x-yaml',
            'application/xhtml+xml',
            'application/x-php',
            'application/x-plist',
            'application/x-apple-plist',
            'application/toml',
            'application/x-ruby',
            'application/x-python',
            'application/x-perl',
            'application/ld+json',
            'application/manifest+json',
            'application/x-ndjson',
        ];

        foreach ($textTypes as $type) {
            if (str_starts_with($mimeType, $type) || $mimeType === $type) {
                return true;
            }
        }

        return false;
    }

    protected function isTextExtension(string $extension): bool
    {
        $textExtensions = [
            // iOS-specific
            'plist', 'strings', 'stringsdict', 'entitlements', 'xcconfig',
            'pbxproj', 'xcscheme', 'xcworkspacedata', 'storyboard', 'xib',
            'swift', 'm', 'h', 'mm',
            // Android-specific
            'gradle', 'pro', 'properties', 'smali',
            'kt', 'java',
            // Config files
            'ini', 'conf', 'cfg', 'rc', 'env', 'toml',
            'editorconfig', 'eslintrc', 'prettierrc', 'babelrc',
            // Log files
            'log',
            // Shell scripts
            'zsh', 'bash', 'fish', 'csh', 'ksh',
            // Data formats
            'csv', 'tsv', 'ndjson', 'jsonl',
            // Documentation
            'rst', 'adoc', 'textile',
            // Dotfiles (common ones)
            'gitignore', 'gitattributes', 'dockerignore', 'npmignore',
            'htaccess', 'htpasswd',
            // Lock files (usually JSON or YAML)
            'lock',
            // Mobile project files
            'podspec', 'gemspec',
            // Ruby
            'rb', 'rake', 'gemfile',
        ];

        return in_array(strtolower($extension), $textExtensions, true);
    }
}
