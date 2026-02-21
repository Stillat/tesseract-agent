<?php

declare(strict_types=1);

namespace Native\src\Commands\Logs;

use Native\src\AgentConfig;

trait LogReaderTrait
{
    protected const MAX_CHUNK_BYTES = AgentConfig::LOG_CHUNK_MAX_BYTES;

    protected const MAX_LINES = AgentConfig::LOG_MAX_LINES;

    /**
     * Read log lines from a file starting at the given offset.
     */
    protected function readLogLines(string $path, int $offset = 0, int $maxBytes = 102400, bool $skipPartial = false): array
    {
        if (! file_exists($path)) {
            return ['lines' => [], 'offset' => 0, 'fileSize' => 0];
        }

        $fileSize = filesize($path);

        $offset = $this->resolveOffset($offset, $fileSize, $maxBytes);

        if ($offset > $fileSize) {
            $offset = 0;
        }

        // If no new content, return empty
        if ($offset >= $fileSize) {
            return ['lines' => [], 'offset' => $offset, 'fileSize' => $fileSize];
        }

        $handle = fopen($path, 'r');
        if (! $handle) {
            return ['lines' => [], 'offset' => $offset, 'fileSize' => $fileSize];
        }

        fseek($handle, $offset);

        if ($skipPartial && $offset > 0) {
            fgets($handle);
        }

        $lines = [];
        $bytesRead = 0;

        while (! feof($handle) && $bytesRead < $maxBytes && count($lines) < self::MAX_LINES) {
            $line = fgets($handle);
            if ($line === false) {
                break;
            }
            $bytesRead += strlen($line);
            $trimmedLine = rtrim($line, "\r\n");

            if ($trimmedLine !== '') {
                $parsedLine = $this->parseLogLine($trimmedLine);

                if ($parsedLine['isValidHeader']) {
                    $lines[] = $parsedLine;
                } elseif (! empty($lines)) {
                    $lastIndex = count($lines) - 1;
                    $lines[$lastIndex]['text'] .= "\n".$trimmedLine;
                }
            }
        }

        $newOffset = ftell($handle);
        fclose($handle);

        return [
            'lines' => $lines,
            'offset' => $newOffset,
            'fileSize' => $fileSize,
        ];
    }

    protected function resolveOffset(int $offset, int $fileSize, int $maxBytes): int
    {
        return $offset;
    }

    protected function parseLogLine(string $line): array
    {
        $pattern = '/^\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)\]\s+(\w+)\.(emergency|alert|critical|error|warning|notice|info|debug):\s*/i';

        if (preg_match($pattern, $line, $matches)) {
            return [
                'text' => $line,
                'level' => strtolower($matches[3]),
                'timestamp' => $matches[1],
                'channel' => $matches[2],
                'isValidHeader' => true,
            ];
        }

        return [
            'text' => $line,
            'level' => null,
            'timestamp' => null,
            'channel' => null,
            'isValidHeader' => false,
        ];
    }
}
